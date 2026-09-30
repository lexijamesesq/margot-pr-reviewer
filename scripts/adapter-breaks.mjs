import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createBreakHarness } from "./break-harness.mjs";

const manifest = readFileSync("tests/adapter-scenarios.json", "utf8");
const cases = JSON.parse(manifest);
const { run, requireBaseline, requireAssertionFailures, mutateSource, restoreSource, cleanup } =
  createBreakHarness(".adapter-break-results.json");
try {
  const baseline = run();
  requireBaseline(baseline);
  const rows = [];
  for (const spec of cases) {
    if (spec.sourceBreak) mutateSource(spec.sourceBreak);
    const result = run(spec.id);
    restoreSource();
    requireAssertionFailures(result);
    if (result.failed.length !== 1 || result.failed[0].title !== spec.name)
      throw new Error(`Unexpected break result: ${spec.id}`);
    rows.push(
      `| ${spec.name} | ${spec.defect} | 1 failed; ${result.report.numPassedTests} passed |`,
    );
    process.stdout.write(`${spec.id}: caught\n`);
  }
  const restored = run();
  requireBaseline(restored);
  writeFileSync(
    "docs/adapter-break-receipts.md",
    `# Live adapter break receipts\n\nGenerated ${new Date().toISOString()}, Node ${process.version}. Baseline and restored suite: ${baseline.report.numTotalTests}/${baseline.report.numTotalTests} passed. Each of ${cases.length} isolated breaks ran the complete suite and failed exactly its named assertion.\n\nDeclared source mutations exercise CLI grants, version and envelope guards, prose mapping, hunk completeness and subprocess redaction. Other breaks are controlled input/transport counterexamples in tests/adapters.test.ts, selected by MARGOT_ADAPTER_BREAK. Error cases repair the bad input; positive cases replace evidence with its opposite. Credential isolation inserts a forbidden credential into the filtered environment. They do not claim exhaustive source mutation coverage or independence: changing only one test's input guarantees other fixtures are unchanged. No live service or paid model call occurs in this harness. Live confinement and model quality are separate proofs.\n\nManifest SHA-256: ${createHash("sha256").update(manifest).digest("hex")}. Reproduce: npm run test:adapter-breaks.\n\n| Test | Deliberate break | Observed |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
  );
} finally {
  cleanup();
}
