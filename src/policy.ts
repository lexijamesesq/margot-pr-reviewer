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
  facts: Facts,
  config: ReviewConfig,
): Classification {
  const fresh =
    classNames.find((name) => answer[name] >= config.classificationThreshold) ?? "functional";
  const earlier = facts.triage?.classification ?? fresh;
  return (
    classNames[Math.min(classNames.indexOf(fresh), classNames.indexOf(earlier))] ?? "functional"
  );
}
export function reviewPath(
  classification: Classification,
  route: z.infer<typeof routeSchema> | null,
  config: ReviewConfig,
): { routing: boolean; council: boolean; risk: boolean } {
  const editorial =
    classification === "documentation" &&
    route !== null &&
    route.documentationSubstantive !== null &&
    route.documentationSubstantive < config.routeThreshold;
  return {
    routing: classification !== "mechanical",
    council: classification !== "mechanical" && !editorial,
    risk: classification === "functional",
  };
}
export function selectCards(
  route: z.infer<typeof routeSchema>,
  classification: Classification,
  config: ReviewConfig,
): Card["name"][] {
  const selected = cardNames.filter((name) => route.cards[name] >= config.routeThreshold);
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
/** The findings the voice must rule on: this round's non-advisory `[issue]` findings — Python's
 * rule. An `[info]` is never mandatory; a BLOCKING `[info]` or any achieves-the-objective
 * finding summons the voice (see `needsVoice`) but is not an ID it must dispose of. */
export function mandatory(cards: Card[]): string[] {
  return cards.flatMap((card) =>
    card.findings.filter((f) => !f.advisory && f.tag === "issue").map((f) => f.id),
  );
}
/** Code cannot affirmatively clear the PR, so the voice rules: any mandatory finding, an
 * achieves-the-objective finding (the clarification signal), a BLOCKING `[info]`, a band above
 * LOW, or Jev's own doubt. */
function summonsVoice(cards: Card[]): boolean {
  return cards.some(
    (card) =>
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
  if (summonsVoice(cards) || rating.band !== "LOW") return true;
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
  const advisory = cards.flatMap((c) => c.findings.filter((f) => f.advisory).map((f) => f.id));
  if (voice.dispositions.some((d) => advisory.includes(d.id) && d.status !== "dismissed"))
    throw new Error("Voice cannot reestablish advisory findings");
  const required = mandatory(cards);
  const ids = voice.dispositions.map((d) => d.id);
  // Python's completeness rule: every mandatory finding of this round lands in exactly one
  // bucket. IDs outside this round's findings (a prior round's ledger key the voice reports
  // as fixed) are not an error; the ledger, not the voice, settles those.
  if (new Set(ids).size !== ids.length || required.some((id) => !ids.includes(id)))
    throw new Error("Voice must account for every mandatory finding exactly once");
  if (
    voice.outcome === "APPROVED" &&
    voice.dispositions.some((d) => required.includes(d.id) && d.status !== "dismissed")
  )
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
  if (outcome !== "APPROVED") holdReasons.push("author-action");
  return {
    outcome,
    rating: finalRating,
    mergeEligible: holdReasons.length === 0,
    holdReasons,
    authorityPaths,
  };
}
