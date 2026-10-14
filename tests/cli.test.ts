import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRecording } from "./helpers/recordings.js";

// The real services unless a test asks for a scripted run that reports two responses.
const scripted = vi.hoisted(() => ({ on: false, request: undefined as unknown }));
vi.mock("../src/cli-services.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli-services.js")>();
  return {
    ...actual,
    cliServices: (...args: Parameters<typeof actual.cliServices>) => {
      if (!scripted.on) return actual.cliServices(...args);
      const onResponse = args[2];
      const onJevRetry = args[3];
      return {
        actions: [],
        run: async (request: unknown) => {
          scripted.request = request;
          onJevRetry?.({
            question: "risk",
            attempt: 2,
            reason: "operations: a partial distribution",
          });
          for (const role of ["safety", "voice"])
            onResponse?.({
              role,
              raw: `${role} raw`,
              cost: 0.1,
              models: ["example-model"],
              tools: ["Bash"],
              evidence: [],
              durationMs: 10,
              numTurns: 2,
            });
          return { kind: "reviewed", adherence: { status: "unchecked" } };
        },
      };
    },
  };
});
const { runCli } = await import("../src/cli-run.js");

const recording = readRecording("mechanical-bump");
const sampleConfig = JSON.parse(
  await readFile(new URL("../samples/config.sample.json", import.meta.url), "utf8"),
);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function invoke(
  options: {
    request?: unknown;
    config?: unknown;
    environment?: NodeJS.ProcessEnv;
    args?: (paths: { request: string; config: string; output: string }) => string[];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-run-"));
  directories.push(root);
  const paths = {
    request: join(root, "request.json"),
    config: join(root, "config.json"),
    output: join(root, "output.json"),
  };
  await writeFile(paths.request, JSON.stringify(options.request ?? recording.request));
  await writeFile(paths.config, JSON.stringify(options.config ?? sampleConfig));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    options.args ? options.args(paths) : [paths.request, paths.config, paths.output],
    options.environment ?? { JEV_KEY: "test-only" },
    { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
  );
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), paths };
}

describe("margot-review failure messages", () => {
  it("names either missing input file and exits unsuccessfully", async () => {
    for (const label of ["request", "configuration"]) {
      const { code, stderr } = await invoke({
        args: (p) =>
          label === "request"
            ? [p.request.replace("request", "absent"), p.config, p.output]
            : [p.request, p.config.replace("config", "absent"), p.output],
      });
      expect(code).toBe(1);
      expect(stderr).toContain(label);
      expect(stderr).toContain("absent.json");
      expect(stderr).toContain("ENOENT");
    }
  });
  it("names invalid configuration and request fields", async () => {
    const bad = structuredClone(sampleConfig);
    bad.review.timeoutMs = "soon";
    const configRun = await invoke({ config: bad });
    expect(configRun.code).toBe(1);
    expect(configRun.stderr).toContain("configuration");
    expect(configRun.stderr).toContain("review.timeoutMs");
    const requestRun = await invoke({ request: { ...(recording.request as object), pr: "seven" } });
    expect(requestRun.code).toBe(1);
    expect(requestRun.stderr).toContain("request");
    expect(requestRun.stderr).toContain("pr:");
  });
  it("names the missing environment variable and never prints a secret", async () => {
    const { code, stderr } = await invoke({ environment: { GH_TOKEN: "ghp_secretvalue" } });
    expect({ code, stderr }).toEqual({
      code: 1,
      stderr: "Review failed: missing environment variable JEV_KEY\n",
    });
    expect(stderr).not.toContain("ghp_secretvalue");
  });
  it("prints usage when the arguments are wrong", async () => {
    const { code, stderr } = await invoke({ args: () => ["only-one.json"] });
    expect(code).toBe(1);
    expect(stderr).toContain("Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json");
  });
});

describe("margot-review --help", () => {
  it("prints the usage and exits 0 for --help", async () => {
    const { code, stdout, stderr } = await invoke({ args: () => ["--help"] });
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json");
  });
});

describe("margot-review GitHub publication settings", () => {
  const publishing = () => {
    const config = structuredClone(sampleConfig);
    config.review.publication = "github";
    return config;
  };
  it("names missing publication credentials and publisher configuration without secrets", async () => {
    const tokenRun = await invoke({
      config: publishing(),
      environment: { JEV_KEY: "test-only", GH_TOKEN: "ghp_secretvalue" },
    });
    expect(tokenRun.code).toBe(1);
    expect(tokenRun.stderr).toContain("MARGOT_WRITE_TOKEN");
    expect(tokenRun.stderr).not.toContain("ghp_secretvalue");
    const config = publishing();
    delete config.publisher;
    const configRun = await invoke({
      config,
      environment: { JEV_KEY: "test-only", MARGOT_WRITE_TOKEN: "placeholder" },
    });
    expect(configRun.code).toBe(1);
    expect(configRun.stderr).toContain("publisher");
    expect(configRun.stderr).not.toContain("placeholder");
  });
});
it("writes successful model callbacks and retry/adherence diagnostics beside the output", async () => {
  scripted.on = true;
  try {
    const run = await invoke();
    const written = JSON.parse(
      await readFile(join(run.paths.output, "..", "diagnostics.json"), "utf8"),
    );
    expect(run.code).toBe(0);
    expect(written.cards).toMatchObject([{ card: "safety", raw: "safety raw" }]);
    expect(written.voice).toMatchObject({ prose: "voice raw" });
    expect(written.jevRetries).toEqual([
      { question: "risk", attempt: 2, reason: "operations: a partial distribution" },
    ]);
    expect(written.adherence).toEqual({ status: "unchecked" });
  } finally {
    scripted.on = false;
  }
});

it("does not accept retired classification environment overrides", async () => {
  scripted.on = true;
  try {
    const result = await invoke({
      environment: {
        JEV_KEY: "test-only",
        MARGOT_CLASSIFICATION: "functional",
        MARGOT_TRIAGE: "functional",
      },
    });
    expect(result.code).toBe(0);
    expect(scripted.request).toEqual(recording.request);
    expect(scripted.request).not.toHaveProperty("classification");
    expect(scripted.request).not.toHaveProperty("triage");
  } finally {
    scripted.on = false;
  }
});
