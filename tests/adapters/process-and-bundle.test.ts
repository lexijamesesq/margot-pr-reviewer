import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveBundle } from "../../src/adapters/bundle.js";
import { claudeEnvironment } from "../../src/adapters/claude.js";
import { ghFetch } from "../../src/adapters/github.js";
import { execute } from "../../src/adapters/process.js";
import { cardNames } from "../../src/schemas.js";
import { context } from "../helpers/adapters.js";

it("rejects a write method through the gh bridge before spawning", async () => {
  await expect(
    ghFetch("not-a-real-command")("https://api.github.com/repos/example/project", {
      method: "POST",
    }).catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ).rejects.toThrow();
});
it("rejects an alternate API origin through the gh bridge", async () => {
  await expect(
    ghFetch("not-a-real-command")("https://other.invalid/x").catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ).rejects.toThrow();
});
it("passes Claude only its explicit credential allowlist", () => {
  const env = claudeEnvironment({
    PATH: "/bin",
    JEV_KEY: "jev-canary",
    GH_TOKEN: "write-canary",
    UNRELATED_SECRET: "other",
  });
  expect(env.PATH).toBe("/bin");
  expect([env.JEV_KEY, env.GH_TOKEN, env.UNRELATED_SECRET]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});
it("rejects a failed subprocess", async () => {
  await expect(execute(process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow();
});
it("rejects a timed out subprocess", async () => {
  await expect(
    execute(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      signal: AbortSignal.timeout(100),
    }),
  ).rejects.toThrow();
});
it("fails before loading cards when the bundle commit mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "margot-bundle-test-"));
  try {
    await execute("git", ["init", "-q", root]);
    await writeFile(join(root, "a"), "a");
    await execute("git", ["-C", root, "add", "a"]);
    await execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    await expect(resolveBundle(root, "f".repeat(40), context())).rejects.toThrow("pin mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("redacts MCP credentials from failed subprocess diagnostics", async () => {
  const canary = "test-only-mcp-token-canary";
  try {
    await execute(process.execPath, [
      "-e",
      "process.stderr.write(process.argv[2]);process.exit(1)",
      "--",
      "--mcp-config",
      JSON.stringify({ mcpServers: { tickets: { env: { GH_TOKEN: canary } } } }),
    ]);
    return expect(false).toBe(true);
  } catch (error) {
    const saved = JSON.stringify({
      message: String(error),
      stack: error instanceof Error ? error.stack : "",
    });
    return expect(
      String(error).includes("Process failed:") &&
        !saved.includes(canary) &&
        !saved.includes("GH_TOKEN") &&
        !saved.includes("--mcp-config"),
    ).toBe(true);
  }
});
it("rejects a dirty card bundle as the pinned instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "margot-dirty-bundle-"));
  try {
    await execute("git", ["init", "-q", root]);
    const paths = [
      ".claude-plugin/plugin.json",
      "agents/pr-reviewer.md",
      "agents/margot.md",
      "skills/pr-council/SKILL.md",
      ...cardNames.map((n) => `skills/pr-council/playbooks/${n}.md`),
    ];
    for (const path of paths) {
      const target = join(root, path);
      await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      await writeFile(target, "pinned content");
      await execute("git", ["-C", root, "add", path]);
    }
    await execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    const sha = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).trim();
    await writeFile(join(root, "agents/margot.md"), "changed instructions");
    return await expect(resolveBundle(root, sha, context())).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("delivers large CLI evidence complete through stdin", async () => {
  const input = "evidence".repeat(100000);
  const out = await execute(
    process.execPath,
    ["-e", "process.stdin.on('data',d=>process.stdout.write(d))"],
    { input: input },
  );
  expect(out).toBe(input);
});
