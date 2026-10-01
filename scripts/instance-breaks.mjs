import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ids = [
  "deployment-success",
  "release-repository",
  "release-version",
  "release-integrity",
  "release-sha256",
  "enrolment",
  "authority-enrolment",
  "shadow-selection",
  "github-output",
  "authority-binding",
  "shadow-binding",
  "placeholder-resolution",
  "closed",
  "draft",
  "fork",
  "moved",
  "trusted-config",
  "absolute-root",
  "bound-files",
  "github-token",
  "command-arguments",
];
function run(id = "") {
  return spawnSync(
    "npm",
    ["exec", "vitest", "run", "tests/instance.test.ts", "--", "--reporter=json"],
    {
      encoding: "utf8",
      env: { ...process.env, MARGOT_INSTANCE_BREAK: id },
    },
  );
}
function report(result) {
  assert.equal(result.status, result.status ?? 1, result.stderr);
  return JSON.parse(result.stdout);
}
const baselineResult = run();
assert.equal(baselineResult.status, 0, baselineResult.stdout + baselineResult.stderr);
const baseline = report(baselineResult);
const rows = [];
for (const id of ids) {
  const result = run(id);
  assert.equal(result.status, 1, `${id}\n${result.stdout}\n${result.stderr}`);
  const receipt = report(result);
  assert.equal(receipt.numFailedTests, 1, id);
  rows.push(`| ${id} | 1 failed, ${receipt.numPassedTests} passed |`);
  process.stdout.write(`${id}: one deliberate assertion failure\n`);
}
const restoredResult = run();
assert.equal(restoredResult.status, 0, restoredResult.stdout + restoredResult.stderr);
const restored = report(restoredResult);
writeFileSync(
  new URL("../docs/instance-command-break-receipts.md", import.meta.url),
  `# Instance command break receipts\n\nRun: ${new Date().toISOString()}. Node ${process.version}.\n\nBaseline: ${baseline.numPassedTests}/${baseline.numTotalTests} passed. Each row changes one command input or expected decision, runs the complete instance-command Vitest file, and observes exactly one assertion failure. The input is restored before the next run. Restored baseline: ${restored.numPassedTests}/${restored.numTotalTests} passed.\n\n| Break | Observed |\n| --- | --- |\n${rows.join("\n")}\n`,
);
process.stdout.write(`Restored: ${restored.numPassedTests}/${restored.numTotalTests} passed\n`);
