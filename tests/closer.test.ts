import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { type CloseStrandedCheckInput, closeStrandedCheck } from "../src/closer.js";
import cases from "./closer-scenarios.json" with { type: "json" };

const head = "a".repeat(40);
const ownRuns = "https://github.com/example/control/actions/runs/";

function scenario(id: string, exercise: (broken: boolean) => Promise<unknown>, expected: object) {
  const spec = cases.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(id);
  it(spec.name, async () =>
    expect(await exercise(process.env.MARGOT_CLOSER_BREAK === id)).toMatchObject(expected),
  );
}

async function wire(mode: string, broken = false) {
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
    if (broken) input.published = "false";
  }
  if (mode === "review-failed" || mode === "review-cancelled") {
    input.routeResult = "success";
    input.reviewResult = mode === "review-cancelled" && !broken ? "cancelled" : "failure";
  }
  if (mode === "selected") {
    input.routeResult = "success";
    input.published = broken ? "true" : "false";
  }
  if (mode === "route-cancelled") input.routeResult = broken ? "failure" : "cancelled";
  if (mode === "route-failed-review-cancelled") {
    input.reviewResult = "cancelled";
    if (broken) input.routeResult = "success";
  }
  if (mode === "stale" || mode === "live-stale") input.stopReason = "stale";
  if (mode === "floor" && !broken) input.stopReason = "floor";
  if (mode === "stopped" && broken) input.stopReason = "floor";

  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    const method = init?.method ?? "GET";
    reads.push(`${method} ${target.pathname}${target.search}`);
    if (method === "GET" && target.pathname.endsWith(`/commits/${head}/pulls`)) {
      if (mode === "commit-error" && !broken)
        return response({ message: "Recorded pull read failure" }, 500, url);
      const own = {
        number: mode === "wrong-pr" && !broken ? 8 : 7,
        state: "open",
        head: {
          sha: mode === "stale" || (mode === "live-stale" && broken) ? "f".repeat(40) : head,
        },
      };
      const pulls = [own];
      if (mode === "other-live" && !broken)
        pulls.push({ number: 9, state: "open", head: { sha: head } });
      return response(pulls, 200, url);
    }
    if (method === "GET" && target.pathname.endsWith("/check-runs")) {
      const name = target.searchParams.get("check_name");
      if (mode === "check-error" && !broken)
        return response({ message: "Recorded check read failure" }, 500, url);
      let checkRuns: Record<string, unknown>[] = [
        {
          id: 88,
          name,
          head_sha: head,
          app: { id: 42 },
          status: "in_progress",
          details_url:
            mode === "other-run" && !broken
              ? `${ownRuns}2`
              : mode === "no-run"
                ? ""
                : `${ownRuns}1`,
        },
      ];
      if (mode === "legacy") {
        checkRuns = name === "margot" && !broken ? checkRuns : [];
      } else if (mode === "no-open") {
        checkRuns = broken
          ? checkRuns
          : checkRuns.map((check) => ({ ...check, status: "completed" }));
      }
      return response({ check_runs: checkRuns, total_count: checkRuns.length }, 200, url);
    }
    if (method === "PATCH" && /\/check-runs\/88$/.test(target.pathname)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(body);
      if (mode === "patch-error" && !broken)
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

scenario(
  "closer-nothing-unselected",
  async (broken) => {
    const result = await wire("nothing-unselected", broken);
    return { ...result.decision, reads: result.reads.length };
  },
  { action: "left", message: "nothing to close", reads: 0 },
);
scenario(
  "closer-nothing-published",
  async (broken) => {
    const result = await wire("nothing-published", broken);
    return { ...result.decision, reads: result.reads.length };
  },
  { action: "left", message: "nothing to close", reads: 0 },
);
scenario("closer-commit-error", async (broken) => (await wire("commit-error", broken)).decision, {
  action: "error",
  message: expect.stringContaining("pull requests"),
});
scenario("closer-wrong-pr", async (broken) => (await wire("wrong-pr", broken)).decision, {
  action: "left",
  message: expect.stringContaining("not a commit of PR #7"),
});
scenario("closer-live-stale", async (broken) => (await wire("live-stale", broken)).decision, {
  action: "left",
  message: expect.stringContaining("live head of open PR #7"),
});
scenario("closer-other-live", async (broken) => (await wire("other-live", broken)).decision, {
  action: "left",
  message: expect.stringContaining("open PR #9"),
});
scenario(
  "closer-primary",
  async (broken) => {
    const result = await wire("primary", broken);
    if (broken) result.writes[0] = { ...result.writes[0], conclusion: "success" };
    return { action: result.decision.action, write: result.writes[0] };
  },
  { action: "closed", write: { status: "completed", conclusion: "action_required" } },
);
scenario(
  "closer-legacy",
  async (broken) => {
    const result = await wire("legacy", broken);
    return { action: result.decision.action, read: result.reads.at(-2) };
  },
  { action: "closed", read: expect.stringContaining("check_name=margot") },
);
scenario("closer-check-error", async (broken) => (await wire("check-error", broken)).decision, {
  action: "error",
  message: expect.stringContaining("check-runs"),
});
scenario("closer-no-open", async (broken) => (await wire("no-open", broken)).decision, {
  action: "left",
  message: expect.stringContaining("no open margot check"),
});
scenario("closer-other-run", async (broken) => (await wire("other-run", broken)).decision, {
  action: "left",
  message: expect.stringContaining("belongs to run 2"),
});
scenario(
  "closer-no-run",
  async (broken) => {
    const result = await wire("no-run", broken);
    if (broken) result.writes.length = 0;
    return { action: result.decision.action, writes: result.writes.length };
  },
  { action: "closed", writes: 1 },
);
scenario(
  "closer-stale",
  async (broken) => {
    const result = await wire("stale", broken);
    if (broken) (result.writes[0]?.output as Record<string, unknown>).title = "Margot: stopped";
    return { action: result.decision.action, write: result.writes[0] };
  },
  {
    action: "closed",
    write: {
      conclusion: "skipped",
      output: {
        title: `Margot: superseded by a newer push (${"f".repeat(7)})`,
        summary: "A newer push re-dispatched Margot; that run owns this PR's verdict.",
      },
    },
  },
);
scenario(
  "closer-route-cancelled",
  async (broken) => ({ write: (await wire("route-cancelled", broken)).writes[0] }),
  { write: { conclusion: "cancelled" } },
);
scenario(
  "closer-route-priority",
  async (broken) => ({ write: (await wire("route-failed-review-cancelled", broken)).writes[0] }),
  { write: { conclusion: "action_required" } },
);
scenario(
  "closer-review-cancelled",
  async (broken) => ({ write: (await wire("review-cancelled", broken)).writes[0] }),
  { write: { conclusion: "cancelled" } },
);
scenario(
  "closer-review-failed",
  async (broken) => {
    const result = await wire("review-failed", broken);
    if (broken) (result.writes[0]?.output as Record<string, unknown>).title = "changed";
    return { write: result.writes[0] };
  },
  { write: { output: { title: expect.stringContaining("review job failure") } } },
);
scenario(
  "closer-selected",
  async (broken) => {
    const result = await wire("selected", broken);
    return { action: result.decision.action, write: result.writes[0] };
  },
  {
    action: "closed",
    write: { output: { title: expect.stringContaining("package job did not publish") } },
  },
);
scenario("closer-floor", async (broken) => ({ write: (await wire("floor", broken)).writes[0] }), {
  write: {
    output: {
      title: "Margot: preflight — required checks not green — waiting for the next push",
    },
  },
});
scenario(
  "closer-stopped",
  async (broken) => ({ write: (await wire("stopped", broken)).writes[0] }),
  { write: { output: { title: expect.stringContaining("stopped before a verdict") } } },
);
scenario("closer-patch-error", async (broken) => (await wire("patch-error", broken)).decision, {
  action: "error",
  message: expect.stringContaining("could not close check 88"),
});
