import { expect, it, vi } from "vitest";
import { recorded, reviewRecording } from "../helpers/review.js";

vi.mock("../../src/ledger.js", async (original) => ({
  ...(await original<typeof import("../../src/ledger.js")>()),
  nextLedger: () => {
    throw new Error("Approval contradicts standing ledger");
  },
}));

// The template gate's stage covers only the gate: a ledger failure after it keeps the
// stage it ran under, so it is never reported as a template-gate poster error.
it("does not report a ledger failure at the template-gate stage", async () => {
  const { result } = await reviewRecording(recorded("council-clear"));
  expect(result).toMatchObject({ kind: "error", mergeEligible: false });
  expect((result as { stage: string }).stage).not.toBe("template-gate");
});
