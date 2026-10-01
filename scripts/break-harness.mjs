import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

function discoverTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? discoverTests(path) : path.endsWith(".test.ts") ? [path] : [];
    })
    .sort();
}

/** Every receipt entry point executes and accounts for all discovered test files. */
export function createBreakHarness(output, breakEnvironment = "MARGOT_ADAPTER_BREAK") {
  const testFiles = discoverTests("tests");
  if (testFiles.length === 0) throw new Error("No test files discovered");
  let total;
  let restore;
  function run(id) {
    if (existsSync(output)) unlinkSync(output);
    const child = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        ...testFiles,
        "--reporter=json",
        `--outputFile=${output}`,
      ],
      { encoding: "utf8", env: { ...process.env, [breakEnvironment]: id ?? "" } },
    );
    if (child.error) throw child.error;
    const report = JSON.parse(readFileSync(output, "utf8"));
    if (
      total !== undefined &&
      (report.numTotalTests !== total || report.numPassedTests + report.numFailedTests !== total)
    )
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
    if (result.status !== 0 || result.report.numFailedTests !== 0)
      throw new Error("Baseline did not pass every test");
    total ??= result.report.numTotalTests;
    if (
      total === 0 ||
      result.report.numTotalTests !== total ||
      result.report.numPassedTests !== total
    )
      throw new Error("Baseline did not execute every discovered test");
  }
  function requireAssertionFailures(result) {
    if (result.status !== 1 || result.failed.length === 0)
      throw new Error("Mutation did not produce test failures");
    for (const test of result.failed) {
      const message = stripVTControlCharacters(test.failureMessages.join("\n"));
      if (!message.includes("AssertionError")) throw new Error(`Unexpected failure: ${test.title}`);
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
