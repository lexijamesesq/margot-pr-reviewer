import { describe, expect, it } from "vitest";
import { render } from "../../src/render.js";
import { mechanicalReview, runPublication } from "../helpers/publication.js";

// Each case is [hold reasons, the one sentence the comment and the check title share].
const cases = [
  [["review-authority"], "it touches a protected path"],
  [["fallback-risk"], "the risk was scored by a fallback (reduced confidence)"],
  [["fallback-routing"], "routing fell back to a simpler model (reduced confidence)"],
  [["fallback-routing", "fallback-risk"], "routing and risk both fell back (reduced confidence)"],
  [["fallback"], "a model step fell back (reduced confidence)"],
  [["ownership-uncomputed"], "ownership could not be established"],
  [["calibration"], "calibration mode is on"],
  [["risk"], "risk is HIGH"],
  [["review-authority", "risk"], "it touches a protected path"],
  [["risk", "calibration"], "calibration mode is on"],
] as const;

describe("a held approval names one reason", () => {
  for (const [reasons, sentence] of cases)
    it(`says "${sentence}" in the comment and the check for ${reasons.join(" + ")}`, async () => {
      const value = structuredClone(mechanicalReview);
      value.decision.mergeEligible = false;
      value.decision.holdReasons = [...reasons];
      value.decision.rating.band = "HIGH";
      const run = await runPublication("hold", "voice", [...reasons]);
      expect({
        comment: render(value).includes(`Above my authority: ${sentence}.`),
        title: ((run.final?.output ?? {}) as { title?: string }).title,
      }).toEqual({ comment: true, title: `held for the operator: ${sentence}` });
    });
});
