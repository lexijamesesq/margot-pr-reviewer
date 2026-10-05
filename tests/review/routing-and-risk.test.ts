import { describe, expect, it } from "vitest";
import {
  type Change,
  confidentLow,
  councilClearCalls,
  councilClearCards,
  recorded,
  reviewed,
  reviewRecording,
  uniformRisk,
  voiceRuling,
  withBundle,
  withCardFields,
  withNoCouncil,
  withRisk,
  withRiskDimension,
  withRouteConfidence,
  withRoutedCards,
  withVoice,
  withVoiceFields,
} from "../helpers/review.js";

/** A functional review where routing selects no lens and every risk dimension is confidently LOW. */
const noCouncilConfidentlyLow = (...changes: Change[]) =>
  recorded(
    "council-clear",
    withNoCouncil(),
    withRisk(uniformRisk(confidentLow)),
    withVoice(voiceRuling("APPROVED", "LOW")),
    ...changes,
  );

describe("which lenses run", () => {
  it("runs a lens whose route score reaches the threshold", async () => {
    const { result } = await reviewed(recorded("council-clear", withRoutedCards({ safety: 0.35 })));
    expect(result.cards.map((card) => card.name)).toEqual(["safety"]);
  });

  it("clears without the voice when routing confidently selects no lens", async () => {
    const { result } = await reviewed(noCouncilConfidentlyLow());
    expect(result.cards).toEqual([]);
    expect(result.voice).toBeNull();
    expect(result.decision.mergeEligible).toBe(true);
  });

  it("escalates to the voice when routing selects no lens but is uncertain", async () => {
    const { result } = await reviewed(noCouncilConfidentlyLow(withRouteConfidence(0.1)));
    expect(result.voice).not.toBeNull();
  });

  it("summons the voice when a lens did not complete", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withCardFields("safety", {
          completion: "incomplete",
          completionReason: "the fixture is in another repository",
        }),
      ),
    );
    expect(result.voice).not.toBeNull();
    expect(result.cards.map((card) => card.name)).toEqual([...councilClearCards]);
  });

  it("summons the voice when a council risk dimension is uncertain", async () => {
    const { result, calls } = await reviewed(
      recorded(
        "council-clear",
        withRiskDimension("operations", { probabilities: [0.64, 0.09, 0.27, 0], confidence: 0.29 }),
      ),
    );
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.decision.rating.ignoredDimensions).toEqual([]);
    expect(result.voice).not.toBeNull();
    expect(result.cards.map((card) => card.name)).toEqual([...councilClearCards]);
    expect(calls).toEqual([...councilClearCalls, "voice", "head", "publish"]);
  });

  it("validates the card bundle pin when the voice runs without a council", async () => {
    const { result, publications } = await reviewRecording(
      noCouncilConfidentlyLow(withRouteConfidence(0.29), withBundle({ commit: "b".repeat(40) })),
    );
    expect(result).toMatchObject({
      kind: "error",
      stage: "bundle",
      diagnostic: "Card bundle pin mismatch",
      mergeEligible: false,
    });
    expect(publications).toEqual([]);
  });
});

describe("the risk band", () => {
  const operationsAt = (probabilities: number[]) =>
    withRiskDimension("operations", { probabilities, confidence: 1 });

  it("holds a confident MEDIUM when no council ran", async () => {
    const { result } = await reviewed(
      noCouncilConfidentlyLow(operationsAt([0, 0, 1, 0]), withVoiceFields({ band: "MEDIUM" })),
    );
    expect(result.decision.rating.band).toBe("MEDIUM");
    expect(result.decision.mergeEligible).toBe(false);
  });

  it("raises the band when the risk tail reaches the boundary", async () => {
    const { result } = await reviewed(
      noCouncilConfidentlyLow(operationsAt([0, 0.7, 0.3, 0]), withVoiceFields({ band: "MEDIUM" })),
    );
    expect(result.decision.rating.band).toBe("MEDIUM");
    expect(result.voice).not.toBeNull();
  });

  it("keeps the band LOW when the risk tail is just below the boundary", async () => {
    const { result } = await reviewed(
      noCouncilConfidentlyLow(
        operationsAt([0, 0.701, 0.299, 0]),
        withVoiceFields({ band: "MEDIUM" }),
      ),
    );
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.voice).toBeNull();
  });

  it("does not use the confidence floor when no risk dimension is confident", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withNoCouncil(),
        withRisk(uniformRisk({ probabilities: [0, 0, 1, 0], confidence: 0.1 })),
        withVoice(voiceRuling("APPROVED", "MEDIUM")),
      ),
    );
    expect(result.decision.rating.band).toBe("MEDIUM");
    expect(result.decision.rating.ignoredDimensions).toEqual([]);
  });

  it("does not apply the no-council confidence floor when a council ran", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withRisk({
          source: "jev",
          dimensions: {
            blast_radius: { probabilities: [1, 0, 0, 0], confidence: 1 },
            reversibility: { probabilities: [0.39, 0.61, 0, 0], confidence: 0.61 },
            data_security: { probabilities: [0.89, 0.11, 0, 0], confidence: 0.89 },
            operations: { probabilities: [1, 0, 0, 0], confidence: 0.99 },
            verification_gap: { probabilities: [0.55, 0.11, 0.23, 0.11], confidence: 0.1 },
          },
        }),
        withVoice(voiceRuling("APPROVED", "MEDIUM")),
      ),
    );
    expect(result.decision.rating.band).toBe("MEDIUM");
    expect(result.decision.rating.ignoredDimensions).toEqual([]);
  });

  it("lets the voice lower a functional band for display and for merge eligibility", async () => {
    const { result } = await reviewed(recorded("voice-hold", withVoiceFields({ band: "LOW" })));
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.decision.mergeEligible).toBe(true);
  });

  it("publishes a held verdict instead of throwing when the voice rules ERROR", async () => {
    const { result, publications } = await reviewed(
      recorded("invalid-accounting", withVoiceFields({ outcome: "ERROR" })),
    );
    expect(result.decision.outcome).toBe("ERROR");
    expect(result.decision.mergeEligible).toBe(false);
    expect(publications).toHaveLength(1);
  });
});

describe("a risk answer from the fallback", () => {
  it("holds the review with the fallback reason", async () => {
    const draft = recorded("council-clear");
    draft.risk.source = "fallback";
    const { result } = await reviewed(draft);
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["fallback-risk"]);
  });
  it("names only routing when the routing answer alone came from the fallback", async () => {
    const draft = recorded("council-clear");
    draft.route.source = "fallback";
    const { result } = await reviewed(draft);
    expect(result.decision.holdReasons).toEqual(["fallback-routing"]);
  });
});
