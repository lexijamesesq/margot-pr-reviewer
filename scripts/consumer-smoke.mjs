import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recordedServices, review } from "margot-pr-reviewer";

const fixture = JSON.parse(
  await readFile(
    new URL(import.meta.resolve("margot-pr-reviewer/recordings/council-clear.json")),
    "utf8",
  ),
);
const services = recordedServices(fixture);
const clear = await review(fixture.request, fixture.config, services);
assert.equal(clear.kind, "reviewed");
assert.equal(clear.decision.mergeEligible, true);
assert.equal(services.publications.length, 1);
assert.equal(services.publications[0].report, clear.report);
console.log(
  JSON.stringify({ outcome: clear.decision.outcome, publications: services.publications.length }),
);
