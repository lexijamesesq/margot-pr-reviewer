import { describe, expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import { mechanicalBump, mechanicalRequest, mechanicalReview } from "../helpers/publication.js";

it("accepts a skipped required check only when it is explicitly configured as allowed to skip", async () => {
  const copy = structuredClone(mechanicalBump);
  const config = {
    ...(copy.config as object),
    requiredChecks: ["ci / optional"],
    requiredCheckReporters: { "ci / optional": 42 },
    trustedCheckActors: ["checks-app"],
    allowedSkippedChecks: ["ci / optional"],
  };
  copy.facts = {
    ...(copy.facts as object),
    checks: [
      {
        name: "ci / optional",
        actor: "checks-app",
        appId: 42,
        head: mechanicalRequest.head,
        conclusion: "skipped",
      },
    ],
  };
  expect({
    kind: (await review(mechanicalRequest, config, recordedServices(copy))).kind,
  }).toMatchObject({
    kind: "reviewed",
  });
});
it("preserves mechanical classification for a 2005-line candidate", async () => {
  const copy = structuredClone(mechanicalBump);
  const additions = Array.from({ length: 2001 }, (_, index) => `+line ${index}`).join("\n");
  (
    copy.facts as {
      diff: string;
    }
  ).diff =
    `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2001 @@\n${additions}\n`;
  const services = recordedServices(copy);
  const result = await review(copy.request, copy.config, services);
  expect({
    mechanical: result.kind === "reviewed" && result.classification === "mechanical",
    classificationCall: services.calls.some((call) => call.name === "classification"),
    routeCall: services.calls.some((call) => call.name === "route"),
  }).toMatchObject({ mechanical: true, classificationCall: false, routeCall: false });
});
describe("merge actor configuration", () => {
  it("carries the configured merge actor from the configuration to the presentation", async () => {
    const withActor = await review(
      mechanicalRequest,
      { ...(mechanicalBump.config as object), mergeActor: "merge-bot" },
      recordedServices(mechanicalBump),
    );
    expect({
      configured: withActor.kind === "reviewed" && withActor.presentation?.mergeActor,
      unset: mechanicalReview.presentation?.mergeActor,
    }).toEqual({ configured: "merge-bot", unset: undefined });
  });
});
