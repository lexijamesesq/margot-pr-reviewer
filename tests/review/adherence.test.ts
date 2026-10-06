import { describe, expect, it } from "vitest";
import { adherenceQuestions } from "../../src/questions.js";
import { checkText } from "../../src/render.js";
import { recorded, reviewed, reviewRecording } from "../helpers/review.js";

const flagged = {
  status: "checked" as const,
  riskClassificationOk: false,
  cardsRestating: ["safety", "house-style"],
  ok: false,
  nouls: { risk_is_classification: 0.1, distinct__safety: 0.2, "distinct__house-style": 0.3 },
};
describe("the advisory template-adherence check", () => {
  it("is skipped for a mechanical change, without asking Jev", async () => {
    const { result, calls } = await reviewed(recorded("mechanical-bump"));
    expect({ adherence: result.adherence, asked: calls.includes("adherence") }).toEqual({
      adherence: { status: "skipped" },
      asked: false,
    });
  });
  it("asks Jev about the posted risk line, summary and council findings", async () => {
    const draft = recorded("author-changes");
    (draft as { adherence?: unknown }).adherence = flagged;
    const { result, callInput } = await reviewed(draft);
    expect({ adherence: result.adherence, input: callInput("adherence") }).toEqual({
      adherence: flagged,
      input: {
        questions: adherenceQuestions(
          result.cards.filter((card) => card.findings.length > 0).map((card) => card.name),
        ),
        risk: result.voice?.risk,
        summary: result.voice?.summary,
        cards: result.cards.map((card) => ({
          name: card.name,
          findings: card.findings.map((finding) => ({ what: finding.what })),
        })),
      },
    });
  });
  it("is unchecked on a Jev outage, and leaves the review as it was", async () => {
    const baseline = await reviewed(recorded("author-changes"));
    const outage = recorded("author-changes");
    outage.failures = { ...outage.failures, adherence: "Jev unavailable (HTTP 503)" };
    const run = await reviewRecording(outage);
    expect({
      kind: run.result.kind,
      adherence: run.result.kind === "reviewed" ? run.result.adherence : null,
      decision: run.result.kind === "reviewed" ? run.result.decision : null,
    }).toEqual({
      kind: "reviewed",
      adherence: { status: "unchecked" },
      decision: baseline.result.decision,
    });
  });
  it("never changes the decision, however it answers", async () => {
    const baseline = await reviewed(recorded("council-clear"));
    const draft = recorded("council-clear");
    (draft as { adherence?: unknown }).adherence = flagged;
    const { result } = await reviewed(draft);
    expect({
      decision: result.decision,
      decisionSource: result.provenance.decision_source,
    }).toEqual({
      decision: baseline.result.decision,
      decisionSource: baseline.result.provenance.decision_source,
    });
  });
  it("renders in the check text as the previous reviewer's poster did", async () => {
    const draft = recorded("author-changes");
    (draft as { adherence?: unknown }).adherence = flagged;
    const { result } = await reviewed(draft);
    const lines = checkText(result).split("\n");
    const at = lines.indexOf("adherence: flags");
    const unchecked = checkText({ ...result, adherence: { status: "unchecked" } }).split("\n");
    expect({
      flagged: lines.slice(at - 1, at + 4),
      unchecked: unchecked.filter((line) => line.startsWith("adherence")),
      clean: checkText({
        ...result,
        adherence: { ...flagged, ok: true, riskClassificationOk: true, cardsRestating: [] },
      })
        .split("\n")
        .filter((line) => line.startsWith("adherence") || line.startsWith("  risk line")),
    }).toEqual({
      flagged: [
        `can auto-merge: ${result.decision.mergeEligible ? "True" : "False"}`,
        "adherence: flags",
        "  risk line reads as a sentence, not a classification",
        "  cards restating a shared finding: safety, house-style",
        `band_reason: ${result.decision.rating.rationale}`,
      ],
      unchecked: ["adherence: unchecked"],
      clean: ["adherence: clean"],
    });
  });
});
