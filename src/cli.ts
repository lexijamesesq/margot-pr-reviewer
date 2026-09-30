#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { liveConfigSchema, liveServices } from "./adapters/live.js";
import { requestSchema } from "./schemas.js";

async function main(args: string[]) {
  const [requestFile, configFile, outputFile] = args;
  if (!requestFile || !configFile || !outputFile || args.length !== 3)
    throw new Error("Usage: margot-review REQUEST.json CONFIG.json OUTPUT.json");
  const request = requestSchema.parse(JSON.parse(await readFile(requestFile, "utf8")));
  const config = liveConfigSchema.parse(JSON.parse(await readFile(configFile, "utf8")));
  const jevKey = process.env.JEV_KEY;
  if (!jevKey) throw new Error("JEV_KEY is required");
  const responses: unknown[] = [];
  const { run, actions } = liveServices(
    config,
    {
      jevKey,
      ...(process.env.GH_TOKEN ? { githubToken: process.env.GH_TOKEN } : {}),
      ...(process.env.MARGOT_WRITE_TOKEN ? { writeToken: process.env.MARGOT_WRITE_TOKEN } : {}),
    },
    (r) => responses.push(r),
  );
  const result = await run(request);
  await writeFile(outputFile, `${JSON.stringify({ result, actions, responses }, null, 2)}\n`, {
    mode: 0o600,
  });
  if (result.kind === "error") process.exitCode = 1;
}
main(process.argv.slice(2)).catch(() => {
  process.stderr.write(
    "Review failed before a result could be recorded. Check input files and credentials.\n",
  );
  process.exitCode = 1;
});
