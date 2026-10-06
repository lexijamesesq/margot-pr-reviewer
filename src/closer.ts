import type { Octokit } from "octokit";
import { describeFailure } from "./describe-failure.js";
import { repositorySchema, shaSchema } from "./schemas.js";

const openStates = new Set(["queued", "in_progress"]);

export type CloseStrandedCheckInput = {
  repository: string;
  pr: number;
  head: string;
  appId: number;
  checkName: string;
  ownRuns: string;
  ownRunId: string;
  routeResult: string;
  reviewResult: string;
  published: string;
  stopReason: string;
  liveSha?: string;
  /** What held the floor, as the host words it (such as "pending: ci / checks, lint"). */
  blockingChecks?: string;
};

export type CloseStrandedCheckDecision = {
  action: "closed" | "left" | "error";
  message: string;
};

type CheckClient = Pick<Octokit, "rest">;
type Pulls = Awaited<
  ReturnType<CheckClient["rest"]["repos"]["listPullRequestsAssociatedWithCommit"]>
>["data"];
type Checks = Awaited<
  ReturnType<CheckClient["rest"]["checks"]["listForRef"]>
>["data"]["check_runs"];

type CheckConclusion = "skipped" | "cancelled" | "failure" | "action_required";
type CheckOutput = { conclusion: CheckConclusion; title: string; summary: string };
type StopContext = { liveSha: string; stopped: [string, string]; blockingChecks: string };

const stopChecks = {
  superseded: ({ liveSha }: StopContext): CheckOutput => ({
    conclusion: "skipped",
    title: `Margot: superseded by a newer push (${liveSha.slice(0, 7)})`,
    summary: "A newer push re-dispatched Margot; that run owns this PR's verdict.",
  }),
  merged: (): CheckOutput => ({
    conclusion: "skipped",
    title: "Margot: not reviewed: the PR was merged first",
    summary: "The PR was merged before a review runner picked it up, so Margot skipped the review.",
  }),
  closed: (): CheckOutput => ({
    conclusion: "cancelled",
    title: "Margot: not reviewed: the PR was closed first",
    summary: "The PR was closed before a review runner picked it up, so Margot skipped the review.",
  }),
  draft: (): CheckOutput => ({
    conclusion: "failure",
    title: "Margot: not reviewed: draft",
    summary: "This PR is a draft, and Margot does not review drafts. Mark it ready for review.",
  }),
  fork: (): CheckOutput => ({
    conclusion: "failure",
    title: "Margot: not reviewed: fork head",
    summary: "This PR's head is in a fork, and Margot does not review fork heads.",
  }),
  conflict: (): CheckOutput => ({
    conclusion: "failure",
    title: "Margot: not reviewed: merge conflict (resolve before review)",
    summary:
      "This PR has a merge conflict, so Margot did not review it. Resolve the conflict and push.",
  }),
  empty: (): CheckOutput => ({
    conclusion: "failure",
    title: "Margot: not reviewed: empty (no changed files)",
    summary: "This PR changes no files, so Margot has nothing to review.",
  }),
  floor: ({ blockingChecks }: StopContext): CheckOutput => ({
    conclusion: "action_required",
    title: `Margot: preflight — ${blockingChecks || "required checks not green"} — waiting for the next push`,
    summary:
      "The required checks were not green when the review's wait ended, so Margot did not review this head. She reviews it when she is dispatched again: on the next push, or when the host re-dispatches her once the checks finish.",
  }),
  cancelled: ({ stopped }: StopContext): CheckOutput => ({
    conclusion: "cancelled",
    title: `Margot: stopped before a verdict (${stopped[0]} job ${stopped[1]}) — see the run`,
    summary: `The ${stopped[0]} job was cancelled before it posted a verdict (job result: ${stopped[1]}). A newer dispatch of the same head takes it over, or the next push re-dispatches Margot; until then she has not cleared this head.`,
  }),
  unknown: ({ stopped }: StopContext): CheckOutput => ({
    conclusion: "action_required",
    title: `Margot: stopped before a verdict (${stopped[0]} job ${stopped[1]}) — see the run`,
    summary: `The ${stopped[0]} job ended without posting a verdict (job result: ${stopped[1]}). Margot has not cleared this head; read the run for the cause. The next push re-dispatches her.`,
  }),
} satisfies Record<string, (context: StopContext) => CheckOutput>;

export function shouldCloseStrandedCheck(input: CloseStrandedCheckInput) {
  return (
    input.routeResult !== "success" ||
    input.reviewResult !== "success" ||
    input.published === "false"
  );
}

/** Close only the still-open review check this workflow run is allowed to own. */
export async function closeStrandedCheck(
  input: CloseStrandedCheckInput,
  client: CheckClient,
): Promise<CloseStrandedCheckDecision> {
  const repository = repositorySchema.parse(input.repository);
  const head = shaSchema.parse(input.head);
  const [owner, repo] = repository.split("/") as [string, string];
  const short = head.slice(0, 7);
  if (!shouldCloseStrandedCheck(input)) return { action: "left", message: "nothing to close" };

  let pulls: Pulls;
  try {
    pulls = (
      await client.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: head,
      })
    ).data;
  } catch (error) {
    return {
      action: "error",
      message: `could not read the pull requests of ${short} — left untouched (${describeFailure(error)})`,
    };
  }
  const ownPull = pulls.find((pull) => pull.number === input.pr);
  if (!ownPull)
    return {
      action: "left",
      message: `sha ${short} is not a commit of PR #${input.pr} — left alone`,
    };

  const superseded = input.stopReason === "superseded";
  for (const pull of pulls) {
    if (pull.state === "open" && pull.head.sha === head) {
      if (superseded || pull.number !== input.pr)
        return {
          action: "left",
          message: `sha ${short} is the live head of open PR #${pull.number} — left to that PR's review`,
        };
    }
  }

  let checks: Checks;
  try {
    checks = (
      await client.rest.checks.listForRef({
        owner,
        repo,
        ref: head,
        check_name: input.checkName,
        app_id: input.appId,
        filter: "latest",
      })
    ).data.check_runs;
  } catch (error) {
    return {
      action: "error",
      message: `could not read check-runs on ${short} — left untouched (${describeFailure(error)})`,
    };
  }
  const check = checks.find((candidate) => openStates.has(candidate.status));
  if (!check)
    return {
      action: "left",
      message: `no open margot check on ${short} — nothing to close`,
    };

  const checkId = String(check.id);
  const details = check.details_url ?? "";
  if (details.startsWith(input.ownRuns) && details.slice(input.ownRuns.length) !== input.ownRunId)
    return {
      action: "left",
      message: `check ${checkId} belongs to run ${details.slice(input.ownRuns.length)} — left to that run`,
    };

  const stopped: [string, string] =
    input.routeResult !== "success"
      ? ["route", input.routeResult]
      : input.reviewResult !== "success"
        ? ["review", input.reviewResult]
        : ["package", "did not publish"];
  const cancelled =
    stopped[1] === "cancelled" || (stopped[0] === "package" && input.stopReason === "cancelled");
  const context = {
    liveSha: input.liveSha ?? ownPull.head.sha,
    stopped,
    blockingChecks: input.blockingChecks?.trim() ?? "",
  };
  const mapped = Object.hasOwn(stopChecks, input.stopReason)
    ? stopChecks[input.stopReason as keyof typeof stopChecks]
    : undefined;
  const output = mapped
    ? mapped(context)
    : cancelled
      ? stopChecks.cancelled(context)
      : stopChecks.unknown(context);
  try {
    await client.rest.checks.update({
      owner,
      repo,
      check_run_id: check.id,
      status: "completed",
      conclusion: output.conclusion,
      output: { title: output.title, summary: output.summary },
    });
  } catch (error) {
    return {
      action: "error",
      message: `could not close check ${checkId} (${describeFailure(error)})`,
    };
  }
  return {
    action: "closed",
    message: `closed check ${checkId} on ${short} as ${output.conclusion}`,
  };
}
