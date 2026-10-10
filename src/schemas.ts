import { z } from "zod";

const text = z.string().min(1);
export const probability = z.number().min(0).max(1);
export const repositorySchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "Repository must be owner/name");
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
/** A risk distribution is well-formed when its levels sum to one within this tolerance. */
export const distributionTolerance = 0.015;
/** Whether a distribution's levels sum to one, within the tolerance. */
export const sumsToOne = (levels: number[]) =>
  Math.abs(levels.reduce((total, p) => total + p, 0) - 1) < distributionTolerance;
export const dimensions = [
  "blast_radius",
  "reversibility",
  "data_security",
  "operations",
  "verification_gap",
] as const;
export const classNames = ["functional", "documentation", "mechanical"] as const;
export const checkConclusions = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
  "pending",
] as const;
export const classSchema = z.enum(classNames);
export const cardNameSchema = z.enum(cardNames);
export const bandSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const checkIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const triagePayloadSchema = z
  .strictObject({
    version: z.literal(1),
    repository: repositorySchema,
    pr: checkIdSchema,
    base_sha: shaSchema,
    head_sha: shaSchema,
    classification: classSchema,
    decision_source: z.enum(["jev", "fallback"]),
    mechanical_probability: probability.optional(),
    mechanical: z.boolean().optional(),
  })
  .refine(
    (v) => v.mechanical === undefined || v.mechanical === (v.classification === "mechanical"),
    "Mechanical compatibility field must agree with classification",
  );
export const requestSchema = z.strictObject({
  repository: repositorySchema,
  pr: checkIdSchema,
  base: shaSchema,
  head: shaSchema,
  phase: z.enum(["triage", "review"]),
  triageCheckId: checkIdSchema.optional(),
  workflowRef: text.optional(),
});
export const configSchema = z
  .strictObject({
    protectedPaths: z.array(text),
    trustedCheckActors: z.array(text),
    trustedTriageActors: z.array(text),
    trustedTriageAppId: checkIdSchema.optional(),
    trustedTriageCheckName: text.optional(),
    trustedLedgerActors: z.array(text).default([]),
    requiredChecks: z.array(text),
    requiredCheckReporters: z.record(text, checkIdSchema).optional(),
    allowedSkippedChecks: z.array(text).default([]),
    cardBundle: z.strictObject({ commit: shaSchema }),
    classificationThreshold: probability,
    routeThreshold: probability,
    riskTailThreshold: probability,
    confidenceThreshold: probability,
    noCouncilConfidenceFloor: probability,
    timeoutMs: z.number().int().positive(),
    publication: z.enum(["record", "none", "github"]),
    mergeActor: text.optional(),
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
export const triageFactsSchema = z.strictObject({
  version: z.literal(1),
  name: text,
  status: z.literal("completed"),
  conclusion: z.literal("success"),
  externalId: text,
  actor: text,
  checkId: checkIdSchema,
  appId: checkIdSchema,
  repository: repositorySchema,
  pr: checkIdSchema,
  base: shaSchema,
  head: shaSchema,
  classification: classSchema,
  decisionSource: z.enum(["jev", "fallback"]),
  mechanicalProbability: probability.optional(),
});
export const factsSchema = z.strictObject({
  repository: text,
  pr: checkIdSchema,
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
      appId: checkIdSchema.optional(),
      head: shaSchema,
      // GitHub's own conclusion, or `pending` while the run is not complete.
      conclusion: z.enum(checkConclusions),
      // Recency, for a name that carries several runs on one head (a superseded run
      // stays in the list). Optional: older recordings lack them and fall back to order.
      startedAt: z.string().optional(),
      id: z.number().int().optional(),
    }),
  ),
  history: z.strictObject({
    complete: z.boolean(),
    priorLedger: z.boolean(),
    reviews: z
      .array(
        z.strictObject({
          id: z.number().int().positive(),
          actor: text,
          actorType: text,
          head: shaSchema,
          submittedAt: z.iso.datetime(),
          body: z.string(),
        }),
      )
      .optional(),
  }),
  triage: triageFactsSchema.nullable(),
  ownedPathTier: z.unknown().optional(),
  autoMergeArmed: z.boolean(),
});
export const classificationSchema = z.strictObject({
  source: z.enum(["jev", "fallback"]),
  functional: probability,
  documentation: probability,
  mechanical: probability,
});
export const routeSchema = z.strictObject({
  source: z.enum(["jev", "fallback", "jev_unreachable"]),
  cards: z.record(cardNameSchema, probability),
  confidence: probability,
  documentationSubstantive: probability.nullable(),
});
export const riskSchema = z.strictObject({
  source: z.enum(["jev", "fallback"]),
  dimensions: z.record(
    z.enum(dimensions),
    z.strictObject({
      // Rated by its tail whatever it sums to, as the previous reviewer read it.
      probabilities: z.tuple([probability, probability, probability, probability]),
      // Null when Jev gave no usable confidence: not "unsure", so the band is never lowered.
      confidence: probability.nullable(),
      // Jev's expected level, 0 to 3; it names the kind of exposure on a code verdict.
      score: z.number().min(0).max(3).optional(),
      // Jev gave only some of the four levels; the missing ones read as 0.
      partial: z.boolean().optional(),
    }),
  ),
});
export const findingSchema = z.strictObject({
  // `[issue]` findings are F1…Fn across the council; an `[info]` carries none.
  id: text.optional(),
  tag: z.enum(["issue", "info"]),
  severity: z.enum(["MINOR", "MAJOR", "BLOCKING"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  location: text,
  what: text,
  detail: text.optional(),
  ledger: z
    .string()
    .regex(/^R[1-9]\d*-F[1-9]\d*$/)
    .optional(),
  // Any `late=` value is kept; only a `missed` prefix changes what the ledger does.
  late: text.optional(),
  // No longer read or written; receipts saved by 0.7.0 and earlier still carry it.
  reopens: text.optional(),
  unconfirmed: z.boolean().optional(),
  // The earlier dismissal's reason, on a dismissed finding a card raised again.
  previouslyDismissed: text.optional(),
  // `carried-dismissal` is no longer assigned; receipts saved by 0.7.0 and earlier carry it.
  advisory: z.enum(["minor-after-round-1", "late-non-blocking", "carried-dismissal"]).optional(),
});
export const cardSchema = z.strictObject({
  name: cardNameSchema,
  // The three completion tokens; anything but `completed` cannot affirmatively clear.
  completion: z.enum(["completed", "incomplete", "skipped"]),
  completionReason: text.optional(),
  checked: z.array(text),
  notCovered: z.array(text),
  // From round two: the card's standing entries it closed, each with the lines that fix it.
  resolved: z.array(text).optional(),
  findings: z.array(findingSchema),
});
export const voiceSchema = z.strictObject({
  outcome: z.enum(["APPROVED", "CHANGES_REQUESTED", "CLARIFICATION_REQUESTED", "ERROR"]),
  band: bandSchema,
  rationale: text,
  summary: text,
  risk: z.string().optional(),
  clarification: z.string().optional(),
  finding: z.string().optional(),
  dispositions: z.array(
    z.strictObject({
      id: text,
      status: z.enum(["established", "dismissed", "question"]),
      reason: z.string(),
    }),
  ),
});
export const bundleSchema = z.strictObject({
  commit: shaSchema,
  reviewerAgent: z.literal("publish:pr-reviewer"),
  voiceAgent: z.literal("publish:margot"),
});
export const publicationSchema = z.strictObject({
  head: shaSchema,
  recorded: z.boolean(),
  id: text,
});

export const referencesSchema = z.record(
  z.string(),
  z.strictObject({ repository: requestSchema.shape.repository, head: shaSchema }),
);
const referenceRepositorySchema = requestSchema.shape.repository;
export const referenceInputSchema = z
  .strictObject({
    repository: referenceRepositorySchema,
    head: shaSchema.optional(),
    ref: z
      .string()
      .regex(
        /^(?!-)(?!.*\.\.)\S+$/,
        "A reference ref must not contain whitespace or .., or start with -",
      )
      .optional(),
  })
  .refine((reference) => (reference.head === undefined) !== (reference.ref === undefined), {
    message: "A reference gives exactly one of head or ref",
  });
export const publisherSchema = z.strictObject({
  checks: z.strictObject({
    triage: text,
    review: text,
  }),
  actor: text,
  appId: z.number().int().positive(),
  runUrl: z.url(),
});
const environmentVariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const ticketingSchema = z
  .strictObject({
    server: z.string().regex(/^[A-Za-z0-9_-]+$/),
    command: text,
    args: z.array(z.string()),
    env: z
      .array(environmentVariableNameSchema)
      .min(1)
      .refine((names) => new Set(names).size === names.length, "Environment names must be unique"),
    tools: z
      .array(text)
      .min(1)
      .refine((tools) => new Set(tools).size === tools.length, "Ticketing tools must be unique"),
  })
  .refine(
    ({ server, tools }) => tools.every((tool) => tool.startsWith(`mcp__${server}__`)),
    "Ticketing tools must address the configured server",
  );
export const liveConfigSchema = z.strictObject({
  review: configSchema,
  github: z.strictObject({
    gh: z.string().optional(),
    freshShadow: z.boolean().default(false),
    shadowBeforeHead: z.boolean().default(false),
  }),
  publisher: publisherSchema.optional(),
  handoff: z.strictObject({ repository: repositorySchema, workflow: text, ref: text }).optional(),
  jev: z.strictObject({
    model: z.string().min(1),
    url: z.url({ protocol: /^https$/ }).optional(),
  }),
  claude: z.strictObject({
    executable: z.string().min(1),
    ticketing: ticketingSchema.optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    pluginDirectory: z.string().min(1),
    reviewerModel: z.string().min(1),
    references: referencesSchema.optional(),
    /** The runtime image every card and voice invocation runs in, and the base checkout it reads. */
    container: z.strictObject({
      docker: z.string().min(1).default("docker"),
      image: z
        .string()
        .regex(
          /^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/,
          "The container image must be pinned by digest (name@sha256:… or sha256:…)",
        ),
      work: z.string().min(1),
    }),
  }),
});

export const ratingSchema = z.strictObject({
  band: bandSchema,
  rationale: text,
  evidence: riskSchema.nullable(),
  ignoredDimensions: z.array(text),
  voiceOverride: bandSchema.nullable(),
});
export const decisionSchema = z.strictObject({
  outcome: voiceSchema.shape.outcome,
  rating: ratingSchema,
  mergeEligible: z.boolean(),
  holdReasons: z.array(text),
  authorityPaths: z.array(text).optional(),
  ownedPathTier: z.string().optional(),
});
/** The advisory template-adherence check: it informs calibration and never gates. */
export const adherenceSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("skipped") }),
  z.strictObject({ status: z.literal("unchecked") }),
  z.strictObject({
    status: z.literal("checked"),
    riskClassificationOk: z.boolean(),
    cardsRestating: z.array(z.string()),
    ok: z.boolean(),
    nouls: z.record(z.string(), z.number()),
  }),
]);
export const reviewCoreSchema = z.strictObject({
  request: requestSchema,
  classification: classSchema,
  routeAnswer: routeSchema.nullable().default(null),
  riskAnswer: riskSchema.nullable().default(null),
  cards: z.array(cardSchema),
  voice: voiceSchema.nullable(),
  decision: decisionSchema,
  provenance: z.strictObject({
    cardBundle: shaSchema,
    classification: z.string(),
    mechanicalProbability: probability.nullable().optional(),
    summonedByLedger: z.array(cardNameSchema).optional(),
    decision_source: z.enum(["jev", "fallback"]).optional(),
    services: text,
  }),
});
export const convergenceSchema = z.strictObject({
  round: z.number().int().positive(),
  standing: z.number().int().nonnegative(),
  fixed: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  unconfirmed: z.number().int().nonnegative(),
});
export const ledgerEntrySchema = z
  .strictObject({
    key: z.string().regex(/^R[1-9]\d*-F[1-9]\d*$/),
    card: cardNameSchema,
    location: text,
    what: text,
    severity: findingSchema.shape.severity,
    status: z.enum(["standing", "fixed", "dismissed", "advisory"]),
    round_raised: z.number().int().positive(),
    reason: text.optional(),
    late: text.optional(),
    fixed_round: z.number().int().positive().optional(),
    advisory_round: z.number().int().positive().optional(),
  })
  .refine((e) => e.status !== "dismissed" || !!e.reason, "Dismissal requires a reason");
export const ledgerSchema = z
  .strictObject({
    v: z.union([z.literal(1), z.literal(2)]),
    round: z.number().int().positive(),
    head: shaSchema,
    entries: z.array(ledgerEntrySchema),
    receipt: z
      .strictObject({
        configHash: text,
        evidenceHash: text,
        // Historical dispatch fields are inert ledger memory, never accepted on a live request.
        review: reviewCoreSchema.extend({
          request: requestSchema.extend({
            classification: z.string().optional(),
            triage: z.string().optional(),
          }),
        }),
        counts: convergenceSchema,
      })
      .optional(),
  })
  .superRefine((l, ctx) => {
    if (
      new Set(l.entries.map((e) => e.key)).size !== l.entries.length ||
      l.entries.some(
        (e) =>
          e.round_raised > l.round ||
          Number(e.key.split("-")[0]?.slice(1)) !== e.round_raised ||
          (e.fixed_round ?? 0) > l.round ||
          (e.advisory_round ?? 0) > l.round,
      ) ||
      (l.v === 1 && l.receipt !== undefined) ||
      (l.receipt &&
        (l.receipt.counts.standing !== l.entries.filter((e) => e.status === "standing").length ||
          (l.receipt.review.decision.outcome === "APPROVED" && l.receipt.counts.standing > 0) ||
          (l.receipt.review.decision.mergeEligible &&
            (l.receipt.review.decision.outcome !== "APPROVED" ||
              l.receipt.review.decision.rating.band !== "LOW" ||
              l.receipt.review.decision.holdReasons.length > 0)))) ||
      (l.v === 2 &&
        (!l.receipt ||
          l.receipt.review.request.head !== l.head ||
          l.receipt.counts.round !== l.round))
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent ledger" });
  });
export const comparisonSchema = z.strictObject({
  base: shaSchema,
  head: shaSchema,
  status: z.enum(["ahead", "identical", "diverged", "behind"]),
  diff: z.string(),
  complete: z.boolean(),
});
