import { describe, expect, it } from "vitest";
import { capCheckText } from "../../src/adapters/publish.js";
import { checkText } from "../../src/render.js";
import { authorChangesReview } from "../helpers/publication.js";

it("preserves convergence as machine-readable JSON in the check text", () => {
  const value = structuredClone(authorChangesReview);
  value.convergence.round = 3;
  expect(
    checkText(value)
      .split("\n")
      .find((line) => line.startsWith("convergence: ")),
  ).toBe(`convergence: ${JSON.stringify(value.convergence)}`);
});
it("names cards summoned by the prior ledger in the check text", () => {
  const value = structuredClone(authorChangesReview);
  value.provenance.summonedByLedger = ["safety", "principal-engineer"];
  expect(checkText(value)).toContain("summoned by ledger: safety, principal-engineer");
});
it("keeps machine fields first and full finding detail in the review check text", () => {
  const text = checkText(authorChangesReview);
  expect(text.split("\n").slice(0, 3)).toEqual([
    "outcome: CHANGES_REQUESTED | band: MEDIUM",
    "decision_source: jev",
    "verdict_source: verdict_voice",
  ]);
  expect(text).toContain("finding details:");
  expect(text).toContain("GUIDE.md:40");
});
describe("check text limits", () => {
  it("caps check text by Unicode characters while preserving machine fields", () => {
    const text = `outcome: APPROVED | band: LOW\ndecision_source: fallback\n${"🦉".repeat(61000)}`;
    const capped = capCheckText(text);
    expect({
      length: Array.from(capped).length,
      top: capped.startsWith("outcome: APPROVED | band: LOW\ndecision_source: fallback\n"),
      note: capped.endsWith("[Margot: check text truncated]"),
    }).toMatchObject({ length: 60000, top: true, note: true });
  });
});
