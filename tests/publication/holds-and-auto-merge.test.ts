import { readFileSync } from "node:fs";
import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { liveServices } from "../../src/adapters/live.js";
import { githubPublisher } from "../../src/adapters/publish.js";
import { mechanicalRequest, publisherOptions, runPublication } from "../helpers/publication.js";

it("disarms auto-merge and comments with neutral checks when the review is held", async () => {
  const run = await runPublication("hold");
  expect({
    armed: run.armed,
    ordered: (() => {
      const review = run.writes.findIndex((w) => w.path.endsWith("/reviews"));
      const disable = run.writes.findIndex((w) => w.path === "/graphql");
      const final = run.writes.findIndex(
        (w) => w.body.name === publisherOptions.checks.review && w.body.conclusion === "neutral",
      );
      return review >= 0 && disable > review && final > disable;
    })(),
    conclusion: run.final?.conclusion,
    event: run.writes.find((w) => w.path.endsWith("/reviews"))?.body.event,
  }).toMatchObject({ armed: false, ordered: true, conclusion: "neutral", event: "COMMENT" });
});
it("disarms auto-merge before holding the check, with no rating or native review, when history is unreadable", async () => {
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
          head: { sha: mechanicalRequest.head, repo: { full_name: mechanicalRequest.repository } },
          base: { sha: mechanicalRequest.base },
          auto_merge: armed ? {} : null,
        };
    } else {
      writes.push({ path, body });
      if (path === "/graphql") {
        armed = false;
        data = { data: { disablePullRequestAutoMerge: { pullRequest: { id: "PR_1" } } } };
      } else {
        stored = { ...stored, ...body, id: 1, app: { id: publisherOptions.appId } };
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
    publisherOptions,
  );
  const result = await publisher.run(mechanicalRequest, async () => ({
    kind: "held",
    request: mechanicalRequest,
    reason: "Review history unavailable",
    recovery:
      "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
    mergeEligible: false,
  }));
  const output = stored?.output as { title?: string; summary?: string; text?: string };
  const disable = writes.findIndex((write) => write.path === "/graphql");
  const closed = writes.findIndex(
    (write) =>
      write.body.name === publisherOptions.checks.review &&
      write.body.conclusion === "action_required",
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
it("does not disarm a newer head and retains the prior approval when the head moves afterward", async () => {
  const run = await runPublication("head-after-approval");
  expect({
    kind: run.result.kind,
    approved: run.writes.some((w) => w.body.event === "APPROVE"),
    dismissed: run.dismissedIds.length > 0,
    disarmed: run.writes.some((w) => String(w.body.query).includes("disablePullRequestAutoMerge")),
    armed: run.armed,
    approvalRemains: run.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({
    kind: "error",
    approved: true,
    dismissed: false,
    disarmed: false,
    armed: true,
    approvalRemains: true,
  });
});
it("completes the success check when a confirmed approval is followed by auto-merge", async () => {
  const run = await runPublication("merged");
  expect({
    kind: run.result.kind,
    publication: run.result.kind === "reviewed" ? run.result.publication : undefined,
    dismissed: run.dismissedIds.length,
    conclusion: run.final?.conclusion,
  }).toMatchObject({
    kind: "reviewed",
    publication: { recorded: false, head: mechanicalRequest.head },
    dismissed: 0,
    conclusion: "success",
  });
});
it("names every failed cleanup operation and its cause in the diagnostic", async () => {
  const run = await runPublication("cleanup-fail");
  expect({
    kind: run.result.kind,
    diagnostic: run.result.kind === "error" ? run.result.diagnostic : "",
  }).toMatchObject({
    kind: "error",
    diagnostic:
      "Invalid native review receipt; disable auto-merge cleanup unconfirmed: Disarm denied; write error check cleanup unconfirmed: Check denied",
  });
});
it("errors after the held comment when the auto-merge disable is unconfirmed", async () => {
  const run = await runPublication("disarm-fail");
  expect({
    kind: run.result.kind,
    diagnostic: run.result.kind === "error" ? run.result.diagnostic : "",
    approved: run.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({
    kind: "error",
    diagnostic: expect.stringContaining("cleanup unconfirmed"),
    approved: false,
  });
});
it("records publication without any write credential in shadow mode", async () => {
  const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
  const { services, actions } = liveServices(config, { jevKey: "unused" });
  await services.disableAutoMerge(mechanicalRequest, { signal: AbortSignal.timeout(1000) });
  expect({ actions }).toMatchObject({
    actions: [{ action: "would-disable-auto-merge", request: mechanicalRequest }],
  });
});
it("posts Margot's own ERROR ruling as a held, action-required comment", async () => {
  const run = await runPublication("voice-error");
  const review = run.writes.find((w) => w.path.endsWith("/reviews"));
  expect({
    conclusion: run.final?.conclusion,
    title: (
      run.final?.output as
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
