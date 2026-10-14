import { Octokit } from "octokit";
import { expect, it } from "vitest";
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
      let checkRuns: Record<string, unknown>[] = [
        {
          id: 88,
          name,
          head_sha: head,
          app: { id: 42 },
          status: "in_progress",
          details_url:
            mode === "other-run" ? `${ownRuns}2` : mode === "no-run" ? "" : `${ownRuns}1`,
        },
      ];
      if (mode === "other-name") {
        checkRuns = name === "custom / review" ? checkRuns : [];
      } else if (mode === "no-open") {
        checkRuns = checkRuns.map((check) => ({ ...check, status: "completed" }));
      }
      return response({ check_runs: checkRuns, total_count: checkRuns.length }, 200, url);
    }
    if (method === "PATCH" && /\/check-runs\/88$/.test(target.pathname)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(body);
      if (mode === "patch-error")
        return response({ message: "Recorded check write failure" }, 500, url);
      return response({ id: 88, ...body }, 200, url);
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
  const result = await wire("commit-error");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("pull requests"),
  });
});
it("leaves alone a SHA outside the requested PR", async () => {
  const result = await wire("wrong-pr");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("not a commit of PR #7"),
  });
});
it("refuses to close the requested PR's still-live head from a superseded claim", async () => {
  const result = await wire("live-superseded");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("live head of open PR #7"),
  });
});
it("leaves a SHA that is another open PR's live head to that review", async () => {
  const result = await wire("other-live");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
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
  const result = await wire("check-error");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("check-runs"),
  });
});
it("leaves completed checks alone", async () => {
  const result = await wire("no-open");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("no open margot check"),
  });
});
it("leaves a check adopted by another run to that run", async () => {
  const result = await wire("other-run");
  expect(result.writes).toEqual([]);
  expect(result.decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("belongs to run 2"),
  });
});
it("closes a pending check on the requested PR before a run owner is attached", async () => {
  const result = await wire("no-run");
  expect({ action: result.decision.action, writes: result.writes.length }).toMatchObject({
    action: "closed",
    writes: 1,
  });
});
for (const [name, reason, conclusion, title] of [
  [
    "closes a superseded head as skipped with the hosted wording",
    "superseded",
    "skipped",
    `superseded by a newer push (${"f".repeat(7)})`,
  ],
  ["closes a merged PR as skipped with the hosted wording", "merged", "skipped", "merged"],
  [
    "closes a closed unmerged PR as cancelled with the hosted wording",
    "closed",
    "cancelled",
    "closed",
  ],
  ["closes a draft PR as failure with the hosted wording", "draft", "failure", "draft"],
  ["closes a fork-head PR as failure with the hosted wording", "fork", "failure", "fork"],
  [
    "closes a conflicted PR as failure with the hosted wording",
    "conflict",
    "failure",
    "merge conflict",
  ],
  ["closes an empty PR as failure with the hosted wording", "empty", "failure", "empty"],
] as const)
  it(name, async () => {
    const result = await wire(reason);
    expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
      action: "closed",
      write: { conclusion, output: { title: expect.stringContaining(title) } },
    });
  });
it("closes as cancelled when the route is cancelled", async () => {
  expect({ write: (await wire("route-cancelled")).writes[0] }).toMatchObject({
    write: {
      conclusion: "cancelled",
      output: { title: expect.stringContaining("route job cancelled") },
    },
  });
});
it("takes a non-stale conclusion from the first stopped job", async () => {
  expect({ write: (await wire("route-failed-review-cancelled")).writes[0] }).toMatchObject({
    write: {
      conclusion: "action_required",
      output: { title: expect.stringContaining("route job failure") },
    },
  });
});
it("closes as cancelled when the review is cancelled", async () => {
  expect({ write: (await wire("review-cancelled")).writes[0] }).toMatchObject({
    write: {
      conclusion: "cancelled",
      output: { title: expect.stringContaining("review job cancelled") },
    },
  });
});
it("names the stopped job when the review fails", async () => {
  const result = await wire("review-failed");
  expect({ write: result.writes[0] }).toMatchObject({
    write: {
      conclusion: "action_required",
      output: { title: expect.stringContaining("review job failure") },
    },
  });
});
it("closes a selected package that did not publish", async () => {
  const result = await wire("selected");
  expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
    action: "closed",
    write: {
      conclusion: "action_required",
      output: { title: expect.stringContaining("package job did not publish") },
    },
  });
});
it("closes as cancelled when the package stop is cancelled", async () => {
  expect({ write: (await wire("package-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("reports a required-check stop without claiming a review verdict", async () => {
  const result = await wire("floor");
  expect(result.writes[0]).toMatchObject({
    conclusion: "action_required",
    output: {
      title: expect.stringMatching(/preflight.*required checks not green/i),
      summary: expect.stringMatching(/did not review.*dispatched again/i),
    },
  });
});
it("names the required checks that held the review", async () => {
  const named = (await wire("floor-named")).writes[0];
  const blank = (await wire("floor-blank")).writes[0];
  expect(named?.output).toMatchObject({
    title: expect.stringContaining("pending: ci / checks, lint"),
  });
  expect(blank?.output).toMatchObject({
    title: expect.stringContaining("required checks not green"),
  });
});
it("gives an unknown stop its own summary, apart from a cancelled one", async () => {
  const summary = async (reason: string) =>
    (await wire(reason)).writes[0]?.output as { summary: string };
  expect({
    unknown: await summary("stopped"),
    cancelled: await summary("review-cancelled"),
  }).toMatchObject({
    unknown: { summary: expect.stringContaining("ended without posting a verdict") },
    cancelled: { summary: expect.stringContaining("was cancelled") },
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
