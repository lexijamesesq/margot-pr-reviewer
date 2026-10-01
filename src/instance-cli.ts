#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Octokit } from "octokit";
import { bindRequestFiles, validateDeployment, writeGitHubOutput } from "./instance.js";

type Options = Record<string, string>;

function options(args: string[]) {
  const parsed: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new Error(`Invalid argument: ${flag ?? "missing"}`);
    const name = flag.slice(2);
    if (name in parsed) throw new Error(`Duplicate argument: ${flag}`);
    parsed[name] = value;
  }
  return parsed;
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

function rejectUnknown(input: Options, names: string[]) {
  const known = new Set(names);
  const unknown = Object.keys(input).find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown argument: --${unknown}`);
}

export async function runInstanceCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  client?: Pick<Octokit, "rest">,
) {
  const [command, ...rest] = args;
  const input = options(rest);
  if (command === "validate-deployment") {
    rejectUnknown(input, [
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
    const phase = required(input, "phase");
    if (phase !== "triage" && phase !== "review") throw new Error("--phase is invalid");
    rejectUnknown(input, [
      "repository",
      "pr",
      "head",
      "phase",
      "authority",
      "engine-root",
      "config",
      "required-checks",
      "protected-paths",
      "allowed-skipped-checks",
      "run-url",
    ]);
    if (input["run-url"] === "") throw new Error("--run-url must not be empty");
    return bindRequestFiles(
      {
        repository: required(input, "repository"),
        pr: Number(required(input, "pr")),
        expectedHead: required(input, "head"),
        phase,
        authority: bool(input, "authority"),
        engineRoot: required(input, "engine-root"),
        configFile: required(input, "config"),
        requiredChecks: list(input, "required-checks"),
        protectedPaths: list(input, "protected-paths"),
        allowedSkippedChecks: list(input, "allowed-skipped-checks"),
        ...(input["run-url"] ? { runUrl: input["run-url"] } : {}),
      },
      environment.GH_TOKEN,
      client,
    );
  }
  throw new Error("Usage: margot-instance <validate-deployment|bind-request> [named arguments]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  runInstanceCommand(process.argv.slice(2), process.env).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Instance command failed"}\n`);
    process.exitCode = 1;
  });
