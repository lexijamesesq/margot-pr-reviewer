import type { Review } from "./types.js";

export function render(review: Review): string {
  const { decision, request, cards, voice } = review;
  return [
    `## ${decision.outcome}`,
    `Risk: **${decision.rating.band}** — ${decision.rating.rationale}`,
    `Class: ${review.classification}. Merge eligible: ${decision.mergeEligible ? "yes" : "no"}.`,
    `Reviewed ${request.repository} PR ${request.pr} at ${request.head}.`,
    voice?.summary ?? "The selected review path completed without unresolved findings.",
    ...cards.map((c) => `- ${c.name}: ${c.findings.length} finding(s); ${c.checked.join("; ")}`),
    ...cards.flatMap((c) =>
      c.findings.map((f) => `- ${f.id} (${f.severity}, ${f.location}): ${f.what}`),
    ),
    ...(voice?.dispositions.map((d) => `- ${d.id}: ${d.status} — ${d.reason}`) ?? []),
    ...(decision.holdReasons.length ? [`Held: ${decision.holdReasons.join(", ")}.`] : []),
    `Evidence: ${review.provenance.services}; card bundle ${review.provenance.cardBundle}.`,
  ].join("\n\n");
}
