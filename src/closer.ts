import type { Octokit } from "octokit";
import { repositorySchema, shaSchema } from "./schemas.js";

const openStates = new Set(["queued", "in_progress"]);

export type CloseStrandedCheckInput = {
  repository: string;
  pr: number;
  head: string;
  appId: number;
  ownRuns: string;
  ownRunId: string;
  routeResult: string;
  reviewResult: string;
  published: string;
  stopReason: string;
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

function diagnostic(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
      message: `could not read the pull requests of ${short} — left untouched (${diagnostic(error)})`,
    };
  }
  const ownPull = pulls.find((pull) => pull.number === input.pr);
  if (!ownPull)
    return {
      action: "left",
      message: `sha ${short} is not a commit of PR #${input.pr} — left alone`,
    };

  const stale = input.stopReason === "stale";
  for (const pull of pulls) {
    if (pull.state === "open" && pull.head.sha === head) {
      if (stale || pull.number !== input.pr)
        return {
          action: "left",
          message: `sha ${short} is the live head of open PR #${pull.number} — left to that PR's review`,
        };
    }
  }

  let check:
    | Awaited<ReturnType<CheckClient["rest"]["checks"]["listForRef"]>>["data"]["check_runs"][number]
    | undefined;
  for (const name of ["review / margot", "margot"]) {
    let checks: Checks;
    try {
      checks = (
        await client.rest.checks.listForRef({
          owner,
          repo,
          ref: head,
          check_name: name,
          app_id: input.appId,
          filter: "latest",
        })
      ).data.check_runs;
    } catch (error) {
      return {
        action: "error",
        message: `could not read check-runs on ${short} — left untouched (${diagnostic(error)})`,
      };
    }
    check = checks.find((candidate) => openStates.has(candidate.status));
    if (check) break;
  }
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

  const stopped =
    input.routeResult !== "success"
      ? ["route", input.routeResult]
      : input.reviewResult !== "success"
        ? ["review", input.reviewResult]
        : ["package", "did not publish"];
  const cancelled =
    stopped[1] === "cancelled" || (stopped[0] === "package" && input.stopReason === "cancelled");
  const conclusion = stale ? "skipped" : cancelled ? "cancelled" : "action_required";
  const title = stale
    ? `Margot: superseded by a newer push (${ownPull.head.sha.slice(0, 7)})`
    : input.stopReason === "floor"
      ? "Margot: preflight — required checks not green — waiting for the next push"
      : `Margot: stopped before a verdict (${stopped[0]} job ${stopped[1]}) — see the run`;
  const summary = stale
    ? "A newer push re-dispatched Margot; that run owns this PR's verdict."
    : input.stopReason === "floor"
      ? "The required mechanical checks were not green, so Margot did not review this head. The next push re-dispatches her."
      : `The ${stopped[0]} job ended without posting a verdict (job result: ${stopped[1]}). A cancelled run is taken over by the newer dispatch of the same head, or the next push re-dispatches her; otherwise Margot did not clear this head.`;
  try {
    await client.rest.checks.update({
      owner,
      repo,
      check_run_id: check.id,
      status: "completed",
      conclusion,
      output: { title, summary },
    });
  } catch (error) {
    return {
      action: "error",
      message: `could not close check ${checkId} (${diagnostic(error)})`,
    };
  }
  return { action: "closed", message: `closed check ${checkId} on ${short} as ${conclusion}` };
}
