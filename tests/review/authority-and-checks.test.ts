import { describe, expect, it } from "vitest";
import {
  asDocumentation,
  checkRun,
  recorded,
  reviewed,
  reviewRecording,
  withCheck,
  withChecks,
  withConfig,
  withFacts,
  withFiles,
} from "../helpers/review.js";

const protectGithubDirectory = withConfig({ protectedPaths: [".github/**"] });

describe("protected paths", () => {
  it("holds a functional change on a protected path for the review authority", async () => {
    const { result } = await reviewed(recorded("council-clear", protectGithubDirectory));
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["review-authority"]);
  });

  it("leaves ordinary documentation on a protected path with its author", async () => {
    const { result } = await reviewed(
      recorded("council-clear", asDocumentation(1), protectGithubDirectory),
    );
    expect(result.decision.mergeEligible).toBe(true);
    expect(result.decision.holdReasons).toEqual([]);
  });

  it("holds a file renamed away from a protected path", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        asDocumentation(1),
        protectGithubDirectory,
        withFiles({ path: "guide.md", previousPath: ".github/workflows/old.yml" }),
      ),
    );
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["review-authority"]);
  });

  it("holds a file renamed onto a protected path", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        asDocumentation(1),
        protectGithubDirectory,
        withFiles({ path: ".github/workflows/new.yml", previousPath: "guide.md" }),
      ),
    );
    expect(result.decision.mergeEligible).toBe(false);
    expect(result.decision.holdReasons).toEqual(["review-authority"]);
  });

  it("protects the sixty-first file in the listing", async () => {
    const sixtyFiles = Array.from({ length: 60 }, (_, index) => `file-${index}.ts`);
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withFiles(...sixtyFiles, "authority.ts"),
        withFacts({ fileCount: 61 }),
        withConfig({ protectedPaths: ["authority.ts"] }),
      ),
    );
    expect(result.decision.holdReasons).toEqual(["review-authority"]);
  });

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
    ["concluded neutral", withCheck({ conclusion: "neutral" })],
    ["was cancelled", withCheck({ conclusion: "cancelled" })],
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
