#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Octokit } from "octokit";
import { githubClient } from "./adapters/github.js";
import { closeStrandedCheck, shouldCloseStrandedCheck } from "./closer.js";
import {
  type BindRequestStop,
  bindRequestFiles,
  StopRequestError,
  validateDeployment,
  writeGitHubOutput,
} from "./instance.js";
import { shaSchema } from "./schemas.js";

type Options = Record<string, string | undefined>;

class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export function instanceExitCode(error: unknown) {
  return error instanceof CommandError
    ? error.exitCode
    : error instanceof StopRequestError
      ? 75
      : 1;
}

function stopOutput(stop: BindRequestStop) {
  return `stop_reason=${stop.stopReason}\n${stop.liveSha ? `live_sha=${stop.liveSha}\n` : ""}`;
}

function named(args: string[], names: string[]) {
  try {
    const { values, tokens } = parseArgs({
      args,
      options: Object.fromEntries(names.map((name) => [name, { type: "string" as const }])),
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name)) throw new Error(`Duplicate argument: --${token.name}`);
      seen.add(token.name);
    }
    return values as Options;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = message.match(/Unknown option '([^']+)'/);
    throw new Error(unknown ? `Unknown argument: ${unknown[1]}` : message);
  }
}

function required(input: Options, name: string) {
  const value = input[name];
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

function list(input: Options, name: string) {
  const value = JSON.parse(required(input, name));
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`--${name} must be a JSON string array`);
  return value as string[];
}

function bool(input: Options, name: string) {
  const value = required(input, name);
  if (value !== "true" && value !== "false") throw new Error(`--${name} must be true or false`);
  return value === "true";
}

function positiveInteger(input: Options, name: string) {
  const value = Number(required(input, name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} is invalid`);
  return value;
}

export async function runInstanceCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  client?: Pick<Octokit, "rest">,
) {
  const [command, ...rest] = args;
  if (command === "validate-deployment") {
    const input = named(rest, [
      "deployment",
      "release-repository",
      "repository",
      "enrolled-repositories",
      "authority-repositories",
    ]);
    const deployment = JSON.parse(await readFile(required(input, "deployment"), "utf8"));
    const result = validateDeployment({
      deployment,
      releaseRepository: required(input, "release-repository"),
      repository: required(input, "repository"),
      enrolledRepositories: list(input, "enrolled-repositories"),
      authorityRepositories: list(input, "authority-repositories"),
    });
    await writeGitHubOutput(result, environment.GITHUB_OUTPUT);
    return result;
  }
  if (command === "bind-request") {
    const input = named(rest, [
      "repository",
      "pr",
      "head",
      "phase",
      "authority",
      "margot-root",
      "config",
      "required-checks",
      "protected-paths",
      "allowed-skipped-checks",
      "run-url",
    ]);
    const phase = required(input, "phase");
    if (phase !== "triage" && phase !== "review") throw new Error("--phase is invalid");
    if (input["run-url"] === "") throw new Error("--run-url must not be empty");
    try {
      return await bindRequestFiles(
        {
          repository: required(input, "repository"),
          pr: Number(required(input, "pr")),
          expectedHead: required(input, "head"),
          phase,
          authority: bool(input, "authority"),
          margotRoot: required(input, "margot-root"),
          configFile: required(input, "config"),
          requiredChecks: list(input, "required-checks"),
          protectedPaths: list(input, "protected-paths"),
          allowedSkippedChecks: list(input, "allowed-skipped-checks"),
          ...(input["run-url"] ? { runUrl: input["run-url"] } : {}),
        },
        environment.GH_TOKEN,
        client,
      );
    } catch (error) {
      if (error instanceof StopRequestError && environment.GITHUB_OUTPUT)
        await appendFile(environment.GITHUB_OUTPUT, stopOutput(error.stop));
      throw error;
    }
  }
  if (command === "close-stranded-check") {
    const input = named(rest, [
      "repository",
      "pr",
      "head",
      "app-id",
      "own-runs",
      "own-run-id",
      "route-result",
      "review-result",
      "published",
      "stop-reason",
      "live-sha",
    ]);
    const head = shaSchema.parse(required(input, "head"));
    const ownRuns = required(input, "own-runs");
    if (!ownRuns.endsWith("/")) throw new Error("--own-runs must be a run URL prefix ending in /");
    const published = required(input, "published");
    if (published !== "" && published !== "true" && published !== "false")
      throw new Error("--published must be true, false, or empty");
    const closeInput = {
      repository: required(input, "repository"),
      pr: positiveInteger(input, "pr"),
      head,
      appId: positiveInteger(input, "app-id"),
      ownRuns,
      ownRunId: required(input, "own-run-id"),
      routeResult: required(input, "route-result"),
      reviewResult: required(input, "review-result"),
      published,
      stopReason: required(input, "stop-reason"),
      ...(input["live-sha"] ? { liveSha: shaSchema.parse(input["live-sha"]) } : {}),
    };
    if (!shouldCloseStrandedCheck(closeInput))
      return { action: "left" as const, message: "nothing to close" };
    if (!environment.GH_TOKEN) throw new Error("GH_TOKEN is required");
    const decision = await closeStrandedCheck(
      closeInput,
      client ?? githubClient({ token: environment.GH_TOKEN, retries: 0 }),
    );
    if (decision.action === "error") throw new CommandError(decision.message, 2);
    return decision;
  }
  throw new Error(
    "Usage: margot-instance <validate-deployment|bind-request|close-stranded-check> [named arguments]",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  runInstanceCommand(process.argv.slice(2), process.env)
    .then((result) => {
      if ("action" in result) process.stdout.write(`${result.message}\n`);
    })
    .catch((error: unknown) => {
      if (error instanceof StopRequestError) process.stdout.write(stopOutput(error.stop));
      process.stderr.write(
        `${error instanceof Error ? error.message : "Instance command failed"}\n`,
      );
      process.exitCode = instanceExitCode(error);
    });
