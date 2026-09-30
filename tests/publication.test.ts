import { readFileSync } from "node:fs";
import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { liveServices } from "../src/adapters/live.js";
import { githubPublisher } from "../src/adapters/publish.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import { nextLedger, prepareFindings, selectLedger, standingCards } from "../src/ledger.js";
import { findingTally, render } from "../src/render.js";
import { review } from "../src/review.js";
import { configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import type { Card, Review, ReviewResult, RoundScope } from "../src/types.js";
import cases from "./publication-scenarios.json" with { type: "json" };

const recording = JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
const r = requestSchema.parse(recording.request);
const clean = await review(r, recording.config, recordedServices(recording));
if (clean.kind !== "reviewed") throw new Error("Invalid test source");
const baseReview: Review = clean;
const options = {
  checks: {
    triage: "review / triage",
    review: "review / margot",
    authority: "review / self-instrument",
  },
  actor: "reviewer[bot]",
  appId: 42,
  runUrl: "https://github.com/example/instance/actions/runs/1",
};
function scenario(
  id: string,
  exercise: (broken: boolean) => Promise<unknown> | unknown,
  expected: object,
) {
  const spec = cases.find((c) => c.id === id);
  if (!spec) throw new Error(id);
  it(spec.name, async () =>
    expect(await exercise(process.env.MARGOT_ADAPTER_BREAK === id)).toMatchObject(expected),
  );
}
async function wire(mode = "clear", broken = false) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const stored = new Map<number, Record<string, unknown>>();
  if (mode === "adopt" && !broken)
    stored.set(88, {
      id: 88,
      name: options.checks.review,
      head_sha: r.head,
      app: { id: options.appId },
      status: "in_progress",
      details_url: "https://github.com/example/caller/actions/runs/1",
    });
  const reviews: Record<string, unknown>[] = [];
  let armed = mode === "hold" || mode === "disarm-fail";
  let evaluated = false;
  let moved = false;
  let sequence = 0;
  const defect = (name: string) => mode === name && !broken;
  if (defect("order") || defect("error"))
    reviews.push({
      id: 77,
      user: { login: options.actor, type: "Bot" },
      state: "APPROVED",
      commit_id: r.head,
    });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown;
    if (method === "GET") {
      if (path.endsWith("/reviews")) data = reviews;
      else if (path.endsWith("/check-runs"))
        data = { check_runs: [...stored.values()], total_count: stored.size };
      else if (/\/check-runs\/\d+$/.test(path)) data = stored.get(Number(path.split("/").at(-1)));
      else
        data = {
          node_id: "PR_1",
          state: defect("closed") ? "closed" : "open",
          draft: defect("draft"),
          head: {
            sha: moved ? "f".repeat(40) : r.head,
            repo: { full_name: defect("fork") ? "other/repo" : r.repository },
          },
          base: { sha: defect("base") ? "f".repeat(40) : r.base },
          auto_merge: armed ? {} : null,
        };
    } else {
      writes.push({ method, path, body });
      if (
        (defect("start-fail") && body.status === "in_progress") ||
        (defect("review-fail") && path.endsWith("/reviews")) ||
        (defect("final-fail") &&
          body.name === options.checks.review &&
          body.conclusion === "success")
      )
        return new Response(JSON.stringify({ message: "Recorded write failure" }), { status: 422 });
      if (path === "/graphql") {
        if (!defect("disarm-fail")) armed = false;
        data = { data: { disablePullRequestAutoMerge: { pullRequest: { id: "PR_1" } } } };
      } else if (path.endsWith("/dismissals")) {
        const id = Number(path.split("/").at(-2));
        const item = reviews.find((v) => v.id === id);
        if (item) item.state = "DISMISSED";
        data = { state: "DISMISSED" };
      } else if (path.endsWith("/reviews")) {
        data = {
          id: ++sequence,
          commit_id: defect("receipt") ? "f".repeat(40) : body.commit_id,
          user: { login: options.actor, type: "Bot" },
          state: body.event === "APPROVE" ? "APPROVED" : "COMMENTED",
        };
        reviews.push(data as Record<string, unknown>);
      } else {
        const id = method === "POST" ? ++sequence : Number(path.split("/").at(-1));
        data = {
          ...stored.get(id),
          ...body,
          id,
          app: { id: defect("identity") ? 999 : options.appId },
        };
        stored.set(id, data as Record<string, unknown>);
        if (defect("head") && body.name === options.checks.authority) moved = true;
      }
    }
    const response = new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  }) as typeof fetch;
  const publisher = githubPublisher(
    new Octokit({
      request: { fetch: fetcher },
      retry: { enabled: false },
      throttle: { enabled: false },
    }),
    options,
  );
  const request = { ...r, phase: mode === "triage" ? ("triage" as const) : ("review" as const) };
  const result = await publisher.run(request, async (): Promise<ReviewResult> => {
    evaluated = true;
    if (defect("superseded")) {
      const gate = [...stored.values()].find((v) => v.name === options.checks.review);
      if (gate) gate.details_url = "https://github.com/example/instance/actions/runs/2";
    }
    if (defect("error"))
      return { kind: "error", stage: "card", diagnostic: "Recorded timeout", mergeEligible: false };
    if (mode === "triage")
      return {
        kind: "classified",
        request,
        classification: broken ? "functional" : "documentation",
      };
    const value = structuredClone(baseReview);
    if (
      (["hold", "authority", "calibration"].includes(mode) && !broken) ||
      mode === "disarm-fail"
    ) {
      value.decision.mergeEligible = false;
      value.decision.holdReasons = [
        mode === "authority" ? "review-authority" : mode === "calibration" ? "calibration" : "risk",
      ];
      value.decision.rating.band = "HIGH";
    }
    if (mode === "clear" && broken) {
      value.decision.mergeEligible = false;
      value.decision.holdReasons = ["risk"];
    }
    const report = render(value);
    const publication = await publisher.publish(
      { expectedHead: r.head, review: value, report },
      { signal: AbortSignal.timeout(3000) },
    );
    return {
      kind: "reviewed",
      ...value,
      report,
      publication: publication as Extract<ReviewResult, { kind: "reviewed" }>["publication"],
    };
  });
  const final = [...stored.values()].find(
    (v) => v.name === (mode === "triage" ? options.checks.triage : options.checks.review),
  );
  const authority = [...stored.values()].find((v) => v.name === options.checks.authority);
  return { result, writes, reviews, evaluated, armed, final, authority };
}
scenario(
  "pub-clear",
  async (b) => {
    const x = await wire("clear", b);
    const approve = x.writes.findIndex((w) => w.body.event === "APPROVE");
    const success = x.writes.findIndex(
      (w) => w.body.name === options.checks.review && w.body.conclusion === "success",
    );
    return {
      kind: x.result.kind,
      approveBeforeSuccess: approve >= 0 && success > approve,
      head: x.writes.find((w) => w.body.event === "APPROVE")?.body.commit_id,
      merged: x.writes.some(
        (w) =>
          w.path.endsWith("/merge") ||
          JSON.stringify(w.body).includes("enablePullRequestAutoMerge"),
      ),
    };
  },
  { kind: "reviewed", approveBeforeSuccess: true, head: r.head, merged: false },
);
scenario(
  "pub-hold",
  async (b) => {
    const x = await wire("hold", b);
    return {
      armed: x.armed,
      conclusion: x.final?.conclusion,
      event: x.writes.find((w) => w.path.endsWith("/reviews"))?.body.event,
    };
  },
  { armed: false, conclusion: "neutral", event: "COMMENT" },
);
scenario(
  "pub-authority",
  async (b) => ({ conclusion: (await wire("authority", b)).authority?.conclusion }),
  { conclusion: "neutral" },
);
scenario(
  "pub-calibration",
  async (b) => ({ conclusion: (await wire("calibration", b)).final?.conclusion }),
  { conclusion: "action_required" },
);
scenario(
  "pub-triage",
  async (b) => {
    const x = await wire("triage", b);
    return {
      text: JSON.parse((x.final?.output as { text?: string } | undefined)?.text ?? "{}"),
      reviews: x.reviews.length,
    };
  },
  {
    text: { head_sha: r.head, classification: "documentation", decision_source: "jev" },
    reviews: 0,
  },
);
for (const mode of ["closed", "fork", "draft", "base"])
  scenario(
    `pub-${mode}`,
    async (b) => {
      const x = await wire(mode, b);
      return { kind: x.result.kind, evaluated: x.evaluated, writes: x.writes.length };
    },
    { kind: "error", evaluated: false, writes: 0 },
  );
for (const mode of ["head", "start-fail", "review-fail", "disarm-fail", "identity"])
  scenario(
    `pub-${mode}`,
    async (b) => {
      const x = await wire(mode, b);
      return { kind: x.result.kind, approved: x.reviews.some((v) => v.state === "APPROVED") };
    },
    { kind: "error", approved: false },
  );
for (const mode of ["final-fail", "error", "receipt"])
  scenario(
    `pub-${mode}`,
    async (b) => {
      const x = await wire(mode, b);
      return {
        kind: x.result.kind,
        conclusion: x.final?.conclusion,
        dismissed: x.reviews.some((v) => v.state === "DISMISSED"),
        approved: x.reviews.some((v) => v.state === "APPROVED"),
      };
    },
    { kind: "error", conclusion: "action_required", dismissed: true, approved: false },
  );
scenario(
  "pub-order",
  async (b) => {
    const x = await wire("order", b);
    return { dismissed: x.reviews.find((v) => v.id === 77)?.state };
  },
  { dismissed: "DISMISSED" },
);
scenario(
  "pub-shadow",
  async (b) => {
    const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
    const { services, actions } = liveServices(config, { jevKey: "unused" });
    if (!b) await services.disableAutoMerge(r, { signal: AbortSignal.timeout(1000) });
    return { actions };
  },
  { actions: [{ action: "would-disable-auto-merge", request: r }] },
);
function tallyReview() {
  const value = structuredClone(baseReview);
  value.convergence.round = 2;
  value.ledger.round = 2;
  value.ledger.entries = ["standing", "fixed", "dismissed", "advisory"].map((status, i) => ({
    key: `${i === 2 || i === 3 ? "R2" : "R1"}-F${i + 1}`,
    card: "safety",
    status: status as "standing",
    severity: "MAJOR",
    round_raised: i === 2 || i === 3 ? 2 : 1,
    location: "a.ts:1",
    what: "Recorded issue",
    reason: "Recorded reason",
    ...(i === 3 ? { late: "missed: outside the earlier delta" } : {}),
  }));
  return value;
}
scenario(
  "tally",
  () => {
    const value = tallyReview();
    const report = render(value);
    const tally = findingTally(value);
    const listed = report.split("\n").filter((line) => /^- R\d+-F\d+ \[/.test(line));
    return {
      tally,
      visible: report.includes(`New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`),
      new: listed.filter((l) => l.includes("; New")).length,
      open: listed.filter((l) => l.includes("[Open;")).length,
      closed: listed.filter((l) => l.includes("[Closed;")).length,
      fixed: listed.some((l) => l.includes("Closed; fixed")),
      dismissed: listed.some((l) => l.includes("Closed; dismissed")),
      late: listed.some((l) => l.includes("; late]")),
    };
  },
  {
    tally: { new: 2, open: 2, closed: 2 },
    visible: true,
    new: 2,
    open: 2,
    closed: 2,
    fixed: true,
    dismissed: true,
    late: true,
  },
);
scenario(
  "tally-history",
  (b) => {
    const value = tallyReview();
    value.convergence.round = 3;
    if (b) value.ledger.entries.splice(1, 1);
    return { tally: findingTally(value), late: render(value).includes("; late]") };
  },
  { tally: { new: 0, open: 2, closed: 2 }, late: true },
);

scenario(
  "pub-adopt",
  async (b) => {
    const x = await wire("adopt", b);
    return {
      adopted: x.writes.some((w) => w.path.endsWith("/check-runs/88")),
      duplicates: x.writes.filter(
        (w) => w.method === "POST" && w.body.name === options.checks.review,
      ).length,
    };
  },
  { adopted: true, duplicates: 0 },
);
scenario(
  "pub-superseded",
  async (b) => {
    const x = await wire("superseded", b);
    return {
      kind: x.result.kind,
      gateStillPending: x.final?.status === "in_progress",
      approved: x.reviews.some((v) => v.state === "APPROVED"),
    };
  },
  { kind: "error", gateStillPending: true, approved: false },
);

scenario(
  "pub-skip-policy",
  async (b) => {
    const copy = structuredClone(recording);
    const config = {
      ...(copy.config as object),
      requiredChecks: ["ci / optional"],
      trustedCheckActors: ["checks-app"],
      allowedSkippedChecks: b ? [] : ["ci / optional"],
    };
    copy.facts = {
      ...(copy.facts as object),
      checks: [{ name: "ci / optional", actor: "checks-app", head: r.head, conclusion: "skipped" }],
    };
    return { kind: (await review(r, config, recordedServices(copy))).kind };
  },
  { kind: "reviewed" },
);

scenario(
  "tally-advisory-fix",
  (b) => {
    const value = tallyReview();
    const advisory = value.ledger.entries.filter((e) => e.status === "advisory");
    const scope: RoundScope = {
      round: 3,
      priorHead: r.head,
      full: false,
      diff: "delta",
      files: [],
      entries: advisory,
    };
    const card: Card = {
      name: "safety",
      completion: "completed",
      checked: ["Verified the earlier advisory"],
      notCovered: [],
      findings: [],
      resolved: b
        ? []
        : advisory.map((e) => ({ key: e.key, reason: "a.ts:1 now validates input" })),
    };
    prepareFindings([card], scope);
    const next = nextLedger(
      scope,
      [card],
      null,
      {
        request: value.request,
        classification: value.classification,
        cards: [card],
        voice: null,
        decision: value.decision,
        provenance: value.provenance,
      },
      configSchema.parse(recording.config),
      factsSchema.parse(recording.facts),
    );
    return { status: next.ledger.entries[0]?.status, recalled: standingCards(scope) };
  },
  { status: "fixed", recalled: ["safety"] },
);

scenario(
  "pub-run-url",
  (b) => {
    const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
    config.publisher = structuredClone(options);
    const before = liveServices(config, { jevKey: "unused" }).services.provenance;
    config.publisher.runUrl = "https://example.invalid/run/2";
    if (b) config.publisher.appId++;
    return {
      compatible: before === liveServices(config, { jevKey: "unused" }).services.provenance,
    };
  },
  { compatible: true },
);
scenario(
  "pub-rollback-ledger",
  (b) => {
    let body = render(baseReview);
    if (b) body = body.replace("<!-- margot-ledger:v1 ", "<!-- margot-ledger:v2 ");
    const block = body.match(/<!-- margot-ledger:v1 ([A-Za-z0-9+/=]+) -->$/);
    const legacy = block
      ? JSON.parse(Buffer.from(block[1] ?? "", "base64").toString("utf8"))
      : null;
    const config = configSchema.parse({
      ...(recording.config as object),
      trustedLedgerActors: [options.actor],
    });
    let restored: ReturnType<typeof selectLedger> = null;
    try {
      restored = selectLedger(
        {
          ...factsSchema.parse(recording.facts),
          history: {
            complete: true,
            priorLedger: true,
            reviews: [
              {
                id: 1,
                actor: options.actor,
                actorType: "Bot",
                head: r.head,
                submittedAt: "2026-09-30T20:00:00Z",
                body,
              },
            ],
          },
        },
        config,
      );
    } catch {
      restored = null;
    }
    return {
      legacyReadable: legacy?.v === 1 && legacy?.head === r.head && Array.isArray(legacy?.entries),
      restored,
    };
  },
  { legacyReadable: true, restored: baseReview.ledger },
);

scenario(
  "tally-late-advisory",
  (b) => {
    const scope: RoundScope = {
      round: 3,
      priorHead: r.head,
      full: false,
      diff: "delta",
      files: [],
      entries: [
        {
          key: "R2-F1",
          card: "principal-engineer",
          status: b ? "standing" : "advisory",
          severity: "MAJOR",
          round_raised: 2,
          location: "a.ts:1",
          what: "Earlier out-of-scope concern",
          late: "missed: outside earlier delta",
        },
      ],
    };
    const card: Card = {
      name: "principal-engineer",
      completion: "completed",
      checked: ["Rechecked the concern"],
      notCovered: [],
      findings: [
        {
          id: "F1",
          ledger: "R2-F1",
          tag: "issue",
          severity: "MAJOR",
          confidence: "HIGH",
          location: "a.ts:1",
          what: "Earlier out-of-scope concern",
        },
      ],
    };
    prepareFindings([card], scope);
    return { advisory: card.findings[0]?.advisory };
  },
  { advisory: "late-non-blocking" },
);
