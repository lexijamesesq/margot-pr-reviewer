import { describe, expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import {
  councilClearCalls,
  recorded,
  reviewed,
  reviewRecording,
  withConfig,
  withDisableAutoMerge,
  withFacts,
  withFailure,
  withHead,
} from "../helpers/review.js";

const invalidExternalData = /"code": "invalid_(type|format)"/;

describe("disarming auto-merge", () => {
  it("disables an already armed auto-merge when the review holds", async () => {
    const { calls } = await reviewed(recorded("voice-hold"));
    expect(calls).toEqual([
      "facts",
      "classification",
      "route",
      "bundle",
      "card:safety",
      "card:works-and-proven",
      "card:principal-engineer",
      "card:maintainable-no-slop",
      "risk",
      "voice",
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
    expect(calls).toEqual([...councilClearCalls, "disableAutoMerge"]);
  });

  it.each([
    ["the string true", "true"],
    ["the number 1", 1],
    ["an object", { confirmed: true }],
  ])("rejects %s as the disarm answer for a held review", async (_label, answer) => {
    const { result, publications } = await reviewRecording(
      recorded("council-clear", withConfig({ calibration: true }), withDisableAutoMerge(answer)),
    );
    expect(result).toMatchObject({
      kind: "error",
      stage: "disable-auto-merge",
      mergeEligible: false,
    });
    expect((result as { diagnostic: string }).diagnostic).toMatch(invalidExternalData);
    expect(publications).toEqual([]);
  });

  it.each([
    ["the string true", "true"],
    ["the number 1", 1],
    ["an object", { confirmed: true }],
  ])("rejects %s as the disarm answer during error recovery", async (_label, answer) => {
    const { result, calls, publications } = await reviewRecording(
      recorded("council-clear", withFacts({ complete: false }), withDisableAutoMerge(answer)),
    );
    expect(result).toMatchObject({
      kind: "error",
      stage: "facts",
      diagnostic: "Incomplete facts; auto-merge disable failed",
      mergeEligible: false,
    });
    expect(calls).toEqual(["facts", "disableAutoMerge"]);
    expect(publications).toEqual([]);
  });

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

  it.each([
    ["a malformed SHA", "not-a-sha"],
    ["a non-string value", { sha: "0000000000000000000000000000000000000002" }],
  ])("rejects %s as the head before publication", async (_label, head) => {
    const { result, publications } = await reviewRecording(
      recorded("council-clear", withHead(head)),
    );
    expect(result).toMatchObject({
      kind: "error",
      stage: "publication-head",
      mergeEligible: false,
    });
    expect((result as { diagnostic: string }).diagnostic).toMatch(invalidExternalData);
    expect(publications).toEqual([]);
  });

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
    expect({ kind: result.kind, attempts, writes: services.publications.length }).toEqual({
      kind: "reviewed",
      attempts: 2,
      writes: 1,
    });
  });
});

describe("unreadable review history", () => {
  const heldForHistory = (request: unknown) => ({
    kind: "held",
    request,
    reason: "Review history unavailable",
    recovery:
      "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
    mergeEligible: false,
  });

  it("holds for the operator and disarms auto-merge before any model call", async () => {
    const draft = recorded(
      "mechanical-bump",
      withFacts({ history: { complete: false, priorLedger: true, reviews: [] } }),
    );
    const { result, calls, publications } = await reviewRecording(draft);
    expect(result).toEqual(heldForHistory(draft.request));
    expect(calls).toEqual(["facts", "head", "disableAutoMerge"]);
    expect(publications).toEqual([]);
  });

  it("holds a functional review even when the council would clear", async () => {
    const draft = recorded(
      "council-clear",
      withFacts({ history: { complete: false, priorLedger: false } }),
    );
    const { result, publications } = await reviewRecording(draft);
    expect(result).toEqual(heldForHistory(draft.request));
    expect(publications).toEqual([]);
  });
});
