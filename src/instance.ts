import { appendFile, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Octokit } from "octokit";
import { z } from "zod";
import { githubClient } from "./adapters/github.js";
import { liveConfigSchema, requestSchema, shaSchema } from "./schemas.js";

const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const versionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/);
const deploymentSchema = z.object({
  version: versionSchema,
  packageReference: z.url(),
  packageIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const pullSchema = z.object({
  state: z.literal("open"),
  draft: z.literal(false),
  base: z.object({ sha: shaSchema }),
  head: z.object({ sha: shaSchema, repo: z.object({ full_name: repositorySchema }) }),
});

export type DeploymentSelection = { authority: boolean; repositoryName: string };

function uniqueRepositories(name: string, values: string[]) {
  const parsed = values.map((value) => repositorySchema.parse(value));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${name} contains duplicates`);
  return parsed;
}

export function validateDeployment(input: {
  deployment: unknown;
  releaseRepository: string;
  repository: string;
  enrolledRepositories: string[];
  authorityRepositories: string[];
}): DeploymentSelection {
  const deployment = deploymentSchema.parse(input.deployment);
  const releaseRepository = repositorySchema.parse(input.releaseRepository);
  const repository = repositorySchema.parse(input.repository);
  const enrolled = uniqueRepositories("Enrolled repositories", input.enrolledRepositories);
  const authority = uniqueRepositories("Authority repositories", input.authorityRepositories);
  if (authority.some((candidate) => !enrolled.includes(candidate)))
    throw new Error("Every authority repository must be enrolled");
  if (!enrolled.includes(repository)) throw new Error("Repository is not enrolled");

  const reference = new URL(deployment.packageReference);
  const expectedPath = `/${releaseRepository}/releases/download/v${deployment.version}/margot-pr-reviewer-${deployment.version}.tgz`;
  if (
    reference.protocol !== "https:" ||
    reference.hostname !== "github.com" ||
    reference.port ||
    reference.username ||
    reference.password ||
    reference.search ||
    reference.hash ||
    reference.pathname !== expectedPath
  )
    throw new Error("Package reference must be the matching configured GitHub release asset");

  const repositoryName = repository.split("/")[1];
  if (!repositoryName) throw new Error("Repository has no short name");
  return { authority: authority.includes(repository), repositoryName };
}

export async function writeGitHubOutput(
  selection: DeploymentSelection,
  outputPath: string | undefined,
) {
  if (!outputPath) return;
  await appendFile(
    outputPath,
    `authority=${selection.authority}\nrepositoryName=${selection.repositoryName}\n`,
  );
}

type PullReader = (repository: string, pr: number) => Promise<unknown>;

export type BindRequestInput = {
  repository: string;
  pr: number;
  expectedHead: string;
  phase: "triage" | "review";
  authority: boolean;
  engineRoot: string;
  config: unknown;
  requiredChecks: string[];
  protectedPaths: string[];
  allowedSkippedChecks: string[];
  runUrl?: string;
};

function resolveEngineRoot(value: string, engineRoot: string) {
  return value.replaceAll(`\${ENGINE_ROOT}`, engineRoot);
}

export async function bindRequest(input: BindRequestInput, readPull: PullReader) {
  const repository = repositorySchema.parse(input.repository);
  const expectedHead = shaSchema.parse(input.expectedHead);
  if (!Number.isSafeInteger(input.pr) || input.pr < 1) throw new Error("Invalid PR number");
  if (!isAbsolute(input.engineRoot)) throw new Error("Engine root must be absolute");

  const suppliedConfig = liveConfigSchema.parse(input.config);
  const pull = pullSchema.parse(await readPull(repository, input.pr));
  if (pull.head.repo.full_name !== repository || pull.head.sha !== expectedHead)
    throw new Error("Stale or untrusted request");

  const config = structuredClone(suppliedConfig);
  if (input.authority && !config.publisher)
    throw new Error("Authority requires publisher configuration");
  if (input.authority && !input.runUrl) throw new Error("Authority requires a run URL");
  config.review.requiredChecks = input.requiredChecks;
  config.review.protectedPaths = input.protectedPaths;
  config.review.allowedSkippedChecks = input.allowedSkippedChecks;
  config.review.publication = input.authority ? "github" : "none";
  config.github.shadowBeforeHead = !input.authority;
  config.claude.executable = resolveEngineRoot(config.claude.executable, input.engineRoot);
  config.claude.pluginDirectory = resolveEngineRoot(
    config.claude.pluginDirectory,
    input.engineRoot,
  );
  if (config.claude.ticketing)
    config.claude.ticketing.command = resolveEngineRoot(
      config.claude.ticketing.command,
      input.engineRoot,
    );
  if (input.runUrl !== undefined) {
    if (!config.publisher) throw new Error("Run URL requires publisher configuration");
    config.publisher.runUrl = input.runUrl;
  }
  const boundConfig = liveConfigSchema.parse(config);
  const request = requestSchema.parse({
    repository,
    pr: input.pr,
    base: pull.base.sha,
    head: pull.head.sha,
    phase: input.phase,
  });
  return { request, config: boundConfig };
}

export async function bindRequestFiles(
  input: Omit<BindRequestInput, "config"> & { configFile: string },
  token: string | undefined,
  client?: Pick<Octokit, "rest">,
) {
  if (!token) throw new Error("GH_TOKEN is required");
  const github = client ?? githubClient({ token, retries: 0 });
  const config = JSON.parse(await readFile(input.configFile, "utf8"));
  const bound = await bindRequest({ ...input, config }, async (repository, pr) => {
    const [owner = "", repo = ""] = repository.split("/");
    return (await github.rest.pulls.get({ owner, repo, pull_number: pr })).data;
  });
  await Promise.all([
    writeFile(join(input.engineRoot, "request.json"), `${JSON.stringify(bound.request)}\n`, {
      mode: 0o600,
    }),
    writeFile(join(input.engineRoot, "config.json"), `${JSON.stringify(bound.config)}\n`, {
      mode: 0o600,
    }),
  ]);
  return bound;
}
