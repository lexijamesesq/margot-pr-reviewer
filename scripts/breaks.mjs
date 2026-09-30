import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createBreakHarness } from "./break-harness.mjs";

const path = new URL("../tests/scenarios.json", import.meta.url);
const original = readFileSync(path, "utf8");
const scenarios = JSON.parse(original);
const sourceOriginal = readFileSync(
  new URL("../tests/source-breaks.json", import.meta.url),
  "utf8",
);
const sourceBreaks = JSON.parse(sourceOriginal);
const receiptPath = new URL("../docs/test-break-receipts.md", import.meta.url);
const { run, requireBaseline, requireAssertionFailures, mutateSource, restoreSource, cleanup } =
  createBreakHarness(".break-results.json");
const rows = [];
const sourceRuns = [];
try {
  const baseline = run();
  requireBaseline(baseline);
  for (const [index, scenario] of scenarios.entries()) {
    const mutated = structuredClone(scenarios);
    mutated[index].patches.push(...scenario.break);
    if (scenario.sourceBreak) mutateSource(scenario.sourceBreak);
    writeFileSync(path, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = run();
    restoreSource();
    writeFileSync(path, original);
    requireAssertionFailures(result);
    const expectedFailures = [scenario.name, ...(scenario.alsoFails ?? [])];
    if (
      result.failed.length !== expectedFailures.length ||
      !expectedFailures.every((name) => result.failed.some((test) => test.title === name))
    )
      throw new Error(
        `Break ${index + 1} did not fail only ${scenario.name}: ${result.failed.map((test) => test.title)}`,
      );
    rows.push(
      `| ${index + 1} | ${scenario.name} | ${scenario.defect} | ${result.report.numFailedTests} failed, ${result.report.numPassedTests} passed; assertion mismatch |`,
    );
    process.stdout.write(`${index + 1}/${scenarios.length}: ${scenario.name}\n`);
  }
  for (const mutation of sourceBreaks) {
    mutateSource(mutation);
    const result = run();
    restoreSource();
    requireAssertionFailures(result);
    const failedNames = result.failed.map((test) => test.title);
    if (mutation.tests.length === 0 || !mutation.tests.every((name) => failedNames.includes(name)))
      throw new Error(`Source mutation missed its intended tests: ${mutation.name}`);
    sourceRuns.push({
      name: mutation.name,
      failedNames,
      failed: result.report.numFailedTests,
      passed: result.report.numPassedTests,
    });
    process.stdout.write(`Source mutation: ${mutation.name}: ${failedNames.length} failed\n`);
  }
  const restored = run();
  requireBaseline(restored);
  const digest = createHash("sha256").update(original).digest("hex");
  const sourceDigest = createHash("sha256").update(sourceOriginal).digest("hex");
  const sourceSummary = `Separate source-level checks caught ${sourceRuns.length} mutations: ${sourceRuns.map((run) => run.name).join(", ")}. Each mutation failed its intended tests; all observed failures are listed below.`;
  const sourceRows = sourceRuns.map(
    (run) =>
      `| ${run.name} | ${run.failedNames.join("; ")} | ${run.failed} failed, ${run.passed} passed; assertion mismatches |`,
  );
  writeFileSync(
    receiptPath,
    `# Test and deliberate-break receipts\n\nRun: ${new Date().toISOString()}. Node ${process.version}.\n\nBaseline: ${baseline.report.numPassedTests}/${baseline.report.numTotalTests} passed. Each scenario break changes the named scenario's service output/caller input, or its explicitly declared source mutation; expected assertions stay unchanged. Every run executes the full suite. For each scenario break, the named test and any explicitly declared alsoFails tests failed, with all other tests passing. The two older prompt-rule mutations also fail the complete P1 wire contract. Each break was reverted before the next run. Restored baseline: ${restored.report.numPassedTests}/${baseline.report.numTotalTests} passed.\n\nMost breaks mutate only their own scenario input. For those breaks, the harness guarantees that other scenarios are unchanged, so the observed one-failure result cannot reveal a duplicated test. These are controlled service/input counterexamples plus declared source mutations, not a claim of independent or exhaustive implementation mutation coverage. Error scenarios repair exactly the invalid response to prove that the error test distinguishes it from usable evidence. Classification question tests protect the text sent to Jev, not Jev's interpretation of it. Exact paths, values, and expectations are in tests/scenarios.json and tests/source-breaks.json; run npm run test:breaks.\n\n${sourceSummary}\n\nScenario SHA-256: ${digest}.\n\nSource mutation SHA-256: ${sourceDigest}.\n\n| # | Single failing test | Deliberate break | Observed |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n## Source mutations\n\n| Mutation | Observed failing tests | Result |\n| --- | --- | --- |\n${sourceRows.join("\n")}\n`,
  );
  process.stdout.write(
    `Receipts: ${rows.length} scenario breaks and ${sourceRuns.length} source mutations caught; restored ${restored.report.numPassedTests}/${baseline.report.numTotalTests} passed.\n`,
  );
} finally {
  cleanup();
  writeFileSync(path, original);
}
