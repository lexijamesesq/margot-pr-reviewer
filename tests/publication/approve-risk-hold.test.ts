import { describe, expect, it } from "vitest";
import { runPublication } from "../helpers/publication.js";

// With `approveRiskHold` on, a review held for risk alone posts a real approval so the required review is
// met on a pull request its author cannot approve. Everything else about the hold is unchanged: the check
// stays neutral and "held for the operator", and auto-merge is disarmed. With the option off (the
// default) a risk hold still posts a comment; holds-and-auto-merge.test.ts covers that.
const on = { publisher: { approveRiskHold: true } };
const event = (run: Awaited<ReturnType<typeof runPublication>>) =>
  run.writes.find((w) => w.path.endsWith("/reviews"))?.body.event;

it("posts an approval on a risk-only hold, disarms auto-merge first, and keeps the check neutral and held", async () => {
  const run = await runPublication("hold", "voice", ["risk"], undefined, undefined, on);
  const review = run.writes.findIndex((w) => w.path.endsWith("/reviews"));
  const disarm = run.writes.findIndex((w) => w.path === "/graphql");
  expect({
    event: event(run),
    disarmedBeforeApproval: disarm >= 0 && disarm < review,
    armed: run.armed,
    conclusion: run.final?.conclusion,
    title: ((run.final?.output ?? {}) as { title?: string }).title,
  }).toMatchObject({
    event: "APPROVE",
    disarmedBeforeApproval: true,
    armed: false,
    conclusion: "neutral",
    title: expect.stringMatching(/held for the operator/i),
  });
});
it("does not let an armed PR merge on the approval", async () => {
  const run = await runPublication("hold", "voice", ["risk"], undefined, undefined, {
    ...on,
    autoMergeOnApprove: true,
  });
  expect({ merged: run.merged, approved: event(run) === "APPROVE", kind: run.result.kind }).toEqual(
    {
      merged: false,
      approved: true,
      kind: "reviewed",
    },
  );
});
it("posts no approval when the disarm cannot be confirmed", async () => {
  const run = await runPublication("disarm-fail", "voice", undefined, undefined, undefined, on);
  expect({ reviewsPosted: run.writes.filter((w) => w.path.endsWith("/reviews")).length }).toEqual({
    reviewsPosted: 0,
  });
});
describe("every other hold still posts a comment", () => {
  const others = [
    ["calibration"],
    ["ownership-uncomputed"],
    ["error"],
    ["author-action"],
    ["fallback-routing"],
    ["fallback-risk"],
    ["risk", "calibration"],
  ];
  for (const reasons of others)
    it(`holds ${reasons.join(" + ")} as a comment even with the option on`, async () => {
      const run = await runPublication("hold", "voice", reasons, undefined, undefined, on);
      expect(event(run)).toBe("COMMENT");
    });
});
