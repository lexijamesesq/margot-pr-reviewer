import picomatch from "picomatch";
import type { z } from "zod";
import {
  cardNames,
  type classificationSchema,
  classNames,
  dimensions,
  type routeSchema,
} from "./schemas.js";
import type {
  Card,
  Classification,
  Decision,
  Facts,
  Rating,
  ReviewConfig,
  RiskEvidence,
  Voice,
} from "./types.js";

export function classify(
  answer: z.infer<typeof classificationSchema>,
  config: ReviewConfig,
): Classification {
  if (answer.source !== "jev") return "functional";
  return classNames.find((name) => answer[name] >= config.classificationThreshold) ?? "functional";
}
/** A standing ledger entry puts a mechanical or editorial change on the full path: routing,
 * the routed and ledger cards, and risk for anything but documentation. */
export function reviewPath(
  classification: Classification,
  route: z.infer<typeof routeSchema> | null,
  config: ReviewConfig,
  ledgerOpen = false,
): { routing: boolean; council: boolean; risk: boolean } {
  const editorial =
    !ledgerOpen &&
    classification === "documentation" &&
    route !== null &&
    route.documentationSubstantive !== null &&
    route.documentationSubstantive < config.routeThreshold;
  const routing = classification !== "mechanical" || ledgerOpen;
  return {
    routing,
    council: routing && !editorial,
    risk: classification === "functional" || (classification === "mechanical" && ledgerOpen),
  };
}
/** The routed cards plus the ledger's; a documentation change with none gets the proof card. */
export function selectCards(
  route: z.infer<typeof routeSchema>,
  classification: Classification,
  config: ReviewConfig,
  recalled: Card["name"][] = [],
): Card["name"][] {
  const selected = [
    ...new Set([
      ...cardNames.filter((name) => route.cards[name] >= config.routeThreshold),
      ...recalled,
    ]),
  ];
  if (classification === "documentation" && selected.length === 0)
    selected.push("works-and-proven");
  return selected;
}
export function rate(
  evidence: RiskEvidence | null,
  noCouncil: boolean,
  config: ReviewConfig,
): Rating {
  if (!evidence)
    return {
      band: "LOW",
      rationale: "No functional risk under the verified class",
      evidence,
      ignoredDimensions: [],
      voiceOverride: null,
    };
  const levels = dimensions.map((name) => {
    const p = evidence.dimensions[name].probabilities;
    return (
      [0, 1, 2, 3]
        .filter((level) => p.slice(level).reduce((a, b) => a + b, 0) >= config.riskTailThreshold)
        .at(-1) ?? 0
    );
  });
  const confident = dimensions.filter(
    (name) => evidence.dimensions[name].confidence >= config.noCouncilConfidenceFloor,
  );
  const ignored =
    noCouncil && confident.length > 0 ? dimensions.filter((name) => !confident.includes(name)) : [];
  const raw = Math.max(...levels);
  const adjusted = Math.max(
    ...levels.filter((_, i) => !ignored.includes(dimensions[i] as (typeof dimensions)[number])),
  );
  const lowered = adjusted < raw;
  const level = lowered ? adjusted : raw;
  return {
    band: level <= 1 ? "LOW" : level === 2 ? "MEDIUM" : "HIGH",
    rationale: lowered
      ? "Confident dimensions; uncertain dimensions excluded"
      : "Highest conservative risk dimension",
    evidence,
    ignoredDimensions: lowered ? ignored : [],
    voiceOverride: null,
  };
}
/** Every `[issue]` across the council gets an id, F1…Fn in card order, assigned once all
 * cards have parsed. An id a card already carries (a recording) is kept; an `[info]` has none. */
export function assignFindingIds(cards: Card[]): void {
  let index = 0;
  for (const card of cards)
    for (const finding of card.findings)
      if (finding.tag === "issue" && finding.id === undefined) finding.id = `F${++index}`;
}
/** The findings the voice must rule on: this round's non-advisory `[issue]` findings.
 * An `[info]` is never mandatory; a BLOCKING `[info]` or any achieves-the-objective
 * finding summons the voice (see `needsVoice`) but is not an ID it must dispose of. */
export function mandatory(cards: Card[]): string[] {
  return cards.flatMap((card) =>
    card.findings.flatMap((f) => (!f.advisory && f.tag === "issue" && f.id ? [f.id] : [])),
  );
}
/** Code cannot affirmatively clear the PR, so the voice rules: any mandatory finding, an
 * achieves-the-objective finding (the clarification signal), a BLOCKING `[info]`, a card that
 * did not complete, a band above LOW, or Jev's own doubt. */
function summonsVoice(cards: Card[]): boolean {
  return cards.some(
    (card) =>
      card.completion !== "completed" ||
      card.findings.some((f) => !f.advisory && f.tag === "issue") ||
      (card.name === "achieves-the-objective" && card.findings.length > 0) ||
      card.findings.some((f) => f.severity === "BLOCKING"),
  );
}
export function needsVoice(
  cards: Card[],
  rating: Rating,
  routeConfidence: number,
  config: ReviewConfig,
): boolean {
  if (summonsVoice(cards)) return true;
  // No cards with confident routing is a clean council: the band alone decides, and a band
  // above LOW is held for the operator without handing the voice an empty council.
  if (rating.band !== "LOW")
    return !(cards.length === 0 && routeConfidence >= config.confidenceThreshold);
  if (cards.length === 0 && routeConfidence < config.confidenceThreshold) return true;
  return (
    rating.evidence !== null &&
    dimensions.some(
      (name) =>
        !rating.ignoredDimensions.includes(name) &&
        (rating.evidence?.dimensions[name].confidence ?? 0) < config.confidenceThreshold,
    )
  );
}
export function validateVoice(cards: Card[], voice: Voice): void {
  const synthesis = [voice.summary, voice.rationale, voice.risk, voice.finding, voice.clarification]
    .join(" ")
    .toLowerCase();
  const attribution = [
    "co-authored-by",
    "generated with",
    "🤖",
    "as an ai",
    "i am claude",
    "i'm claude",
    "powered by claude",
    "claude-session",
  ].find((pattern) => synthesis.includes(pattern));
  if (attribution) throw new Error(`Attribution leak in review prose (matched ${attribution})`);
  // An honest ERROR is Margot's own fail-closed ruling, never an incomplete verdict; a
  // finding she could not resolve legitimately lands in neither list.
  if (voice.outcome === "ERROR") return;
  if (voice.outcome === "APPROVED" && voice.clarification?.trim())
    throw new Error("Approval contradicts an open clarification");
  const advisory = cards.flatMap((c) =>
    c.findings.flatMap((f) => (f.advisory && f.id ? [f.id] : [])),
  );
  if (voice.dispositions.some((d) => advisory.includes(d.id) && d.status !== "dismissed"))
    throw new Error("Voice cannot reestablish advisory findings");
  const required = mandatory(cards);
  const ids = voice.dispositions.map((d) => d.id);
  // Completeness rule: every mandatory finding of this round lands in exactly one
  // bucket. IDs outside this round's findings (a prior round's ledger key the voice reports
  // as fixed) are not an error; the ledger, not the voice, settles those.
  if (new Set(ids).size !== ids.length || required.some((id) => !ids.includes(id)))
    throw new Error("Voice must account for every mandatory finding exactly once");
  if (voice.outcome === "APPROVED" && voice.dispositions.some((d) => d.status !== "dismissed"))
    throw new Error("Approval contradicts unresolved findings");
}
export function decide(
  classification: Classification,
  facts: Facts,
  config: ReviewConfig,
  rating: Rating,
  voice: Voice | null,
): Decision {
  const finalRating: Rating = voice
    ? {
        ...rating,
        band: classification === "documentation" ? "LOW" : voice.band,
        rationale: voice.rationale,
        voiceOverride: voice.band,
      }
    : rating;
  const holdReasons: string[] = [];
  if (
    typeof facts.ownedPathTier !== "string" ||
    !["none", "owned", "required_owned"].includes(facts.ownedPathTier)
  )
    holdReasons.push("ownership-uncomputed");
  const protectedPath = picomatch(config.protectedPaths, { dot: true });
  const authorityPaths = [
    ...new Set(
      facts.files.flatMap((file) =>
        [file.path, ...(file.previousPath ? [file.previousPath] : [])].filter((path) =>
          protectedPath(path),
        ),
      ),
    ),
  ];
  const protectedRename = facts.files.some(
    (f) => f.previousPath && (protectedPath(f.path) || protectedPath(f.previousPath)),
  );
  if (
    protectedRename ||
    (classification === "functional" && facts.files.some((f) => protectedPath(f.path)))
  )
    holdReasons.push("review-authority");
  if (finalRating.band !== "LOW") holdReasons.push("risk");
  if (config.calibration) holdReasons.push("calibration");
  const outcome = voice?.outcome ?? "APPROVED";
  // ERROR is held for the operator (posted `action_required`); the other two go
  // back to the author.
  if (outcome === "ERROR") holdReasons.push("error");
  else if (outcome !== "APPROVED") holdReasons.push("author-action");
  return {
    outcome,
    rating: finalRating,
    mergeEligible: holdReasons.length === 0,
    holdReasons,
    authorityPaths,
    ownedPathTier: typeof facts.ownedPathTier === "string" ? facts.ownedPathTier : "unknown",
  };
}

/** Every reason an approved review is held, most telling first; a missing "risk" sentence is filled with the band. */
const holdSentences: [string, string][] = [
  ["review-authority", "it touches a protected path"],
  ["fallback-risk", "the risk was scored by a fallback (reduced confidence)"],
  ["fallback-routing", "routing fell back to a simpler model (reduced confidence)"],
  // Saved by 0.6.12, before the step was recorded; a replayed receipt still carries it.
  ["fallback", "a model step fell back (reduced confidence)"],
  ["ownership-uncomputed", "ownership could not be established"],
  ["calibration", "calibration mode is on"],
  ["risk", ""],
];

/** The one reason a held review is held, for the comment and the check title alike. */
export function holdReason(decision: { holdReasons: string[]; rating: { band: string } }): {
  reason: string;
  sentence: string;
} {
  if (
    decision.holdReasons.includes("fallback-routing") &&
    decision.holdReasons.includes("fallback-risk") &&
    !decision.holdReasons.includes("review-authority")
  )
    return {
      reason: "fallback-risk",
      sentence: "routing and risk both fell back (reduced confidence)",
    };
  const [reason, sentence] = holdSentences.find(([r]) => decision.holdReasons.includes(r)) ?? [
    "risk",
    "",
  ];
  return { reason, sentence: sentence || `risk is ${decision.rating.band}` };
}

/** Which model step fell back, for the review comment; null when none did. */
export function fallbackNotice(holdReasons: string[]): string | null {
  const routing = holdReasons.includes("fallback-routing");
  const risk = holdReasons.includes("fallback-risk");
  if (routing && risk)
    return "The risk model was unavailable — routing and risk were both decided by a fallback at reduced confidence";
  if (risk)
    return "The risk model was unavailable — this risk was scored by a fallback at reduced confidence";
  if (routing)
    return "The routing model was unavailable — routing fell back to a simpler model at reduced confidence";
  if (holdReasons.includes("fallback"))
    return "A model step was unavailable — a fallback decided it at reduced confidence";
  return null;
}
