import type { Octokit } from "octokit";
import { changedFiles, triageFromChecks } from "./adapters/github.js";
import { errorMessage } from "./errors.js";
import { authorityHold, verifiedTriage } from "./policy.js";
import { selfInstrumentCheck } from "./render.js";
import { repositorySchema, shaSchema } from "./schemas.js";

export type SelfInstrumentInput = {
  repository: string;
  pr: number;
  head: string;
  protectedPaths: string[];
  /** The App that posts the triage check, and the actors whose triage is trusted. */
  appId: number;
  trustedTriageActors: string[];
  triageCheckName: string;
  checkName: string;
};

/**
 * Posts the self-instrument check for a head before the floor, as the previous reviewer's
 * preflight did: the protected-path hold under the verified triage's class (functional
 * without one), with its conclusion and wording. The changed files are the review's own:
 * the whole-PR diff plus GitHub's listing. A change that cannot be read completely is held.
 */
export async function postSelfInstrument(
  input: SelfInstrumentInput,
  read: Pick<Octokit, "rest" | "paginate" | "request">,
  write: Pick<Octokit, "rest">,
) {
  const repository = repositorySchema.parse(input.repository);
  const head = shaSchema.parse(input.head);
  const [owner, repo] = repository.split("/") as [string, string];
  const p = { owner, repo, pull_number: input.pr };
  const moved = () =>
    new Error("PR head moved: the self-instrument check is for the live head only");
  const { data: pull } = await read.rest.pulls.get(p);
  if (pull.head.sha !== head) throw moved();
  const [files, diff, checks] = await Promise.all([
    read.paginate(read.rest.pulls.listFiles, { ...p, per_page: 100 }),
    read.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...p,
      mediaType: { format: "diff" },
    }),
    read.paginate(read.rest.checks.listForRef, {
      owner,
      repo,
      ref: head,
      per_page: 100,
      filter: "latest",
    }),
  ]);
  if ((await read.rest.pulls.get(p)).data.head.sha !== head) throw moved();
  const verified = verifiedTriage(
    triageFromChecks(
      checks,
      { base: pull.base.sha, head },
      { triageAppId: input.appId, triageCheckName: input.triageCheckName },
    ),
    input.trustedTriageActors,
    head,
  );
  const classification = verified?.classification ?? "functional";
  let output: ReturnType<typeof selfInstrumentCheck>;
  let paths: string[] = [];
  try {
    const hold = authorityHold(
      changedFiles(diff.data, files).files,
      classification,
      input.protectedPaths,
    );
    paths = hold.paths;
    output = selfInstrumentCheck({ ...hold, classification });
  } catch (error) {
    output = selfInstrumentCheck({
      hold: true,
      paths: [],
      classification,
      unreadable: errorMessage(error),
    });
  }
  await write.rest.checks.create({
    owner,
    repo,
    name: input.checkName,
    head_sha: head,
    status: "completed",
    conclusion: output.conclusion,
    output: { title: output.title, summary: output.summary },
  });
  return {
    action: "posted" as const,
    message: `${input.checkName}=${output.conclusion} matched=${JSON.stringify([...paths].sort())}`,
  };
}
