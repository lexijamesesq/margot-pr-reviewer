import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { type CloseStrandedCheckInput, closeStrandedCheck } from "../src/closer.js";

const head = "a".repeat(40);
const ownRuns = "https://github.com/example/control/actions/runs/";
async function wire(mode: string) {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const input: CloseStrandedCheckInput = {
    repository: "example/project",
    pr: 7,
    head,
    appId: 42,
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
  if (mode === "floor") input.stopReason = "floor";
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
      if (mode === "pre-rename") {
        checkRuns = name === "margot" ? checkRuns : [];
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
it("An unselected package with successful jobs has nothing to close", async () => {
  const result = await wire("nothing-unselected");
  expect({ ...result.decision, reads: result.reads.length }).toMatchObject({
    action: "left",
    message: "nothing to close",
    reads: 0,
  });
});
it("A published package has nothing to close", async () => {
  const result = await wire("nothing-published");
  expect({ ...result.decision, reads: result.reads.length }).toMatchObject({
    action: "left",
    message: "nothing to close",
    reads: 0,
  });
});
it("An unreadable commit-to-PR binding touches nothing", async () => {
  expect((await wire("commit-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("pull requests"),
  });
});
it("A SHA outside the requested PR is left alone", async () => {
  expect((await wire("wrong-pr")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("not a commit of PR #7"),
  });
});
it("A superseded claim cannot close the requested PR's still-live head", async () => {
  expect((await wire("live-superseded")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("live head of open PR #7"),
  });
});
it("A SHA that is another open PR's live head is left to that review", async () => {
  expect((await wire("other-live")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("open PR #9"),
  });
});
it("The open review slash margot check closes without passing", async () => {
  const result = await wire("primary");
  expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
    action: "closed",
    write: { status: "completed", conclusion: "action_required" },
  });
});
it("The pre-rename margot check is the fallback", async () => {
  const result = await wire("pre-rename");
  expect({ action: result.decision.action, read: result.reads.at(-2) }).toMatchObject({
    action: "closed",
    read: expect.stringContaining("check_name=margot"),
  });
});
it("An unreadable check list touches nothing", async () => {
  expect((await wire("check-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("check-runs"),
  });
});
it("Completed checks are left alone", async () => {
  expect((await wire("no-open")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("no open margot check"),
  });
});
it("A check adopted by another run is left to that run", async () => {
  expect((await wire("other-run")).decision).toMatchObject({
    action: "left",
    message: expect.stringContaining("belongs to run 2"),
  });
});
it("A caller check with no run owner can be closed", async () => {
  const result = await wire("no-run");
  expect({ action: result.decision.action, writes: result.writes.length }).toMatchObject({
    action: "closed",
    writes: 1,
  });
});
for (const [name, reason, conclusion, title] of [
  [
    "A superseded head closes skipped with the hosted wording",
    "superseded",
    "skipped",
    `Margot: superseded by a newer push (${"f".repeat(7)})`,
  ],
  [
    "A merged PR closes skipped with the hosted wording",
    "merged",
    "skipped",
    "Margot: not reviewed — the PR was merged first",
  ],
  [
    "A closed unmerged PR closes cancelled with the hosted wording",
    "closed",
    "cancelled",
    "Margot: not reviewed — the PR was closed first",
  ],
  ["A draft PR closes failure with the hosted wording", "draft", "failure", "not reviewed: draft"],
  [
    "A fork-head PR closes failure with the hosted wording",
    "fork",
    "failure",
    "not reviewed: fork head",
  ],
  [
    "A conflicted PR closes failure with the hosted wording",
    "conflict",
    "failure",
    "not reviewed: merge conflict (resolve before review)",
  ],
  [
    "An empty PR closes failure with the hosted wording",
    "empty",
    "failure",
    "not reviewed: empty (no changed files)",
  ],
] as const)
  it(name, async () => {
    const result = await wire(reason);
    expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
      action: "closed",
      write: { conclusion, output: { title } },
    });
  });
it("A cancelled route closes cancelled", async () => {
  expect({ write: (await wire("route-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("The first stopped job determines a non-stale conclusion", async () => {
  expect({ write: (await wire("route-failed-review-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "action_required" },
  });
});
it("A cancelled review closes cancelled", async () => {
  expect({ write: (await wire("review-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("A failed review names the stopped job", async () => {
  const result = await wire("review-failed");
  expect({ write: result.writes[0] }).toMatchObject({
    write: { output: { title: expect.stringContaining("review job failure") } },
  });
});
it("A selected package that did not publish is closed", async () => {
  const result = await wire("selected");
  expect({ action: result.decision.action, write: result.writes[0] }).toMatchObject({
    action: "closed",
    write: { output: { title: expect.stringContaining("package job did not publish") } },
  });
});
it("A cancelled package stop closes cancelled", async () => {
  expect({ write: (await wire("package-cancelled")).writes[0] }).toMatchObject({
    write: { conclusion: "cancelled" },
  });
});
it("A floor stop uses the preflight title", async () => {
  expect({ write: (await wire("floor")).writes[0] }).toMatchObject({
    write: {
      output: {
        title: "Margot: preflight — required checks not green — waiting for the next push",
      },
    },
  });
});
it("Other failures say Margot stopped before a verdict", async () => {
  expect({ write: (await wire("stopped")).writes[0] }).toMatchObject({
    write: { output: { title: expect.stringContaining("stopped before a verdict") } },
  });
});
it("A failed close is an error rather than a false receipt", async () => {
  expect((await wire("patch-error")).decision).toMatchObject({
    action: "error",
    message: expect.stringContaining("could not close check 88"),
  });
});
