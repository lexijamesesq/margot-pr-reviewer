import { readFileSync, writeFileSync } from "node:fs";
import { createBreakHarness } from "./break-harness.mjs";

const adapters = JSON.parse(readFileSync("tests/adapter-scenarios.json", "utf8"));
const reviews = JSON.parse(readFileSync("tests/scenarios.json", "utf8"));
const cases = [
  ...adapters.filter((test) =>
    ["jev-measured-p1", "jev-classification-code-only"].includes(test.id),
  ),
  ...reviews.filter((test) => test.questionContract),
];
const harness = createBreakHarness(".mechanical-break-results.json");
const rows = [];
try {
  harness.requireBaseline(harness.run());
  for (const spec of cases) {
    harness.mutateSource(spec.sourceBreak);
    const result = harness.run();
    harness.restoreSource();
    harness.requireAssertionFailures(result);
    const expected = [spec.name, ...(spec.alsoFails ?? [])].sort();
    const actual = result.failed.map((test) => test.title).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw new Error(`Unexpected failures for ${spec.name}: ${actual.join(", ")}`);
    rows.push(
      `| ${spec.name} | ${spec.defect} | ${actual.length} failed; ${result.report.numPassedTests} passed |`,
    );
    console.log(spec.name, "caught");
  }
  const restored = harness.run();
  harness.requireBaseline(restored);
  writeFileSync(
    "docs/mechanical-break-receipts.md",
    `# Mechanical regression break receipts\n\n${new Date().toISOString()}, Node ${process.version}. Baseline and restored suite: ${restored.report.numPassedTests}/${restored.report.numTotalTests} passed. Each mutation ran the complete suite and produced assertion failures in exactly the declared tests. No model or credential calls. Reproduce: npm run test:mechanical-breaks.\n\nThe two old prompt-rule breaks now also fail the independent full P1 wire contract. Their declarations retain that overlap explicitly. The new state break passes facts, including release notes, directly to classification again. The new wording break deletes the external-release exception from the production definition.\n\n| Test | Source mutation | Result |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
  );
} finally {
  harness.cleanup();
}
