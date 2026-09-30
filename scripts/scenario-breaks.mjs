import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createBreakHarness } from "./break-harness.mjs";

/** Adapter and convergence receipts share the same mutation/accounting checks. */
export function scenarioBreaks(group, title, explanation) {
  const manifest = readFileSync(`tests/${group}-scenarios.json`, "utf8");
  const cases = JSON.parse(manifest);
  const { run, requireBaseline, requireAssertionFailures, mutateSource, restoreSource, cleanup } =
    createBreakHarness(`.${group}-break-results.json`);
  try {
    const baseline = run();
    requireBaseline(baseline);
    const rows = [];
    for (const spec of cases) {
      if (spec.sourceBreak) mutateSource(spec.sourceBreak);
      const result = run(spec.sourceBreak ? undefined : spec.id);
      restoreSource();
      requireAssertionFailures(result);
      if (result.failed.length !== 1 || result.failed[0].title !== spec.name)
        throw new Error(`Unexpected break result: ${spec.id}`);
      rows.push(
        `| ${spec.name} | ${spec.defect} | 1 failed; ${result.report.numPassedTests} passed |`,
      );
      process.stdout.write(`${spec.id}: caught\n`);
    }
    requireBaseline(run());
    writeFileSync(
      `docs/${group}-break-receipts.md`,
      `# ${title}\n\nGenerated ${new Date().toISOString()}, Node ${process.version}. Baseline and restored suite: ${baseline.report.numTotalTests}/${baseline.report.numTotalTests} passed. Each of ${cases.length} isolated breaks ran the complete suite and failed exactly its named assertion.\n\n${explanation}\n\nMost breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without MARGOT_ADAPTER_BREAK and are identified in the manifest. No live service or paid model call occurs in the harness.\n\nManifest SHA-256: ${createHash("sha256").update(manifest).digest("hex")}. Reproduce: npm run test:${group}-breaks.\n\n| Test | Deliberate break | Observed |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
    );
  } finally {
    cleanup();
  }
}
