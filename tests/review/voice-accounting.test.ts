import { describe, expect, it } from "vitest";
import { parseVoice } from "../../src/adapters/prose.js";
import { cardNames, requestSchema } from "../../src/schemas.js";
import {
  asDocumentation,
  type Change,
  completedCard,
  disposition,
  finding,
  recorded,
  reviewed,
  reviewRecording,
  voiceRuling,
  withCard,
  withRoute,
  withRoutedCards,
  withVoice,
} from "../helpers/review.js";

describe("which documentation changes get a council", () => {
  it("runs works-and-proven when the documentation changes meaning", async () => {
    const { result } = await reviewed(recorded("council-clear", asDocumentation(1)));
    expect(result.classification).toBe("documentation");
    expect(result.cards.map((card) => card.name)).toEqual(["works-and-proven"]);
    expect(result.decision.rating.band).toBe("LOW");
  });

  it("skips the council and the voice for an editorial documentation change", async () => {
    const { result } = await reviewed(recorded("council-clear", asDocumentation(0)));
    expect(result.cards).toEqual([]);
    expect(result.voice).toBeNull();
  });

  it("runs works-and-proven when Jev did not answer whether the documentation changes meaning", async () => {
    const { result } = await reviewed(recorded("council-clear", asDocumentation(null)));
    expect(result.cards.map((card) => card.name)).toEqual(["works-and-proven"]);
  });
});

describe("documentation findings", () => {
  const withOpenFinding = (...changes: Change[]) =>
    asDocumentation(
      1,
      withCard("works-and-proven", completedCard("works-and-proven", [finding()])),
      ...changes,
    );

  it("sends a documentation defect to the author at band LOW", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(
            voiceRuling("CHANGES_REQUESTED", "HIGH", [
              disposition("one", "established", "The command and its effect disagree."),
            ]),
          ),
        ),
      ),
    );
    expect(result.decision.outcome).toBe("CHANGES_REQUESTED");
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.decision.holdReasons).toEqual(["author-action"]);
  });

  it("requests clarification at band LOW when the voice has a question", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(
            voiceRuling("CLARIFICATION_REQUESTED", "LOW", [
              disposition("one", "question", "Which command is intended?"),
            ]),
          ),
        ),
      ),
    );
    expect(result.decision.outcome).toBe("CLARIFICATION_REQUESTED");
    expect(result.decision.rating.band).toBe("LOW");
  });

  it("approves when the voice dismisses every mandatory finding", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(
            voiceRuling("APPROVED", "LOW", [
              disposition("one", "dismissed", "Execution disproves the allegation."),
            ]),
          ),
        ),
      ),
    );
    expect(result.decision.mergeEligible).toBe(true);
  });

  it("rejects the voice when it disposes of one finding twice", async () => {
    const established = disposition("one", "established", "The command and its effect disagree.");
    const { result } = await reviewRecording(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(voiceRuling("CHANGES_REQUESTED", "LOW", [established, established])),
        ),
      ),
    );
    expect(result).toMatchObject({ kind: "error", stage: "voice" });
  });

  it("ignores a disposition for an ID outside this round and still accounts for every mandatory finding", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(
            voiceRuling("CHANGES_REQUESTED", "LOW", [
              disposition("one", "established", "The command and its effect disagree."),
              disposition("unknown", "dismissed", "No matching finding."),
            ]),
          ),
        ),
      ),
    );
    expect(result.decision.mergeEligible).toBe(false);
  });

  it("rejects an approval that leaves a mandatory finding established", async () => {
    const { result } = await reviewRecording(
      recorded(
        "council-clear",
        withOpenFinding(
          withVoice(
            voiceRuling("APPROVED", "LOW", [
              disposition("one", "established", "The command and its effect disagree."),
            ]),
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ kind: "error", stage: "voice" });
  });

  it("summons the voice for a BLOCKING info finding, which the voice need not dispose of", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        asDocumentation(
          1,
          withCard(
            "works-and-proven",
            completedCard("works-and-proven", [finding({ tag: "info", severity: "BLOCKING" })]),
          ),
          withVoice(voiceRuling("CHANGES_REQUESTED", "LOW")),
        ),
      ),
    );
    expect(result.decision.mergeEligible).toBe(false);
  });

  it("summons the voice for an achieves-the-objective finding, which the voice need not dispose of", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        asDocumentation(
          1,
          withRoutedCards({ "achieves-the-objective": 1 }),
          withCard(
            "achieves-the-objective",
            completedCard("achieves-the-objective", [finding({ tag: "info" })]),
          ),
          withVoice(voiceRuling("CHANGES_REQUESTED", "LOW")),
        ),
      ),
    );
    expect(result.decision.mergeEligible).toBe(false);
  });
});

describe("voice publication safeguards", () => {
  function recordedWithVoiceProse(prose: string) {
    return recorded(
      "mechanical-bump",
      (draft) => {
        draft.request = { ...requestSchema.parse(draft.request), classification: "functional" };
      },
      withRoute({
        source: "jev",
        cards: Object.fromEntries(cardNames.map((name) => [name, 0])),
        confidence: 0,
        documentationSubstantive: null,
      }),
      (draft) => {
        draft.voice = parseVoice(prose) as typeof draft.voice;
      },
    );
  }

  it("refuses an approval with an open clarification before publication", async () => {
    const { result, publications } = await reviewRecording(
      recordedWithVoiceProse(
        "outcome: APPROVED\nband: LOW\nband_reason: Bounded change\nrisk: configuration change\nsummary: Reviewed\nclarification: Which behavior should callers receive?\nestablished:\ndismissed:\n",
      ),
    );
    expect(result).toMatchObject({
      kind: "error",
      mergeEligible: false,
      diagnostic: "Approval contradicts an open clarification",
    });
    expect(publications).toEqual([]);
  });

  it("refuses an approval with an established finding outside the mandatory set", async () => {
    const { result, publications } = await reviewRecording(
      recordedWithVoiceProse(
        "outcome: APPROVED\nband: LOW\nband_reason: Bounded change\nsummary: Reviewed\nestablished:\n- F999 · The guard is missing\ndismissed:\n",
      ),
    );
    expect(result).toMatchObject({
      kind: "error",
      mergeEligible: false,
      diagnostic: "Approval contradicts unresolved findings",
    });
    expect(publications).toEqual([]);
  });

  it.each(["summary", "risk", "band_reason", "finding", "clarification"])(
    "refuses self-attribution in the voice's %s before publication",
    async (field) => {
      const fields = {
        outcome: "CHANGES_REQUESTED",
        band: "LOW",
        band_reason: "Bounded change",
        risk: "configuration change",
        summary: "Reviewed",
        finding: "",
        clarification: "",
        [field]: "Generated with Claude Code",
      };
      const { result, publications } = await reviewRecording(
        recordedWithVoiceProse(
          Object.entries(fields)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n"),
        ),
      );
      expect(result).toMatchObject({
        kind: "error",
        mergeEligible: false,
        diagnostic: expect.stringContaining("Attribution leak in review prose"),
      });
      expect(publications).toEqual([]);
    },
  );
});
