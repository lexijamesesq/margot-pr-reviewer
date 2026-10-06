import type { Octokit } from "octokit";
import { triageFromChecks } from "./adapters/github.js";
import { authorityHold } from "./policy.js";
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
 * without one), with its conclusion and wording. Publication posts the same check again with
 * its own text.
 */
export async function postSelfInstrument(
  input: SelfInstrumentInput,
  read: Pick<Octokit, "rest" | "paginate">,
  write: Pick<Octokit, "rest">,
) {
  const repository = repositorySchema.parse(input.repository);
  const head = shaSchema.parse(input.head);
  const [owner, repo] = repository.split("/") as [string, string];
  const { data: pull } = await read.rest.pulls.get({ owner, repo, pull_number: input.pr });
  if (pull.head.sha !== head)
    throw new Error("PR head moved: the self-instrument check is for the live head only");
  const [files, checks] = await Promise.all([
    read.paginate(read.rest.pulls.listFiles, { owner, repo, pull_number: input.pr, per_page: 100 }),
    read.paginate(read.rest.checks.listForRef, {
      owner,
      repo,
      ref: head,
      per_page: 100,
      filter: "latest",
    }),
  ]);
  const triage = triageFromChecks(
    checks,
    { base: pull.base.sha, head },
    { triageAppId: input.appId, triageCheckName: input.triageCheckName },
  );
  const classification =
    triage && input.trustedTriageActors.includes(triage.actor)
      ? triage.classification
      : "functional";
  const { hold, paths } = authorityHold(
    files.map((file) => ({
      path: file.filename,
      ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
    })),
    classification,
    input.protectedPaths,
  );
  const output = hold
    ? {
        conclusion: "neutral" as const,
        title: "self-instrument: held for the operator's approval",
        summary: `This PR changes Margot's own config, the estate ownership map, or a gate workflow — a surface that could disarm the gate. Margot does not approve it herself; it merges on the operator's approval.\n\nMatched:\n${[
          ...paths,
        ]
          .sort()
          .map((path) => `- \`${path}\``)
          .join("\n")}`,
      }
    : {
        conclusion: "success" as const,
        title: "self-instrument: clear",
        summary: `No functional change to a protected path (class: ${classification}).`,
      };
  await write.rest.checks.create({
    owner,
    repo,
    name: input.checkName,
    head_sha: head,
    status: "completed",
    conclusion: output.conclusion,
    output: {
      title: output.title,
      summary: Array.from(output.summary).slice(0, 900).join(""),
    },
  });
  return {
    action: "posted" as const,
    message: `${input.checkName}=${output.conclusion} matched=${JSON.stringify([...paths].sort())}`,
  };
}
