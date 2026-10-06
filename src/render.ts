import { ledgerBlock } from "./ledger.js";
import { fallbackNotice, holdReason } from "./policy.js";
import { cardNames } from "./schemas.js";
import type { Card, Review, ReviewPresentation } from "./types.js";

const outcomeIcons = {
  APPROVED: "✅",
  CHANGES_REQUESTED: "❌",
  CLARIFICATION_REQUESTED: "❓",
  ERROR: "🚫",
} as const;
const bandIcons = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" } as const;
const maxVisibleChars = 160;

/** Every listed issue has exactly one fate; advisory issues remain open. */
export function findingTally(review: Review) {
  const entries = review.ledger.entries;
  return {
    new: entries.filter((e) => e.round_raised === review.convergence.round).length,
    open: entries.filter((e) => e.status === "standing" || e.status === "advisory").length,
    closed: entries.filter((e) => e.status === "fixed" || e.status === "dismissed").length,
  };
}

const normalized = (value: string) => value.trim().replace(/\s+/gu, " ");

function cutAtWord(value: string): string {
  const text = normalized(value);
  if (text.length <= maxVisibleChars) return text;
  const boundary = text.slice(0, maxVisibleChars).lastIndexOf(" ");
  return `${text.slice(0, boundary > 0 ? boundary : maxVisibleChars).trimEnd()}…`;
}

function firstSentences(value: string, count: number): string {
  return normalized(value)
    .split(/(?<=[.!?]) +/u)
    .slice(0, count)
    .join(" ");
}

const firstSentence = (value: string) => cutAtWord(firstSentences(value, 1));
const sentence = (value: string) => (/[.!?…]$/u.test(value) ? value : `${value}.`);

function firstClause(value: string): string {
  const text = normalized(value);
  const boundary = text.search(/;| — |[.!?](?: |$)/u);
  return boundary < 0 ? text : text.slice(0, boundary);
}

function fallbackRationale(review: Review): string {
  if (review.classification === "mechanical")
    return "A mechanical change has no functional effect, so no council review was required.";
  return "The selected review path completed without unresolved findings.";
}

function authorityLine(review: Review): string | null {
  if (review.decision.outcome !== "APPROVED" || review.decision.mergeEligible) return null;
  const { reason, sentence } = holdReason(review.decision);
  const { mergeActor } = review.presentation ?? {};
  const next =
    reason !== "review-authority"
      ? "Yours to merge."
      : mergeActor
        ? `Approve it and ${mergeActor} merges it.`
        : "Approve it to merge it.";
  return `Above my authority: ${sentence}. ${next}`;
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
      card.findings.filter((finding) => !finding.id || !dismissed.has(finding.id)),
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
    if (!card) return `* ❓ \`${name}\` — skipped: not selected`;
    const findings = visible.get(name) ?? [];
    const first = findings[0];
    // A card that did not complete shows its completion, never "clear".
    if (!first && card.completion !== "completed") {
      const icon = card.completion === "incomplete" ? "⏳" : "❓";
      const reason = card.completionReason ? `: ${firstClause(card.completionReason)}` : "";
      return `* ${icon} \`${name}\` — ${card.completion}${reason}`;
    }
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
    return `* ${icon} ${labels}${count} — ${sentence(firstSentence(first.what))} \`${first.location}\``;
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
  const tally = findingTally(review);
  const presentation = defaultPresentation(review);
  const cards = cardRows(review);
  const authority = authorityLine(review);
  const cost = presentation.costUsd === null ? "$—" : `$${presentation.costUsd.toFixed(2)}`;
  const run = presentation.runUrl
    ? `[${presentation.runUrl.replace(/\/$/, "").split("/").at(-1)}](${presentation.runUrl})`
    : "dry run";
  const ticket = presentation.ticket
    ? `[${presentation.ticket.label}](${presentation.ticket.url})`
    : "none";
  const risk = normalized(review.voice?.risk ?? "");
  const clarification = review.voice?.clarification?.trim();
  const mechanical = review.classification === "mechanical" && review.routeAnswer === null;
  const confidence =
    typeof review.provenance.mechanicalProbability === "number"
      ? ` (confidence ${Math.round(review.provenance.mechanicalProbability * 100)}%)`
      : "";
  const files = `${presentation.files} file${presentation.files === 1 ? "" : "s"}`;
  const lines = [
    `### ${outcomeIcons[decision.outcome]} ${decision.outcome}`,
    `${bandIcons[decision.rating.band]} **Risk: ${decision.rating.band}**${risk ? ` — ${risk}` : ""}`,
    `> ${firstSentences(rationale, 2)}`,
    ...(fallbackNotice(review.decision.holdReasons)
      ? [`> ⚠️ _${fallbackNotice(review.decision.holdReasons)}, so nothing was auto-merged._`]
      : []),
    ...(authority ? ["", authority] : []),
    ...(decision.outcome === "CLARIFICATION_REQUESTED" && clarification
      ? ["", `@${presentation.author}, your call: ${clarification}`]
      : []),
    // Margot's own ERROR ruling: the review could not be completed.
    ...(decision.outcome === "ERROR"
      ? ["", "Not reviewed: the review could not be completed. Held for the operator."]
      : []),
    "",
    "---",
    ...(mechanical
      ? [
          `Mechanical change${confidence} • ${files} • ${cost} • ${duration(presentation.durationMs)}`,
        ]
      : [
          `Council reviewed ${files} • ${review.cards.length} of 6 cards • ${cards.findings} finding${cards.findings === 1 ? "" : "s"} • ${cost} • ${duration(presentation.durationMs)}`,
          ...cards.rows,
        ]),
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
  return `${body}\n${ledgerBlock(review.ledger)}`;
}

/**
 * The verdict check's text: the lines downstream automation consumes. Merge automation
 * reads `outcome: X | band: Y` and `decision_source:` to decide whether a held PR is
 * waiting on the operator and to request their review. These lines are the contract, not
 * decoration.
 */
export function checkText(review: Review): string {
  const summoned = review.cards.map((card) => card.name);
  const verdictSource =
    review.classification === "mechanical" && review.routeAnswer === null
      ? "mechanical"
      : review.voice
        ? "verdict_voice"
        : "fast_path";
  const lines = [
    `outcome: ${review.decision.outcome} | band: ${review.decision.rating.band}`,
    `decision_source: ${review.provenance.decision_source ?? "jev"}`,
    `verdict_source: ${verdictSource}`,
    `class: ${review.classification}`,
    `summoned: ${summoned.join(", ") || "none"}`,
    `convergence: ${JSON.stringify(review.convergence)}`,
    `can auto-merge: ${review.decision.mergeEligible ? "True" : "False"}`,
    `band_reason: ${review.decision.rating.rationale}`,
    "pipeline_ok: true",
    `vector: ${JSON.stringify(review.riskAnswer?.dimensions ?? {})}`,
    `owned tier: ${review.decision.ownedPathTier ?? "unknown"}`,
    `summoned by ledger: ${review.provenance.summonedByLedger?.join(", ") || "none"}`,
  ];
  const findingById = new Map(
    review.cards.flatMap((card) =>
      card.findings.flatMap((finding) => (finding.id ? [[finding.id, finding] as const] : [])),
    ),
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
