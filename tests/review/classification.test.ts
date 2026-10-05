import { describe, expect, it } from "vitest";
import { jevAdapter } from "../../src/adapters/jev.js";
import { riskQuestions } from "../../src/questions.js";
import { checkText } from "../../src/render.js";
import { cardNames, factsSchema } from "../../src/schemas.js";
import {
  asDocumentation,
  classifiedAs,
  type Draft,
  recorded,
  reviewed,
  reviewRecording,
  withClassification,
  withFacts,
  withRequest,
  withTriage,
} from "../helpers/review.js";

/** The question text the review sent Jev for one classification key. */
async function classificationQuestion(draft: Draft, key: string) {
  const { callInput } = await reviewRecording(draft);
  return (callInput("classification").questions as Record<string, unknown>)[key];
}

describe("classification precedence", () => {
  it("reviews as functional when functional is confident alongside other classes", async () => {
    const { result } = await reviewed(
      recorded("mechanical-bump", withClassification({ functional: 1, documentation: 1 })),
    );
    expect(result.classification).toBe("functional");
  });

  it("reviews as documentation when documentation and mechanical are both confident", async () => {
    const { result } = await reviewed(
      recorded("mechanical-bump", asDocumentation(1), withClassification({ mechanical: 1 })),
    );
    expect(result.classification).toBe("documentation");
  });

  it("reviews as functional when no class is confident", async () => {
    const { result } = await reviewed(
      recorded("council-clear", withClassification(classifiedAs(0.2, 0.2, 0.2))),
    );
    expect(result.classification).toBe("functional");
  });
});

describe("trusted triage", () => {
  it("keeps the fresh functional classification over a trusted mechanical receipt", async () => {
    const { result } = await reviewed(recorded("council-clear", withTriage({})));
    expect(result.classification).toBe("functional");
  });

  it("raises a mechanical classification when the trusted receipt says functional", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withClassification(classifiedAs(0, 0, 1)),
        withTriage({ classification: "functional" }),
      ),
    );
    expect(result.classification).toBe("functional");
  });

  it("does not lower a review on the word of an untrusted triage actor", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withTriage({ actor: "forger" }),
        withClassification(classifiedAs(0, 0, 1)),
      ),
    );
    expect(result.classification).toBe("functional");
  });

  it("does not lower a review on a triage receipt for a different head", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withTriage({ head: "b".repeat(40) }),
        withClassification(classifiedAs(0, 0, 1)),
      ),
    );
    expect(result.classification).toBe("functional");
  });

  it("binds a triage receipt to the head, not the base", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withTriage({ base: "b".repeat(40) }),
        withClassification(classifiedAs(0, 0, 1)),
      ),
    );
    expect(result.classification).toBe("mechanical");
  });

  it("classifies without publishing an approval in the triage phase", async () => {
    const { result, publications } = await reviewRecording(
      recorded("mechanical-bump", withRequest({ phase: "triage" })),
    );
    expect(result).toMatchObject({ kind: "classified", classification: "mechanical" });
    expect(publications).toEqual([]);
  });
});

describe("the classification question", () => {
  it("tells Jev to judge human formatting by behavior", async () => {
    const question = await classificationQuestion(
      recorded(
        "mechanical-bump",
        withFacts({ author: "human", diff: "Formatting only: indentation changes." }),
      ),
      "mechanical",
    );
    expect(question).toContain(
      "Judge what changed, not the author, generator, file extension, or size.",
    );
    expect(question).toContain("behavior-preserving lint/format changes.");
  });

  it("tells Jev that agent instructions are functional", async () => {
    const question = await classificationQuestion(
      recorded(
        "council-clear",
        withFacts({
          files: [{ path: "AGENTS.md" }],
          diff: "Change the agent instructions to run a different command.",
        }),
      ),
      "functional",
    );
    expect(question).toContain(
      "Text that a tool or an agent reads to change behaviour is FUNCTIONAL",
    );
    expect(question).toContain("agent or skill instructions");
  });

  it("asks Jev whether documentation changes meaning", async () => {
    const { callInput } = await reviewRecording(
      recorded("council-clear", withClassification(classifiedAs(0, 1, 0))),
    );
    const questions = callInput("route").questions as Record<string, unknown>;
    expect(typeof questions.documentationSubstantive).toBe("string");
  });

  it("omits the documentation meaning question when routing a functional change", async () => {
    const { callInput } = await reviewRecording(recorded("council-clear"));
    const questions = callInput("route").questions as Record<string, unknown>;
    expect(questions.documentationSubstantive).toBeUndefined();
  });
});

describe("classification provenance and availability", () => {
  const mechanical = (...changes: Parameters<typeof recorded>[1][]) =>
    recorded("mechanical-bump", ...changes);

  it("carries measured mechanical confidence into the comment and saved result", async () => {
    const { result } = await reviewed(
      mechanical(withClassification({ functional: 0, documentation: 0, mechanical: 0.87 })),
    );
    expect(result).toMatchObject({
      provenance: { mechanicalProbability: 0.87 },
      ledger: { receipt: { review: { provenance: { mechanicalProbability: 0.87 } } } },
      report: expect.stringContaining("Mechanical change (confidence 87%)"),
    });
  });

  it("uses the requested functional classification", async () => {
    const { result } = await reviewed(mechanical(withRequest({ classification: "functional" })));
    expect(result).toMatchObject({
      classification: "functional",
      provenance: { classification: "dispatch" },
    });
  });

  it("reviews as functional when trusted triage is unavailable", async () => {
    const { result } = await reviewed(mechanical(withFacts({ triage: null })));
    expect(result).toMatchObject({
      classification: "functional",
      provenance: { classification: "triage_unavailable" },
    });
  });

  it("reviews as functional when the requested classification is invalid", async () => {
    const { result } = await reviewed(mechanical(withRequest({ classification: "garbage" })));
    expect(result.classification).toBe("functional");
  });

  it("allows a clear documentation review after conservative outage routing", async () => {
    const outageRoute = {
      source: "jev_unreachable",
      documentationSubstantive: 1,
      confidence: 0,
      cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
    };
    const { result } = await reviewed(
      mechanical(withClassification(classifiedAs(0, 1, 0)), (draft) => {
        draft.route = outageRoute as Draft["route"];
        draft.cards = Object.fromEntries(
          cardNames.map((name) => [
            name,
            { name, completion: "completed", checked: [], notCovered: [], findings: [] },
          ]),
        );
      }),
    );
    expect(result.decision.mergeEligible).toBe(true);
    expect(result.provenance.decision_source).toBe("jev");
  });

  it("holds approval and records fallback provenance when risk uses the fallback", async () => {
    const outage = jevAdapter({
      key: "test",
      model: "test",
      retries: 0,
      fetch: async () => new Response("{}", { status: 503 }),
      fallback: async (questions) =>
        Object.fromEntries(
          Object.keys(questions).map((key) => [
            key,
            { type: "score", confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
          ]),
        ),
    });
    const draft = recorded("council-clear");
    const fallbackRisk = await outage.risk(factsSchema.parse(draft.facts), [], riskQuestions, {
      signal: AbortSignal.timeout(3000),
    });
    draft.risk = fallbackRisk as Draft["risk"];
    const { result } = await reviewed(draft);
    expect(result.decision.mergeEligible).toBe(false);
    expect(checkText(result)).toContain("decision_source: fallback");
  });
});
