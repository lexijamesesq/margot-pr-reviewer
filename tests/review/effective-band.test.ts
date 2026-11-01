import { describe, expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { bandBlock, ledgerBlock } from "../../src/ledger.js";
import { effectiveBand } from "../../src/policy.js";
import { checkText, render } from "../../src/render.js";
import { review } from "../../src/review.js";
import type { Review } from "../../src/types.js";
import { margotRecording, posted, prior } from "../helpers/ledger.js";

// A later round reviews only the changes since the last reviewed head, so its band describes
// that delta. Found on lexijamesesq/eve-plus#132: round 2 was APPROVED and HIGH, a comment-only
// commit made round 3 APPROVED and LOW, and the LOW made the PR auto-mergeable.

/** A clean round reviewed after a prior round posted `body`, which ends with its ledger. */
async function roundAfter(body: (ledger: string) => string): Promise<Review> {
  const r = margotRecording("mechanical");
  const ledger = prior([], 2);
  r.facts = {
    ...(r.facts as object),
    history: {
      complete: true,
      priorLedger: true,
      reviews: [posted(ledger, "reviewer[bot]", body(ledgerBlock(ledger)))],
    },
  };
  const result = await review(r.request as never, r.config as never, recordedServices(r));
  if (result.kind !== "reviewed") throw new Error(`not reviewed: ${result.kind}`);
  return result;
}

describe("effective band", () => {
  it("is the highest band any round gave, never the latest round's alone", () => {
    expect(effectiveBand({ band: "HIGH", round: 2 }, "LOW", 3)).toEqual({ band: "HIGH", round: 2 });
    expect(effectiveBand({ band: "MEDIUM", round: 1 }, "HIGH", 2)).toEqual({
      band: "HIGH",
      round: 2,
    });
    expect(effectiveBand(null, "LOW", 1)).toEqual({ band: "LOW", round: 1 });
  });

  it("holds a LOW round after a HIGH one for the operator, and says both bands", async () => {
    const control = await roundAfter((ledger) => `review\n${ledger}`);
    expect(control.decision.mergeEligible).toBe(true);

    const held = await roundAfter(
      (ledger) => `review\n${bandBlock({ band: "HIGH", round: 2 })}\n${ledger}`,
    );
    expect(held.decision).toMatchObject({
      outcome: "APPROVED",
      mergeEligible: false,
      rating: { band: "LOW" },
    });
    expect(held.decision.holdReasons).toContain("peak-risk");
    expect(held.effective).toEqual({ band: "HIGH", round: 2 });
    const text = checkText(held);
    expect(text).toContain("band: HIGH");
    expect(text).toContain("delta_band: LOW");
    const body = render(held);
    expect(body).toContain("**Risk: LOW**");
    expect(body).toContain("**Effective for merge: HIGH**");
    expect(body).toContain("Above my authority: round 2 banded it HIGH. Yours to merge.");
    // The next round reads the effective band back from this one.
    expect(body).toMatch(/<!-- margot-band:v1 [A-Za-z0-9+/=]+ -->\n<!-- margot-ledger:v1 /);
  });

  it("reads the band from a review posted before the marker existed: eve-plus#132's round 2", async () => {
    // The opening of round 2's verdict on eve-plus#132 as posted by 0.12.3, which carried no
    // band marker; its risk line is that round's band.
    const round2 = [
      "### ✅ APPROVED",
      "🔴 **Risk: HIGH** — release that's hard to take back",
      "> This adds a new, separate package that gives an agent a second memory for its current to-dos, follow-ups and holds, and shows them at the start of every turn.",
      "",
      "Above my authority: risk is HIGH. Yours to merge.",
    ].join("\n");
    const held = await roundAfter((ledger) => `${round2}\n${ledger}`);
    expect(held.decision.mergeEligible).toBe(false);
    expect(held.effective).toEqual({ band: "HIGH", round: 2 });
  });
});
