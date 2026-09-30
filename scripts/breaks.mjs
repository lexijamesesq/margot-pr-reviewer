import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const path = new URL("../tests/scenarios.json", import.meta.url);
const original = readFileSync(path, "utf8");
const scenarios = JSON.parse(original);
const sourceOriginal = readFileSync(
  new URL("../tests/source-breaks.json", import.meta.url),
  "utf8",
);
const sourceBreaks = JSON.parse(sourceOriginal);
const receiptPath = new URL("../docs/test-break-receipts.md", import.meta.url);
const resultPath = new URL("../.break-results.json", import.meta.url);
const rows = [];
const sourceRuns = [];
let restoreSource;
function run() {
  if (existsSync(resultPath)) unlinkSync(resultPath);
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--reporter=json",
      "--outputFile=.break-results.json",
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  const report = JSON.parse(readFileSync(resultPath, "utf8"));
  if (
    report.numTotalTests !== scenarios.length ||
    report.numPassedTests + report.numFailedTests !== scenarios.length
  )
    throw new Error("Runner did not execute every scenario");
  return {
    status: result.status,
    report,
    failed: report.testResults.flatMap((suite) =>
      suite.assertionResults.filter((test) => test.status === "failed"),
    ),
  };
}
function mutateSource({ file, from, to }) {
  const contents = readFileSync(file, "utf8");
  if (contents.split(from).length !== 2) throw new Error(`Source break must match once: ${file}`);
  restoreSource = () => writeFileSync(file, contents);
  writeFileSync(file, contents.replace(from, to));
}
function requireAssertionFailures(result) {
  if (result.status !== 1 || result.failed.length === 0)
    throw new Error("Mutation did not produce test failures");
  for (const test of result.failed) {
    const message = stripVTControlCharacters(test.failureMessages.join("\n"));
    if (!message.includes("AssertionError") || !message.includes("to match object"))
      throw new Error(`Unexpected failure: ${test.title}`);
  }
}
try {
  const baseline = run();
  if (baseline.status !== 0 || baseline.report.numPassedTests !== scenarios.length)
    throw new Error("Baseline did not pass every test");
  for (const [index, scenario] of scenarios.entries()) {
    const mutated = structuredClone(scenarios);
    mutated[index].patches.push(...scenario.break);
    if (scenario.sourceBreak) mutateSource(scenario.sourceBreak);
    writeFileSync(path, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = run();
    restoreSource?.();
    restoreSource = undefined;
    writeFileSync(path, original);
    requireAssertionFailures(result);
    if (result.failed.length !== 1 || result.failed[0].title !== scenario.name)
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
    restoreSource = undefined;
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
  if (restored.status !== 0 || restored.report.numPassedTests !== scenarios.length)
    throw new Error("Restored baseline did not pass");
  const digest = createHash("sha256").update(original).digest("hex");
  const sourceDigest = createHash("sha256").update(sourceOriginal).digest("hex");
  const sourceSummary = `Separate source-level checks caught ${sourceRuns.length} mutations: ${sourceRuns.map((run) => run.name).join(", ")}. Each mutation failed its intended tests; all observed failures are listed below.`;
  const sourceRows = sourceRuns.map(
    (run) =>
      `| ${run.name} | ${run.failedNames.join("; ")} | ${run.failed} failed, ${run.passed} passed; assertion mismatches |`,
  );
  writeFileSync(
    receiptPath,
    `# Test and deliberate-break receipts\n\nRun: ${new Date().toISOString()}. Node ${process.version}.\n\nBaseline: ${baseline.report.numPassedTests}/${scenarios.length} passed. Each scenario break changes the named scenario's service output/caller input, or its explicitly declared source mutation; expected assertions stay unchanged. Every run executes the full suite. For each scenario break, the one named test failed at its behavioral result assertion, with all other tests passing. Each break was reverted before the next run. Restored baseline: ${restored.report.numPassedTests}/${scenarios.length} passed.\n\nMost breaks mutate only their own scenario input. For those breaks, the harness guarantees that other scenarios are unchanged, so the observed one-failure result cannot reveal a duplicated test. These are controlled service/input counterexamples plus declared source mutations, not a claim of independent or exhaustive implementation mutation coverage. Error scenarios repair exactly the invalid response to prove that the error test distinguishes it from usable evidence. Classification question tests protect the text sent to Jev, not Jev's interpretation of it. Exact paths, values, and expectations are in tests/scenarios.json and tests/source-breaks.json; run npm run test:breaks.\n\n${sourceSummary}\n\nScenario SHA-256: ${digest}.\n\nSource mutation SHA-256: ${sourceDigest}.\n\n| # | Single failing test | Deliberate break | Observed |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n## Source mutations\n\n| Mutation | Observed failing tests | Result |\n| --- | --- | --- |\n${sourceRows.join("\n")}\n`,
  );
  process.stdout.write(
    `Receipts: ${rows.length} scenario breaks and ${sourceRuns.length} source mutations caught; restored ${restored.report.numPassedTests}/${scenarios.length} passed.\n`,
  );
} finally {
  restoreSource?.();
  writeFileSync(path, original);
  if (existsSync(resultPath)) unlinkSync(resultPath);
}
