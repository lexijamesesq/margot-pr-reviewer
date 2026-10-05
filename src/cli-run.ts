import { readFile, writeFile } from "node:fs/promises";
import type { z } from "zod";
import { liveConfigSchema } from "./adapters/live.js";
import { cliServices } from "./cli-services.js";
import { ConfigurationError } from "./errors.js";
import { requestSchema } from "./schemas.js";

const usage = "Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json";
const help = `${usage}

Reviews the pull request named by REQUEST.json under CONFIG.json and writes the
result, the recorded actions and the model responses to OUTPUT.json.

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
    const responses: unknown[] = [];
    const { run, actions } = cliServices(config, environment, (r) => responses.push(r));
    const result = await run(request);
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
