import { describe, expect, it } from "vitest";
import { render } from "../../src/render.js";
import { mechanicalReview, runPublication } from "../helpers/publication.js";

// Each case is [hold reasons, the one sentence the comment and the check title share].
const cases = [
  [["fallback-risk"], "risk.*fallback"],
  [["fallback-routing"], "routing.*fell back"],
  [["fallback-routing", "fallback-risk"], "routing and risk.*fell back"],
  [["ownership-uncomputed"], "ownership.*not.*established"],
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
        comment: new RegExp(sentence, "i").test(render(value)),
        title: ((run.final?.output ?? {}) as { title?: string }).title,
      }).toEqual({ comment: true, title: expect.stringMatching(new RegExp(sentence, "i")) });
    });
});
