import { describe, expect, it } from "vitest";
import { checkText } from "../../src/render.js";
import { core, prior } from "../helpers/ledger.js";
import { present } from "../helpers/present.js";
import { recorded, reviewed, reviewRecording } from "../helpers/review.js";

const flagged = {
  status: "checked" as const,
  riskClassificationOk: false,
  cardsRestating: ["safety", "house-style"],
  ok: false,
  nouls: { risk_is_classification: 0.1, distinct__safety: 0.2, "distinct__house-style": 0.3 },
};
describe("the advisory template-adherence check", () => {
  it("asks Jev about the posted risk line, summary and council findings", async () => {
    const draft = recorded("author-changes");
    draft.adherence = flagged;
    draft.voice.risk = "stale instructions";
    draft.voice.summary = "The guide points readers to a deleted check. Correct the guide.";
    present((present(draft.cards["principal-engineer"]).findings as { what: string }[])[0]).what =
      "The named check no longer exists.";
    present((present(draft.cards["maintainable-no-slop"]).findings as { what: string }[])[0]).what =
      "The guide gives obsolete instructions.";
    const { result, callInput } = await reviewed(draft);
    const input = callInput("adherence");
    expect(result.adherence).toEqual(flagged);
    expect(input).toMatchObject({
      risk: "stale instructions",
      summary: "The guide points readers to a deleted check. Correct the guide.",
      cards: [
        { name: "safety", findings: [] },
        { name: "works-and-proven", findings: [] },
        { name: "principal-engineer", findings: [{ what: "The named check no longer exists." }] },
        {
          name: "maintainable-no-slop",
          findings: [{ what: "The guide gives obsolete instructions." }],
        },
      ],
    });
    expect(Object.keys(input.questions as object).sort()).toEqual([
      "distinct__maintainable-no-slop",
      "distinct__principal-engineer",
      "risk_is_classification",
    ]);
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
  it("renders advisory status and flagged lenses in the check text", () => {
    const result = {
      ...core([], null),
      ledger: prior([]),
      convergence: {
        round: 1,
        standing: 0,
        fixed: 0,
        new: 0,
        late: 0,
        unconfirmed: 0,
      },
    };
    const text = checkText({ ...result, adherence: flagged });
    expect(text).toContain("adherence: flags");
    expect(text).toContain("safety, house-style");
    expect(text).toContain("risk line");
    expect(checkText({ ...result, adherence: { status: "unchecked" } })).toContain(
      "adherence: unchecked",
    );
    expect(
      checkText({
        ...result,
        adherence: { ...flagged, ok: true, riskClassificationOk: true, cardsRestating: [] },
      }),
    ).toContain("adherence: clean");
  });
});
