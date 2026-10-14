import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCard, parseVoice } from "../src/adapters/prose.js";

it("preserves the voice's risk statement, clarification and setting finding", () => {
  expect(
    parseVoice(
      "outcome: CLARIFICATION_REQUESTED\nband: LOW\nband_reason: Bounded change\nrisk: caller-visible behavior\nsummary: One choice remains\nfinding: The default changed\nclarification: Which default should callers receive?\nestablished:\ndismissed:\n",
    ),
  ).toMatchObject({
    risk: "caller-visible behavior",
    finding: "The default changed",
    clarification: "Which default should callers receive?",
  });
});

function cardText() {
  return "card: safety\ncompletion: completed\nChecked:\n- Inspected changed permission grants; would catch write access.\nNot covered:\n- Runtime execution; outside the change.\nFindings:\n";
}
// The parser's stated tolerance covers a card's labels and completion value too.
it("preserves completion, checked and exclusion fields with Markdown decoration", () => {
  expect(
    parseCard(
      "card: safety\n**Completion:** **completed**.\n**Checked:**\n- Looked.\n**Not covered:**\n- Runtime.\n",
      "safety",
    ),
  ).toMatchObject({ completion: "completed", checked: ["Looked."], notCovered: ["Runtime."] });
});
it("preserves a real mandatory finding in card prose", () => {
  const raw =
    cardText() +
    "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    consequence: Writes can escape.\n    action: Restore the guard.\n";
  expect({ findings: parseCard(raw, "safety").findings }).toMatchObject({
    findings: [
      {
        tag: "issue",
        severity: "MAJOR",
        confidence: "HIGH",
        location: "a.ts:1",
        what: "A guard is missing.",
        detail: "Consequence: Writes can escape. Restore the guard.",
      },
    ],
  });
});
// The card parser reads the whole block for tagged bullets and never requires the
// Checked, Not covered or Findings labels; a label mentioned again in free text is not an error.
it("yields tagged findings from a card without its block labels", () => {
  const finding =
    "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    action: Restore the guard.\n";
  const card = parseCard(
    `card: safety\ncompletion: completed\n\nI reviewed the change; see Findings: below.\n${finding}`,
    "safety",
  );
  expect({
    checked: card.checked,
    notCovered: card.notCovered,
    findings: card.findings.map(({ what, severity }) => ({ what, severity })),
  }).toMatchObject({
    checked: [],
    notCovered: [],
    findings: [{ what: "A guard is missing.", severity: "MAJOR" }],
  });
});
it("refuses malformed tagged findings instead of dropping them", () => {
  expect(() => parseCard(`${cardText()}- [issue] missing fields\n`, "safety")).toThrow();
});
it("keeps canonical card metadata when narrative mentions its labels", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\nChecked:\n- Reviewed; completion: incomplete is a quoted draft label.\nNot covered:\nFindings:\n",
    "safety",
  );
  expect(card.completion).toBe("completed");
  expect(card.checked).toEqual(["Reviewed; completion: incomplete is a quoted draft label."]);
});
// Decorated issue and information bullets retain their semantic fields.
it("preserves decorated issue and information findings with reordered fields", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\nFindings:\n(none yet)\n- **[issue]** a.ts:1 \u00B7 confidence=high \u00B7 severity=**major** \u00B7 owner=reviewer \u00B7 ledger=not-a-key \u00B7 late=missed\n    what: A guard is missing.\n1. *[ info ]* b.ts:2 \u00B7 severity=MINOR \u00B7 confidence=LOW\n    what: A note.\n    note: Optional.\n",
    "safety",
  );
  expect({ findings: card.findings }).toMatchObject({
    findings: [
      { tag: "issue", location: "a.ts:1", severity: "MAJOR", confidence: "HIGH" },
      {
        tag: "info",
        location: "b.ts:2",
        severity: "MINOR",
        confidence: "LOW",
        detail: "Optional.",
      },
    ],
  });
});
// An information note supplies its text without a separate what label.
it("keeps finding meaning without consequence decoration or a separate what label", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\nFindings:\n- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    action: Restore the guard.\n- [info] b.ts:2 · severity=MINOR · confidence=LOW\n    note: Only a note line.\n",
    "safety",
  );
  expect(card.findings.map((finding) => [finding.what, finding.detail])).toEqual([
    ["A guard is missing.", "Restore the guard."],
    ["Only a note line.", "Only a note line."],
  ]);
});
// The outcomes include ERROR: Margot's own fail-closed ruling, with a finding she could
// not resolve legitimately in neither list.
it("parses Margot's ERROR as a ruling, not an exception", () => {
  const voice = parseVoice(
    "I read the council's findings against the cited lines.\n\noutcome: ERROR\nband: MEDIUM\nband_reason: the change touches one bounded behavior with a revert as its recovery\nrisk: retry-loop exposure\nsummary: The retry wraps one call and is bounded; the findings below decide it.\nfinding: F1 could not be checked: the head's file could not be read\nclarification: \nestablished:\ndismissed:\n",
  );
  expect({
    outcome: voice.outcome,
    band: voice.band,
    dispositions: voice.dispositions.length,
  }).toMatchObject({ outcome: "ERROR", band: "MEDIUM", dispositions: 0 });
});
it("preserves finding IDs and dispositions in voice prose", () => {
  return expect(
    parseVoice(
      "outcome: CHANGES_REQUESTED\nband: LOW\nband_reason: Bounded change.\nsummary: Restore the guard.\nestablished:\n* safety-F1 \u00B7 a.ts:1 \u00B7 The guard is missing.\ndismissed:\n- safety-F2 \u00B7 a.ts:2 \u00B7 Existing check covers this.\n",
    ),
  ).toMatchObject({
    outcome: "CHANGES_REQUESTED",
    band: "LOW",
    rationale: "Bounded change.",
    summary: "Restore the guard.",
    dispositions: [
      { id: "safety-F1", status: "established", reason: "a.ts:1 · The guard is missing." },
      { id: "safety-F2", status: "dismissed", reason: "a.ts:2 · Existing check covers this." },
    ],
  });
});
it("uses the final voice verdict and excludes optional notes from dispositions", () => {
  const final = parseVoice(
    "outcome: CHANGES_REQUESTED\nband: HIGH\nband_reason: Draft.\nsummary: Draft.\n\n**outcome:** **approved**.\n**band:** **medium**!\nband_reason: Final reason.\nsummary: Final summary.\nestablished:\ndismissed:\n",
  );
  expect(final).toMatchObject({
    outcome: "APPROVED",
    band: "MEDIUM",
    rationale: "Final reason.",
    summary: "Final summary.",
  });
  const actual = parseVoice(
    "I checked the one finding that could still block and dismissed it, so this is approved. It's banded HIGH, though, which means you merge it, not me.\n\noutcome: APPROVED\nband: HIGH\nband_reason: I'm keeping the model's HIGH, for a stronger reason than its scoring. The model's two lowest-confidence readings carry zero confidence, and the one finding that could still block has been dismissed below. A lower band is not justified.\nrisk: changes to a configuration surface\nsummary: This change adjusts how an existing check concludes. The only blocking problem from round one is fixed below. Because the change affects how a required check is closed, the operator decides whether to merge. Three small notes are optional.\nfinding: none\nestablished:\ndismissed:\n- verify-R1-F2 · a.ts:12 · Fixed. Line 12 at head matches the base exactly, and the file is no longer part of this PR's changed-file list, so the saved record is accurate again.\n\nThese three notes don't block and the author can take or leave them:\n- **first-note-F1 (MINOR):** a claim in the PR description is no longer accurate.\n- **second-note-F1 (MINOR):** two entries in b.ts repeat the same title and summary text.\n- **third-note-F1 (info):** some titles in c.ts don't follow the house naming convention.\n",
  );
  expect(actual.dispositions).toEqual([
    {
      id: "verify-R1-F2",
      status: "dismissed",
      reason:
        "a.ts:12 · Fixed. Line 12 at head matches the base exactly, and the file is no longer part of this PR's changed-file list, so the saved record is accurate again.",
    },
  ]);
});
describe("card prose ledger marks", () => {
  it("preserves ledger marks and reads past a Resolved section in card prose", () => {
    expect(
      parseCard(
        "card: safety\ncompletion: completed\nChecked:\n- a.ts access\nNot covered:\nResolved:\n- R1-F2 \u00B7 a.ts:3 validates input\nFindings:\n- [issue] a.ts:1 \u00B7 severity=MAJOR \u00B7 confidence=HIGH \u00B7 ledger=R1-F1 \u00B7 late=delta-reach: new caller\n what: unsafe\n consequence: exposure\n action: validate\n",
        "safety",
      ),
    ).toMatchObject({
      findings: [{ ledger: "R1-F1", late: "delta-reach: new caller" }],
    });
  });
});
it("preserves an incomplete recorded card's reason", () => {
  const card = parseCard(
    readFileSync("recordings/prose/incomplete-proof-card.txt", "utf8"),
    "works-and-proven",
  );
  expect(card.completion).toBe("incomplete");
  expect(card.completionReason).toContain("could not get the evidence");
  expect(card.findings).toEqual([]);
});
it("preserves the recorded voice's outcome, band and finding bindings", () => {
  const voice = parseVoice(readFileSync("recordings/prose/changes-requested-voice.txt", "utf8"));
  expect(voice).toMatchObject({ outcome: "CHANGES_REQUESTED", band: "HIGH" });
  expect(voice.dispositions.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "principal-engineer-F1", status: "established" },
    { id: "works-and-proven-F1", status: "established" },
    { id: "works-and-proven-F2", status: "established" },
    { id: "maintainable-no-slop-F1", status: "established" },
  ]);
});
it("keeps a card's Resolved section for the voice and Jev's risk text", async () => {
  const { councilText } = await import("../src/adapters/jev.js");
  const { fakeClaude } = await import("./helpers/adapters.js");
  const card = parseCard(
    "card: safety\ncompletion: completed\nChecked:\n- Read the workflow.\nNot covered:\nResolved:\n- R1-F1 · a.ts:4 — the token is now masked\nFindings:\n",
    "safety",
  );
  const voice = await fakeClaude({ role: "voice", cards: [card] });
  const input = JSON.parse(voice.stdin.split("\n").at(-1) ?? "{}") as {
    cards: { resolved?: string[] }[];
  };
  expect({
    parsed: card.resolved,
    voice: input.cards[0]?.resolved,
    risk: councilText([card]).includes("Resolved:\n- R1-F1 · a.ts:4 — the token is now masked"),
  }).toEqual({
    parsed: ["R1-F1 · a.ts:4 — the token is now masked"],
    voice: ["R1-F1 · a.ts:4 — the token is now masked"],
    risk: true,
  });
});
