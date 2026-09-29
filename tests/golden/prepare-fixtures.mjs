#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const casesRoot = process.argv[2] ?? new URL("cases/", import.meta.url).pathname;
const oldRunUrl = "https://github.com/lexijamesesq/margot/actions/runs/";
const newRunUrl = "https://github.com/example-org/margot-instance/actions/runs/";
const seamOrder = ["poster", "council-parse", "ledger", "risk-verdict", "triage", "workflow-steps"];

const ids = (await readdir(casesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const touched = [];
let replacements = 0;

for (const id of ids) {
  const directory = join(casesRoot, id);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const before = await readFile(path, "utf8");
    const count = before.split(oldRunUrl).length - 1;
    if (count > 0) {
      await writeFile(path, before.replaceAll(oldRunUrl, newRunUrl));
      touched.push({ path, replacements: count });
      replacements += count;
    }
  }

  const casePath = join(directory, "case.json");
  const expectedPath = join(directory, "expected.json");
  const adapterPath = join(directory, "adapter.json");
  const fixture = JSON.parse(await readFile(casePath, "utf8"));
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  const adapter = JSON.parse(await readFile(adapterPath, "utf8"));
  const seams = new Set();

  if (adapter.poster === true || expected.poster !== undefined) seams.add("poster");
  if (
    adapter.driver === true &&
    expected.model_requests?.some((request) => request.role === "reviewer")
  ) {
    seams.add("council-parse");
  }
  const priorLedger = fixture.github.reads.some(
    (read) =>
      read.path.endsWith("/reviews") &&
      typeof read.response === "string" &&
      read.response.includes('"login": "margot-the-meticulous[bot]"') &&
      read.response.includes("margot-ledger:v1"),
  );
  if (expected.emit?.round > 1 || priorLedger || id.includes("ledger-selection")) {
    seams.add("ledger");
  }
  const riskKeys = [
    "band",
    "R",
    "risk",
    "risk_vector",
    "band_basis",
    "ignored_dimensions",
    "raised",
    "verdict_voice",
  ];
  if (expected.emit && riskKeys.some((key) => Object.hasOwn(expected.emit, key))) {
    seams.add("risk-verdict");
  }
  if (expected.outcome?.triage !== undefined) seams.add("triage");
  if (
    adapter.workflow &&
    expected.outcome &&
    (expected.outcome.status !== undefined || expected.outcome.facts !== undefined) &&
    expected.driver === undefined &&
    expected.poster === undefined
  ) {
    seams.add("workflow-steps");
  }
  if (seams.size === 0) throw new Error(`${id}: no seam rule matched`);
  fixture.seams = seamOrder.filter((seam) => seams.has(seam));
  await writeFile(casePath, `${JSON.stringify(fixture, null, 2)}\n`);
}

console.log(JSON.stringify({ cases: ids.length, replacements, touched }, null, 2));
