import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const manifest = readFileSync("tests/adapter-scenarios.json", "utf8");
const cases = JSON.parse(manifest);
let restoreSource;
const output = ".adapter-break-results.json";
function run(id) {
  if (existsSync(output)) unlinkSync(output);
  const child = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${output}`],
    {
      encoding: "utf8",
      env: { ...process.env, MARGOT_ADAPTER_BREAK: id ?? "" },
    },
  );
  if (child.error) throw child.error;
  const report = JSON.parse(readFileSync(output, "utf8"));
  const failures = report.testResults.flatMap((s) =>
    s.assertionResults.filter((t) => t.status === "failed"),
  );
  return { report, failures, status: child.status };
}
try {
  const baseline = run();
  if (baseline.status !== 0) throw new Error("Baseline failed");
  const rows = [];
  for (const spec of cases) {
    if (spec.sourceBreak) {
      const { file, from, to } = spec.sourceBreak;
      const source = readFileSync(file, "utf8");
      if (source.split(from).length !== 2) throw new Error("Source break does not match once");
      restoreSource = () => writeFileSync(file, source);
      writeFileSync(file, source.replace(from, to));
    }
    const result = run(spec.id);
    restoreSource?.();
    restoreSource = undefined;
    if (
      result.status !== 1 ||
      result.failures.length !== 1 ||
      result.failures[0].title !== spec.name ||
      !result.failures[0].failureMessages.join("").includes("AssertionError") ||
      result.report.numTotalTests !== baseline.report.numTotalTests
    )
      throw new Error(`Unexpected break result: ${spec.id}`);
    rows.push(
      `| ${spec.name} | ${spec.defect} | 1 failed; ${result.report.numPassedTests} passed |`,
    );
    process.stdout.write(`${spec.id}: caught\n`);
  }
  const restored = run();
  if (restored.status !== 0) throw new Error("Restored suite failed");
  writeFileSync(
    "docs/adapter-break-receipts.md",
    `# Live adapter break receipts\n\nGenerated ${new Date().toISOString()}, Node ${process.version}. Baseline and restored suite: ${baseline.report.numTotalTests}/${baseline.report.numTotalTests} passed. Each of ${cases.length} isolated breaks ran the complete suite and failed exactly its named assertion.\n\nOne declared source mutation grants Bash to the CLI; its invocation test catches it. The remaining breaks are controlled input/transport counterexamples in tests/adapters.test.ts, selected by MARGOT_ADAPTER_BREAK. Error cases repair the bad input; positive cases replace evidence with its opposite. Credential isolation inserts a forbidden credential into the filtered environment. They do not claim exhaustive source mutation coverage or independence: changing only one test's input guarantees other fixtures are unchanged. No live service or paid model call occurs in this harness. Live confinement and model quality are separate proofs.\n\nManifest SHA-256: ${createHash("sha256").update(manifest).digest("hex")}. Reproduce: npm run test:adapter-breaks.\n\n| Test | Deliberate break | Observed |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
  );
} finally {
  restoreSource?.();
  if (existsSync(output)) unlinkSync(output);
}
