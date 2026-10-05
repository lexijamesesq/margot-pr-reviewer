import { readFileSync } from "node:fs";
import { Octokit } from "octokit";
import { githubPublisher } from "../../src/adapters/publish.js";
import { type Recording, recordedServices } from "../../src/adapters/recorded.js";
import { render } from "../../src/render.js";
import { review } from "../../src/review.js";
import { requestSchema } from "../../src/schemas.js";
import type { Review, ReviewResult } from "../../src/types.js";

// Shared fakes for the publication tests. `runPublication(mode)` runs the GitHub publisher against an
// in-memory GitHub whose `mode` names the one thing that is different about this run:
//   clear, hold, authority, authority-summary, calibration, triage, phase-titles, voice-error
//     - the review the publisher is given (default `clear`: a clean approval);
//   closed, fork, draft, base - the pull request is not reviewable;
//   start-fail, review-fail, final-fail - the write named by the mode is rejected by GitHub;
//   receipt, identity, confirm, head, head-after-approval, merged - a GitHub receipt or the
//     head or merge state disagrees with what was written;
//   cleanup-fail, disarm-fail - the compensating write is rejected;
//   adopt, retry, superseded - an earlier check run for this head already exists;
//   order, error - a prior approval exists / the evaluation returns an error.

export type PublicationMode =
  | "clear"
  | "hold"
  | "authority"
  | "authority-summary"
  | "calibration"
  | "triage"
  | "phase-titles"
  | "voice-error"
  | "closed"
  | "fork"
  | "draft"
  | "base"
  | "start-fail"
  | "review-fail"
  | "final-fail"
  | "receipt"
  | "identity"
  | "confirm"
  | "head"
  | "head-after-approval"
  | "merged"
  | "cleanup-fail"
  | "disarm-fail"
  | "adopt"
  | "retry"
  | "superseded"
  | "order"
  | "error";

export const mechanicalBump = JSON.parse(
  readFileSync("recordings/mechanical-bump.json", "utf8"),
) as Recording;
export const mechanicalRequest = requestSchema.parse(mechanicalBump.request);
const clean = await review(
  mechanicalRequest,
  mechanicalBump.config,
  recordedServices(mechanicalBump),
);
if (clean.kind !== "reviewed") throw new Error("Invalid test source");
export const mechanicalReview: Review = clean;
export const authorChangesRecording = JSON.parse(
  readFileSync("recordings/author-changes.json", "utf8"),
) as Recording;
const authorChangesResult = await review(
  authorChangesRecording.request,
  authorChangesRecording.config,
  recordedServices(authorChangesRecording),
);
if (authorChangesResult.kind !== "reviewed") throw new Error("Invalid comment test source");
export const authorChangesReview: Review = authorChangesResult;
export const publisherOptions = {
  checks: {
    triage: "review / triage",
    review: "review / margot",
    authority: "review / self-instrument",
  },
  actor: "reviewer[bot]",
  appId: 42,
  runUrl: "https://github.com/example/instance/actions/runs/1",
};
export async function runPublication(mode: PublicationMode = "clear") {
  const writes: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  const stored = new Map<number, Record<string, unknown>>();
  if (mode === "retry")
    stored.set(89, {
      id: 89,
      name: publisherOptions.checks.review,
      head_sha: mechanicalRequest.head,
      app: { id: publisherOptions.appId },
      status: "completed",
      conclusion: "action_required",
      details_url: "https://github.com/example/caller/actions/runs/1",
    });
  if (mode === "adopt")
    stored.set(88, {
      id: 88,
      name: publisherOptions.checks.review,
      head_sha: mechanicalRequest.head,
      app: { id: publisherOptions.appId },
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
      user: { login: publisherOptions.actor, type: "Bot" },
      state: "APPROVED",
      commit_id: mechanicalRequest.head,
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
            sha: moved ? "f".repeat(40) : mechanicalRequest.head,
            repo: { full_name: defect("fork") ? "other/repo" : mechanicalRequest.repository },
          },
          base: { sha: defect("base") || merged ? "f".repeat(40) : mechanicalRequest.base },
          auto_merge: armed ? {} : null,
        };
    } else {
      writes.push({ method, path, body });
      if (
        (defect("start-fail") && body.status === "in_progress") ||
        (defect("review-fail") && path.endsWith("/reviews")) ||
        (defect("final-fail") &&
          body.name === publisherOptions.checks.review &&
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
          user: { login: publisherOptions.actor, type: "Bot" },
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
          app: { id: defect("identity") ? 999 : publisherOptions.appId },
        };
        stored.set(id, data as Record<string, unknown>);
        if (
          mode === "confirm" &&
          body.name === publisherOptions.checks.review &&
          body.conclusion === "success"
        )
          stored.set(id, { ...(data as Record<string, unknown>), status: "in_progress" });
        if (
          mode === "merged" &&
          body.name === publisherOptions.checks.review &&
          body.conclusion === "success"
        ) {
          merged = true;
          armed = false;
        }
        if (
          mode === "head" &&
          body.name === publisherOptions.checks.authority &&
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
    publisherOptions,
  );
  const request = {
    ...mechanicalRequest,
    phase: mode === "triage" ? ("triage" as const) : ("review" as const),
  };
  const result = await publisher.run(request, async (): Promise<ReviewResult> => {
    evaluated = true;
    if (defect("superseded")) {
      const gate = [...stored.values()].find((v) => v.name === publisherOptions.checks.review);
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
    const value = structuredClone(mechanicalReview);
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
      { expectedHead: mechanicalRequest.head, review: value, report },
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
    (v) =>
      v.name ===
      (mode === "triage" ? publisherOptions.checks.triage : publisherOptions.checks.review),
  );
  const authority = [...stored.values()].find((v) => v.name === publisherOptions.checks.authority);
  return { result, writes, reviews, dismissedIds, evaluated, armed, final, authority };
}
export function tallyReview() {
  const value = structuredClone(mechanicalReview);
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
// Merge automation reads these lines from the check text and requests the
// operator's review on a held PR. Without them a hold is invisible to the operator, so these
// lines must always be present on a hold.
export function parseVerdictText(text: string | undefined) {
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
