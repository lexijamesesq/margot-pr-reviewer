import { describe, expect, it } from "vitest";
import {
  checkRun,
  recorded,
  reviewed,
  reviewRecording,
  withCheck,
  withChecks,
  withConfig,
} from "../helpers/review.js";

describe("calibration", () => {
  it("never clears a calibration run", async () => {
    const { result } = await reviewed(
      recorded("mechanical-bump", withConfig({ calibration: true })),
    );
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["calibration"]);
  });
});

describe("required checks", () => {
  it.each([
    ["is missing", withChecks()],
    ["comes from an actor that is not trusted", withCheck({ actor: "forger" })],
    ["uses an untrusted App ID despite the trusted actor", withCheck({ appId: 15368 })],
    ["ran against a stale head", withCheck({ head: "b".repeat(40) })],
    ["did not succeed", withCheck({ conclusion: "failure" })],
    [
      "has a newer queued run with no start time after an older success",
      withChecks(checkRun("success", 1, "2026-10-01T21:35:42Z"), {
        ...checkRun("pending", 2, ""),
        startedAt: undefined,
      }),
    ],
  ])("errors at the checks stage when the required check %s", async (_cause, change) => {
    const { result } = await reviewRecording(
      recorded("council-clear", withConfig({ requiredCheckReporters: { ci: 42 } }), change),
    );
    expect(result).toMatchObject({ kind: "error", stage: "checks", mergeEligible: false });
  });

  it("ignores a superseded failing run when the current run of the check succeeded", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withChecks(
          checkRun("failure", 1, "2026-10-01T21:35:42Z"),
          checkRun("success", 2, "2026-10-01T21:36:01Z"),
        ),
      ),
    );
    expect(result.decision.mergeEligible).toBe(true);
  });

  it("errors at the checks stage when the current run failed although an older run succeeded", async () => {
    const { result } = await reviewRecording(
      recorded(
        "council-clear",
        withChecks(
          checkRun("success", 1, "2026-10-01T21:35:42Z"),
          checkRun("failure", 2, "2026-10-01T21:36:01Z"),
        ),
      ),
    );
    expect(result).toMatchObject({ kind: "error", stage: "checks", mergeEligible: false });
  });
});
