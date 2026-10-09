import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

async function invoke(
  options: {
    request?: unknown;
    config?: unknown;
    environment?: NodeJS.ProcessEnv;
    args?: (paths: { request: string; config: string; output: string }) => string[];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-run-"));
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
  it("names a request file that does not exist", async () => {
    const missing = join(tmpdir(), "margot-no-such-request.json");
    const { code, stderr } = await invoke({
      args: (p) => [missing, p.config, p.output],
    });
    expect({ code, stderr }).toEqual({
      code: 1,
      stderr: `Review failed: cannot read request file ${missing} (ENOENT)\n`,
    });
  });
  it("names a configuration file that does not exist", async () => {
    const { code, stderr } = await invoke({
      args: (p) => [p.request, p.request.replace("request", "absent"), p.output],
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(
      /^Review failed: cannot read configuration file .*absent\.json \(ENOENT\)/,
    );
  });
  it("names the configuration field that is invalid", async () => {
    const bad = structuredClone(sampleConfig);
    bad.review.timeoutMs = "soon";
    const { code, stderr } = await invoke({ config: bad });
    expect(code).toBe(1);
    expect(stderr).toMatch(
      /^Review failed: invalid configuration file .*config\.json: review\.timeoutMs: /,
    );
  });
  it("names the request field that is invalid", async () => {
    const { code, stderr } = await invoke({
      request: { ...(recording.request as object), pr: "seven" },
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^Review failed: invalid request file .*request\.json: pr: /);
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
    expect({ code, stderr }).toEqual({
      code: 1,
      stderr: "Review failed: Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json\n",
    });
  });
});

describe("margot-review --help and --version", () => {
  it("prints the usage and exits 0 for --help", async () => {
    const { code, stdout, stderr } = await invoke({ args: () => ["--help"] });
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json");
  });
  it("prints the package version and exits 0 for --version", async () => {
    const { code, stdout, stderr } = await invoke({ args: () => ["--version"] });
    expect({ code, stdout, stderr }).toEqual({
      code: 0,
      stdout: `${manifest.version}\n`,
      stderr: "",
    });
  });
});

describe("margot-review GitHub publication settings", () => {
  const publishing = () => {
    const config = structuredClone(sampleConfig);
    config.review.publication = "github";
    return config;
  };
  it("names the missing write token without printing any token", async () => {
    const { code, stderr } = await invoke({
      config: publishing(),
      environment: { JEV_KEY: "test-only", GH_TOKEN: "ghp_secretvalue" },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("MARGOT_WRITE_TOKEN");
    expect(stderr).not.toContain("ghp_secretvalue");
  });
  it("names the missing publisher configuration", async () => {
    const config = publishing();
    delete config.publisher;
    const { stderr } = await invoke({
      config,
      environment: { JEV_KEY: "test-only", MARGOT_WRITE_TOKEN: "placeholder" },
    });
    expect(stderr).toContain("`publisher` configuration");
  });
});
it("writes diagnostics.json beside the output after a successful review", async () => {
  scripted.on = true;
  try {
    const run = await invoke();
    const written = JSON.parse(
      await readFile(join(run.paths.output, "..", "diagnostics.json"), "utf8"),
    );
    expect({ code: run.code, written }).toEqual({
      code: 0,
      written: {
        cards: [
          {
            card: "safety",
            raw: "safety raw",
            durationMs: 10,
            numTurns: 2,
            models: ["example-model"],
            costUsd: 0.1,
          },
        ],
        voice: {
          prose: "voice raw",
          durationMs: 10,
          numTurns: 2,
          models: ["example-model"],
          costUsd: 0.1,
        },
        jevRetries: [
          { question: "risk", attempt: 2, reason: "operations: a partial distribution" },
        ],
        adherence: { status: "unchecked" },
      },
    });
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
