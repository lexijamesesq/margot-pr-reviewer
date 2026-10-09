import { Octokit } from "octokit";
import { expect, it } from "vitest";
import {
  boundIdentity,
  checkExternalId,
  checkMetadataText,
  readCheckRecord,
  reviewRequestId,
} from "../src/check-identity.js";
import { type CloseStrandedCheckInput, closeStrandedCheck } from "../src/closer.js";

const head = "a".repeat(40);
const ownRuns = "https://github.com/example/control/actions/runs/";
async function wire(mode: string, checkName = "review / margot") {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const input: CloseStrandedCheckInput = {
    repository: "example/project",
    pr: 7,
    head,
    appId: 42,
    checkName,
    ownRuns,
    ownRunId: "1",
    ownRunUrl: `${ownRuns}1/attempts/1`,
    base: "b".repeat(40),
    triageCheckId: 101,
    workflowRef: "v0.10.0",
    reviewActor: "margot[bot]",
    routeResult: "failure",
    reviewResult: "success",
    published: "",
    stopReason: "",
  };
  if (mode === "nothing-unselected" || mode === "nothing-published") {
    input.routeResult = "success";
    input.published = mode === "nothing-published" ? "true" : "";
  }
  if (mode === "review-failed" || mode === "review-cancelled") {
    input.routeResult = "success";
    input.reviewResult = mode === "review-cancelled" ? "cancelled" : "failure";
  }
  if (mode === "selected") {
    input.routeResult = "success";
    input.published = "false";
  }
  if (mode === "package-cancelled") {
    input.routeResult = "success";
    input.published = "false";
    input.stopReason = "cancelled";
  }
  if (mode === "route-cancelled") input.routeResult = "cancelled";
  if (mode === "route-failed-review-cancelled") {
    input.reviewResult = "cancelled";
  }
  if (["superseded", "merged", "closed", "draft", "fork", "conflict", "empty"].includes(mode))
    input.stopReason = mode;
  if (mode === "superseded") input.liveSha = "f".repeat(40);
  if (mode === "live-superseded") input.stopReason = "superseded";
  if (mode === "floor" || mode === "floor-named" || mode === "floor-blank")
    input.stopReason = "floor";
  if (mode === "floor-named") input.blockingChecks = "pending: ci / checks, lint";
  if (mode === "floor-blank") input.blockingChecks = "  ";
  if (mode === "prototype-key") input.stopReason = "toString";
  const request = {
    repository: input.repository,
    pr: 7,
    base: input.base,
    head,
    phase: "review" as const,
    triageCheckId: 101,
    workflowRef: input.workflowRef,
  };
  const details =
    mode === "other-run" ? `${ownRuns}2/attempts/1` : mode === "no-run" ? "" : input.ownRunUrl;
  let stored: Record<string, unknown> = {
    id: 88,
    name: checkName,
    head_sha: head,
    app: { id: 42 },
    status: "in_progress",
    conclusion: null,
    details_url: details,
    external_id: checkExternalId(request),
    output: {
      text: checkMetadataText({
        version: 1,
        kind: "review",
        repository: request.repository,
        pr: 7,
        base_sha: request.base,
        head_sha: head,
        workflow_ref: request.workflowRef,
        triage_check_id: 101,
        request_id: reviewRequestId(boundIdentity(request, request.workflowRef)),
        owner_run_url: details || input.ownRunUrl,
        phase: "waiting",
      }),
    },
  };
  let listedNative = false;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    const method = init?.method ?? "GET";
    reads.push(`${method} ${target.pathname}${target.search}`);
    if (method === "GET" && target.pathname.endsWith(`/commits/${head}/pulls`)) {
      if (mode === "commit-error")
        return response({ message: "Recorded pull read failure" }, 500, url);
      const own = {
        number: mode === "wrong-pr" ? 8 : 7,
        state: "open",
        head: {
          sha: mode === "superseded" ? "f".repeat(40) : head,
        },
      };
      const pulls = [own];
      if (mode === "other-live") pulls.push({ number: 9, state: "open", head: { sha: head } });
      return response(pulls, 200, url);
    }
    if (method === "GET" && target.pathname.endsWith("/check-runs")) {
      const name = target.searchParams.get("check_name");
      if (mode === "check-error")
        return response({ message: "Recorded check read failure" }, 500, url);
      let checkRuns: Record<string, unknown>[] = [stored];
      if (mode === "other-name") {
        checkRuns = name === "custom / review" ? checkRuns : [];
      } else if (mode === "no-open") {
        checkRuns = checkRuns.map((check) => ({ ...check, status: "completed" }));
      }
      return response({ check_runs: checkRuns, total_count: checkRuns.length }, 200, url);
    }
    if (
      method === "GET" &&
      (target.pathname.endsWith("/reviews") || target.pathname.endsWith("/reviews/90"))
    ) {
      listedNative = true;
      if (mode === "owner-during-native")
        stored = {
          ...stored,
          details_url: `${ownRuns}2/attempts/1`,
          output: {
            text: checkMetadataText({
              ...readCheckRecord((stored.output as { text: string }).text),
              owner_run_url: `${ownRuns}2/attempts/1`,
            }),
          },
        };
      const state = mode === "native-approved" ? "APPROVED" : "COMMENTED";
      const native = {
        id: 90,
        commit_id: head,
        state,
        user: { login: "margot[bot]", type: "Bot" },
        body: checkMetadataText({
          ...readCheckRecord((stored.output as { text: string }).text),
          review_state: state as "APPROVED" | "COMMENTED",
          retryable: false,
        }),
      };
      return response(
        target.pathname.endsWith("/90") ? native : mode.startsWith("native-") ? [native] : [],
        200,
        url,
      );
    }
    if (method === "GET" && target.pathname.endsWith("/actions/runs/1"))
      return response(
        {
          id: 1,
          repository: { full_name: "example/control" },
          run_attempt: mode === "old-attempt" ? 2 : 1,
        },
        200,
        url,
      );
    if (method === "GET" && target.pathname.endsWith("/pulls/7"))
      return response(
        {
          head: {
            sha:
              mode === "moved-head" || (mode === "head-during-native" && listedNative)
                ? "f".repeat(40)
                : head,
          },
          base: { sha: mode === "moved-base" ? "f".repeat(40) : input.base },
        },
        200,
        url,
      );
    if (method === "GET" && target.pathname.endsWith("/check-runs/88"))
      return response(stored, 200, url);
    if (method === "PATCH" && /\/check-runs\/88$/.test(target.pathname)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(body);
      if (mode === "patch-error")
        return response({ message: "Recorded check write failure" }, 500, url);
      stored = { ...stored, ...body };
      return response(stored, 200, url);
    }
    return response({ message: "Unexpected recorded request" }, 404, url);
  }) as typeof fetch;
  const client = new Octokit({
    request: { fetch: fetcher },
    retry: { enabled: false },
    throttle: { enabled: false },
  });
  const decision = await closeStrandedCheck(input, client);
  return { decision, writes, reads };
}
function response(data: unknown, status: number, url: string | URL | Request) {
  const result = new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(result, "url", { value: String(url) });
  return result;
}
it("has nothing to close for an unselected package with successful jobs", async () => {
  const result = await wire("nothing-unselected");
  expect({ ...result.decision, reads: result.reads.length }).toMatchObject({
    action: "left",
    message: "nothing to close",
    reads: 0,
  });
});
it("has nothing to close for a published package", async () => {
  const result = await wire("nothing-published");
  expect({ ...result.decision, reads: result.reads.length }).toMatchObject({
    action: "left",
    message: "nothing to close",
    reads: 0,
  });
});
it("touches nothing when the commit-to-PR binding is unreadable", async () => {
  expect((await wire("commit-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("pull requests"),
  });
});
it("leaves alone a SHA outside the requested PR", async () => {
  expect((await wire("wrong-pr")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("not a commit of PR #7"),
  });
});
it("refuses to close the requested PR's still-live head from a superseded claim", async () => {
  expect((await wire("live-superseded")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("live head of open PR #7"),
  });
});
it("leaves a SHA that is another open PR's live head to that review", async () => {
  expect((await wire("other-live")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("open PR #9"),
  });
});
it("closes the open review/margot check without passing it", async () => {
  const result = await wire("primary");
  expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
    action: "closed",
    write: { status: "completed", conclusion: "action_required" },
  });
});
it("closes the check named by --check-name and no other", async () => {
  const result = await wire("other-name", "custom / review");
  expect(result.decision.action).toBe("closed");
  expect((await wire("other-name")).decision.action).toBe("left");
});
it("touches nothing when the check list is unreadable", async () => {
  expect((await wire("check-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("check-runs"),
  });
});
it("leaves completed checks alone", async () => {
  expect((await wire("no-open")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("no open margot check"),
  });
});
it("leaves a check adopted by another run to that run", async () => {
  expect((await wire("other-run")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("owned by this request and run"),
  });
});
it("refuses a caller check that has no run owner", async () => {
  const result = await wire("no-run");
  expect({ action: result.decision.action, writes: result.writes.length }).toMatchObject({
    action: "left",
    writes: 0,
  });
});
for (const [name, reason, conclusion, title] of [
  [
    "closes a superseded head as skipped with the hosted wording",
    "superseded",
    "skipped",
    `Margot: superseded by a newer push (${"f".repeat(7)})`,
  ],
  [
    "closes a merged PR as skipped with the hosted wording",
    "merged",
    "skipped",
    "Margot: not reviewed: the PR was merged first",
  ],
  [
    "closes a closed unmerged PR as cancelled with the hosted wording",
    "closed",
    "cancelled",
    "Margot: not reviewed: the PR was closed first",
  ],
  [
    "closes a draft PR as failure with the hosted wording",
    "draft",
    "failure",
    "Margot: not reviewed: draft",
  ],
  [
    "closes a fork-head PR as failure with the hosted wording",
    "fork",
    "failure",
    "Margot: not reviewed: fork head",
  ],
  [
    "closes a conflicted PR as failure with the hosted wording",
    "conflict",
    "failure",
    "Margot: not reviewed: merge conflict (resolve before review)",
  ],
  [
    "closes an empty PR as failure with the hosted wording",
    "empty",
    "failure",
    "Margot: not reviewed: empty (no changed files)",
  ],
] as const)
  it(name, async () => {
    const result = await wire(reason);
    expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
      action: "closed",
      write: { conclusion, output: { title } },
    });
  });
it("closes as cancelled when the route is cancelled", async () => {
  expect({ write: (await wire("route-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("takes a non-stale conclusion from the first stopped job", async () => {
  expect({ write: (await wire("route-failed-review-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "action_required" },
  });
});
it("closes as cancelled when the review is cancelled", async () => {
  expect({ write: (await wire("review-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("names the stopped job when the review fails", async () => {
  const result = await wire("review-failed");
  expect({ write: result.writes[0] }).toMatchObject({
    write: { output: { title: expect.stringContaining("review job failure") } },
  });
});
it("closes a selected package that did not publish", async () => {
  const result = await wire("selected");
  expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
    action: "closed",
    write: { output: { title: expect.stringContaining("package job did not publish") } },
  });
});
it("closes as cancelled when the package stop is cancelled", async () => {
  expect({ write: (await wire("package-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("uses the preflight title for a floor stop", async () => {
  expect({ write: (await wire("floor")).writes[0] }).toMatchObject({
    write: {
      output: {
        title: "Margot: preflight — required checks not green — waiting for the next push",
        summary:
          "The required checks were not green when the review's wait ended, so Margot did not review this head. She reviews it when she is dispatched again: on the next push, or when the host re-dispatches her once the checks finish.",
      },
    },
  });
});
it("names the checks that held the floor in its title, as the previous reviewer did", async () => {
  const named = (await wire("floor-named")).writes[0];
  const blank = (await wire("floor-blank")).writes[0];
  const floor = (await wire("floor")).writes[0];
  expect({
    named: ((named?.output ?? {}) as { title?: string }).title,
    blank: ((blank?.output ?? {}) as { title?: string }).title,
    sameSummary:
      ((named?.output ?? {}) as { summary?: string }).summary ===
      ((floor?.output ?? {}) as { summary?: string }).summary,
  }).toEqual({
    named: "Margot: preflight — pending: ci / checks, lint — waiting for the next push",
    blank: "Margot: preflight — required checks not green — waiting for the next push",
    sameSummary: true,
  });
});
it("says Margot stopped before a verdict for other failures", async () => {
  expect({ write: (await wire("stopped")).writes[0] }).toMatchObject({
    write: { output: { title: expect.stringContaining("stopped before a verdict") } },
  });
});
it("gives an unknown stop its own summary, apart from a cancelled one", async () => {
  const summary = async (reason: string) =>
    (await wire(reason)).writes[0]?.output as { summary: string };
  expect({
    unknown: await summary("stopped"),
    cancelled: await summary("review-cancelled"),
  }).toMatchObject({
    unknown: { summary: expect.stringContaining("read the run for the cause") },
    cancelled: { summary: expect.stringContaining("was cancelled before it posted") },
  });
});
it("writes a stop summary as a sentence, not a template", async () => {
  expect((await wire("conflict")).writes[0]).toMatchObject({
    output: { summary: expect.stringContaining("This PR has a merge conflict") },
  });
});
it("reports a failed close as an error rather than a false receipt", async () => {
  expect((await wire("patch-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("could not close check 88"),
  });
});
it("treats a stop reason that is only an inherited object key as unknown", async () => {
  expect({ write: (await wire("prototype-key")).writes[0] }).toMatchObject({
    write: {
      conclusion: "action_required",
      output: { summary: expect.stringContaining("read the run for the cause") },
    },
  });
});

for (const mode of ["old-attempt", "moved-head", "moved-base"])
  it(`refuses cleanup after ${mode}`, async () => {
    const result = await wire(mode);
    expect(result.decision.action).toBe("error");
    expect(result.writes).toHaveLength(0);
  });

for (const mode of ["native-approved", "native-held"])
  it(`leaves an authenticated ${mode} publication untouched after a lost App receipt`, async () => {
    const result = await wire(mode);
    expect(result.decision).toMatchObject({
      action: "left",
      message: expect.stringContaining("native publication 90"),
    });
    expect(result.writes).toHaveLength(0);
  });

for (const mode of ["owner-during-native", "head-during-native"])
  it(`refences after native history before cleanup when ${mode}`, async () => {
    const result = await wire(mode);
    expect(result.decision.action).toBe("error");
    expect(result.writes).toHaveLength(0);
  });
