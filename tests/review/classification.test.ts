import { describe, expect, it } from "vitest";
import { jevAdapter } from "../../src/adapters/jev.js";
import { riskQuestions } from "../../src/questions.js";
import { checkText, render } from "../../src/render.js";
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

const pinnedClaude = {
  executable: "claude",
  version: "1.0.0",
  reviewerModel: "configured-reviewer-model",
};

const oversizedDiff =
  "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,2001 @@\n" +
  "+added\n".repeat(2001);

describe("classification precedence", () => {
  it("takes the class from a verified triage", async () => {
    for (const classification of ["functional", "documentation", "mechanical"]) {
      const { result, calls } = await reviewed(
        recorded(
          "council-clear",
          asDocumentation(1),
          withTriage({ classification }),
          withClassification(classifiedAs(1, 0, 0)),
        ),
      );
      expect(calls).not.toContain("classification");
      expect(result).toMatchObject({
        classification,
        provenance: { classification: "jev" },
      });
    }
  });

  it("rejects missing triage without asking another classifier", async () => {
    const { result, calls } = await reviewRecording(
      recorded("mechanical-bump", withoutTriage(), withClassification(classifiedAs(0, 0, 1))),
    );
    expect(calls).not.toContain("classification");
    expect(calls).not.toContain("route");
    expect(result).toMatchObject({ kind: "error", stage: "triage" });
  });
});

describe("the triage phase's class", () => {
  const triaged = async (...changes: Parameters<typeof recorded>[1][]) =>
    (
      await reviewRecording(
        recorded("mechanical-bump", withRequest({ phase: "triage" }), ...changes),
      )
    ).result;

  it("classifies as functional when functional is confident alongside other classes", async () => {
    expect(await triaged(withClassification({ functional: 1, documentation: 1 }))).toMatchObject({
      kind: "classified",
      classification: "functional",
    });
  });

  it("classifies as documentation when documentation and mechanical are both confident", async () => {
    expect(
      await triaged(withClassification({ functional: 0, documentation: 1, mechanical: 1 })),
    ).toMatchObject({ kind: "classified", classification: "documentation" });
  });

  it("classifies as functional when no class is confident", async () => {
    expect(await triaged(withClassification(classifiedAs(0.2, 0.2, 0.2)))).toMatchObject({
      kind: "classified",
      classification: "functional",
    });
  });

  it.each(["documentation"])("uses fallback probabilities for the %s lane", async (lane) => {
    expect(
      await triaged(
        withClassification({
          source: "fallback",
          functional: 0,
          documentation: 0,
          mechanical: 0,
          [lane]: 0.9,
        }),
      ),
    ).toMatchObject({ kind: "classified", classification: lane, decision_source: "fallback" });
    expect(await triaged(withClassification({ source: "unknown" }))).toMatchObject({
      kind: "error",
      stage: "classification",
      mergeEligible: false,
    });
  });
});

describe("trusted triage", () => {
  it("rejects raw classification overrides", async () => {
    const { result, calls } = await reviewRecording(
      recorded("council-clear", withRequest({ classification: "mechanical" })),
    );
    expect(result).toMatchObject({ kind: "error", stage: "input" });
    expect(calls).toEqual([]);
  });

  it.each([
    { actor: "forger" },
    { appId: 15368 },
    { checkId: 102 },
    { repository: "other/repo" },
    { pr: 999 },
    { head: "b".repeat(40) },
    { base: "b".repeat(40) },
  ])("rejects mismatched normalized triage %j without model calls", async (fields) => {
    const { result, calls } = await reviewRecording(recorded("council-clear", withTriage(fields)));
    expect(result).toMatchObject({ kind: "error", stage: "triage" });
    expect(calls).not.toContain("classification");
    expect(calls).not.toContain("route");
  });
  it.each([
    { name: "other" },
    { externalId: "foreign" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { version: 2 },
  ])("rejects malformed recorded check receipt %j", async (fields) => {
    const { result, calls } = await reviewRecording(recorded("council-clear", withTriage(fields)));
    expect(result.kind).toBe("error");
    expect(calls).not.toContain("classification");
    expect(calls).not.toContain("route");
  });
  it("requires trusted numeric App configuration", async () => {
    const { result, calls } = await reviewRecording(
      recorded("council-clear", withConfig({ trustedTriageAppId: 15368 })),
    );
    expect(result).toMatchObject({ kind: "error", stage: "triage" });
    expect(calls).not.toContain("route");
  });

  it("preserves the classifier lane for an oversized diff", async () => {
    const { result, calls } = await reviewed(
      recorded("council-clear", withTriage({}), withFacts({ diff: oversizedDiff })),
    );
    expect(calls).not.toContain("classification");
    expect(calls).not.toContain("route");
    expect(result).toMatchObject({
      classification: "mechanical",
      provenance: { classification: "jev" },
    });
  });

  it("does not add a merge hold for initial fallback classification", async () => {
    const { result } = await reviewed(
      recorded("council-clear", withTriage({ decisionSource: "fallback" })),
    );
    expect(result).toMatchObject({
      classification: "mechanical",
      decision: { mergeEligible: true },
      provenance: { classification: "fallback", decision_source: "jev" },
    });
    expect(checkText(result)).toContain("classification_source: fallback");
    expect(render(result)).not.toContain("Classification:");
  });

  it("classifies oversized triage input instead of overriding it", async () => {
    const { result, calls, callInput } = await reviewRecording(
      recorded(
        "mechanical-bump",
        withRequest({ phase: "triage" }),
        withFacts({ diff: oversizedDiff }),
      ),
    );
    expect(calls).toContain("classification");
    expect((callInput("classification").facts as { diff: string }).diff).toBe(oversizedDiff);
    expect(result).toMatchObject({
      kind: "classified",
      classification: "mechanical",
      decision_source: "jev",
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
  it.each(["documentation", "functional"])(
    "supplies the documentation question only for the %s route",
    async (classification) => {
      const { callInput } = await reviewRecording(
        recorded("council-clear", asDocumentation(1), withTriage({ classification })),
      );
      const questions = callInput("route").questions as Record<string, unknown>;
      if (classification === "documentation")
        expect(typeof questions.documentation_substantive).toBe("string");
      else expect(questions.documentation_substantive).toBeUndefined();
    },
  );
});

describe("classification provenance and availability", () => {
  const mechanical = (...changes: Parameters<typeof recorded>[1][]) =>
    recorded("mechanical-bump", ...changes);

  it.each([0.87, null])(
    "preserves verified mechanical confidence %j",
    async (mechanicalProbability) => {
      const { result } = await reviewed(
        mechanical((draft) => {
          if (mechanicalProbability !== null)
            Object.assign(draft.facts.triage as object, { mechanicalProbability });
        }),
      );
      expect(result.provenance.mechanicalProbability).toBe(mechanicalProbability);
    },
  );

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

  it("reviews a documentation change on outage routing and keeps its decision source", async () => {
    const outageRoute = {
      source: "jev_unreachable",
      documentationSubstantive: 1,
      confidence: 0,
      cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
    };
    const { result, calls } = await reviewed(
      mechanical(withClassification(classifiedAs(0, 1, 0)), (draft) => {
        Object.assign(draft.facts.triage as object, { classification: "documentation" });
        draft.route = outageRoute as Draft["route"];
        draft.cards = Object.fromEntries(
          cardNames.map((name) => [
            name,
            { name, completion: "completed", checked: [], notCovered: [], findings: [] },
          ]),
        );
      }),
    );
    expect(calls).toContain("route");
    expect({
      routeSource: result.routeAnswer?.source,
      classification: result.classification,
      cards: result.cards.map((card) => card.name),
      mergeEligible: result.decision.mergeEligible,
      holdReasons: result.decision.holdReasons,
      decisionSource: result.provenance.decision_source,
    }).toEqual({
      routeSource: "jev_unreachable",
      classification: "documentation",
      cards: Object.keys(outageRoute.cards),
      mergeEligible: true,
      holdReasons: [],
      decisionSource: "jev",
    });
  });

  it("holds approval and records fallback provenance when risk uses the fallback", async () => {
    const outage = jevAdapter({
      key: "test",
      model: "test",
      fallbackClaude: pinnedClaude,
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
    expect(result.decision.holdReasons).toContain("fallback-risk");
    expect(result.provenance.decision_source).toBe("fallback");
  });
});
