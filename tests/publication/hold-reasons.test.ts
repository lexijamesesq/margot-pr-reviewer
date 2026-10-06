import { describe, expect, it } from "vitest";
import { render } from "../../src/render.js";
import { mechanicalReview, runPublication } from "../helpers/publication.js";

// Each case is [hold reasons, the one reason the comment and the check title share], in the
// previous reviewer's words and order: a fallback, then the band, then the protected path,
// then ownership.
const fallback = "the risk was scored by the fallback (reduced confidence)";
const cases = [
  [["review-authority"], "it changes Margot's own machinery; approve it to merge it"],
  [["fallback-risk"], fallback],
  [["fallback-routing"], fallback],
  [["fallback-routing", "fallback-risk"], fallback],
  [["fallback"], fallback],
  [["ownership-uncomputed"], "ownership could not be established"],
  [["risk"], "risk is HIGH"],
  [["review-authority", "risk"], "risk is HIGH"],
  [["fallback-risk", "risk", "review-authority"], fallback],
] as const;

describe("a held approval names one reason", () => {
  for (const [reasons, sentence] of cases)
    it(`says "${sentence}" in the comment and the check for ${reasons.join(" + ")}`, async () => {
      const value = structuredClone(mechanicalReview);
      value.decision.mergeEligible = false;
      value.decision.holdReasons = [...reasons];
      value.decision.rating.band = reasons.some((r) => r === "risk") ? "HIGH" : "LOW";
      const run = await runPublication("hold", "voice", [...reasons]);
      expect({
        comment: render(value).includes(`\nAbove my authority: ${sentence}. Yours to merge.\n`),
        title: ((run.final?.output ?? {}) as { title?: string }).title,
      }).toEqual({ comment: true, title: `held for the operator: ${sentence}` });
    });
});

describe("calibration", () => {
  it("adds no authority line and titles the check calibrating", async () => {
    const value = structuredClone(mechanicalReview);
    value.decision.mergeEligible = false;
    value.decision.holdReasons = ["calibration"];
    const run = await runPublication("calibration");
    expect({
      authority: render(value).includes("Above my authority"),
      title: ((run.final?.output ?? {}) as { title?: string }).title,
    }).toEqual({ authority: false, title: "calibrating" });
  });
  it("keeps the authority line when another reason also holds", () => {
    const value = structuredClone(mechanicalReview);
    value.decision.mergeEligible = false;
    value.decision.holdReasons = ["risk", "calibration"];
    value.decision.rating.band = "MEDIUM";
    expect(render(value)).toContain("Above my authority: risk is MEDIUM. Yours to merge.");
  });
});
