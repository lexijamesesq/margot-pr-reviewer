import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const path = new URL("../tests/scenarios.json", import.meta.url);
const original = readFileSync(path, "utf8");
const scenarios = JSON.parse(original);
const receiptPath = new URL("../docs/test-break-receipts.md", import.meta.url);
const resultPath = new URL("../.break-results.json", import.meta.url);
const rows = [];
let restoreSource;
function run() {
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
  return {
    status: result.status,
    report,
    failed: report.testResults.flatMap((suite) =>
      suite.assertionResults.filter((test) => test.status === "failed"),
    ),
  };
}
try {
  const baseline = run();
  if (baseline.status !== 0 || baseline.report.numPassedTests !== scenarios.length)
    throw new Error("Baseline did not pass every test");
  for (const [index, scenario] of scenarios.entries()) {
    const mutated = structuredClone(scenarios);
    mutated[index].patches.push(...scenario.break);
    if (scenario.sourceBreak) {
      const { file, from, to } = scenario.sourceBreak;
      const contents = readFileSync(file, "utf8");
      if (contents.split(from).length !== 2)
        throw new Error(`Source break must match once: ${file}`);
      restoreSource = () => writeFileSync(file, contents);
      writeFileSync(file, contents.replace(from, to));
    }
    writeFileSync(path, `${JSON.stringify(mutated, null, 2)}\n`);
    const result = run();
    restoreSource?.();
    restoreSource = undefined;
    writeFileSync(path, original);
    if (
      result.status === 0 ||
      result.failed.length !== 1 ||
      result.failed[0].title !== scenario.name
    )
      throw new Error(
        `Break ${index + 1} did not fail only ${scenario.name}: ${result.failed.map((test) => test.title)}`,
      );
    const message = stripVTControlCharacters(result.failed[0].failureMessages.join("\n"));
    if (!message.includes("AssertionError") || !message.includes("to match object"))
      throw new Error(`Unexpected failure: ${scenario.name}`);
    rows.push(
      `| ${index + 1} | ${scenario.name} | ${scenario.defect} | 1 failed, ${scenarios.length - 1} passed; assertion mismatch |`,
    );
    process.stdout.write(`${index + 1}/${scenarios.length}: ${scenario.name}\n`);
  }
  const restored = run();
  if (restored.status !== 0 || restored.report.numPassedTests !== scenarios.length)
    throw new Error("Restored baseline did not pass");
  const digest = createHash("sha256").update(original).digest("hex");
  writeFileSync(
    receiptPath,
    `# Test and deliberate-break receipts\n\nRun: ${new Date().toISOString()}. Node ${process.version}.\n\nBaseline: ${scenarios.length}/${scenarios.length} passed. Each break changes the named scenario's service output/caller input, or its explicitly declared source mutation; expected assertions stay unchanged. Every run executes the full suite. The one named test failed at its behavioral result assertion, with all other tests passing. Each break was reverted before the next run. Restored baseline: ${scenarios.length}/${scenarios.length} passed.\n\nMost breaks mutate only their own scenario input. For those breaks, the harness guarantees that other scenarios are unchanged, so the observed one-failure result cannot reveal a duplicated test. These are controlled service/input counterexamples plus declared source mutations, not a claim of independent or exhaustive implementation mutation coverage. Error scenarios repair exactly the invalid response to prove that the error test distinguishes it from usable evidence. Exact paths, values, and expectations are in tests/scenarios.json; run npm run test:breaks.\n\nSeparate source-level checks reversed classification precedence, forced the documentation band, made routing always true, and dropped the old-path rename check. Each mutation was caught by its intended test.\n\nScenario SHA-256: ${digest}.\n\n| # | Single failing test | Deliberate break | Observed |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`,
  );
} finally {
  restoreSource?.();
  writeFileSync(path, original);
  try {
    unlinkSync(resultPath);
  } catch {
    /* No report when the runner could not start. */
  }
}
