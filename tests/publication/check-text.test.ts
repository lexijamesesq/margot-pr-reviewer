import { describe, expect, it } from "vitest";
import { capCheckText } from "../../src/adapters/publish.js";
import { checkText } from "../../src/render.js";
import { authorChangesReview } from "../helpers/publication.js";

it("keeps machine fields first and full finding detail in the review check text", () => {
  const text = checkText(authorChangesReview);
  expect(text).toContain("outcome: CHANGES_REQUESTED | band: MEDIUM");
  expect(text).toContain("decision_source: jev");
  expect(text).toContain("verdict_source: verdict_voice");
  expect(text).toContain("finding details:");
  expect(text).toContain("GUIDE.md:40");
  const details = text.indexOf("finding details:");
  for (const field of ["outcome:", "decision_source:", "verdict_source:"])
    expect(text.indexOf(field)).toBeLessThan(details);
});
describe("check text limits", () => {
  it("caps check text by Unicode characters while preserving machine fields", () => {
    const text = `outcome: APPROVED | band: LOW\ndecision_source: fallback\n${"🦉".repeat(61000)}`;
    const capped = capCheckText(text);
    expect({
      withinLimit: Array.from(capped).length <= 60000,
      top: capped.startsWith("outcome: APPROVED | band: LOW\ndecision_source: fallback\n"),
      note: capped.endsWith("[Margot: check text truncated]"),
      validUnicode: !Array.from(capped).some((character) => /^[\uD800-\uDFFF]$/u.test(character)),
    }).toMatchObject({ withinLimit: true, top: true, note: true, validUnicode: true });
  });
});
