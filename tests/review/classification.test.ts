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
  withConfig,
  withFacts,
  withoutTriage,
  withRequest,
  withTriage,
} from "../helpers/review.js";

/** The question text the review sent Jev for one classification key. */
async function classificationQuestion(draft: Draft, key: string) {
  const { callInput } = await reviewRecording(draft);
  return (callInput("classification").questions as Record<string, unknown>)[key];
}

describe("classification precedence", () => {
  it("takes the class from a verified triage", async () => {
    for (const classification of ["functional", "documentation", "mechanical"]) {
      const { result } = await reviewed(
        recorded("council-clear", asDocumentation(1), withTriage({ classification })),
      );
      expect(result).toMatchObject({
        classification,
        provenance: { classification: "jev" },
      });
    }
  });

  it("reviews as functional without asking when there is no verified triage", async () => {
    const { result, calls } = await reviewed(
      recorded("mechanical-bump", withoutTriage(), withClassification(classifiedAs(0, 0, 1))),
    );
    expect(calls).not.toContain("classification");
    expect(result).toMatchObject({
      classification: "functional",
      provenance: { classification: "triage_unavailable" },
    });
  });
});

describe("trusted triage", () => {
  it("does not ask Jev to classify again when the triage is verified", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({ classification: "functional" })),
    );
    expect(calls).not.toContain("classification");
    expect(result.classification).toBe("functional");
  });

  it("uses a verified mechanical triage without asking Jev, even if Jev would say functional", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({}), withClassification(classifiedAs(1, 0, 0))),
    );
    expect(calls).not.toContain("classification");
    expect(result).toMatchObject({
      classification: "mechanical",
      provenance: { classification: "jev" },
    });
  });

  it("keeps the dispatcher's stricter class over a verified mechanical triage", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({}), withRequest({ classification: "functional" })),
    );
    expect(calls).not.toContain("classification");
    expect(result).toMatchObject({
      classification: "functional",
      provenance: { classification: "dispatch" },
    });
  });

  it("reviews as functional without asking when the triage actor is untrusted", async () => {
    const { result, calls } = await reviewed(
      recorded(
        "council-clear",
        withTriage({ actor: "forger" }),
        withClassification(classifiedAs(0, 0, 1)),
      ),
    );
    expect(calls).not.toContain("classification");
    expect(result.classification).toBe("functional");
  });

  it("reviews as functional without asking when the triage is for a different head", async () => {
    const { result, calls } = await reviewed(
      recorded(
        "council-clear",
        withTriage({ head: "b".repeat(40) }),
        withClassification(classifiedAs(0, 0, 1)),
      ),
    );
    expect(calls).not.toContain("classification");
    expect(result.classification).toBe("functional");
  });

  it("binds a triage receipt to the head, not the base", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({ base: "b".repeat(40) })),
    );
    expect(calls).not.toContain("classification");
    expect(result.classification).toBe("mechanical");
  });

  it("reviews an oversized diff as functional without asking, even with a verified triage", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({}), withConfig({ mechanicalDiffLineCap: 1 })),
    );
    expect(calls).not.toContain("classification");
    expect(result).toMatchObject({
      classification: "functional",
      provenance: { classification: "diff_too_large" },
    });
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
        withRequest({ phase: "triage" }),
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
        withRequest({ phase: "triage" }),
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
    const { callInput } = await reviewRecording(recorded("council-clear", asDocumentation(1)));
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

  it("renders the measured confidence the verified triage carried", async () => {
    const { result } = await reviewed(
      mechanical((draft) => {
        Object.assign(draft.facts.triage as object, { mechanicalProbability: 0.87 });
      }),
    );
    expect(result).toMatchObject({
      provenance: { mechanicalProbability: 0.87 },
      report: expect.stringContaining("Mechanical change (confidence 87%)"),
    });
  });

  it("omits the confidence when the verified triage carries none", async () => {
    const { result } = await reviewed(mechanical());
    expect(result).toMatchObject({
      provenance: { mechanicalProbability: null },
      report: expect.stringContaining("Mechanical change"),
    });
    expect(result.report).not.toContain("confidence");
  });

  it("hands the triage's confidence to the triage check in the triage phase", async () => {
    const { result } = await reviewRecording(
      recorded(
        "mechanical-bump",
        withRequest({ phase: "triage" }),
        withClassification({ functional: 0, documentation: 0, mechanical: 0.87 }),
      ),
    );
    expect(result).toMatchObject({ kind: "classified", mechanical_probability: 0.87 });
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
