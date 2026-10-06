import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { liveConfigSchema } from "./adapters/live.js";
import { cliServices } from "./cli-services.js";
import { ConfigurationError } from "./errors.js";
import { requestSchema } from "./schemas.js";

const usage = "Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json";
const help = `${usage}

Reviews the pull request named by REQUEST.json under CONFIG.json and writes the
result, the recorded actions and the model responses to OUTPUT.json, and each card's
and the voice's raw output, duration, turns and models to diagnostics.json beside it.

Options:
  --help, -h     Print this help and exit.
  --version, -v  Print the package version and exit.

Environment: JEV_KEY (required); GH_TOKEN, MARGOT_WRITE_TOKEN, MARGOT_OWNED_TIER,
MARGOT_CLASSIFICATION and MARGOT_TRIAGE are optional. See the README.
`;

/** A failure whose message names the input at fault and is safe to print. */
class InputError extends Error {}

const code = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : "unknown error";

async function readJson(file: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new InputError(`cannot read ${label} file ${file} (${code(error)})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(`${label} file ${file} is not valid JSON`);
  }
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string, file: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new InputError(`invalid ${label} file ${file}: ${fields}`);
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return String(manifest.version);
}

type ModelResponse = {
  role: string;
  raw: string;
  cost: number;
  models: string[];
  durationMs?: number;
  numTurns?: number;
};
/**
 * The run's diagnostics, as the previous reviewer kept them: each card's raw block, duration,
 * turns and models, and the voice's raw prose. Tool output and the environment never go in.
 */
export function diagnostics(responses: ModelResponse[]) {
  const timing = (r: ModelResponse) => ({
    durationMs: r.durationMs ?? null,
    numTurns: r.numTurns ?? null,
    models: r.models,
    costUsd: r.cost,
  });
  const voice = responses.findLast((r) => r.role === "voice");
  return {
    cards: responses
      .filter((r) => r.role !== "voice")
      .map((r) => ({ card: r.role, raw: r.raw, ...timing(r) })),
    voice: voice ? { prose: voice.raw, ...timing(voice) } : null,
  };
}
/** Writes diagnostics.json next to the output file, readable only by its owner. */
export async function writeDiagnostics(outputFile: string, responses: ModelResponse[]) {
  await writeFile(
    join(dirname(outputFile), "diagnostics.json"),
    `${JSON.stringify(diagnostics(responses), null, 2)}\n`,
    { mode: 0o600 },
  );
}
/** Runs the review CLI and returns its exit code. Messages never include credentials. */
export async function runCli(
  args: string[],
  environment: NodeJS.ProcessEnv,
  out: { stdout: (text: string) => void; stderr: (text: string) => void },
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    out.stdout(help);
    return 0;
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    out.stdout(`${await packageVersion()}\n`);
    return 0;
  }
  try {
    const [requestFile, configFile, outputFile] = args;
    if (!requestFile || !configFile || !outputFile || args.length !== 3)
      throw new InputError(usage);
    const request = parseInput(
      requestSchema,
      {
        ...((await readJson(requestFile, "request")) as object),
        ...(environment.MARGOT_CLASSIFICATION !== undefined
          ? { classification: environment.MARGOT_CLASSIFICATION }
          : {}),
        ...(environment.MARGOT_TRIAGE !== undefined ? { triage: environment.MARGOT_TRIAGE } : {}),
      },
      "request",
      requestFile,
    );
    const config = parseInput(
      liveConfigSchema,
      await readJson(configFile, "configuration"),
      "configuration",
      configFile,
    );
    if (!environment.JEV_KEY) throw new InputError("missing environment variable JEV_KEY");
    const responses: ModelResponse[] = [];
    const { run, actions } = cliServices(config, environment, (r) => responses.push(r));
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(request);
    } finally {
      // Written whatever the review's end, like the previous reviewer's always() upload.
      await writeDiagnostics(outputFile, responses).catch((error: unknown) => {
        throw new InputError(`cannot write diagnostics next to ${outputFile} (${code(error)})`);
      });
    }
    try {
      await writeFile(outputFile, `${JSON.stringify({ result, actions, responses }, null, 2)}\n`, {
        mode: 0o600,
      });
    } catch (error) {
      throw new InputError(`cannot write output file ${outputFile} (${code(error)})`);
    }
    if (result.kind !== "error") return 0;
    // The output file is removed with the run's working files; the run log keeps the reason.
    out.stderr(`Review ended in an error at ${result.stage}: ${result.diagnostic}\n`);
    return 1;
  } catch (error) {
    out.stderr(
      error instanceof InputError || error instanceof ConfigurationError
        ? `Review failed: ${error.message}\n`
        : `Review failed before a result could be recorded (${error instanceof Error ? error.name : "unknown error"}). Check input files and credentials.\n`,
    );
    return 1;
  }
}
