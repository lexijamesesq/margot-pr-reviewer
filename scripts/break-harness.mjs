import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

/** Both receipt entry points execute and account for the complete scenario inventory. */
export function createBreakHarness(output) {
  const total = [
    "tests/scenarios.json",
    "tests/adapter-scenarios.json",
    "tests/ledger-scenarios.json",
    "tests/publication-scenarios.json",
  ].reduce((count, file) => count + JSON.parse(readFileSync(file, "utf8")).length, 0);
  let restore;
  function run(id) {
    if (existsSync(output)) unlinkSync(output);
    const child = spawnSync(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${output}`],
      { encoding: "utf8", env: { ...process.env, MARGOT_ADAPTER_BREAK: id ?? "" } },
    );
    if (child.error) throw child.error;
    const report = JSON.parse(readFileSync(output, "utf8"));
    if (report.numTotalTests !== total || report.numPassedTests + report.numFailedTests !== total)
      throw new Error("Runner did not execute every scenario");
    return {
      status: child.status,
      report,
      failed: report.testResults.flatMap((suite) =>
        suite.assertionResults.filter((test) => test.status === "failed"),
      ),
    };
  }
  function requireBaseline(result) {
    if (result.status !== 0 || result.report.numPassedTests !== total)
      throw new Error("Baseline did not pass every test");
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
  function mutateSource({ file, from, to }) {
    if (restore) throw new Error("A source mutation is already active");
    const contents = readFileSync(file, "utf8");
    if (contents.split(from).length !== 2) throw new Error(`Source break must match once: ${file}`);
    restore = () => writeFileSync(file, contents);
    writeFileSync(file, contents.replace(from, to));
  }
  function restoreSource() {
    restore?.();
    restore = undefined;
  }
  function cleanup() {
    restoreSource();
    if (existsSync(output)) unlinkSync(output);
  }
  return { run, requireBaseline, requireAssertionFailures, mutateSource, restoreSource, cleanup };
}
