import { describe, expect, it } from "vitest";
import { render, renderCheckText } from "../../src/render.js";
import { present } from "../helpers/present.js";
import { authorChangesReview, mechanicalReview } from "../helpers/publication.js";

it("shows an incomplete card's completion and reason instead of clear", () => {
  const value = structuredClone(authorChangesReview);
  const card = value.cards.find((c) => c.name === "safety");
  if (!card) throw new Error("Invalid comment test source");
  card.completion = "incomplete";
  card.completionReason = "the eval fixture is in another repository; nothing else";
  const report = render(value);
  expect({
    row: report.split("\n").find((line) => line.includes("`safety`")),
  }).toMatchObject({
    row: "* ⏳ `safety` — incomplete: the eval fixture is in another repository",
  });
});
it("displays the voice's short risk statement on the risk line instead of the band rationale", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.risk = "  operator\nworkflow   disruption  ";
  value.decision.rating.rationale = "The band comes from a separate risk assessment.";
  expect(render(value).split("\n")[1]).toBe("🟡 **Risk: MEDIUM** — operator workflow disruption");
});
it("omits the explanatory suffix when the voice gives no risk statement", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  delete value.voice.risk;
  expect(render(value).split("\n")[1]).toBe("🟡 **Risk: MEDIUM**");
});
it("posts confidence, files, cost and runtime without a council roster on a mechanical review", () => {
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
  expect(body).toContain("Mechanical change (confidence 99%) • 2 files • $0.12 • 1m 1s");
  expect(body).not.toContain("Council reviewed");
  expect(body.split("\n").filter((line) => line.startsWith("* "))).toEqual([]);
});
it("omits the confidence annotation when a mechanical review has no probability", () => {
  const value = structuredClone(mechanicalReview);
  delete value.provenance.mechanicalProbability;
  expect(render(value)).toContain("Mechanical change • ");
  expect(render(value)).not.toContain("confidence");
});
it("tells the pull request author which decision is needed on a clarification", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice || !value.presentation) throw new Error("voice and presentation required");
  value.decision.outcome = "CLARIFICATION_REQUESTED";
  value.voice.clarification = "Should this setting apply to existing installations?";
  value.presentation.author = "contributor";
  expect(render(value)).toContain(
    "@contributor, your call: Should this setting apply to existing installations?",
  );
});
it("warns that confidence is reduced and nothing was auto-merged on a fallback-scored review", () => {
  const value = structuredClone(authorChangesReview);
  value.provenance.decision_source = "fallback";
  expect(render(value)).toContain(
    "> ⚠️ _The risk model was unavailable — this risk was scored by a fallback at reduced confidence, so nothing was auto-merged._",
  );
});
it("renders the first two sentences of a long rationale", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.summary = "First sentence. Second sentence. Third sentence.";
  expect({ rationale: render(value).split("\n")[2] }).toMatchObject({
    rationale: "> First sentence. Second sentence.",
  });
});
it("renders bounded prose for a long finding while the check keeps its full text", () => {
  const value = structuredClone(authorChangesReview);
  const finding = value.cards.flatMap((card) => card.findings)[0];
  if (!finding) throw new Error("finding fixture required");
  const first = Array.from({ length: 60 }, () => "word").join(" ");
  finding.what = `${first}. This second sentence belongs only in the check details.`;
  const report = render(value);
  const row = report.split("\n").find((line) => line.includes("`principal-engineer`"));
  const check = renderCheckText(value);
  expect({
    row,
    fullFindingInComment: report.includes(finding.what),
    fullFindingInCheck: check.includes(finding.what),
  }).toMatchObject({
    row: `* ⚠️ \`principal-engineer\` — ${Array.from({ length: 32 }, () => "word").join(" ")}… \`GUIDE.md:40\``,
    fullFindingInComment: false,
    fullFindingInCheck: true,
  });
});
it("renders the first clause of a multi-clause skip reason", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.presentation) throw new Error("presentation fixture required");
  value.presentation.skipReasons = {
    "house-style": "not selected; another reviewer covered it — no additional pass needed.",
  };
  expect({
    row: render(value)
      .split("\n")
      .find((line) => line.includes("`house-style`")),
  }).toMatchObject({ row: "* ❓ `house-style` — skipped: not selected" });
});
it("renders the verdict, risk, council roster and finding tally in the review comment", () => {
  const report = render(authorChangesReview);
  const visible = report.split("\n<!-- margot-ledger:v1 ")[0] ?? "";
  const lines = visible.split("\n");
  const roster = lines.filter((line) => /^\* (?:✅|⚠️|ℹ️|❓) /.test(line));
  return expect({
    outcome: /^### [✅❌❓] [A-Z_]+$/.test(lines[0] ?? ""),
    risk: /^(?:🟢|🟡|🔴) \*\*Risk: (LOW|MEDIUM|HIGH)\*\*(?: — .+)?$/.test(lines[1] ?? ""),
    rationale: (lines[2] ?? "").startsWith("> "),
    council: lines.some((line) =>
      /^Council reviewed \d+ files? • \d of 6 cards • \d+ findings? • \$\d+\.\d{2} • /.test(line),
    ),
    roster: roster.length,
    tally: lines.some((line) => /^Review \d+ · New: \d+ · Open: \d+ · Closed: \d+$/.test(line)),
    footer: ["**Author:**", "**Ticket:**", "**Commit:**", "**Run:**"].every(
      (field) => lines.filter((line) => line.startsWith(field)).length === 1,
    ),
    markers: report.includes("<!-- margot:v1 -->\n<!-- margot-ledger:v1 "),
  }).toMatchObject({
    outcome: true,
    risk: true,
    rationale: true,
    council: true,
    roster: 6,
    tally: true,
    footer: true,
    markers: true,
  });
});
it("renders a shared defect once and points the second card to it", () => {
  const value = structuredClone(authorChangesReview);
  const [first, second] = value.cards.flatMap((card) => card.findings);
  if (!first || !second || !value.voice) throw new Error("two findings required");
  second.what = first.what;
  second.location = first.location;
  const report = render(value);
  expect(report).toContain("`principal-engineer` + `maintainable-no-slop`");
  expect(report).toContain("`maintainable-no-slop` — Same finding as `principal-engineer`");
  expect(
    report.match(new RegExp(first.what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
  ).toHaveLength(1);
});
describe("merge actor in the authority hold", () => {
  function authorityHold(mergeActor?: string) {
    const value = structuredClone(mechanicalReview);
    value.decision.mergeEligible = false;
    value.decision.holdReasons = ["review-authority"];
    value.presentation = { ...present(value.presentation), ...(mergeActor ? { mergeActor } : {}) };
    return render(value);
  }
  it("names the configured merge actor", () => {
    expect(authorityHold("merge-bot")).toContain(
      "Above my authority: it changes Margot's own machinery; approve it and merge-bot merges it. Yours to merge.",
    );
  });
  it("names no merger when none is configured", () => {
    const report = authorityHold();
    expect(report).toContain(
      "Above my authority: it changes Margot's own machinery; approve it to merge it. Yours to merge.",
    );
    expect(report).not.toContain("merges it");
  });
});
