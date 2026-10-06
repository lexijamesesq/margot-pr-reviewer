import { appendFile, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Octokit } from "octokit";
import { z } from "zod";
import { githubClient } from "./adapters/github.js";
import { errorMessage } from "./errors.js";
import {
  liveConfigSchema,
  referenceInputSchema,
  repositorySchema,
  requestSchema,
  shaSchema,
} from "./schemas.js";

const versionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/);
const deploymentSchema = z.object({
  version: versionSchema,
  packageReference: z.url(),
  packageIntegrity: z
    .string()
    .regex(/^sha512-[A-Za-z0-9+/]{86}==$/)
    .optional(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const pullSchema = z.object({
  state: z.string(),
  merged: z.boolean(),
  draft: z.boolean(),
  mergeable: z.boolean().nullable(),
  changed_files: z.number().int().nonnegative(),
  base: z.object({ sha: shaSchema }),
  head: z.object({ sha: shaSchema, repo: z.object({ full_name: repositorySchema }).nullable() }),
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
  margotRoot: string;
  config: unknown;
  requiredChecks: string[];
  protectedPaths: string[];
  allowedSkippedChecks: string[];
  runUrl?: string;
};

export type BindStopReason =
  | "superseded"
  | "merged"
  | "closed"
  | "draft"
  | "fork"
  | "conflict"
  | "empty";

export type BindRequestStop = {
  stopReason: BindStopReason;
  liveSha?: string;
  message: string;
};

export class StopRequestError extends Error {
  constructor(readonly stop: BindRequestStop) {
    super(stop.message);
  }
}

function classifyPull(
  pull: z.infer<typeof pullSchema>,
  repository: string,
  pr: number,
  expectedHead: string,
): BindRequestStop | undefined {
  if (pull.merged)
    return {
      stopReason: "merged",
      message: `margot-instance: PR #${pr} was merged before its review started — exiting without a review. Every later step is skipped.`,
    };
  if (pull.state !== "open")
    return {
      stopReason: "closed",
      message: `margot-instance: PR #${pr} was closed before its review started — exiting without a review. Every later step is skipped.`,
    };
  if (pull.head.sha !== expectedHead)
    return {
      stopReason: "superseded",
      liveSha: pull.head.sha,
      message: `margot-instance: dispatched sha ${expectedHead} is superseded by current head ${pull.head.sha} — exiting; the newer dispatch owns this PR's verdict. Every later step is skipped.`,
    };
  if (pull.draft)
    return { stopReason: "draft", message: "margot-instance refused: not reviewed: draft" };
  if (pull.head.repo?.full_name !== repository)
    return {
      stopReason: "fork",
      message: `margot-instance refused: PR head repository (${pull.head.repo?.full_name ?? "null"}) is not ${repository} (fork). Margot does not review forks.`,
    };
  if (pull.mergeable === false)
    return {
      stopReason: "conflict",
      message: "margot-instance refused: not reviewed: merge conflict (resolve before review)",
    };
  if (pull.changed_files === 0)
    return {
      stopReason: "empty",
      message: "margot-instance refused: not reviewed: empty (no changed files)",
    };
  return undefined;
}

function resolveMargotRoot(value: string, margotRoot: string, field: string) {
  const resolved = value.replaceAll(`\${MARGOT_ROOT}`, margotRoot);
  const unresolved = resolved.match(/\$\{[^{}]+\}/)?.[0];
  if (unresolved)
    throw new Error(
      `Unresolved placeholder ${unresolved} in ${field}; the install root is \${MARGOT_ROOT}`,
    );
  return resolved;
}

type BindIdentityInput = Pick<
  BindRequestInput,
  "repository" | "expectedHead" | "pr" | "margotRoot"
>;

function validateBindIdentity(input: BindIdentityInput) {
  const repository = repositorySchema.parse(input.repository);
  const expectedHead = shaSchema.parse(input.expectedHead);
  if (!Number.isSafeInteger(input.pr) || input.pr < 1) throw new Error("Invalid PR number");
  if (!isAbsolute(input.margotRoot)) throw new Error("Margot root must be absolute");
  return { repository, expectedHead };
}

function prepareRequest(
  input: BindIdentityInput,
  value: unknown,
  identity = validateBindIdentity(input),
) {
  const { expectedHead, repository } = identity;
  const pull = pullSchema.parse(value);
  const stop = classifyPull(pull, repository, input.pr, expectedHead);
  if (stop) throw new StopRequestError(stop);
  return { repository, pull };
}

function bindPrepared(input: BindRequestInput, prepared: ReturnType<typeof prepareRequest>) {
  const { pull, repository } = prepared;
  const suppliedConfig = liveConfigSchema.parse(input.config);
  const config = structuredClone(suppliedConfig);
  if (input.authority) {
    if (!config.publisher) throw new Error("Authority requires publisher configuration");
    if (!input.runUrl) throw new Error("Authority requires a run URL");
    config.publisher.runUrl = input.runUrl;
  }
  config.review.requiredChecks = input.requiredChecks;
  config.review.protectedPaths = input.protectedPaths;
  config.review.allowedSkippedChecks = input.allowedSkippedChecks;
  config.review.publication = input.authority ? "github" : "none";
  config.github.shadowBeforeHead = !input.authority;
  config.claude.executable = resolveMargotRoot(
    config.claude.executable,
    input.margotRoot,
    "claude.executable",
  );
  config.claude.pluginDirectory = resolveMargotRoot(
    config.claude.pluginDirectory,
    input.margotRoot,
    "claude.pluginDirectory",
  );
  config.claude.container.work = resolveMargotRoot(
    config.claude.container.work,
    input.margotRoot,
    "claude.container.work",
  );
  if (config.claude.ticketing)
    config.claude.ticketing.command = resolveMargotRoot(
      config.claude.ticketing.command,
      input.margotRoot,
      "claude.ticketing.command",
    );
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

export async function bindRequest(input: BindRequestInput, readPull: PullReader) {
  const identity = validateBindIdentity(input);
  const pull = await readPull(identity.repository, input.pr);
  return bindPrepared(input, prepareRequest(input, pull, identity));
}

async function resolveReferences(config: unknown, github: Pick<Octokit, "rest">) {
  const claude = (config as { claude?: { references?: Record<string, unknown> } } | null)?.claude;
  if (!claude?.references) return config;
  const references: Record<string, { repository: string; head: string }> = {};
  for (const [name, value] of Object.entries(claude.references)) {
    const parsed = referenceInputSchema.safeParse(value);
    if (!parsed.success)
      throw new Error(`Reference ${name} is invalid: ${errorMessage(parsed.error)}`);
    const reference = parsed.data;
    if (reference.head !== undefined) {
      references[name] = { repository: reference.repository, head: reference.head };
      continue;
    }
    const [owner = "", repo = ""] = reference.repository.split("/");
    const ref = reference.ref ?? "";
    try {
      const { data } = await github.rest.repos.getCommit({ owner, repo, ref });
      references[name] = { repository: reference.repository, head: shaSchema.parse(data.sha) };
    } catch (error) {
      throw new Error(
        `Reference ${name} (${reference.repository}) ref ${ref} did not resolve to a commit: ${errorMessage(error)}`,
      );
    }
  }
  return { ...(config as object), claude: { ...claude, references } };
}

export async function bindRequestFiles(
  input: Omit<BindRequestInput, "config"> & { configFile: string },
  token: string | undefined,
  client?: Pick<Octokit, "rest">,
) {
  if (!token) throw new Error("GH_TOKEN is required");
  const github = client ?? githubClient({ token, retries: 0 });
  const identity = validateBindIdentity(input);
  const [owner = "", repo = ""] = identity.repository.split("/");
  const pull = (await github.rest.pulls.get({ owner, repo, pull_number: input.pr })).data;
  const prepared = prepareRequest(input, pull, identity);
  const config = await resolveReferences(
    JSON.parse(await readFile(input.configFile, "utf8")),
    github,
  );
  const bound = bindPrepared({ ...input, config }, prepared);
  await Promise.all([
    writeFile(join(input.margotRoot, "request.json"), `${JSON.stringify(bound.request)}\n`, {
      mode: 0o600,
    }),
    writeFile(join(input.margotRoot, "config.json"), `${JSON.stringify(bound.config)}\n`, {
      mode: 0o600,
    }),
  ]);
  return bound;
}
