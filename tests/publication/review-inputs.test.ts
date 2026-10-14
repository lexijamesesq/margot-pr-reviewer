import { expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import { mechanicalBump, mechanicalRequest } from "../helpers/publication.js";

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
  expect(
    await review(
      mechanicalRequest,
      { ...config, allowedSkippedChecks: [] },
      recordedServices(copy),
    ),
  ).toMatchObject({ kind: "error", stage: "checks", mergeEligible: false });
});
