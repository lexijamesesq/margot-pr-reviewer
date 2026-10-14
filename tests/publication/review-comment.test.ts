import { describe, expect, it } from "vitest";
import { checkSummary, checkText, render } from "../../src/render.js";
import { authorChangesReview, mechanicalReview } from "../helpers/publication.js";

it("shows an incomplete card's completion and reason instead of clear", () => {
  const value = structuredClone(authorChangesReview);
  const card = value.cards.find((c) => c.name === "safety");
  if (!card) throw new Error("Invalid comment test source");
  card.completion = "incomplete";
  card.completionReason = "the eval fixture is in another repository; nothing else";
  const report = render(value);
  const row = report.split("\n").find((line) => line.includes("`safety`"));
  expect(row).toContain("incomplete");
  expect(row).toContain("the eval fixture is in another repository");
  expect(row).not.toContain("clear");
});
it("displays the voice's short risk statement on the risk line instead of the band rationale", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.risk = "  operator\nworkflow   disruption  ";
  value.decision.rating.rationale = "The band comes from a separate risk assessment.";
  expect(render(value).split("\n")[1]).toBe("🟡 **Risk: MEDIUM** — operator workflow disruption");
});
it("omits the explanatory suffix on the voice's own ERROR without a risk statement", () => {
  // Only an ERROR may omit the risk line; any other verdict without one is held, not posted.
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.outcome = "ERROR";
  value.decision.outcome = "ERROR";
  delete value.voice.risk;
  const body = render(value);
  expect(body).toContain("ERROR");
  expect(body).toContain("**Risk: MEDIUM**\n");
  expect(body).not.toMatch(/undefined|null/);
});
it("shows mechanical metadata without implying a council review", () => {
  const value = structuredClone(mechanicalReview);
  value.provenance.mechanicalProbability = 0.987;
  value.presentation = {
    author: "contributor",
    costUsd: 0.12,
    durationMs: 61000,
    files: 2,
    runUrl: null,
    ticket: null,
  };
  const body = render(value);
  expect(body).toContain("Mechanical change");
  expect(body).toContain("confidence");
  expect(body).toContain("2 files");
  expect(body).not.toContain("Council reviewed");
  expect(body.split("\n").filter((line) => line.startsWith("* "))).toEqual([]);
  delete value.provenance.mechanicalProbability;
  expect(render(value)).not.toContain("confidence");
});
it("tells the pull request author which decision is needed on a clarification", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice || !value.presentation) throw new Error("voice and presentation required");
  value.decision.outcome = "CLARIFICATION_REQUESTED";
  value.voice.clarification = "Should this setting apply to existing installations?";
  value.presentation.author = "contributor";
  expect(render(value)).toContain("@contributor");
  expect(render(value)).toContain(value.voice.clarification);
});
it("warns that confidence is reduced and nothing was auto-merged on a fallback-scored review", () => {
  const value = structuredClone(authorChangesReview);
  value.provenance.decision_source = "fallback";
  value.decision.holdReasons = ["fallback-risk"];
  expect(render(value)).toMatch(/risk.*fallback.*reduced confidence/i);
  expect(render(value)).toContain("nothing was auto-merged");
});
it("says only routing fell back when the risk was not scored by a fallback", () => {
  const value = structuredClone(authorChangesReview);
  value.provenance.decision_source = "fallback";
  value.decision.holdReasons = ["fallback-routing"];
  const text = render(value);
  expect({
    routing: text.includes("routing fell back to a simpler model at reduced confidence"),
    risk: text.includes("scored by a fallback"),
  }).toEqual({ routing: true, risk: false });
});
it("says both steps fell back when routing and risk both did", () => {
  const value = structuredClone(authorChangesReview);
  value.decision.holdReasons = ["fallback-routing", "fallback-risk"];
  expect(render(value)).toMatch(/routing and risk.*both.*fallback/i);
});
it("shows the generic fallback notice for a receipt saved with the legacy reason", () => {
  const value = structuredClone(authorChangesReview);
  value.decision.holdReasons = ["fallback"];
  expect(render(value)).toMatch(/model step.*unavailable.*fallback/i);
});
it("renders the first two sentences of a long rationale", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.summary = "First sentence. Second sentence. Third sentence.";
  expect({ rationale: render(value).split("\n")[2] }).toMatchObject({
    rationale: "> First sentence. Second sentence.",
  });
});
it("renders the complete first sentence without a location suffix while the check keeps full details", () => {
  const value = structuredClone(authorChangesReview);
  const finding = value.cards.flatMap((card) => card.findings)[0];
  if (!finding) throw new Error("finding fixture required");
  const first = Array.from({ length: 60 }, () => "word").join(" ");
  finding.what = `${first}. This second sentence belongs only in the check details.`;
  const report = render(value);
  const row = report.split("\n").find((line) => line.includes("`principal-engineer`"));
  const check = checkText(value);
  expect({
    row,
    fullFindingInComment: report.includes(finding.what),
    fullFindingInCheck: check.includes(`${finding.location} · ${finding.what}`),
  }).toMatchObject({
    row: `* ⚠️ \`principal-engineer\` — ${first}.`,
    fullFindingInComment: false,
    fullFindingInCheck: true,
  });
});
it("renders the verdict, risk, council roster and finding tally in the review comment", () => {
  const report = render(authorChangesReview);
  expect(report).toContain(authorChangesReview.decision.outcome);
  expect(report).toContain(`**Risk: ${authorChangesReview.decision.rating.band}**`);
  expect(report).toContain("Council reviewed");
  for (const card of authorChangesReview.cards) expect(report).toContain(`\`${card.name}\``);
  expect(report).toMatch(/Review \d+ · New: \d+ · Open: \d+ · Closed: \d+/);
  for (const field of ["**Author:**", "**Ticket:**", "**Commit:**", "**Run:**"])
    expect(report).toContain(field);
  expect(report).toContain("<!-- margot:v1 -->");
  expect(report).toMatch(/<!-- margot-ledger:v1 [A-Za-z0-9+/=]+ -->$/);
});
it("renders a shared defect once and points the second card to it", () => {
  const value = structuredClone(authorChangesReview);
  const [first, second] = value.cards.flatMap((card) => card.findings);
  if (!first || !second || !value.voice) throw new Error("two findings required");
  second.what = first.what;
  second.location = first.location;
  const report = render(value);
  const rows = report.split("\n").filter((line) => line.startsWith("* "));
  expect(rows).toContain(`* ⚠️ \`principal-engineer\` + \`maintainable-no-slop\` — ${first.what}`);
  expect(rows).toContain("* ℹ️ `maintainable-no-slop` — Same finding as `principal-engineer`.");
  expect(checkText(value)).toContain(`${first.location} · ${first.what}`);
  expect(
    report.match(new RegExp(first.what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
  ).toHaveLength(1);
});
describe("a verdict code reaches without the voice", () => {
  it("labels an editorial documentation change and records it as editorial", () => {
    const value = structuredClone(mechanicalReview);
    value.classification = "documentation";
    value.routeAnswer = structuredClone(authorChangesReview.routeAnswer);
    expect(render(value)).toContain("editorial documentation change");
    expect(render(value)).toContain("no review was required");
    expect(checkText(value)).toContain("verdict_source: documentation_editorial");
  });
  it("says no lens was required when routing selected none", () => {
    const value = structuredClone(authorChangesReview);
    value.classification = "functional";
    value.cards = [];
    value.voice = null;
    value.riskAnswer = null;
    value.decision.rating = structuredClone(mechanicalReview.decision.rating);
    expect(render(value)).toContain("No review lens was required");
    expect(render(value)).not.toContain("Reviewed against the summoned lenses");
  });
});
it("takes the first sentence of the voice's risk label for the check summary", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.risk = "unproven  behavior. Tests are missing!";
  expect(checkSummary(value)).toContain("CHANGES_REQUESTED, MEDIUM");
  expect(checkSummary(value)).toContain("unproven behavior.");
  expect(checkSummary(value)).not.toContain("Tests are missing");
  value.voice.risk = "x".repeat(2000);
  expect(checkSummary(value)).toContain("CHANGES_REQUESTED, MEDIUM: x");
  expect(Array.from(checkSummary(value)).length).toBeLessThanOrEqual(900);
});
it("includes the voice's actionable failure finding in check details when present", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.outcome = "ERROR";
  value.voice.finding = "the look at a.ts:4 failed: the file was unreadable at the head sha";
  expect(checkText(value)).toContain(value.voice.finding);
  delete value.voice.finding;
  expect(checkText(value)).not.toContain("the look at a.ts:4 failed");
});
