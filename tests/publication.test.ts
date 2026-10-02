import { readFileSync } from "node:fs";
import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { liveServices } from "../src/adapters/live.js";
import { githubPublisher } from "../src/adapters/publish.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import { nextLedger, prepareFindings, selectLedger, standingCards } from "../src/ledger.js";
import { findingTally, render, renderCheckText } from "../src/render.js";
import { review } from "../src/review.js";
import { configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import type { Card, Review, ReviewResult, RoundScope } from "../src/types.js";
import cases from "./publication-scenarios.json" with { type: "json" };

const recording = JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
const r = requestSchema.parse(recording.request);
const clean = await review(r, recording.config, recordedServices(recording));
if (clean.kind !== "reviewed") throw new Error("Invalid test source");
const baseReview: Review = clean;
const commentRecording = JSON.parse(
  readFileSync("recordings/author-changes.json", "utf8"),
) as Recording;
const commentResult = await review(
  commentRecording.request,
  commentRecording.config,
  recordedServices(commentRecording),
);
if (commentResult.kind !== "reviewed") throw new Error("Invalid comment test source");
const commentReview: Review = commentResult;
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
  if (mode === "retry")
    stored.set(89, {
      id: 89,
      name: options.checks.review,
      head_sha: r.head,
      app: { id: options.appId },
      status: "completed",
      conclusion: "action_required",
      details_url: "https://github.com/example/caller/actions/runs/1",
    });
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
  const dismissedIds: number[] = [];
  let armed = ["hold", "disarm-fail", "head-after-approval", "merged", "cleanup-fail"].includes(
    mode,
  );
  let merged = false;
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
          state: defect("closed") || merged ? "closed" : "open",
          merged,
          draft: defect("draft"),
          head: {
            sha: moved ? "f".repeat(40) : r.head,
            repo: { full_name: defect("fork") ? "other/repo" : r.repository },
          },
          base: { sha: defect("base") || merged ? "f".repeat(40) : r.base },
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
      if (mode === "cleanup-fail") {
        const message =
          path === "/graphql"
            ? "Disarm denied"
            : path.endsWith("/dismissals")
              ? "Dismissal denied"
              : body.conclusion === "action_required"
                ? "Check denied"
                : undefined;
        if (message)
          return new Response(JSON.stringify({ message }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
      }
      if (path === "/graphql") {
        if (!defect("disarm-fail")) armed = false;
        data = { data: { disablePullRequestAutoMerge: { pullRequest: { id: "PR_1" } } } };
      } else if (path.endsWith("/dismissals")) {
        const id = Number(path.split("/").at(-2));
        dismissedIds.push(id);
        const item = reviews.find((v) => v.id === id);
        if (item) item.state = "DISMISSED";
        data = { state: "DISMISSED" };
      } else if (path.endsWith("/reviews")) {
        data = {
          id: ++sequence,
          commit_id: defect("receipt") || mode === "cleanup-fail" ? "f".repeat(40) : body.commit_id,
          user: { login: options.actor, type: "Bot" },
          state: body.event === "APPROVE" ? "APPROVED" : "COMMENTED",
        };
        if (!defect("receipt")) reviews.push(data as Record<string, unknown>);
        if (mode === "head-after-approval") moved = true;
      } else {
        const id = method === "POST" ? ++sequence : Number(path.split("/").at(-1));
        data = {
          ...stored.get(id),
          ...body,
          id,
          app: { id: defect("identity") ? 999 : options.appId },
        };
        stored.set(id, data as Record<string, unknown>);
        if (
          (mode === "confirm" || (mode === "clear" && broken)) &&
          body.name === options.checks.review &&
          body.conclusion === "success"
        )
          stored.set(id, { ...(data as Record<string, unknown>), status: "in_progress" });
        if (
          mode === "merged" &&
          body.name === options.checks.review &&
          body.conclusion === "success"
        ) {
          merged = true;
          armed = false;
        }
        if (
          mode === "head" &&
          body.name === options.checks.authority &&
          body.conclusion === "success"
        )
          moved = true;
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
    if (mode === "phase-titles") {
      const context = { signal: AbortSignal.timeout(3000) };
      await publisher.progress(
        "Margot: preflight complete — setting up the review runner",
        context,
      );
      if (!broken) await publisher.progress("Margot: council is reviewing the changes", context);
      await publisher.progress("Margot: posting the verdict", context);
    }
    const value = structuredClone(baseReview);
    if (defect("voice-error")) {
      // Margot's own ERROR ruling, as Python posted it: a COMMENT review, the check
      // `action_required`, titled `not reviewed (error)`.
      value.decision.outcome = "ERROR";
      value.decision.mergeEligible = false;
      value.decision.holdReasons = ["error"];
    }
    if (
      (["hold", "authority", "authority-summary", "calibration"].includes(mode) && !broken) ||
      mode === "disarm-fail"
    ) {
      value.decision.mergeEligible = false;
      value.decision.holdReasons = [
        mode.startsWith("authority")
          ? "review-authority"
          : mode === "calibration"
            ? "calibration"
            : "risk",
      ];
      value.decision.rating.band = "HIGH";
      if (mode === "authority-summary")
        value.decision.authorityPaths = [".github/workflows/review.yml", "config/review.json"];
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
  return { result, writes, reviews, dismissedIds, evaluated, armed, final, authority };
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
      successBeforeApprove: approve >= 0 && success > approve,
      head: x.writes.find((w) => w.body.event === "APPROVE")?.body.commit_id,
      finalStatus: x.final?.status,
      merged: x.writes.some(
        (w) =>
          w.path.endsWith("/merge") ||
          JSON.stringify(w.body).includes("enablePullRequestAutoMerge"),
      ),
    };
  },
  {
    kind: "reviewed",
    successBeforeApprove: true,
    head: r.head,
    finalStatus: "completed",
    merged: false,
  },
);
scenario(
  "pub-hold",
  async (b) => {
    const x = await wire("hold", b);
    return {
      armed: x.armed,
      ordered: (() => {
        const review = x.writes.findIndex((w) => w.path.endsWith("/reviews"));
        const disable = x.writes.findIndex((w) => w.path === "/graphql");
        const final = x.writes.findIndex(
          (w) => w.body.name === options.checks.review && w.body.conclusion === "neutral",
        );
        return review >= 0 && disable > review && final > disable;
      })(),
      conclusion: x.final?.conclusion,
      event: x.writes.find((w) => w.path.endsWith("/reviews"))?.body.event,
    };
  },
  { armed: false, ordered: true, conclusion: "neutral", event: "COMMENT" },
);
// Ollie's state script (dotty .github/scripts/ollie-state.py, parse_verdict) reads these
// lines from the check text and requests the operator's review on a held PR. Without them
// a hold is invisible to her; this is the live defect found on margot #94.
function parseVerdictLikeOllie(text: string | undefined) {
  const out = { outcome: "", band: "", source: "" };
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("outcome:")) {
      const parts = line
        .slice("outcome:".length)
        .split("|")
        .map((p) => p.trim());
      out.outcome = parts[0] ?? "";
      for (const p of parts.slice(1)) if (p.startsWith("band:")) out.band = p.slice(5).trim();
    } else if (line.startsWith("decision_source:")) out.source = line.slice(16).trim();
  }
  return out;
}
scenario(
  "pub-ollie-verdict",
  async (b) => {
    const x = await wire("hold", b);
    const output = (x.final?.output ?? {}) as { text?: string; title?: string };
    const parsed = parseVerdictLikeOllie(output.text);
    return { ...parsed, title: output.title };
  },
  {
    outcome: "APPROVED",
    band: "HIGH",
    source: "jev",
    title: "held for the operator: risk is HIGH",
  },
);
scenario(
  "pub-held-reason",
  async () => {
    const x = await wire("authority", false);
    return { title: ((x.final?.output ?? {}) as { title?: string }).title };
  },
  { title: "held for the operator: a change to Margot's own machinery" },
);
scenario(
  "pub-error-text",
  async () => {
    const x = await wire("review-fail", false);
    const output = (x.final?.output ?? {}) as { text?: string };
    return {
      kind: x.result.kind,
      staleApproval: parseVerdictLikeOllie(output.text).outcome,
      hasText: typeof output.text === "string" && output.text.length > 0,
    };
  },
  { kind: "error", staleApproval: "", hasText: true },
);
scenario(
  "pub-authority",
  async (b) => ({ conclusion: (await wire("authority", b)).authority?.conclusion }),
  { conclusion: "neutral" },
);
scenario(
  "pub-authority-summary",
  async (b) => {
    const held = await wire("authority-summary", b);
    const clear = await wire("clear");
    const protectedRecording = structuredClone(commentRecording);
    (protectedRecording.config as { protectedPaths: string[] }).protectedPaths = [".github/**"];
    const protectedResult = await review(
      protectedRecording.request,
      protectedRecording.config,
      recordedServices(protectedRecording),
    );
    return {
      held: (held.authority?.output as { summary?: string } | undefined)?.summary,
      clear: (clear.authority?.output as { summary?: string } | undefined)?.summary,
      matched:
        protectedResult.kind === "reviewed" ? protectedResult.decision.authorityPaths : undefined,
    };
  },
  {
    held: "This PR changes Margot's own config, the estate ownership map, or a gate workflow — a surface that could disarm the gate. Margot does not approve it herself; it merges on the operator's approval.\n\nMatched:\n- `.github/workflows/review.yml`\n- `config/review.json`",
    clear: "No functional change to a protected path (class: mechanical).",
    matched: [".github/workflows/ci.yml"],
  },
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
scenario(
  "pub-phase-titles",
  async (b) => {
    const x = await wire("phase-titles", b);
    return {
      titles: x.writes
        .filter(
          (write) =>
            write.body.name === options.checks.review && write.body.status === "in_progress",
        )
        .map((write) => (write.body.output as { title?: string }).title),
    };
  },
  {
    titles: [
      "Margot: preflight — mechanical checks",
      "Margot: preflight complete — setting up the review runner",
      "Margot: council is reviewing the changes",
      "Margot: posting the verdict",
    ],
  },
);
for (const mode of ["closed", "fork", "draft", "base"])
  scenario(
    `pub-${mode}`,
    async (b) => {
      const x = await wire(mode, b);
      return {
        kind: x.result.kind,
        evaluated: x.evaluated,
        writes: x.writes.length,
        title: ((x.final?.output ?? {}) as { title?: string }).title,
      };
    },
    {
      kind: "error",
      evaluated: false,
      writes: 1,
      title: `Margot: not reviewed: ${mode === "base" ? "stale" : mode}`,
    },
  );
for (const mode of ["start-fail", "review-fail", "identity"])
  scenario(
    `pub-${mode}`,
    async (b) => {
      const x = await wire(mode, b);
      return { kind: x.result.kind, approved: x.reviews.some((v) => v.state === "APPROVED") };
    },
    { kind: "error", approved: false },
  );
for (const mode of ["head", "confirm"])
  scenario(
    `pub-${mode}`,
    async () => {
      const x = await wire(mode);
      return {
        kind: x.result.kind,
        completedWrite: x.writes.some(
          (w) => w.body.name === options.checks.review && w.body.conclusion === "success",
        ),
        approvalAttempted: x.writes.some((w) => w.body.event === "APPROVE"),
      };
    },
    mode === "head"
      ? { kind: "error", completedWrite: false, approvalAttempted: false }
      : { kind: "error", completedWrite: true, approvalAttempted: true },
  );
scenario(
  "pub-head-after-approval",
  async () => {
    const x = await wire("head-after-approval");
    return {
      kind: x.result.kind,
      approved: x.writes.some((w) => w.body.event === "APPROVE"),
      dismissed: x.dismissedIds.length > 0,
      disarmed: x.writes.some((w) => String(w.body.query).includes("disablePullRequestAutoMerge")),
      armed: x.armed,
      approvalRemains: x.reviews.some((v) => v.state === "APPROVED"),
    };
  },
  {
    kind: "error",
    approved: true,
    dismissed: false,
    disarmed: true,
    armed: false,
    approvalRemains: true,
  },
);
scenario(
  "pub-merged",
  async () => {
    const x = await wire("merged");
    return {
      kind: x.result.kind,
      publication: x.result.kind === "reviewed" ? x.result.publication : undefined,
      dismissed: x.dismissedIds.length,
      conclusion: x.final?.conclusion,
    };
  },
  {
    kind: "reviewed",
    publication: { recorded: false, head: r.head },
    dismissed: 0,
    conclusion: "success",
  },
);
scenario(
  "pub-cleanup-fail",
  async () => {
    const x = await wire("cleanup-fail");
    return {
      kind: x.result.kind,
      diagnostic: x.result.kind === "error" ? x.result.diagnostic : "",
    };
  },
  {
    kind: "error",
    diagnostic:
      "Invalid native review receipt; disable auto-merge cleanup unconfirmed: Disarm denied; write error check cleanup unconfirmed: Check denied",
  },
);
scenario(
  "pub-disarm-fail",
  async () => {
    const x = await wire("disarm-fail");
    return {
      kind: x.result.kind,
      diagnostic: x.result.kind === "error" ? x.result.diagnostic : "",
      approved: x.reviews.some((v) => v.state === "APPROVED"),
    };
  },
  { kind: "error", diagnostic: expect.stringContaining("cleanup unconfirmed"), approved: false },
);
scenario(
  "pub-error",
  async (b) => {
    const x = await wire("error", b);
    return {
      kind: x.result.kind,
      conclusion: x.final?.conclusion,
      dismissed: x.reviews.some((v) => v.state === "DISMISSED"),
      newApproval: x.writes.some((w) => w.body.event === "APPROVE"),
    };
  },
  { kind: "error", conclusion: "action_required", dismissed: false, newApproval: false },
);
scenario(
  "pub-receipt",
  async (b) => {
    const x = await wire("receipt", b);
    return {
      kind: x.result.kind,
      conclusion: x.final?.conclusion,
      dismissed: x.dismissedIds.length > 0,
    };
  },
  { kind: "error", conclusion: "action_required", dismissed: false },
);
scenario(
  "pub-order",
  async (b) => {
    const x = await wire("order", b);
    return {
      priorState: x.reviews.find((v) => v.id === 77)?.state,
      dismissals: x.dismissedIds.length,
      kind: x.result.kind,
    };
  },
  { priorState: "APPROVED", dismissals: 0, kind: "reviewed" },
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
    return {
      tally,
      visible: report.includes(`New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`),
    };
  },
  {
    tally: { new: 2, open: 2, closed: 2 },
    visible: true,
  },
);
scenario(
  "tally-history",
  (b) => {
    const value = tallyReview();
    value.convergence.round = 3;
    if (b) value.ledger.entries.splice(1, 1);
    return { tally: findingTally(value) };
  },
  { tally: { new: 0, open: 2, closed: 2 } },
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
  "pub-retry",
  async (b) => {
    const x = await wire("retry", b);
    return {
      kind: x.result.kind,
      reopenedCompleted: x.writes.some(
        (w) => w.path.endsWith("/check-runs/89") && w.body.status === "in_progress",
      ),
      opened: x.writes.filter((w) => w.method === "POST" && w.body.name === options.checks.review)
        .length,
    };
  },
  { kind: "reviewed", reopenedCompleted: false, opened: 1 },
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
  "pub-voice-error",
  async (b) => {
    const x = await wire("voice-error", b);
    const review = x.writes.find((w) => w.path.endsWith("/reviews"));
    return {
      conclusion: x.final?.conclusion,
      title: (x.final?.output as { title?: string } | undefined)?.title,
      event: review?.body.event,
      notReviewed: String(review?.body.body).includes(
        "Not reviewed: the review could not be completed. Held for the operator.",
      ),
      header: String(review?.body.body).startsWith("### 🚫 ERROR"),
    };
  },
  {
    conclusion: "action_required",
    title: "not reviewed (error)",
    event: "COMMENT",
    notReviewed: true,
    header: true,
  },
);
scenario(
  "comment-incomplete-card",
  (b) => {
    const value = structuredClone(commentReview);
    const card = value.cards.find((c) => c.name === "safety");
    if (!card) throw new Error("Invalid comment test source");
    if (!b) {
      card.completion = "incomplete";
      card.completionReason = "the eval fixture is in another repository; nothing else";
    }
    const report = render(value);
    return {
      row: report.split("\n").find((line) => line.includes("`safety`")),
    };
  },
  { row: "* ⏳ `safety` — incomplete: the eval fixture is in another repository" },
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
      // Fixed-ness is inferred from absence: the card no longer raises the advisory entry.
      findings: b
        ? advisory.map((e) => ({
            id: "F1",
            tag: "issue" as const,
            severity: "MINOR" as const,
            confidence: "HIGH" as const,
            location: e.location,
            what: e.what,
            ledger: e.key,
          }))
        : [],
    };
    prepareFindings([card], scope);
    const next = nextLedger(
      scope,
      [card],
      null,
      {
        request: value.request,
        classification: value.classification,
        routeAnswer: value.routeAnswer,
        riskAnswer: value.riskAnswer,
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

scenario(
  "pub-final-fail",
  async (b) => {
    const x = await wire("final-fail", b);
    return {
      kind: x.result.kind,
      conclusion: x.final?.conclusion,
      reviewWrites: x.writes.filter((w) => w.path.endsWith("/reviews")).length,
    };
  },
  { kind: "error", conclusion: "action_required", reviewWrites: 1 },
);

scenario(
  "comment-risk-limit",
  () => {
    const value = structuredClone(commentReview);
    value.decision.rating.rationale = `${Array.from({ length: 40 }, () => "concern").join(" ")}\ncontinued on another line`;
    const line = render(value).split("\n")[1];
    return {
      line,
      continued: line?.includes("continued") ?? false,
    };
  },
  {
    line: `🟡 **Risk: MEDIUM** — ${Array.from({ length: 20 }, () => "concern").join(" ")}…`,
    continued: false,
  },
);

scenario(
  "comment-rationale-limit",
  () => {
    const value = structuredClone(commentReview);
    if (!value.voice) throw new Error("voice fixture required");
    value.voice.summary = "First sentence. Second sentence. Third sentence.";
    return { rationale: render(value).split("\n")[2] };
  },
  { rationale: "> First sentence. Second sentence." },
);

scenario(
  "comment-card-limit",
  () => {
    const value = structuredClone(commentReview);
    const finding = value.cards.flatMap((card) => card.findings)[0];
    if (!finding) throw new Error("finding fixture required");
    const first = Array.from({ length: 60 }, () => "word").join(" ");
    finding.what = `${first}. This second sentence belongs only in the check details.`;
    const report = render(value);
    const row = report.split("\n").find((line) => line.includes("`principal-engineer`"));
    const check = renderCheckText(value);
    return {
      row,
      fullFindingInComment: report.includes(finding.what),
      fullFindingInCheck: check.includes(finding.what),
    };
  },
  {
    row: `* ⚠️ \`principal-engineer\` — ${Array.from({ length: 32 }, () => "word").join(" ")}… \`GUIDE.md:40\``,
    fullFindingInComment: false,
    fullFindingInCheck: true,
  },
);

scenario(
  "comment-skip-limit",
  () => {
    const value = structuredClone(commentReview);
    if (!value.presentation) throw new Error("presentation fixture required");
    value.presentation.skipReasons = {
      "house-style": "not selected; another reviewer covered it — no additional pass needed.",
    };
    return {
      row: render(value)
        .split("\n")
        .find((line) => line.includes("`house-style`")),
    };
  },
  { row: "* ❓ `house-style` — skipped: not selected" },
);

scenario(
  "comment-python-structure",
  (b) => {
    const report = render(commentReview);
    const visible = report.split("\n<!-- margot-ledger:v1 ")[0] ?? "";
    const lines = visible.split("\n");
    const roster = lines.filter((line) => /^\* (?:✅|⚠️|ℹ️|❓) /.test(line));
    return {
      outcome: !b && /^### [✅❌❓] [A-Z_]+$/.test(lines[0] ?? ""),
      risk: /^(?:🟢|🟡|🔴) \*\*Risk: (LOW|MEDIUM|HIGH)\*\* — .+$/.test(lines[1] ?? ""),
      rationale: (lines[2] ?? "").startsWith("> "),
      council: lines.some((line) =>
        /^Council reviewed \d+ files? • \d of 6 cards • \d+ findings? • \$\d+\.\d{2} • /.test(line),
      ),
      roster: roster.length,
      tally: lines.some((line) => /^Review \d+ · New: \d+ · Open: \d+ · Closed: \d+$/.test(line)),
      footer: ["**Author:**", "**Ticket:**", "**Commit:**", "**Run:**"].every(
        (field) => lines.filter((line) => line.startsWith(field)).length === 1,
      ),
      markers: report.includes("<!-- margot:v1 -->\n<!-- margot-ledger:v1 "),
    };
  },
  {
    outcome: true,
    risk: true,
    rationale: true,
    council: true,
    roster: 6,
    tally: true,
    footer: true,
    markers: true,
  },
);

scenario(
  "mechanical-diff-cap",
  async (b) => {
    const copy = structuredClone(recording);
    const additions = Array.from({ length: 2001 }, (_, index) => `+line ${index}`).join("\n");
    (copy.facts as { diff: string }).diff =
      `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2001 @@\n${additions}\n`;
    if (b) (copy.config as { mechanicalDiffLineCap?: number }).mechanicalDiffLineCap = 2005;
    const services = recordedServices(copy);
    const result = await review(copy.request, copy.config, services);
    return {
      full: result.kind === "reviewed" && result.classification === "functional",
      classificationCall: services.calls.some((call) => call.name === "classification"),
      routeCall: services.calls.some((call) => call.name === "route"),
    };
  },
  { full: true, classificationCall: false, routeCall: true },
);

it("keeps machine fields first and full finding detail in the review check text", () => {
  const text = renderCheckText(commentReview);
  expect(text.split("\n").slice(0, 3)).toEqual([
    "outcome: CHANGES_REQUESTED | band: MEDIUM",
    "decision_source: jev",
    "verdict_source: verdict_voice",
  ]);
  expect(text).toContain("finding details:");
  expect(text).toContain("GUIDE.md:40");
});

it("renders a shared defect once and points the second card to it", () => {
  const value = structuredClone(commentReview);
  const [first, second] = value.cards.flatMap((card) => card.findings);
  if (!first || !second || !value.voice) throw new Error("two findings required");
  second.what = first.what;
  second.location = first.location;
  const report = render(value);
  expect(report).toContain("`principal-engineer` + `maintainable-no-slop`");
  expect(report).toContain("`maintainable-no-slop` — Same finding as `principal-engineer`");
  expect(
    report.match(new RegExp(first.what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
  ).toHaveLength(1);
});
