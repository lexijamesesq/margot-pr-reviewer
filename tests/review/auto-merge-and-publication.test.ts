import { describe, expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import {
  recorded,
  reviewed,
  reviewRecording,
  withConfig,
  withDisableAutoMerge,
  withFacts,
  withFailure,
  withHead,
} from "../helpers/review.js";

describe("disarming auto-merge", () => {
  it("disables an already armed auto-merge when the review holds", async () => {
    const { calls } = await reviewed(recorded("voice-hold"));
    expect(calls.filter((call) => ["head", "disableAutoMerge", "publish"].includes(call))).toEqual([
      "head",
      "disableAutoMerge",
      "publish",
    ]);
  });

  it("fails closed when the disarm is not confirmed", async () => {
    const { result } = await reviewRecording(recorded("voice-hold", withDisableAutoMerge(false)));
    expect(result).toMatchObject({ kind: "error", stage: "disable-auto-merge" });
  });

  it("attempts to disarm auto-merge on the error path", async () => {
    const { calls } = await reviewRecording(
      recorded("council-clear", withFailure("risk", "unavailable")),
    );
    expect(
      calls.filter((call) =>
        ["risk", "voice", "adherence", "disableAutoMerge", "publish"].includes(call),
      ),
    ).toEqual(["risk", "disableAutoMerge"]);
  });

  it.each([["the string true", "true"]])(
    "rejects %s as the disarm answer for a held review",
    async (_label, answer) => {
      const { result, publications } = await reviewRecording(
        recorded("council-clear", withConfig({ calibration: true }), withDisableAutoMerge(answer)),
      );
      expect(result).toMatchObject({
        kind: "error",
        stage: "disable-auto-merge",
        mergeEligible: false,
      });
      expect(publications).toEqual([]);
    },
  );

  it.each([["the string true", "true"]])(
    "rejects %s as the disarm answer during error recovery",
    async (_label, answer) => {
      const { result, calls, publications } = await reviewRecording(
        recorded("council-clear", withFacts({ complete: false }), withDisableAutoMerge(answer)),
      );
      expect(result).toMatchObject({
        kind: "error",
        stage: "facts",
        diagnostic: expect.stringContaining("auto-merge disable failed"),
        mergeEligible: false,
      });
      expect(calls).toEqual(["facts", "disableAutoMerge"]);
      expect(publications).toEqual([]);
    },
  );

  it("reports an unconfirmed boolean disarm during error recovery", async () => {
    const { result, publications } = await reviewRecording(
      recorded("council-clear", withFacts({ complete: false }), withDisableAutoMerge(false)),
    );
    expect(result).toMatchObject({
      kind: "error",
      stage: "facts",
      diagnostic: "Incomplete facts; auto-merge disable not confirmed",
      mergeEligible: false,
    });
    expect(publications).toEqual([]);
  });
});

describe("publication", () => {
  it("writes nothing when publication is none", async () => {
    const { result, publications } = await reviewed(
      recorded("mechanical-bump", withConfig({ publication: "none" })),
    );
    expect(publications).toEqual([]);
    expect(result.publication).toBeNull();
  });

  it.each([["a malformed SHA", "not-a-sha"]])(
    "rejects %s as the head before publication",
    async (_label, head) => {
      const { result, publications } = await reviewRecording(
        recorded("council-clear", withHead(head)),
      );
      expect(result).toMatchObject({
        kind: "error",
        stage: "publication-head",
        mergeEligible: false,
      });
      expect(publications).toEqual([]);
    },
  );

  it("refuses to approve a moved head when publication is disabled", async () => {
    const { result } = await reviewRecording(
      recorded("mechanical-bump", withConfig({ publication: "none" }), withHead("f".repeat(40))),
    );
    expect(result).toMatchObject({ kind: "error", mergeEligible: false });
  });

  it("publishes the review even when progress updates fail", async () => {
    const draft = recorded("mechanical-bump");
    const services = recordedServices(draft);
    let attempts = 0;
    const result = await review(draft.request, draft.config, {
      ...services,
      progress: async () => {
        attempts++;
        throw new Error("phase unavailable");
      },
    });
    expect(attempts).toBeGreaterThan(0);
    expect(result.kind).toBe("reviewed");
    expect(services.publications).toHaveLength(1);
  });
});

describe("unreadable review history", () => {
  it("holds for the operator and disarms auto-merge before any model call", async () => {
    const draft = recorded(
      "mechanical-bump",
      withFacts({ history: { complete: false, priorLedger: true, reviews: [] } }),
    );
    const { result, calls, publications } = await reviewRecording(draft);
    expect(result).toMatchObject({
      kind: "held",
      reason: "Review history unavailable",
      mergeEligible: false,
    });
    expect(result).not.toHaveProperty("decision");
    expect(result).not.toHaveProperty("voice");
    expect(calls).toEqual(["facts", "head", "disableAutoMerge"]);
    expect(publications).toEqual([]);
  });
});
