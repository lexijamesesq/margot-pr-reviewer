import { ledgerBlock } from "./ledger.js";
import { cardNames } from "./schemas.js";
import type { Card, Review, ReviewPresentation } from "./types.js";

const outcomeIcons = {
  APPROVED: "✅",
  CHANGES_REQUESTED: "❌",
  CLARIFICATION_REQUESTED: "❓",
} as const;
const bandIcons = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" } as const;
const maxCardWords = 15;
const maxSkipWords = 12;

/** Every listed issue has exactly one fate; advisory issues remain open. */
export function findingTally(review: Review) {
  const entries = review.ledger.entries;
  return {
    new: entries.filter((e) => e.round_raised === review.convergence.round).length,
    open: entries.filter((e) => e.status === "standing" || e.status === "advisory").length,
    closed: entries.filter((e) => e.status === "fixed" || e.status === "dismissed").length,
  };
}

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const sentences = (value: string) =>
  value
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean).length;
const oneLine = (value: string) => !/[\r\n]/.test(value);
const sentence = (value: string) => `${value.trim().replace(/[.!?]+$/, "")}.`;

function validateCommentProse(review: Review, rationale: string): void {
  const concern = review.decision.rating.rationale.trim();
  if (!concern || !oneLine(concern)) throw new Error("Comment risk concern must be one line");
  const count = sentences(rationale);
  if (!oneLine(rationale) || count < 1 || count > 2)
    throw new Error("Comment rationale must be one or two sentences");
  const dismissed = new Set(
    review.voice?.dispositions.filter((d) => d.status === "dismissed").map((d) => d.id) ?? [],
  );
  for (const card of review.cards) {
    for (const finding of card.findings.filter((item) => !dismissed.has(item.id))) {
      if (
        !oneLine(finding.what) ||
        sentences(finding.what) !== 1 ||
        words(finding.what) > maxCardWords ||
        /^Resolved by Margot\b/i.test(finding.what)
      )
        throw new Error(`Comment finding for ${card.name} exceeds its one-sentence limit`);
    }
  }
  for (const [card, reason] of Object.entries(review.presentation?.skipReasons ?? {})) {
    if (
      !oneLine(reason) ||
      words(reason) > maxSkipWords ||
      /[.!?;:]/.test(reason) ||
      /\b(?:and|but|because|although|while)\b/i.test(reason)
    )
      throw new Error(`Comment skip reason for ${card} must be one clause`);
  }
}

function fallbackRationale(review: Review): string {
  if (review.classification === "mechanical")
    return "A mechanical change has no functional effect, so no council review was required.";
  return "The selected review path completed without unresolved findings.";
}

function authorityReason(review: Review): string | null {
  if (review.decision.outcome !== "APPROVED" || review.decision.mergeEligible) return null;
  if (review.decision.holdReasons.includes("risk")) return `risk is ${review.decision.rating.band}`;
  if (review.decision.holdReasons.includes("review-authority"))
    return "it changes Margot's own machinery; approve it and Ollie merges it";
  if (review.decision.holdReasons.includes("calibration")) return "calibration requires review";
  return "the review is held";
}

function duration(value: number): string {
  if (value < 0) return "—";
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function authorLink(author: string): string {
  const url = author.endsWith("[bot]")
    ? `https://github.com/apps/${author.slice(0, -5)}`
    : `https://github.com/${author}`;
  return `[${author}](${url})`;
}

function findingKey(finding: Card["findings"][number]): string {
  return `${finding.location}\u0000${finding.what}`;
}

function cardRows(review: Review): { rows: string[]; findings: number } {
  const cards = new Map(review.cards.map((card) => [card.name, card]));
  const dismissed = new Set(
    review.voice?.dispositions.filter((d) => d.status === "dismissed").map((d) => d.id) ?? [],
  );
  const visible = new Map(
    review.cards.map((card) => [
      card.name,
      card.findings.filter((finding) => !dismissed.has(finding.id)),
    ]),
  );
  const owners = new Map<string, Card["name"][]>();
  for (const [name, findings] of visible)
    for (const finding of findings) {
      const key = findingKey(finding);
      const names = owners.get(key) ?? [];
      if (!names.includes(name)) names.push(name);
      owners.set(key, names);
    }
  const rendered = new Set<string>();
  const rows = cardNames.map((name) => {
    const card = cards.get(name);
    if (!card) {
      const reason = review.presentation?.skipReasons?.[name] ?? "not selected";
      return `* ❓ \`${name}\` — skipped: ${reason}`;
    }
    const findings = visible.get(name) ?? [];
    const first = findings[0];
    if (!first) return `* ✅ \`${name}\` — clear`;
    const key = findingKey(first);
    const shared = owners.get(key) ?? [name];
    if (rendered.has(key)) {
      const primary = shared[0] ?? name;
      return `* ℹ️ \`${name}\` — Same finding as \`${primary}\`. \`${first.location}\``;
    }
    rendered.add(key);
    const labels = shared.map((owner) => `\`${owner}\``).join(" + ");
    const icon = findings.some((finding) => finding.tag === "issue") ? "⚠️" : "ℹ️";
    const count = findings.length > 1 ? ` (${findings.length})` : "";
    return `* ${icon} ${labels}${count} — ${sentence(first.what)} \`${first.location}\``;
  });
  return { rows, findings: owners.size };
}

function defaultPresentation(review: Review): ReviewPresentation {
  return {
    author: "unknown",
    costUsd: null,
    durationMs: -1,
    files: 1,
    runUrl: null,
    ticket: null,
    ...review.presentation,
  };
}

export function render(review: Review): string {
  const { decision, request } = review;
  const rationale = review.voice?.summary.trim() || fallbackRationale(review);
  validateCommentProse(review, rationale);
  const tally = findingTally(review);
  const presentation = defaultPresentation(review);
  const cards = cardRows(review);
  const authority = authorityReason(review);
  const cost = presentation.costUsd === null ? "$—" : `$${presentation.costUsd.toFixed(2)}`;
  const run = presentation.runUrl
    ? `[${presentation.runUrl.replace(/\/$/, "").split("/").at(-1)}](${presentation.runUrl})`
    : "dry run";
  const ticket = presentation.ticket
    ? `[${presentation.ticket.label}](${presentation.ticket.url})`
    : "none";
  const lines = [
    `### ${outcomeIcons[decision.outcome]} ${decision.outcome}`,
    `${bandIcons[decision.rating.band]} **Risk: ${decision.rating.band}** — ${decision.rating.rationale.trim()}`,
    `> ${rationale}`,
    ...(authority ? ["", `Above my authority: ${authority}. Yours to merge.`] : []),
    "",
    "---",
    `Council reviewed ${presentation.files} file${presentation.files === 1 ? "" : "s"} • ${review.cards.length} of 6 cards • ${cards.findings} finding${cards.findings === 1 ? "" : "s"} • ${cost} • ${duration(presentation.durationMs)}`,
    ...cards.rows,
    "",
    `Review ${review.convergence.round} · New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`,
    "",
    "---",
    `**Author:** ${authorLink(presentation.author)}`,
    `**Ticket:** ${ticket}`,
    `**Commit:** [${request.head.slice(0, 7)}](https://github.com/${request.repository}/commit/${request.head})`,
    `**Run:** ${run}`,
    "",
    "<!-- margot:v1 -->",
  ];
  const body = lines.join("\n").replaceAll("margot-ledger", "margot‑ledger");
  const report = `${body}\n${ledgerBlock(review.ledger)}`;
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
  const tally = findingTally(review);
  const summoned = review.cards.map((card) => card.name);
  const verdictSource =
    review.classification === "mechanical"
      ? "mechanical"
      : review.voice
        ? "verdict_voice"
        : "fast_path";
  const lines = [
    `outcome: ${review.decision.outcome} | band: ${review.decision.rating.band}`,
    "decision_source: jev",
    `verdict_source: ${verdictSource}`,
    `class: ${review.classification}`,
    `summoned: ${summoned.join(", ") || "none"}`,
    `convergence: round ${review.convergence.round} · new ${tally.new} · open ${tally.open} · closed ${tally.closed}`,
    `can auto-merge: ${review.decision.mergeEligible ? "True" : "False"}`,
    `band_reason: ${review.decision.rating.rationale}`,
    "pipeline_ok: true",
    `vector: ${JSON.stringify(review.riskAnswer?.dimensions ?? {})}`,
    `owned tier: ${(review.decision.authorityPaths?.length ?? 0) > 0 ? "required_owned" : "none"}`,
    "summoned by ledger: none",
  ];
  const findingById = new Map(
    review.cards.flatMap((card) => card.findings.map((finding) => [finding.id, finding] as const)),
  );
  for (const status of ["established", "dismissed"] as const) {
    const dispositions = review.voice?.dispositions.filter((item) => item.status === status) ?? [];
    if (dispositions.length) {
      lines.push(`${status}:`);
      for (const disposition of dispositions) {
        const finding = findingById.get(disposition.id);
        lines.push(
          `  - ${disposition.id} · ${finding?.location ?? "unknown"} · ${disposition.reason}`,
        );
      }
    }
  }
  const details = review.cards.flatMap((card) =>
    card.findings.map(
      (finding) =>
        `  - ${card.name} · ${finding.location} · ${finding.what}${finding.detail ? ` ${finding.detail}` : ""}`,
    ),
  );
  if (details.length) lines.push("finding details:", ...details);
  return lines.join("\n");
}

/** Backward-compatible name introduced with the visible comment contract. */
export const renderCheckText = checkText;
