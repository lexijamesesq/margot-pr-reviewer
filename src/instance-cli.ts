#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Octokit } from "octokit";
import { z } from "zod";
import { githubClient } from "./adapters/github.js";
import { closeStrandedCheck, shouldCloseStrandedCheck } from "./closer.js";
import { errorMessage } from "./errors.js";
import {
  type BindRequestStop,
  bindRequestFiles,
  StopRequestError,
  validateDeployment,
  writeGitHubOutput,
} from "./instance.js";
import { shaSchema } from "./schemas.js";
import { evaluateChecks, reviewAdmission, trustedChecks } from "./trusted-checks.js";

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
    const message = errorMessage(error);
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
  let value: unknown;
  try {
    value = JSON.parse(required(input, name));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`--${name} is not valid JSON: ${error.message}`);
  }
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

const usage =
  "Usage: margot-instance <validate-deployment|bind-request|evaluate-checks|trusted-checks|review-admission|close-stranded-check> [named arguments]";

export async function runInstanceCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  client?: Pick<Octokit, "rest">,
  /** Construct each explicitly scoped GitHub client from its workflow credential. */
  githubFor: (token: string) => Pick<Octokit, "rest" | "paginate" | "request"> = (token) =>
    githubClient({ token, retries: 0 }),
) {
  const [command, ...rest] = args;
  if (args.length === 1 && (command === "--help" || command === "-h")) return { help: usage };
  if (command === "trusted-checks" || command === "review-admission") {
    const input = named(rest, [
      "operation",
      "kind",
      "request-file",
      "config",
      "context-file",
      "output-file",
      "result-file",
      "text-outcome",
      "failure",
      "run-url",
      "request-id",
    ]);
    if (
      !environment.GH_TOKEN ||
      !environment.MARGOT_WRITE_TOKEN ||
      !environment.MARGOT_RUN_TOKEN ||
      !environment.MARGOT_ACTIONS_TOKEN
    )
      throw new Error(
        "GH_TOKEN, MARGOT_WRITE_TOKEN, MARGOT_RUN_TOKEN and MARGOT_ACTIONS_TOKEN required",
      );
    const config = JSON.parse(await readFile(required(input, "config"), "utf8"));
    if (input["run-url"]) config.publisher = { ...config.publisher, runUrl: input["run-url"] };
    const request = JSON.parse(await readFile(required(input, "request-file"), "utf8"));
    const clients = {
      read: githubFor(environment.GH_TOKEN) as Octokit,
      write: githubFor(environment.MARGOT_WRITE_TOKEN) as Octokit,
      runs: githubFor(environment.MARGOT_RUN_TOKEN) as Octokit,
      actions: githubFor(environment.MARGOT_ACTIONS_TOKEN) as Octokit,
      ...(environment.MARGOT_DISPATCH_TOKEN
        ? { dispatch: githubFor(environment.MARGOT_DISPATCH_TOKEN) as Octokit }
        : {}),
    };
    const result =
      command === "review-admission"
        ? await reviewAdmission(request, config, clients, required(input, "request-id"))
        : await trustedChecks(
            {
              operation: z
                .enum(["begin", "code-passed", "finish", "fail"])
                .parse(required(input, "operation")),
              kind: z.enum(["code", "text"]).parse(required(input, "kind")),
              request,
              config,
              contextFile: required(input, "context-file"),
              ...(input["result-file"]
                ? { result: JSON.parse(await readFile(input["result-file"], "utf8")) }
                : {}),
              ...(input["text-outcome"]
                ? {
                    textOutcome: z
                      .enum(["success", "failure", "cancelled"])
                      .parse(input["text-outcome"]),
                  }
                : {}),
              ...(input.failure
                ? { failure: z.enum(["failure", "cancelled"]).parse(input.failure) }
                : {}),
            },
            clients,
          );
    await writeFile(required(input, "output-file"), `${JSON.stringify(result)}\n`, { mode: 0o600 });
    const outputs = Object.entries(result)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (/[\r\n]/.test(String(v))) throw new Error("Multiline step output refused");
        return `${k}=${String(v)}\n`;
      })
      .join("");
    if (environment.GITHUB_OUTPUT) await appendFile(environment.GITHUB_OUTPUT, outputs);
    if ("retryable" in result && result.retryable)
      throw new CommandError("Trusted work incomplete; explicit recovery required", 1);
    return result;
  }
  if (command === "evaluate-checks") {
    const input = named(rest, ["input-file", "output-file"]);
    const result = evaluateChecks(
      JSON.parse(await readFile(required(input, "input-file"), "utf8")),
    );
    await writeFile(required(input, "output-file"), `${JSON.stringify(result)}\n`, { mode: 0o600 });
    return result;
  }
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
      "base",
      "phase",
      "triage-check-id",
      "authority",
      "margot-root",
      "config",
      "required-checks",
      "required-check-reporters",
      "protected-paths",
      "allowed-skipped-checks",
      "run-url",
      "reviewer-model",
      "fresh",
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
          ...(input.base ? { expectedBase: input.base } : {}),
          phase,
          ...(input["triage-check-id"] === undefined
            ? {}
            : { triageCheckId: Number(input["triage-check-id"]) }),
          authority: bool(input, "authority"),
          margotRoot: required(input, "margot-root"),
          configFile: required(input, "config"),
          requiredChecks: list(input, "required-checks"),
          ...(input["required-check-reporters"]
            ? { requiredCheckReporters: JSON.parse(input["required-check-reporters"]) }
            : {}),
          protectedPaths: list(input, "protected-paths"),
          allowedSkippedChecks: list(input, "allowed-skipped-checks"),
          ...(input["run-url"] ? { runUrl: input["run-url"] } : {}),
          ...(input["reviewer-model"] ? { reviewerModel: input["reviewer-model"] } : {}),
          ...(input.fresh !== undefined ? { fresh: bool(input, "fresh") } : {}),
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
      "check-name",
      "own-runs",
      "own-run-id",
      "review-actor",
      "own-run-url",
      "base",
      "triage-check-id",
      "workflow-ref",
      "check-id",
      "route-result",
      "review-result",
      "published",
      "stop-reason",
      "live-sha",
      "blocking-checks",
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
      checkName: input["check-name"] || "review / margot",
      ownRuns,
      ownRunId: required(input, "own-run-id"),
      ownRunUrl: required(input, "own-run-url"),
      reviewActor: required(input, "review-actor"),
      base: shaSchema.parse(required(input, "base")),
      triageCheckId: positiveInteger(input, "triage-check-id"),
      workflowRef: required(input, "workflow-ref"),
      ...(input["check-id"] ? { checkId: positiveInteger(input, "check-id") } : {}),
      routeResult: required(input, "route-result"),
      reviewResult: required(input, "review-result"),
      published,
      stopReason: required(input, "stop-reason"),
      ...(input["live-sha"] ? { liveSha: shaSchema.parse(input["live-sha"]) } : {}),
      ...(input["blocking-checks"] ? { blockingChecks: input["blocking-checks"] } : {}),
    };
    if (!shouldCloseStrandedCheck(closeInput))
      return { action: "left" as const, message: "nothing to close" };
    if (!environment.GH_TOKEN) throw new Error("GH_TOKEN is required");
    const decision = await closeStrandedCheck(
      closeInput,
      client ?? githubClient({ token: environment.GH_TOKEN, retries: 0 }),
      githubFor(
        environment.MARGOT_RUN_TOKEN ??
          (() => {
            throw new Error("MARGOT_RUN_TOKEN required");
          })(),
      ),
    );
    if (decision.action === "error") throw new CommandError(decision.message, 2);
    return decision;
  }
  throw new Error(usage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  runInstanceCommand(process.argv.slice(2), process.env)
    .then((result) => {
      if ("action" in result) process.stdout.write(`${result.message}\n`);
      else if ("help" in result) process.stdout.write(`${result.help}\n`);
    })
    .catch((error: unknown) => {
      if (error instanceof StopRequestError) process.stdout.write(stopOutput(error.stop));
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = instanceExitCode(error);
    });
