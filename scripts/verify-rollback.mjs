import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { recordedServices, review } from "../dist/index.js";

const [corpusPath, runtimePath] = process.argv.slice(2);
if (!corpusPath || !runtimePath)
  throw new Error(
    "Usage: node scripts/verify-rollback.mjs CORPUS.json.gz PYTHON_RUNTIME_DIRECTORY",
  );
const corpus = JSON.parse(gunzipSync(readFileSync(corpusPath)));
const rows = [];
for (const saved of corpus.migration) {
  const result = await review(
    saved.recording.request,
    saved.recording.config,
    recordedServices(saved.recording),
  );
  assert.equal(result.kind, "reviewed");
  const child = spawnSync(
    "python3",
    [
      "-c",
      `
import sys, json
sys.path.insert(0, sys.argv[1])
import driver
value = json.load(sys.stdin)
ledger = driver.newest_ledger([{"user": {"login": driver.MARGOT_BOT_LOGIN}, "submitted_at": "2026-09-30T20:00:00Z", "body": value["report"]}])
print(json.dumps({"ledger": ledger, "cards": driver.ledger_cards(ledger)}))
`,
      runtimePath,
    ],
    { input: JSON.stringify(result), encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(child.status, 0, child.stderr);
  const restored = JSON.parse(child.stdout);
  assert.equal(restored.ledger?.head, result.request.head);
  assert.equal(restored.ledger?.round, result.ledger.round);
  assert.deepEqual(restored.ledger?.entries, result.ledger.entries);
  assert.deepEqual(
    restored.cards,
    [
      ...new Set(result.ledger.entries.filter((e) => e.status === "standing").map((e) => e.card)),
    ].sort(),
  );
  rows.push({
    name: saved.name,
    entries: result.ledger.entries.length,
    recalledCards: restored.cards,
    result: "unchanged Python reads every entry",
  });
}
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
