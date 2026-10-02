import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard, parseVoice } from "../src/adapters/prose.js";

function cardText() {
  return "card: safety\ncompletion: completed\nChecked:\n- Inspected changed permission grants; would catch write access.\nNot covered:\n- Runtime execution; outside the change.\nFindings:\n";
}
it("Card prose preserves a real mandatory finding", () => {
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
// Python's parse_council reads the whole block for tagged bullets and never requires the
// Checked, Not covered or Findings labels; a label mentioned again in free text is not an error.
it("A card without its block labels still yields its tagged findings", () => {
  const finding =
    "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    action: Restore the guard.\n";
  const card = parseCard(
    `card: safety\ncompletion: completed\n\nI reviewed the change; see Findings: below.\n${finding}`,
    "safety",
  );
  expect({
    checked: card.checked,
    notCovered: card.notCovered,
    findings: card.findings.length,
  }).toMatchObject({ checked: [], notCovered: [], findings: 1 });
});
it("Malformed tagged findings cannot silently disappear", () => {
  expect(() => parseCard(`${cardText()}- [issue] missing fields\n`, "safety")).toThrow();
});
it("Repeated card labels take the first match", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\n\nChecked:\n- Reviewed; completion: completed is restated here.\n\ncard: safety\ncompletion: incomplete: a draft line\n",
    "safety",
  );
  expect({ completion: card.completion, checked: card.checked.length }).toMatchObject({
    completion: "completed",
    checked: 1,
  });
});
// Python's _TAG_BULLET tolerates emphasis around the tag and numbered bullets; its
// _finding_fields reads `k=v` in any order, ignores keys it does not know, and drops a
// `ledger=` value that is not a ledger key. `(none)` under Findings is prose, not a finding.
it("Tagged bullets tolerate emphasis, key order and unknown annotations", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\nFindings:\n(none yet)\n- **[issue]** a.ts:1 \u00B7 confidence=high \u00B7 severity=**major** \u00B7 owner=reviewer \u00B7 ledger=not-a-key \u00B7 late=missed\n    what: A guard is missing.\n1. *[ info ]* b.ts:2 \u00B7 severity=MINOR \u00B7 confidence=LOW\n    what: A note.\n    note: Optional.\n",
    "safety",
  );
  expect({ findings: card.findings }).toMatchObject({
    findings: [
      { tag: "issue", location: "a.ts:1", severity: "MAJOR", confidence: "HIGH", late: "missed" },
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
// Python read only `what:`/`note:`; consequence and action are run-only fields that are never
// a reason to refuse: missing is empty, a repeated label takes the last value.
it("Missing or repeated finding sub-fields are read, never refused", () => {
  const card = parseCard(
    "card: safety\ncompletion: completed\nFindings:\n- [issue] a.ts:1 \u00B7 severity=MAJOR \u00B7 confidence=HIGH\n    what: A guard is missing.\n    action: Draft fix.\n    action: Restore the guard.\n- [info] b.ts:2 \u00B7 severity=MINOR \u00B7 confidence=LOW\n    note: Only a note line.\n",
    "safety",
  );
  expect({ details: card.findings.map((f) => [f.what, f.detail ?? null]) }).toMatchObject({
    details: [
      ["A guard is missing.", "Restore the guard."],
      ["Only a note line.", "Only a note line."],
    ],
  });
});
// Python's _OUTCOMES includes ERROR: Margot's own fail-closed ruling, with a finding she could
// not resolve legitimately in neither list.
it("Margot's ERROR is a parsed ruling, not an exception", () => {
  const voice = parseVoice(
    "I read the council's findings against the cited lines.\n\noutcome: ERROR\nband: MEDIUM\nband_reason: the change touches one bounded behavior with a revert as its recovery\nrisk: retry-loop exposure\nsummary: The retry wraps one call and is bounded; the findings below decide it.\nfinding: F1 could not be checked: the head's file could not be read\nclarification: \nestablished:\ndismissed:\n",
  );
  expect({
    outcome: voice.outcome,
    band: voice.band,
    dispositions: voice.dispositions.length,
  }).toMatchObject({ outcome: "ERROR", band: "MEDIUM", dispositions: 0 });
});
it("Voice prose preserves finding IDs and dispositions", () => {
  return expect(
    parseVoice(
      "outcome: CHANGES_REQUESTED\nband: LOW\nband_reason: Bounded change.\nsummary: Restore the guard.\nestablished:\n- safety-F1 \u00B7 a.ts:1 \u00B7 The guard is missing.\ndismissed:\n- safety-F2 \u00B7 a.ts:2 \u00B7 Existing check covers this.\n",
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
it("parses emphasized verdicts, repeated sections and varied disposition bullets", () => {
  const finalBlock = parseVoice(
    "outcome: CHANGES_REQUESTED\nband: HIGH\nband_reason: Draft.\nsummary: Draft.\n\nI reconsidered.\n**outcome:** **approved**.\n**band:** **medium**!\nband_reason: Final reason.\nsummary: Final summary.\nEstablished:\nDismissed:\n",
  );
  const forms = parseVoice(
    "outcome: approved.\nband: `low`\nband_reason: Bounded.\nsummary: Clear.\nEsTaBlIsHeD:\n- **alpha-F1** · dot reason\n- __beta_F2__ — dash reason\n- *gamma-F3*: colon reason\n- _delta_\n- `epsilon-5` · tick reason\n- (not an id) is ignored\n### Notes\n- after-heading · ignored\nESTABLISHED:\n- zeta-F6 · before rule\n---\n- after-rule · ignored\nestablished:\n- eta-F7 · before prose\nThese notes are optional.\n- **after-prose (MINOR):** ignored\nDISMISSED:\n- unknown-id: dismissed reason\n",
  );
  const liveFailure = parseVoice(
    "I checked the one finding that could still block and dismissed it, so this is approved. It's banded HIGH, though, which means you merge it, not me.\n\noutcome: APPROVED\nband: HIGH\nband_reason: I'm keeping the model's HIGH, and for a stronger reason than its scoring. The model's blast_radius and verification_gap readings have zero confidence. But this repository is the package Margot runs as. The change alters how the stranded-check closer concludes required checks: superseded and merged now close as `skipped`, which GitHub treats as passing. It also changes how `bind-request` reports a stop: it exits 75 with `stop_reason`/`live_sha` in GITHUB_OUTPUT, and the sample drops its `set +e` wrapper. Changing what grades or gates a review is above my authority, so the operator decides. The safety card checked that `skipped` only happens for superseded or merged, and that the leave-the-live-head rule still holds. That makes the risk a matter of who decides, not a defect. A lower band is not justified.\nrisk: changes to the reviewer's own gate\nsummary: This change renames Margot's install-location setting so that nothing is called \"engine\". It also makes every early stop close Margot's status check with the same result the older Python version gave, and it puts back saved records of past reviews that the first round had wrongly edited. The only blocking problem left from round one, the edited records, is fixed: the files match the originals exactly. Because the change affects how Margot's own pass/fail check is closed, the operator decides whether to merge. Three small notes are optional.\nfinding: none\nestablished:\ndismissed:\n- verify-R1-F2 · docs/live/documentation.json:54 · Fixed. Line 54 at head is byte-for-byte the same as base 4437550, and nothing under docs/ is in this PR's changed-file list anymore, so the saved record shows what GitHub actually supplied again. The maintainable-no-slop card's own resolution of R1-F2 says the same.\n\nThese three notes don't block and the author can take or leave them:\n- **achieves-the-objective-F1 (MINOR):** the PR description's \"grep finds only principal-engineer\" claim is now false. The restored lines `docs/SLICE4.md:22` and `docs/SLICE4.md:175` still contain \"engine\".\n- **maintainable-no-slop-F1 (MINOR):** in `src/closer.ts`, the `cancelled` and `unknown` entries repeat the same title and summary text.\n- **house-style-F1 (info):** the draft, fork, conflict and empty check titles in `src/closer.ts` don't start with \"Margot:\" like the other titles do.\n",
  );
  expect({
    final: {
      outcome: finalBlock.outcome,
      band: finalBlock.band,
      rationale: finalBlock.rationale,
      summary: finalBlock.summary,
    },
    forms: forms.dispositions,
    live: liveFailure.dispositions,
  }).toMatchObject({
    final: {
      outcome: "APPROVED",
      band: "MEDIUM",
      rationale: "Final reason.",
      summary: "Final summary.",
    },
    forms: [
      { id: "alpha-F1", status: "established", reason: "dot reason" },
      { id: "beta_F2", status: "established", reason: "dash reason" },
      { id: "gamma-F3", status: "established", reason: "colon reason" },
      { id: "delta", status: "established", reason: "" },
      { id: "epsilon-5", status: "established", reason: "tick reason" },
      { id: "zeta-F6", status: "established", reason: "before rule" },
      { id: "eta-F7", status: "established", reason: "before prose" },
      { id: "unknown-id", status: "dismissed", reason: "dismissed reason" },
    ],
    live: [
      {
        id: "verify-R1-F2",
        status: "dismissed",
        reason:
          "docs/live/documentation.json:54 · Fixed. Line 54 at head is byte-for-byte the same as base 4437550, and nothing under docs/ is in this PR's changed-file list anymore, so the saved record shows what GitHub actually supplied again. The maintainable-no-slop card's own resolution of R1-F2 says the same.",
      },
    ],
  });
});
describe("bound evidence", () => {
  it("Card prose preserves ledger marks and reads past a Resolved section", () => {
    expect(
      parseCard(
        "card: safety\ncompletion: completed\nChecked:\n- a.ts access\nNot covered:\nResolved:\n- R1-F2 \u00B7 a.ts:3 validates input\nFindings:\n- [issue] a.ts:1 \u00B7 severity=MAJOR \u00B7 confidence=HIGH \u00B7 ledger=R1-F1 \u00B7 late=delta-reach: new caller\n what: unsafe\n consequence: exposure\n action: validate\n",
        "safety",
      ),
    ).toMatchObject({
      // Python never parsed `Resolved:`; the section is prose, and fixed-ness comes from absence.
      findings: [{ ledger: "R1-F1", late: "delta-reach: new caller" }],
    });
  });
});
describe("captured reviewer output", () => {
  // Every card and voice Margot has actually written and that the repository keeps
  // (docs/live, recordings) must parse. The reviewer and the voice write prose; a parser
  // that refuses a shape they really produce takes the review down for the operator.
  type Sample = {
    source: string;
    kind: "card" | "voice";
    card?: string;
    text: string;
  };
  function collect(value: unknown, source: string, out: Sample[]) {
    if (typeof value === "string") {
      const text = value.trimStart();
      // A card is the reviewer's whole return (a card line and a completion line); a voice is
      // Margot's return (outcome and band_reason). Labels alone, check text and JSON are neither.
      const card = /^card:\s*([\w-]+)/.exec(text);
      if (card && /^\s*completion:/m.test(text))
        out.push({ source, kind: "card", card: card[1]!, text: value });
      else if (
        /^\s*(?:\*\*|__)?outcome(?:\*\*|__)?:/im.test(text) &&
        /^\s*(?:\*\*|__)?band_reason(?:\*\*|__)?:/im.test(text) &&
        !/^\s*verdict_source:/m.test(text) && // Python's check text carries the same labels
        !text.startsWith("{")
      )
        out.push({ source, kind: "voice", text: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) collect(v, `${source}[${i}]`, out);
    } else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) collect(v, `${source}.${k}`, out);
  }
  function samples(): Sample[] {
    const out: Sample[] = [];
    for (const dir of ["docs/live", "recordings"]) {
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const file = join(dir, name);
        collect(JSON.parse(readFileSync(file, "utf8")), file, out);
      }
    }
    return out;
  }
  describe("recorded prose", () => {
    const all = samples();
    const cards = all.filter((s) => s.kind === "card");
    const voices = all.filter((s) => s.kind === "voice");
    it("retains captured cards and voice rulings for parser compatibility", () => {
      expect(cards.length).toBeGreaterThanOrEqual(5);
      expect(voices.length).toBeGreaterThanOrEqual(1);
    });
    it.each(cards.map((s) => [s.source, s]))("parses the recorded card at %s", (_, s) => {
      expect(() => parseCard(s.text, s.card as Parameters<typeof parseCard>[1])).not.toThrow();
    });
    it.each(voices.map((s) => [s.source, s]))("parses the recorded voice at %s", (_, s) => {
      expect(() => parseVoice(s.text)).not.toThrow();
    });
  });
});
