import { describe, expect, it } from "vitest";
import { councilClearCards, recorded, reviewed, reviewRecording } from "../helpers/review.js";

describe("reviews replayed from recordings", () => {
  it("records the route answer Jev returned for a functional change", async () => {
    const draft = recorded("council-clear");
    const { result } = await reviewed(draft);
    expect(result.routeAnswer).toEqual(draft.route);
    expect(result.riskAnswer).toEqual(draft.risk);
  });

  it("spends no Claude on a mechanical bump", async () => {
    const { result, calls } = await reviewed(recorded("mechanical-bump"));
    expect(result.cards).toEqual([]);
    expect(result.voice).toBeNull();
    expect(result.routeAnswer).toBeNull();
    expect(result.riskAnswer).toBeNull();
    expect(result.adherence).toEqual({ status: "skipped" });
    expect(calls).toEqual(["facts", "head", "publish"]);
  });

  it("publishes once when the council clears the change", async () => {
    const { result, publications } = await reviewed(recorded("council-clear"));
    expect(result.decision.mergeEligible).toBe(true);
    expect(publications).toHaveLength(1);
  });

  it("runs the lenses the route selected, each by name through the pinned reviewer", async () => {
    const draft = recorded("council-clear");
    const { callInput } = await reviewed(draft);
    const inputs = councilClearCards.map((name) => callInput(`card:${name}`));
    expect(inputs.map(({ name, agent }) => ({ name, agent }))).toEqual(
      councilClearCards.map((name) => ({ name, agent: draft.bundle.reviewerAgent })),
    );
  });

  it("refuses to approve when the voice's accounting is malformed", async () => {
    const { result, publications } = await reviewRecording(recorded("invalid-accounting"));
    expect(result).toMatchObject({ kind: "error", stage: "voice" });
    expect(publications).toEqual([]);
  });

  it("approves a second round that fixes both earlier minor findings", async () => {
    const { result } = await reviewed(recorded("prior-ledger"));
    expect(result.decision.outcome).toBe("APPROVED");
    expect(result.convergence).toMatchObject({ round: 2, standing: 0, fixed: 2, new: 0, late: 0 });
    expect(result.ledger.entries.filter((entry) => entry.status === "fixed")).toHaveLength(2);
    expect(result.ledger.entries.filter((entry) => entry.status === "standing")).toEqual([]);
  });

  it("ignores only the uncertain dimensions when no council runs", async () => {
    const { result } = await reviewed(recorded("no-council-floor"));
    expect(result.decision.rating.band).toBe("LOW");
    expect(result.voice).toBeNull();
    expect(result.decision.rating.ignoredDimensions).toEqual(["verification_gap"]);
  });

  it("publishes exactly the rendered governing result", async () => {
    const { result, publications } = await reviewed(recorded("author-changes"));
    expect(result.decision).toMatchObject({ outcome: "CHANGES_REQUESTED", mergeEligible: false });
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({
      expectedHead: result.request.head,
      report: result.report,
      review: { decision: result.decision, cards: result.cards },
    });
  });
});
