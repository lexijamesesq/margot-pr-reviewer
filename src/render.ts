import { ledgerBlock } from "./ledger.js";
import type { Review } from "./types.js";

/** Every listed issue has exactly one fate; advisory issues remain open. */
export function findingTally(review: Review) {
  const entries = review.ledger.entries;
  return {
    new: entries.filter((e) => e.round_raised === review.convergence.round).length,
    open: entries.filter((e) => e.status === "standing" || e.status === "advisory").length,
    closed: entries.filter((e) => e.status === "fixed" || e.status === "dismissed").length,
  };
}
export function render(review: Review): string {
  const { decision, request, cards, voice } = review;
  const tally = findingTally(review);
  const body = [
    `## ${decision.outcome}`,
    `Review ${review.convergence.round} · New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`,
    `Risk: **${decision.rating.band}** — ${decision.rating.rationale}`,
    `Class: ${review.classification}. Merge eligible: ${decision.mergeEligible ? "yes" : "no"}.`,
    `Reviewed ${request.repository} PR ${request.pr} at ${request.head}.`,
    voice?.summary ?? "The selected review path completed without unresolved findings.",
    ...cards.map(
      (c) =>
        `- ${c.name}: ${c.findings.length} finding(s); ${c.checked.length} evidence checks recorded`,
    ),
    ...review.ledger.entries.map(
      (e) =>
        `- ${e.key} [${e.status === "standing" || e.status === "advisory" ? "Open" : "Closed"}; ${e.status}${e.round_raised === review.convergence.round ? "; New" : ""}${e.late?.startsWith("missed:") ? "; late" : ""}] (${e.card}, ${e.severity}, ${e.location}): ${e.what}${e.reason ? ` — ${e.reason}` : ""}${e.late?.startsWith("missed:") ? ` — ${e.late}` : ""}`,
    ),
    ...cards.flatMap((c) =>
      c.findings
        .filter((f) => f.tag !== "issue")
        .map((f) => `- Note (${c.name}, ${f.location}): ${f.what}`),
    ),
    ...(decision.holdReasons.length ? [`Held: ${decision.holdReasons.join(", ")}.`] : []),
    `Evidence bundle: ${review.provenance.cardBundle}.`,
  ]
    .join("\n\n")
    .replaceAll("margot-ledger", "margot‑ledger");
  const report = `${body}\n\n<!-- margot:v1 -->\n${ledgerBlock(review.ledger)}`;
  if (report.length > 65536)
    throw new Error(
      `Review exceeds GitHub body limit (${report.length} characters, ${body.length} visible)`,
    );
  return report;
}

/**
 * The verdict check's text: the lines the estate's readers consume. Ollie's state script
 * (dotty `.github/scripts/ollie-state.py`, `parse_verdict`) reads `outcome: X | band: Y` and
 * `decision_source:` to decide whether a held PR is waiting on the operator and to request
 * her review. Python's check carried these lines; they are the contract, not decoration.
 */
export function checkText(review: Review): string {
  const { decision, cards, voice } = review;
  const tally = findingTally(review);
  return [
    `outcome: ${decision.outcome} | band: ${decision.rating.band}`,
    `decision_source: jev`,
    `verdict_source: ${voice ? "verdict_voice" : "deterministic"}`,
    `class: ${review.classification}`,
    `summoned: ${cards.length ? cards.map((c) => c.name).join(", ") : "none"}`,
    `convergence: round ${review.convergence.round} · new ${tally.new} · open ${tally.open} · closed ${tally.closed}`,
    `can auto-merge: ${decision.mergeEligible ? "True" : "False"}`,
    `band_reason: ${decision.rating.rationale}`,
  ].join("\n");
}
