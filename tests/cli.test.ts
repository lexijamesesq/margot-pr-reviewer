import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli-run.js";

const recording = JSON.parse(
  await readFile(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
);
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
    const { code, stderr } = await invoke({ request: { ...recording.request, pr: "seven" } });
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
