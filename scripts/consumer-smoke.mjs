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
fixture.cards.safety.findings.push({
  id: "consumer-finding",
  tag: "issue",
  severity: "MAJOR",
  confidence: "HIGH",
  location: "workflow.yml:1",
  what: "The required check no longer runs.",
});
fixture.voice = {
  outcome: "CHANGES_REQUESTED",
  band: "LOW",
  rationale: "Bounded author-resolvable defect",
  summary: "Restore the required check before merging.",
  dispositions: [
    {
      id: "consumer-finding",
      status: "established",
      reason: "The workflow omits the required check.",
    },
  ],
};
const heldServices = recordedServices(fixture);
const held = await review(fixture.request, fixture.config, heldServices);
assert.equal(held.kind, "reviewed");
assert.equal(held.decision.mergeEligible, false);
assert.equal(held.decision.outcome, "CHANGES_REQUESTED");
assert.equal(heldServices.publications[0].report, held.report);
console.log(
  JSON.stringify({
    clear: clear.decision.outcome,
    changedFinding: held.decision.outcome,
    publications: services.publications.length + heldServices.publications.length,
  }),
);
