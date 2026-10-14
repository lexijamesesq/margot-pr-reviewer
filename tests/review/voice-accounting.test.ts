import { describe, expect, it } from "vitest";
import { parseVoice } from "../../src/adapters/prose.js";
import { mandatory, requireRiskLine } from "../../src/policy.js";
import { cardNames, requestSchema, voiceSchema } from "../../src/schemas.js";
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
  withCardFields,
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
    expect(result.decision.mergeEligible).toBe(false);
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
    expect(result.ledger.entries).toHaveLength(1);
    expect(result.ledger.entries[0]).toMatchObject({
      status: "standing",
      what: "The documented command deletes required data.",
    });
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
    const { result, calls } = await reviewed(
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
    expect(calls).toContain("voice");
    expect(mandatory(result.cards)).toEqual([]);
    expect(result.voice?.dispositions).toEqual([]);
    expect(result.decision.mergeEligible).toBe(false);
  });

  it("summons the voice for an achieves-the-objective finding, which the voice need not dispose of", async () => {
    const { result, calls } = await reviewed(
      recorded(
        "council-clear",
        asDocumentation(
          1,
          withRoutedCards({ "achieves-the-objective": 1 }),
          withCard(
            "achieves-the-objective",
            completedCard("achieves-the-objective", [
              finding({
                tag: "info",
                what: "The Done-When does not specify which caller should receive the new behavior.",
              }),
            ]),
          ),
          withVoice({
            ...voiceRuling("CLARIFICATION_REQUESTED", "LOW"),
            clarification: "Should existing callers receive the new behavior?",
          }),
        ),
      ),
    );
    expect(result.decision.outcome).toBe("CLARIFICATION_REQUESTED");
    expect(calls).toContain("voice");
    expect(mandatory(result.cards)).toEqual([]);
    expect(result.voice?.dispositions).toEqual([]);
    expect(result.decision.mergeEligible).toBe(false);
  });
});

describe("voice publication safeguards", () => {
  it.each([undefined, "   "])("rejects an empty risk classification %j", (risk) => {
    const voice = voiceSchema.parse(voiceRuling("CHANGES_REQUESTED", "LOW"));
    if (risk === undefined) delete voice.risk;
    else voice.risk = risk;
    expect(() => requireRiskLine(voice)).toThrow();
  });
  function recordedWithVoiceProse(prose: string) {
    return recorded(
      "mechanical-bump",
      (draft) => {
        draft.request = requestSchema.parse(draft.request);
        Object.assign(draft.facts.triage as object, { classification: "functional" });
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
        "outcome: APPROVED\nband: LOW\nband_reason: Bounded change\nrisk: configuration change\nsummary: Reviewed\nestablished:\n- F999 · The guard is missing\ndismissed:\n",
      ),
    );
    expect(result).toMatchObject({
      kind: "error",
      mergeEligible: false,
      diagnostic: "Approval contradicts unresolved findings",
    });
    expect(publications).toEqual([]);
  });

  it.each([""])(
    "holds a verdict whose risk line has no classification (%j) instead of posting it",
    async (risk) => {
      const { result, publications } = await reviewRecording(
        recordedWithVoiceProse(
          `outcome: CHANGES_REQUESTED\nband: LOW\nband_reason: Bounded change\n${risk}summary: Reviewed\nestablished:\ndismissed:\n`,
        ),
      );
      expect({ result, publications }).toMatchObject({
        result: {
          kind: "error",
          stage: "template-gate",
          mergeEligible: false,
          diagnostic: "held — comment not template-compliant: risk line has no classification",
        },
        publications: [],
      });
    },
  );

  it("posts the voice's own ERROR without a risk classification", async () => {
    const { result } = await reviewRecording(
      recordedWithVoiceProse(
        "outcome: ERROR\nband: LOW\nband_reason: Could not read a.ts\nsummary: The review could not be completed.\nfinding: F1 unreadable\nestablished:\ndismissed:\n",
      ),
    );
    expect(result).toMatchObject({ kind: "reviewed", decision: { outcome: "ERROR" } });
  });

  it("publishes a review that quotes the credit text under review", async () => {
    const quotedCredit = '"Generated with Claude Code"';
    const draft = recordedWithVoiceProse(
      `outcome: APPROVED\nband: LOW\nband_reason: Only the package credit text changed\nrisk: package metadata\nsummary: The credit now reads ${quotedCredit}. No runtime behavior changed.\nestablished:\ndismissed:\n`,
    );
    draft.facts.diff =
      'diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-{"credit":"Generated with another tool"}\n+{"credit":"Generated with Claude Code"}\n';
    draft.facts.title = "Update package credit label";
    draft.facts.body = "Update the package credit text without changing runtime behavior.";
    draft.facts.files = [{ path: "package.json" }];
    draft.facts.fileCount = 1;
    const { result, publications } = await reviewRecording(draft);
    expect(result).toMatchObject({
      kind: "reviewed",
      decision: { outcome: "APPROVED", mergeEligible: true },
    });
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ report: expect.stringContaining(quotedCredit) });
  });
});

describe("the comment's card rows", () => {
  const withShownFinding = (what: string) =>
    withCardFields("safety", {
      findings: [{ tag: "info", severity: "MINOR", confidence: "HIGH", location: "a.ts:1", what }],
    });
  it("holds a review whose shown finding has no plain sentence instead of posting it", async () => {
    const { result, publications } = await reviewRecording(
      recorded("council-clear", withShownFinding(" . ")),
    );
    expect({ result, publications }).toMatchObject({
      result: {
        kind: "error",
        stage: "template-gate",
        diagnostic:
          "held — comment not template-compliant: safety: its shown finding has no plain-language comment",
      },
      publications: [],
    });
  });
  it("posts a review whose shown finding has a sentence", async () => {
    const { result } = await reviewRecording(
      recorded("council-clear", withShownFinding("The note is minor.")),
    );
    expect(result.kind).toBe("reviewed");
    if (result.kind === "reviewed") expect(result.report).toContain("The note is minor.");
  });
});
