import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { recordedServices, review } from "../dist/index.js";

const defaultCorpus = fileURLToPath(new URL("../docs/live/slice3-cases.json.gz", import.meta.url));
const corpusPath = process.argv[2] ? resolve(process.argv[2]) : defaultCorpus;
if (!existsSync(corpusPath)) {
  console.error(
    `Slice 3 replay corpus not found at ${corpusPath}. Pass its path as the first argument: node scripts/replay-slice3.mjs <corpus-path>`,
  );
  process.exit(1);
}
const capsule = JSON.parse(gunzipSync(readFileSync(corpusPath)));
const receipts = [];
// Stock zlib output differs across Node versions. Compare every decoded field and
// all visible report text; same-runtime retries below still compare the whole result.
const semanticResult = (result) => ({
  ...result,
  report: result.report.replace(
    /<!-- margot-ledger:v2 [A-Za-z0-9+/=]+ -->$/,
    "<validated ledger transport>",
  ),
});
for (const saved of [...capsule.migration, ...capsule.chain]) {
  const services = recordedServices(saved.recording);
  const result = await review(saved.recording.request, saved.recording.config, services);
  assert.deepEqual(semanticResult(result), semanticResult(saved.expected), saved.name);
  const retryData = structuredClone(saved.recording);
  retryData.facts.history = {
    complete: true,
    priorLedger: true,
    reviews: [
      {
        id: 1,
        actor: retryData.config.trustedLedgerActors[0],
        actorType: "Bot",
        head: result.request.head,
        submittedAt: "2026-09-30T20:00:00Z",
        body: result.report,
      },
    ],
  };
  const retryServices = recordedServices(retryData);
  const retry = await review(retryData.request, retryData.config, retryServices);
  assert.deepEqual(retry, result, `${saved.name} retry`);
  assert.deepEqual(
    retryServices.calls.map((c) => c.name),
    ["facts", "head"],
  );
  receipts.push({
    name: saved.name,
    decision: result.decision.outcome,
    band: result.decision.rating.band,
    counts: result.convergence,
    retry: "identical; no paid calls",
  });
}
const original = capsule.migration.find((r) => r.name === "migration/pr9-r2").recording;
for (const mode of ["rebase", "unreadable-compare", "forged-history", "unreadable-history"]) {
  const data = structuredClone(original);
  if (mode === "rebase") data.comparison.status = "diverged";
  if (mode === "unreadable-compare") data.failures = { compare: "unreadable compare" };
  if (mode === "forged-history") data.facts.history.reviews.at(-1).actor = "forger";
  if (mode === "unreadable-history") data.facts.history.complete = false;
  const services = recordedServices(data);
  const result = await review(data.request, data.config, services);
  if (mode.includes("history")) {
    assert.equal(result.kind, "error");
    assert.equal(result.stage, "history");
    assert.equal(result.mergeEligible, false);
    assert.equal(services.publications.length, 0);
  } else {
    assert.equal(result.kind, "reviewed");
    assert.equal(result.convergence.round, 2);
    assert.equal(result.convergence.fixed, 6);
    for (const call of services.calls.filter((c) => c.name.startsWith("card:"))) {
      assert.equal(call.input.round.full, true);
      assert.equal(call.input.round.diff, data.facts.diff);
    }
    assert.equal(result.ledger.entries.length, 6);
  }
  receipts.push({ name: mode, result: result.kind, counts: result.convergence ?? null });
}
writeFileSync(
  new URL("../docs/live/slice3-replay.json", import.meta.url),
  JSON.stringify({ limitations: capsule.limitations, receipts }, null, 2) + "\n",
);
console.log(
  `${receipts.length} proof assertions passed: exact live-result replay, stable retries, rebase and failed-history refusal.`,
);
