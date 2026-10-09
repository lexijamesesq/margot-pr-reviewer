import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { boundIdentity, readCheckRecord, reviewRequestId } from "../../src/check-identity.js";
import { instanceExitCode, runInstanceCommand } from "../../src/instance-cli.js";
import { hostedFixture } from "../helpers/trusted-checks.js";

async function fixture() {
  const f = await hostedFixture();
  const request = { ...f.request, phase: "review" as const, triageCheckId: 101 };
  const paths = Object.fromEntries(
    ["request", "config", "context", "result", "output", "step"].map((name) => [
      name,
      join(f.directory, `${name}.json`),
    ]),
  ) as Record<"request" | "config" | "context" | "result" | "output" | "step", string>;
  await writeFile(paths.request, JSON.stringify(request));
  await writeFile(paths.config, JSON.stringify(f.config));
  const tokens = {
    GH_TOKEN: "read",
    MARGOT_WRITE_TOKEN: "write",
    MARGOT_RUN_TOKEN: "runs",
    MARGOT_ACTIONS_TOKEN: "actions",
  };
  const used: string[] = [];
  const githubFor = (token: string) => {
    used.push(token);
    const client = f.clients[token as keyof typeof f.clients];
    if (!client) throw new Error("Unexpected credential");
    return client;
  };
  const args = (command: string, extra: string[] = []) => [
    command,
    "--request-file",
    paths.request,
    "--config",
    paths.config,
    "--output-file",
    paths.output,
    ...(command === "trusted-checks" ? ["--kind", "code", "--context-file", paths.context] : []),
    ...extra,
  ];
  const invoke = (command: string, extra: string[] = []) =>
    runInstanceCommand(
      args(command, extra),
      { ...tokens, GITHUB_OUTPUT: paths.step },
      undefined,
      githubFor,
    );
  return { ...f, request, paths, tokens, used, githubFor, args, invoke };
}
it("writes evaluated required-check JSON through the instance command", async () => {
  const f = await fixture();
  const input = new URL("../fixtures/trusted-checks-envelope.json", import.meta.url);
  const result = await runInstanceCommand(
    ["evaluate-checks", "--input-file", input.pathname, "--output-file", f.paths.output],
    {},
  );
  expect(result).toEqual({ green: true, pending: [], failing: [] });
  expect(JSON.parse(await readFile(f.paths.output, "utf8"))).toEqual(result);
});
it("writes trusted context and workflow outputs using the supplied run URL", async () => {
  const f = await fixture();
  const runUrl = "https://github.com/example/project/actions/runs/3/attempts/1";
  const result = await f.invoke("trusted-checks", ["--operation", "begin", "--run-url", runUrl]);
  const context = JSON.parse(await readFile(f.paths.context, "utf8"));
  expect(context.runUrl).toBe(runUrl);
  const stored = f.checks.get(context.codeCheckId);
  if (!stored) throw new Error("Missing created check");
  expect(readCheckRecord((stored.output as { text: string }).text).owner_run_url).toBe(runUrl);
  expect(JSON.parse(await readFile(f.paths.output, "utf8"))).toEqual(result);
  expect(await readFile(f.paths.step, "utf8")).toContain(`text_file=${context.textFile}\n`);
  expect(await readFile(f.paths.step, "utf8")).toContain(`code_check_id=${context.codeCheckId}\n`);
  expect(f.used).toEqual(["read", "write", "runs", "actions"]);
});
it("writes review-admission identity outputs and transfers no foreign request", async () => {
  const f = await fixture();
  const runUrl = "https://github.com/example/margot/actions/runs/10/attempts/1";
  const requestId = reviewRequestId(boundIdentity(f.request, "v0.10.0"));
  const extra = ["--run-url", runUrl, "--request-id", requestId];
  const result = await f.invoke("review-admission", extra);
  expect(result).toMatchObject({
    disposition: "admitted",
    request_id: requestId,
    head_sha: f.request.head,
    triage_check_id: 101,
  });
  expect(JSON.parse(await readFile(f.paths.output, "utf8"))).toEqual(result);
  const output = await readFile(f.paths.step, "utf8");
  expect(output).toContain("disposition=admitted\n");
  expect(output).toContain(`request_id=${requestId}\n`);
  expect(output).toContain("workflow_ref=v0.10.0\n");
  expect(output).toContain(`base_sha=${f.request.base}\n`);
  expect(f.writes.at(-1)?.body.details_url).toBe(runUrl);
  const before = f.writes.length;
  await expect(
    f.invoke("review-admission", ["--run-url", runUrl, "--request-id", "f".repeat(64)]),
  ).rejects.toThrow("request ID mismatch");
  expect(f.writes).toHaveLength(before);
});
it.each(["trusted-checks", "review-admission"])(
  "requires each scoped token before %s makes a call",
  async (command) => {
    const f = await fixture();
    for (const missing of Object.keys(f.tokens)) {
      const environment = { ...f.tokens, [missing]: undefined };
      await expect(
        runInstanceCommand(f.args(command), environment, undefined, f.githubFor),
      ).rejects.toThrow("MARGOT_ACTIONS_TOKEN required");
    }
    expect(f.used).toEqual([]);
    expect(f.writes).toEqual([]);
  },
);
it("writes a retryable handoff result then refuses successful command completion", async () => {
  const f = await fixture();
  await f.invoke("trusted-checks", ["--operation", "begin"]);
  await writeFile(f.paths.result, JSON.stringify({ ...f.classify, request: f.request }));
  await f.invoke("trusted-checks", ["--operation", "code-passed", "--result-file", f.paths.result]);
  await writeFile(f.paths.step, "");
  const error = await f
    .invoke("trusted-checks", ["--operation", "finish", "--text-outcome", "failure"])
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Trusted work incomplete; explicit recovery required");
  expect(instanceExitCode(error)).toBe(1);
  expect(JSON.parse(await readFile(f.paths.output, "utf8"))).toMatchObject({
    disposition: "not_sent_text_failed",
    retryable: true,
  });
  expect(await readFile(f.paths.step, "utf8")).toContain("retryable=true\n");
  expect(f.dispatches).toBe(0);
});
it("refuses multiline workflow output before appending any output lines", async () => {
  const f = await fixture();
  const context = join(f.directory, "context\ninjected.json");
  const args = f.args("trusted-checks", ["--operation", "begin"]);
  args[args.indexOf("--context-file") + 1] = context;
  await expect(
    runInstanceCommand(args, { ...f.tokens, GITHUB_OUTPUT: f.paths.step }, undefined, f.githubFor),
  ).rejects.toThrow("Multiline step output refused");
  await expect(readFile(f.paths.step, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
