import { describe, expect, it } from "vitest";
import { councilClearCards, recorded, reviewed, reviewRecording } from "../helpers/review.js";

describe("reviews replayed from recordings", () => {
  it("records the route answer Jev returned for a functional change", async () => {
    const draft = recorded("council-clear");
    const { result } = await reviewed(draft);
    expect(result.routeAnswer).toEqual(draft.route);
  });

  it("records the risk answer Jev returned for a functional change", async () => {
    const draft = recorded("council-clear");
    const { result } = await reviewed(draft);
    expect(result.riskAnswer).toEqual(draft.risk);
  });

  it("records null Jev answers for a mechanical change because no question was asked", async () => {
    const { result } = await reviewed(recorded("mechanical-bump"));
    expect(result.routeAnswer).toBeNull();
    expect(result.riskAnswer).toBeNull();
  });

  it("spends no Claude on a mechanical bump", async () => {
    const { result, calls } = await reviewed(recorded("mechanical-bump"));
    expect(result.cards).toEqual([]);
    expect(result.voice).toBeNull();
    expect(calls).toEqual(["facts", "head", "publish"]);
  });

  it("publishes once when the council clears the change", async () => {
    const { result, publications } = await reviewed(recorded("council-clear"));
    expect(result.decision.mergeEligible).toBe(true);
    expect(publications).toHaveLength(1);
  });

  it("runs the lenses the route selected, each from its explicit card path", async () => {
    const { callInput } = await reviewed(recorded("council-clear"));
    const cardPaths = councilClearCards.map((name) => callInput(`card:${name}`).cardPath);
    expect(cardPaths).toEqual(
      councilClearCards.map((name) => `/recorded-bundle/skills/pr-council/playbooks/${name}.md`),
    );
  });

  it("holds for the operator at the band the voice displayed", async () => {
    const { result } = await reviewed(recorded("voice-hold"));
    expect(result.decision.rating.band).toBe("MEDIUM");
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["risk"]);
  });

  it("refuses to approve when the voice's accounting is malformed", async () => {
    const { result, publications } = await reviewRecording(recorded("invalid-accounting"));
    expect(result).toMatchObject({ kind: "error", stage: "voice" });
    expect(publications).toEqual([]);
  });

  it("requests changes without merge eligibility when the author's findings stand", async () => {
    const { result } = await reviewed(recorded("author-changes"));
    expect(result.decision.outcome).toBe("CHANGES_REQUESTED");
    expect(result.decision.mergeEligible).toBe(false);
  });

  it("approves a second round that fixes both earlier minor findings", async () => {
    const { result } = await reviewed(recorded("prior-ledger"));
    expect(result.decision.outcome).toBe("APPROVED");
    expect(result.convergence).toMatchObject({ round: 2, standing: 0, fixed: 2, new: 0, late: 0 });
  });

  it("ignores only the uncertain dimensions when no council runs", async () => {
    const { result } = await reviewed(recorded("no-council-floor"));
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.voice).toBeNull();
    expect(result.decision.rating.ignoredDimensions).toEqual(["verification_gap"]);
  });

  it("publishes exactly the rendered governing result", async () => {
    const { result, publications } = await reviewed(recorded("author-changes"));
    expect(publications).toEqual([
      {
        expectedHead: result.request.head,
        review: {
          request: result.request,
          classification: result.classification,
          routeAnswer: result.routeAnswer,
          riskAnswer: result.riskAnswer,
          cards: result.cards,
          voice: result.voice,
          decision: result.decision,
          provenance: result.provenance,
          ledger: result.ledger,
          convergence: result.convergence,
          presentation: result.presentation,
        },
        report: result.report,
      },
    ]);
  });
});
