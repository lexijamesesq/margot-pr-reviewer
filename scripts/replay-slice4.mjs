import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findingTally, recordedServices, review } from "../dist/index.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/replay-slice4.mjs CORPUS.json.gz [OUTPUT.json]");
const corpus = JSON.parse(gunzipSync(readFileSync(path)));
const receipts = [];
for (const saved of [...corpus.migration, ...corpus.chain]) {
  const services = recordedServices(saved.recording);
  const result = await review(saved.recording.request, saved.recording.config, services);
  if (result.kind !== "reviewed") throw new Error(`${saved.name}: ${result.diagnostic}`);
  assert.deepEqual(result.decision, saved.expected.decision, `${saved.name}: decision`);
  assert.equal(result.classification, saved.expected.classification);
  const tally = findingTally(result);
  const lines = result.report.split("\n").filter((line) => /^- R\d+-F\d+ \[/.test(line));
  assert.equal(lines.length, tally.open + tally.closed);
  assert.equal(lines.filter((line) => line.includes("; New")).length, tally.new);
  const retry = structuredClone(saved.recording);
  retry.facts.history = {
    complete: true,
    priorLedger: true,
    reviews: [
      {
        id: 1,
        actor: retry.config.trustedLedgerActors[0],
        actorType: "Bot",
        head: result.request.head,
        submittedAt: "2026-09-30T23:00:00Z",
        body: result.report,
      },
    ],
  };
  const retried = recordedServices(retry);
  assert.deepEqual(await review(retry.request, retry.config, retried), result);
  assert.deepEqual(
    retried.calls.map((c) => c.name),
    ["facts", "head"],
  );
  receipts.push({
    name: saved.name,
    head: result.request.head,
    classification: result.classification,
    decision: result.decision.outcome,
    band: result.decision.rating.band,
    tally,
    sameDecision: true,
    retry: "identical; no model calls",
    reconciliation: "passed",
  });
}
const output = `${JSON.stringify(receipts, null, 2)}\n`;
if (process.argv[3]) writeFileSync(process.argv[3], output);
else process.stdout.write(output);
