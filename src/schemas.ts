import { z } from "zod";

const text = z.string().min(1);
const probability = z.number().min(0).max(1);
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const disableAutoMergeSchema = z.boolean();
export const cardNames = [
  "safety",
  "works-and-proven",
  "principal-engineer",
  "achieves-the-objective",
  "maintainable-no-slop",
  "house-style",
] as const;
export const dimensions = [
  "blast_radius",
  "reversibility",
  "data_security",
  "operations",
  "verification_gap",
] as const;
export const classNames = ["functional", "documentation", "mechanical"] as const;
export const classSchema = z.enum(classNames);
export const cardNameSchema = z.enum(cardNames);
export const bandSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const requestSchema = z.strictObject({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  pr: z.number().int().positive(),
  base: shaSchema,
  head: shaSchema,
  phase: z.enum(["triage", "review"]),
});
export const configSchema = z
  .strictObject({
    protectedPaths: z.array(text),
    trustedCheckActors: z.array(text),
    trustedTriageActors: z.array(text),
    requiredChecks: z.array(text),
    cardBundle: z.strictObject({ commit: shaSchema }),
    classificationThreshold: probability,
    routeThreshold: probability,
    riskTailThreshold: probability,
    confidenceThreshold: probability,
    noCouncilConfidenceFloor: probability,
    timeoutMs: z.number().int().positive(),
    publication: z.enum(["record", "none"]),
    calibration: z.boolean(),
  })
  .refine(
    (c) =>
      c.classificationThreshold > 0 &&
      c.routeThreshold > 0 &&
      c.riskTailThreshold > 0 &&
      c.confidenceThreshold > 0 &&
      c.noCouncilConfidenceFloor > 0,
    "Thresholds must be positive",
  );
export const factsSchema = z.strictObject({
  repository: text,
  pr: z.number().int().positive(),
  base: shaSchema,
  head: shaSchema,
  title: text,
  body: z.string(),
  author: text,
  diff: text,
  complete: z.boolean(),
  fileCount: z.number().int().positive(),
  files: z.array(z.strictObject({ path: text, previousPath: text.optional() })).min(1),
  checks: z.array(
    z.strictObject({
      name: text,
      actor: text,
      head: shaSchema,
      conclusion: z.enum(["success", "failure", "pending", "skipped"]),
    }),
  ),
  history: z.strictObject({ complete: z.boolean(), priorLedger: z.boolean() }),
  triage: z
    .strictObject({ actor: text, base: shaSchema, head: shaSchema, classification: classSchema })
    .nullable(),
  autoMergeArmed: z.boolean(),
});
export const classificationSchema = z.strictObject({
  source: z.literal("jev"),
  functional: probability,
  documentation: probability,
  mechanical: probability,
});
export const routeSchema = z.strictObject({
  source: z.literal("jev"),
  cards: z.record(cardNameSchema, probability),
  confidence: probability,
  documentationSubstantive: probability.nullable(),
});
export const riskSchema = z.strictObject({
  source: z.literal("jev"),
  dimensions: z.record(
    z.enum(dimensions),
    z.strictObject({
      probabilities: z
        .tuple([probability, probability, probability, probability])
        .refine(
          (p) => Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 0.015,
          "Probabilities must sum to one",
        ),
      confidence: probability,
    }),
  ),
});
export const findingSchema = z.strictObject({
  id: text,
  tag: z.enum(["issue", "info"]),
  severity: z.enum(["MINOR", "MAJOR", "BLOCKING"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  location: text,
  what: text,
});
export const cardSchema = z.strictObject({
  name: cardNameSchema,
  completion: z.literal("completed"),
  checked: z.array(text).min(1),
  notCovered: z.array(text),
  findings: z.array(findingSchema),
});
export const voiceSchema = z.strictObject({
  outcome: z.enum(["APPROVED", "CHANGES_REQUESTED", "CLARIFICATION_REQUESTED"]),
  band: bandSchema,
  rationale: text,
  summary: text,
  dispositions: z.array(
    z.strictObject({
      id: text,
      status: z.enum(["established", "dismissed", "question"]),
      reason: text,
    }),
  ),
});
export const bundleSchema = z.strictObject({
  commit: shaSchema,
  reviewerAgent: z.literal("publish:pr-reviewer"),
  voiceAgent: z.literal("publish:margot"),
  cardPaths: z.record(cardNameSchema, z.string().regex(/^\//)),
});
export const publicationSchema = z.strictObject({
  head: shaSchema,
  recorded: z.literal(true),
  id: text,
});
