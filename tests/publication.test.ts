import { readFileSync } from "node:fs";
import { Octokit } from "octokit";
import { describe, expect, it } from "vitest";
import { liveServices } from "../src/adapters/live.js";
import { capCheckText, githubPublisher } from "../src/adapters/publish.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import { nextLedger, prepareFindings, selectLedger, standingCards } from "../src/ledger.js";
import { findingTally, render, renderCheckText } from "../src/render.js";
import { review } from "../src/review.js";
import { configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import type { Card, Review, ReviewResult, RoundScope } from "../src/types.js";
import { present } from "./present.js";

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
async function wire(mode = "clear") {
  const writes: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
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
  if (mode === "adopt")
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
  const defect = (name: string) => mode === name;
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
          mode === "confirm" &&
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
        classification: "documentation",
      };
    if (mode === "phase-titles") {
      const context = { signal: AbortSignal.timeout(3000) };
      await publisher.progress(
        "Margot: preflight complete — setting up the review runner",
        context,
      );
      await publisher.progress("Margot: council is reviewing the changes", context);
      await publisher.progress("Margot: posting the verdict", context);
    }
    const value = structuredClone(baseReview);
    if (defect("voice-error")) {
      // Margot's own ERROR ruling: a COMMENT review, the check `action_required`,
      // titled `not reviewed (error)`.
      value.decision.outcome = "ERROR";
      value.decision.mergeEligible = false;
      value.decision.holdReasons = ["error"];
    }
    if (
      ["hold", "authority", "authority-summary", "calibration"].includes(mode) ||
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
      publication: publication as Extract<
        ReviewResult,
        {
          kind: "reviewed";
        }
      >["publication"],
    };
  });
  const final = [...stored.values()].find(
    (v) => v.name === (mode === "triage" ? options.checks.triage : options.checks.review),
  );
  const authority = [...stored.values()].find((v) => v.name === options.checks.authority);
  return { result, writes, reviews, dismissedIds, evaluated, armed, final, authority };
}
it("Clearance posts the SHA-bound approval before completing the check", async () => {
  const x = await wire("clear");
  const approve = x.writes.findIndex((w) => w.body.event === "APPROVE");
  const success = x.writes.findIndex(
    (w) => w.body.name === options.checks.review && w.body.conclusion === "success",
  );
  expect({
    kind: x.result.kind,
    successBeforeApprove: approve >= 0 && success > approve,
    head: x.writes.find((w) => w.body.event === "APPROVE")?.body.commit_id,
    finalStatus: x.final?.status,
    merged: x.writes.some(
      (w) =>
        w.path.endsWith("/merge") || JSON.stringify(w.body).includes("enablePullRequestAutoMerge"),
    ),
  }).toMatchObject({
    kind: "reviewed",
    successBeforeApprove: true,
    head: r.head,
    finalStatus: "completed",
    merged: false,
  });
});
it("Held review disarms auto-merge and comments with neutral checks", async () => {
  const x = await wire("hold");
  expect({
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
  }).toMatchObject({ armed: false, ordered: true, conclusion: "neutral", event: "COMMENT" });
});
it("Unreadable history disarms auto-merge before holding the check without a rating or native review", async () => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let stored: Record<string, unknown> | undefined;
  let armed = true;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let data: unknown;
    if (method === "GET") {
      if (path.endsWith("/check-runs"))
        data = { check_runs: stored ? [stored] : [], total_count: stored ? 1 : 0 };
      else if (/\/check-runs\/\d+$/.test(path)) data = stored;
      else
        data = {
          node_id: "PR_1",
          state: "open",
          merged: false,
          draft: false,
          head: { sha: r.head, repo: { full_name: r.repository } },
          base: { sha: r.base },
          auto_merge: armed ? {} : null,
        };
    } else {
      writes.push({ path, body });
      if (path === "/graphql") {
        armed = false;
        data = { data: { disablePullRequestAutoMerge: { pullRequest: { id: "PR_1" } } } };
      } else {
        stored = { ...stored, ...body, id: 1, app: { id: options.appId } };
        data = stored;
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
  const result = await publisher.run(r, async () => ({
    kind: "held",
    request: r,
    reason: "Review history unavailable",
    recovery:
      "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
    mergeEligible: false,
  }));
  const output = stored?.output as { title?: string; summary?: string; text?: string };
  const disable = writes.findIndex((write) => write.path === "/graphql");
  const closed = writes.findIndex(
    (write) =>
      write.body.name === options.checks.review && write.body.conclusion === "action_required",
  );
  expect(result.kind).toBe("held");
  expect(armed).toBe(false);
  expect(disable).toBeGreaterThanOrEqual(0);
  expect(closed).toBeGreaterThan(disable);
  expect(writes.filter((write) => write.path.endsWith("/reviews"))).toEqual([]);
  expect(stored?.conclusion).toBe("action_required");
  expect(output.title).toBe("held for the operator: Review history unavailable");
  expect(output.summary).toContain("Review history unavailable");
  expect(output.text).toContain("Review history unavailable");
  expect(output.text).not.toMatch(/outcome:|band:/u);
});
// Merge automation reads these lines from the check text and requests the
// operator's review on a held PR. Without them a hold is invisible to the operator, so these
// lines must always be present on a hold.
function parseVerdictText(text: string | undefined) {
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
it("The verdict check's text carries the lines merge automation parses to request the operator on a hold", async () => {
  const x = await wire("hold");
  const output = (x.final?.output ?? {}) as {
    text?: string;
    title?: string;
  };
  const parsed = parseVerdictText(output.text);
  expect({ ...parsed, title: output.title }).toMatchObject({
    outcome: "APPROVED",
    band: "HIGH",
    source: "jev",
    title: "held for the operator: risk is HIGH",
  });
});
it("A held title names the reason the PR is held, not the band", async () => {
  const x = await wire("authority");
  expect({
    title: (
      (x.final?.output ?? {}) as {
        title?: string;
      }
    ).title,
  }).toMatchObject({ title: "held for the operator: a change to Margot's own machinery" });
});
it("A failure after the verdict check overwrites its text so merge automation never reads a stale approval", async () => {
  const x = await wire("review-fail");
  const output = (x.final?.output ?? {}) as {
    text?: string;
  };
  expect({
    kind: x.result.kind,
    staleApproval: parseVerdictText(output.text).outcome,
    hasText: typeof output.text === "string" && output.text.length > 0,
  }).toMatchObject({ kind: "error", staleApproval: "", hasText: true });
});
it("Authority hold remains neutral on the self-instrument check", async () => {
  expect({ conclusion: (await wire("authority")).authority?.conclusion }).toMatchObject({
    conclusion: "neutral",
  });
});
it("names every matched file in the authority hold summary", async () => {
  const held = await wire("authority-summary");
  const clear = await wire("clear");
  const protectedRecording = structuredClone(commentRecording);
  (
    protectedRecording.config as {
      protectedPaths: string[];
    }
  ).protectedPaths = [".github/**"];
  const protectedResult = await review(
    protectedRecording.request,
    protectedRecording.config,
    recordedServices(protectedRecording),
  );
  expect({
    held: (
      held.authority?.output as
        | {
            summary?: string;
          }
        | undefined
    )?.summary,
    clear: (
      clear.authority?.output as
        | {
            summary?: string;
          }
        | undefined
    )?.summary,
    matched:
      protectedResult.kind === "reviewed" ? protectedResult.decision.authorityPaths : undefined,
  }).toMatchObject({
    held: "This PR changes files Margot's own review depends on (the configured protected paths). Margot does not approve such a change by itself; it waits for a maintainer's approval.\n\nMatched:\n- `.github/workflows/review.yml`\n- `config/review.json`",
    clear: "No functional change to a protected path (class: mechanical).",
    matched: [".github/workflows/ci.yml"],
  });
});
it("Calibration cannot satisfy the review check", async () => {
  expect({ conclusion: (await wire("calibration")).final?.conclusion }).toMatchObject({
    conclusion: "action_required",
  });
});
it("Triage exposes the classification JSON without approving", async () => {
  const x = await wire("triage");
  expect({
    text: JSON.parse(
      (
        x.final?.output as
          | {
              text?: string;
            }
          | undefined
      )?.text ?? "{}",
    ),
    reviews: x.reviews.length,
  }).toMatchObject({
    text: { head_sha: r.head, classification: "documentation", decision_source: "jev" },
    reviews: 0,
  });
});
it("updates the check title as each review phase begins", async () => {
  const x = await wire("phase-titles");
  expect({
    titles: x.writes
      .filter(
        (write) => write.body.name === options.checks.review && write.body.status === "in_progress",
      )
      .map(
        (write) =>
          (
            write.body.output as {
              title?: string;
            }
          ).title,
      ),
  }).toMatchObject({
    titles: [
      "Margot: preflight — mechanical checks",
      "Margot: preflight complete — setting up the review runner",
      "Margot: council is reviewing the changes",
      "Margot: posting the verdict",
    ],
  });
});
for (const [name, mode] of [
  ["reports a closed PR as not reviewed", "closed"],
  ["reports a fork PR as not reviewed", "fork"],
  ["reports a draft PR as not reviewed", "draft"],
  ["reports a stale request as not reviewed", "base"],
] as const)
  it(name, async () => {
    const x = await wire(mode);
    expect({
      kind: x.result.kind,
      evaluated: x.evaluated,
      writes: x.writes.length,
      title: (
        (x.final?.output ?? {}) as {
          title?: string;
        }
      ).title,
    }).toMatchObject({
      kind: "error",
      evaluated: false,
      writes: 1,
      title: `Margot: not reviewed: ${mode === "base" ? "stale" : mode}`,
    });
  });
for (const [name, mode] of [
  ["Failure to create the pending gate stops evaluation", "start-fail"],
  ["Failed native review never completes a success check", "review-fail"],
  ["A wrong-App check receipt cannot approve", "identity"],
] as const)
  it(name, async () => {
    const x = await wire(mode);
    expect({
      kind: x.result.kind,
      approved: x.reviews.some((v) => v.state === "APPROVED"),
    }).toMatchObject({ kind: "error", approved: false });
  });
for (const [name, mode] of [
  ["Head movement before approval fails closed", "head"],
  ["An in-progress final check readback fails publication", "confirm"],
] as const)
  it(name, async () => {
    const x = await wire(mode);
    expect({
      kind: x.result.kind,
      completedWrite: x.writes.some(
        (w) => w.body.name === options.checks.review && w.body.conclusion === "success",
      ),
      approvalAttempted: x.writes.some((w) => w.body.event === "APPROVE"),
    }).toMatchObject(
      mode === "head"
        ? { kind: "error", completedWrite: false, approvalAttempted: false }
        : { kind: "error", completedWrite: true, approvalAttempted: true },
    );
  });
it("disarms auto-merge and retains the approval when the head moves afterward", async () => {
  const x = await wire("head-after-approval");
  expect({
    kind: x.result.kind,
    approved: x.writes.some((w) => w.body.event === "APPROVE"),
    dismissed: x.dismissedIds.length > 0,
    disarmed: x.writes.some((w) => String(w.body.query).includes("disablePullRequestAutoMerge")),
    armed: x.armed,
    approvalRemains: x.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({
    kind: "error",
    approved: true,
    dismissed: false,
    disarmed: true,
    armed: false,
    approvalRemains: true,
  });
});
it("A confirmed approval followed by auto-merge succeeds", async () => {
  const x = await wire("merged");
  expect({
    kind: x.result.kind,
    publication: x.result.kind === "reviewed" ? x.result.publication : undefined,
    dismissed: x.dismissedIds.length,
    conclusion: x.final?.conclusion,
  }).toMatchObject({
    kind: "reviewed",
    publication: { recorded: false, head: r.head },
    dismissed: 0,
    conclusion: "success",
  });
});
it("Cleanup diagnostics identify every failed operation and its cause", async () => {
  const x = await wire("cleanup-fail");
  expect({
    kind: x.result.kind,
    diagnostic: x.result.kind === "error" ? x.result.diagnostic : "",
  }).toMatchObject({
    kind: "error",
    diagnostic:
      "Invalid native review receipt; disable auto-merge cleanup unconfirmed: Disarm denied; write error check cleanup unconfirmed: Check denied",
  });
});
it("Unconfirmed auto-merge disable cannot publish a held verdict", async () => {
  const x = await wire("disarm-fail");
  expect({
    kind: x.result.kind,
    diagnostic: x.result.kind === "error" ? x.result.diagnostic : "",
    approved: x.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({
    kind: "error",
    diagnostic: expect.stringContaining("cleanup unconfirmed"),
    approved: false,
  });
});
it("Evaluation error closes the gate without touching earlier reviews", async () => {
  const x = await wire("error");
  expect({
    kind: x.result.kind,
    conclusion: x.final?.conclusion,
    dismissed: x.reviews.some((v) => v.state === "DISMISSED"),
    newApproval: x.writes.some((w) => w.body.event === "APPROVE"),
  }).toMatchObject({
    kind: "error",
    conclusion: "action_required",
    dismissed: false,
    newApproval: false,
  });
});
it("A mismatched native review receipt is compensated by closing the gate", async () => {
  const x = await wire("receipt");
  expect({
    kind: x.result.kind,
    conclusion: x.final?.conclusion,
    dismissed: x.dismissedIds.length > 0,
  }).toMatchObject({ kind: "error", conclusion: "action_required", dismissed: false });
});
it("A prior same-head approval is left alone; Margot never dismisses her own reviews", async () => {
  const x = await wire("order");
  expect({
    priorState: x.reviews.find((v) => v.id === 77)?.state,
    dismissals: x.dismissedIds.length,
    kind: x.result.kind,
  }).toMatchObject({ priorState: "APPROVED", dismissals: 0, kind: "reviewed" });
});
it("Shadow services record publication without any write credential", async () => {
  const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
  const { services, actions } = liveServices(config, { jevKey: "unused" });
  await services.disableAutoMerge(r, { signal: AbortSignal.timeout(1000) });
  expect({ actions }).toMatchObject({
    actions: [{ action: "would-disable-auto-merge", request: r }],
  });
});
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
it("New Open Closed reconcile with every listed finding including dismissals and advisories", () => {
  const value = tallyReview();
  const report = render(value);
  const tally = findingTally(value);
  expect({
    tally,
    visible: report.includes(`New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`),
  }).toMatchObject({
    tally: { new: 2, open: 2, closed: 2 },
    visible: true,
  });
});
it("Closed entries and late attribution survive later rounds", () => {
  const value = tallyReview();
  value.convergence.round = 3;
  expect({ tally: findingTally(value) }).toMatchObject({ tally: { new: 0, open: 2, closed: 2 } });
});
it("The caller pending check is adopted without a stranded duplicate", async () => {
  const x = await wire("adopt");
  expect({
    adopted: x.writes.some((w) => w.path.endsWith("/check-runs/88")),
    duplicates: x.writes.filter((w) => w.method === "POST" && w.body.name === options.checks.review)
      .length,
  }).toMatchObject({ adopted: true, duplicates: 0 });
});
it("A same-head retry opens a new check instead of reopening the completed one", async () => {
  const x = await wire("retry");
  expect({
    kind: x.result.kind,
    reopenedCompleted: x.writes.some(
      (w) => w.path.endsWith("/check-runs/89") && w.body.status === "in_progress",
    ),
    opened: x.writes.filter((w) => w.method === "POST" && w.body.name === options.checks.review)
      .length,
  }).toMatchObject({ kind: "reviewed", reopenedCompleted: false, opened: 1 });
});
it("A superseded run cannot close the newer run check or approve", async () => {
  const x = await wire("superseded");
  expect({
    kind: x.result.kind,
    gateStillPending: x.final?.status === "in_progress",
    approved: x.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({ kind: "error", gateStillPending: true, approved: false });
});
it("Only explicitly configured skipped jobs satisfy required checks", async () => {
  const copy = structuredClone(recording);
  const config = {
    ...(copy.config as object),
    requiredChecks: ["ci / optional"],
    trustedCheckActors: ["checks-app"],
    allowedSkippedChecks: ["ci / optional"],
  };
  copy.facts = {
    ...(copy.facts as object),
    checks: [{ name: "ci / optional", actor: "checks-app", head: r.head, conclusion: "skipped" }],
  };
  expect({ kind: (await review(r, config, recordedServices(copy))).kind }).toMatchObject({
    kind: "reviewed",
  });
});
it("Margot's ERROR ruling posts as a held, action-required comment", async () => {
  const x = await wire("voice-error");
  const review = x.writes.find((w) => w.path.endsWith("/reviews"));
  expect({
    conclusion: x.final?.conclusion,
    title: (
      x.final?.output as
        | {
            title?: string;
          }
        | undefined
    )?.title,
    event: review?.body.event,
    notReviewed: String(review?.body.body).includes(
      "Not reviewed: the review could not be completed. Held for the operator.",
    ),
    header: String(review?.body.body).startsWith("### 🚫 ERROR"),
  }).toMatchObject({
    conclusion: "action_required",
    title: "not reviewed (error)",
    event: "COMMENT",
    notReviewed: true,
    header: true,
  });
});
it("A card that did not complete shows its completion and reason, never clear", () => {
  const value = structuredClone(commentReview);
  const card = value.cards.find((c) => c.name === "safety");
  if (!card) throw new Error("Invalid comment test source");
  card.completion = "incomplete";
  card.completionReason = "the eval fixture is in another repository; nothing else";
  const report = render(value);
  expect({
    row: report.split("\n").find((line) => line.includes("`safety`")),
  }).toMatchObject({
    row: "* ⏳ `safety` — incomplete: the eval fixture is in another repository",
  });
});
it("An open advisory is recalled and closes when its card stops raising it", () => {
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
    findings: [],
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
  expect({ status: next.ledger.entries[0]?.status, recalled: standingCards(scope) }).toMatchObject({
    status: "fixed",
    recalled: ["safety"],
  });
});
it("A new workflow run keeps same-head review compatibility but a policy change does not", () => {
  const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
  config.publisher = structuredClone(options);
  const before = liveServices(config, { jevKey: "unused" }).services.provenance;
  config.publisher.runUrl = "https://example.invalid/run/2";
  expect({
    compatible: before === liveServices(config, { jevKey: "unused" }).services.provenance,
  }).toMatchObject({ compatible: true });
});
it("The posted ledger stays readable in its version 1 format, with the receipt in its compressed field", () => {
  const body = render(baseReview);
  const block = body.match(/<!-- margot-ledger:v1 ([A-Za-z0-9+/=]+) -->$/);
  const plainLedger = block
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
  expect({
    version1Readable:
      plainLedger?.v === 1 && plainLedger?.head === r.head && Array.isArray(plainLedger?.entries),
    restored,
  }).toMatchObject({ version1Readable: true, restored: baseReview.ledger });
});
it("Recalling a late advisory cannot silently turn it into a blocker", () => {
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
        status: "advisory",
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
  expect({ advisory: card.findings[0]?.advisory }).toMatchObject({ advisory: "late-non-blocking" });
});
it("A failed final check blocks after review delivery", async () => {
  const x = await wire("final-fail");
  expect({
    kind: x.result.kind,
    conclusion: x.final?.conclusion,
    reviewWrites: x.writes.filter((w) => w.path.endsWith("/reviews")).length,
  }).toMatchObject({ kind: "error", conclusion: "action_required", reviewWrites: 1 });
});
it("The risk line displays the voice's short risk statement rather than the band rationale", () => {
  const value = structuredClone(commentReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.risk = "  operator\nworkflow   disruption  ";
  value.decision.rating.rationale = "The band comes from a separate risk assessment.";
  expect(render(value).split("\n")[1]).toBe("🟡 **Risk: MEDIUM** — operator workflow disruption");
});
it("A risk line without a voice risk statement omits the explanatory suffix", () => {
  const value = structuredClone(commentReview);
  if (!value.voice) throw new Error("voice fixture required");
  delete value.voice.risk;
  expect(render(value).split("\n")[1]).toBe("🟡 **Risk: MEDIUM**");
});
it("A mechanical review posts confidence, files, cost and runtime without a council roster", () => {
  const value = structuredClone(baseReview);
  value.provenance.mechanicalProbability = 0.987;
  value.presentation = {
    author: "contributor",
    costUsd: 0.12,
    durationMs: 61000,
    files: 2,
    runUrl: null,
    ticket: null,
  };
  const body = render(value);
  expect(body).toContain("Mechanical change (confidence 99%) • 2 files • $0.12 • 1m 1s");
  expect(body).not.toContain("Council reviewed");
  expect(body.split("\n").filter((line) => line.startsWith("* "))).toEqual([]);
});
it("A mechanical review without a probability omits the confidence annotation", () => {
  const value = structuredClone(baseReview);
  delete value.provenance.mechanicalProbability;
  expect(render(value)).toContain("Mechanical change • ");
  expect(render(value)).not.toContain("confidence");
});
it("A clarification tells the pull request author which decision is needed", () => {
  const value = structuredClone(commentReview);
  if (!value.voice || !value.presentation) throw new Error("voice and presentation required");
  value.decision.outcome = "CLARIFICATION_REQUESTED";
  value.voice.clarification = "Should this setting apply to existing installations?";
  value.presentation.author = "contributor";
  expect(render(value)).toContain(
    "@contributor, your call: Should this setting apply to existing installations?",
  );
});
it("A fallback-scored review warns that confidence is reduced and nothing was auto-merged", () => {
  const value = structuredClone(commentReview);
  value.provenance.decision_source = "fallback";
  expect(render(value)).toContain(
    "> ⚠️ _The risk model was unavailable — this risk was scored by a fallback at reduced confidence, so nothing was auto-merged._",
  );
});
it("The check text preserves convergence as machine-readable JSON", () => {
  const value = structuredClone(commentReview);
  value.convergence.round = 3;
  expect(
    renderCheckText(value)
      .split("\n")
      .find((line) => line.startsWith("convergence: ")),
  ).toBe(`convergence: ${JSON.stringify(value.convergence)}`);
});
it("The check text names cards summoned by the prior ledger", () => {
  const value = structuredClone(commentReview);
  value.provenance.summonedByLedger = ["safety", "principal-engineer"];
  expect(renderCheckText(value)).toContain("summoned by ledger: safety, principal-engineer");
});
it("A long rationale renders its first two sentences", () => {
  const value = structuredClone(commentReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.summary = "First sentence. Second sentence. Third sentence.";
  expect({ rationale: render(value).split("\n")[2] }).toMatchObject({
    rationale: "> First sentence. Second sentence.",
  });
});
it("A long finding renders bounded prose while the check keeps its full text", () => {
  const value = structuredClone(commentReview);
  const finding = value.cards.flatMap((card) => card.findings)[0];
  if (!finding) throw new Error("finding fixture required");
  const first = Array.from({ length: 60 }, () => "word").join(" ");
  finding.what = `${first}. This second sentence belongs only in the check details.`;
  const report = render(value);
  const row = report.split("\n").find((line) => line.includes("`principal-engineer`"));
  const check = renderCheckText(value);
  expect({
    row,
    fullFindingInComment: report.includes(finding.what),
    fullFindingInCheck: check.includes(finding.what),
  }).toMatchObject({
    row: `* ⚠️ \`principal-engineer\` — ${Array.from({ length: 32 }, () => "word").join(" ")}… \`GUIDE.md:40\``,
    fullFindingInComment: false,
    fullFindingInCheck: true,
  });
});
it("A multi-clause skip reason renders its first clause", () => {
  const value = structuredClone(commentReview);
  if (!value.presentation) throw new Error("presentation fixture required");
  value.presentation.skipReasons = {
    "house-style": "not selected; another reviewer covered it — no additional pass needed.",
  };
  expect({
    row: render(value)
      .split("\n")
      .find((line) => line.includes("`house-style`")),
  }).toMatchObject({ row: "* ❓ `house-style` — skipped: not selected" });
});
it("renders the verdict, risk, council roster and finding tally in the review comment", () => {
  const report = render(commentReview);
  const visible = report.split("\n<!-- margot-ledger:v1 ")[0] ?? "";
  const lines = visible.split("\n");
  const roster = lines.filter((line) => /^\* (?:✅|⚠️|ℹ️|❓) /.test(line));
  return expect({
    outcome: /^### [✅❌❓] [A-Z_]+$/.test(lines[0] ?? ""),
    risk: /^(?:🟢|🟡|🔴) \*\*Risk: (LOW|MEDIUM|HIGH)\*\*(?: — .+)?$/.test(lines[1] ?? ""),
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
  }).toMatchObject({
    outcome: true,
    risk: true,
    rationale: true,
    council: true,
    roster: 6,
    tally: true,
    footer: true,
    markers: true,
  });
});
it("A 2005-line mechanical candidate takes the full review path", async () => {
  const copy = structuredClone(recording);
  const additions = Array.from({ length: 2001 }, (_, index) => `+line ${index}`).join("\n");
  (
    copy.facts as {
      diff: string;
    }
  ).diff =
    `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2001 @@\n${additions}\n`;
  const services = recordedServices(copy);
  const result = await review(copy.request, copy.config, services);
  expect({
    full: result.kind === "reviewed" && result.classification === "functional",
    classificationCall: services.calls.some((call) => call.name === "classification"),
    routeCall: services.calls.some((call) => call.name === "route"),
  }).toMatchObject({ full: true, classificationCall: false, routeCall: true });
});
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
describe("check text limits", () => {
  it("caps check text by Unicode characters while preserving machine fields", () => {
    const text = `outcome: APPROVED | band: LOW\ndecision_source: fallback\n${"🦉".repeat(61000)}`;
    const capped = capCheckText(text);
    expect({
      length: Array.from(capped).length,
      top: capped.startsWith("outcome: APPROVED | band: LOW\ndecision_source: fallback\n"),
      note: capped.endsWith("[Margot: check text truncated]"),
    }).toMatchObject({ length: 60000, top: true, note: true });
  });
});
it("A review run never writes the triage check; that check is the triage run's alone", async () => {
  // Rewriting `review / triage` from the review run replaced Jev's answer with the review's
  // merged class; readers accept only a Jev-sourced triage, so a mechanical PR read as
  // functional. The review run never writes it.
  const x = await wire("clear");
  const triageWrites = x.writes.filter(
    (w) => (w.body as { name?: string } | undefined)?.name === options.checks.triage,
  );
  expect(triageWrites).toEqual([]);
});
describe("merge actor in the authority hold", () => {
  function authorityHold(mergeActor?: string) {
    const value = structuredClone(baseReview);
    value.decision.mergeEligible = false;
    value.decision.holdReasons = ["review-authority"];
    value.presentation = { ...present(value.presentation), ...(mergeActor ? { mergeActor } : {}) };
    return render(value);
  }
  it("names the configured merge actor", () => {
    expect(authorityHold("merge-bot")).toContain(
      "Above my authority: it changes Margot's own machinery; approve it and merge-bot merges it. Yours to merge.",
    );
  });
  it("names no merger when none is configured", () => {
    const report = authorityHold();
    expect(report).toContain(
      "Above my authority: it changes Margot's own machinery; approve it to merge it. Yours to merge.",
    );
    expect(report).not.toContain("merges it");
  });
  it("carries the configured value from the configuration to the presentation", async () => {
    const withActor = await review(
      r,
      { ...(recording.config as object), mergeActor: "merge-bot" },
      recordedServices(recording),
    );
    expect({
      configured: withActor.kind === "reviewed" && withActor.presentation?.mergeActor,
      unset: baseReview.presentation?.mergeActor,
    }).toEqual({ configured: "merge-bot", unset: undefined });
  });
});
