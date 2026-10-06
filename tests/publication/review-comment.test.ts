import { describe, expect, it } from "vitest";
import { checkSummary, checkText, render } from "../../src/render.js";
import { present } from "../helpers/present.js";
import { authorChangesReview, mechanicalReview } from "../helpers/publication.js";
import {
  asDocumentation,
  confidentLow,
  recorded,
  reviewed,
  uniformRisk,
  withNoCouncil,
  withRisk,
  withRiskDimension,
} from "../helpers/review.js";

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
it("omits the explanatory suffix on the voice's own ERROR without a risk statement", () => {
  // Only an ERROR may omit the risk line; any other verdict without one is held, not posted.
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.outcome = "ERROR";
  value.decision.outcome = "ERROR";
  delete value.voice.risk;
  expect(render(value).split("\n").slice(0, 2)).toEqual(["### 🚫 ERROR", "🟡 **Risk: MEDIUM**"]);
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
  value.decision.holdReasons = ["fallback-risk"];
  expect(render(value)).toContain(
    "> ⚠️ _The risk model was unavailable — this risk was scored by a fallback at reduced confidence, so nothing was auto-merged._",
  );
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
  expect(render(value)).toContain("routing and risk were both decided by a fallback");
});
it("shows the generic fallback notice for a receipt saved with the legacy reason", () => {
  const value = structuredClone(authorChangesReview);
  value.decision.holdReasons = ["fallback"];
  expect(render(value)).toContain("A model step was unavailable");
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
  const check = checkText(value);
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
      "Above my authority: it touches a protected path. Approve it and merge-bot merges it.",
    );
  });
  it("names no merger when none is configured", () => {
    const report = authorityHold();
    expect(report).toContain(
      "Above my authority: it touches a protected path. Approve it to merge it.",
    );
    expect(report).not.toContain("merges it");
  });
});
describe("a verdict code reaches without the voice", () => {
  const head = (report: string) => report.split("\n").slice(1, 3);
  it("labels a mechanical change and says no review was required", async () => {
    const { result } = await reviewed(recorded("mechanical-bump"));
    expect(head(result.report)).toEqual([
      "🟢 **Risk: LOW** — mechanical change — no functional change",
      "> A mechanical change (dependency bump, or linter/formatter output) with no functional change — no review was required.",
    ]);
  });
  it("labels an editorial documentation change and records it as editorial", async () => {
    const { result } = await reviewed(recorded("council-clear", asDocumentation(0)));
    expect({
      head: head(result.report),
      source: checkText(result).match(/^verdict_source: (.*)$/m)?.[1],
    }).toEqual({
      head: [
        "🟢 **Risk: LOW** — editorial documentation change",
        "> An editorial documentation change with unchanged meaning — no review was required.",
      ],
      source: "documentation_editorial",
    });
  });
  it("names the dimension Jev scored highest on a cleared council review", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withRisk(uniformRisk({ ...confidentLow, score: 0.2 })),
        // The distribution's expected level is higher here, but Jev's score decides.
        withRiskDimension("operations", {
          probabilities: [0, 0.8, 0.2, 0],
          confidence: 1,
          score: 0.3,
        }),
        withRiskDimension("data_security", {
          probabilities: [1, 0, 0, 0],
          confidence: 1,
          score: 0.6,
        }),
      ),
    );
    expect(head(result.report)).toEqual([
      "🟢 **Risk: LOW** — low exposure — data security",
      "> Reviewed against the summoned lenses; no blocking findings.",
    ]);
  });
  it("counts a dimension Jev gave no score as 2", async () => {
    const { result } = await reviewed(
      recorded("council-clear", withRisk(uniformRisk(confidentLow))),
    );
    expect(head(result.report)[0]).toBe("🟢 **Risk: LOW** — low exposure — blast radius");
  });
  it("says no lens was required when routing selected none", async () => {
    const { result } = await reviewed(
      recorded(
        "council-clear",
        withNoCouncil(),
        withRisk(uniformRisk({ probabilities: [1, 0, 0, 0], confidence: 1, score: 0 })),
      ),
    );
    expect(head(result.report)).toEqual([
      "🟢 **Risk: LOW** — low exposure",
      "> No review lens was required for this change.",
    ]);
  });
});
it("takes the first sentence of the voice's risk label for the check summary", () => {
  const value = structuredClone(authorChangesReview);
  if (!value.voice) throw new Error("voice fixture required");
  value.voice.risk = "unproven  behavior. Tests are missing!";
  expect(checkSummary(value)).toBe("CHANGES_REQUESTED, MEDIUM: unproven behavior.");
  value.voice.risk = "widened access;";
  expect(checkSummary(value)).toBe("CHANGES_REQUESTED, MEDIUM: widened access.");
  value.voice.risk = "x".repeat(2000);
  expect(Array.from(checkSummary(value))).toHaveLength(900);
});
