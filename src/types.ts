import type { z } from "zod";
import type {
  bandSchema,
  bundleSchema,
  cardSchema,
  classSchema,
  configSchema,
  convergenceSchema,
  decisionSchema,
  factsSchema,
  ledgerSchema,
  publicationSchema,
  ratingSchema,
  requestSchema,
  reviewCoreSchema,
  riskSchema,
  voiceSchema,
} from "./schemas.js";

export type ReviewRequest = z.infer<typeof requestSchema>;
export type ReviewConfig = z.infer<typeof configSchema>;
export type Facts = z.infer<typeof factsSchema>;
export type Classification = z.infer<typeof classSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Voice = z.infer<typeof voiceSchema>;
export type RiskEvidence = z.infer<typeof riskSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Band = z.infer<typeof bandSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
export type Convergence = z.infer<typeof convergenceSchema>;
export type ReviewCore = z.infer<typeof reviewCoreSchema>;
export type ReviewPresentation = {
  author: string;
  costUsd: number | null;
  durationMs: number;
  files: number;
  runUrl: string | null;
  ticket: { label: string; url: string } | null;
  skipReasons?: Partial<Record<Card["name"], string>>;
};
export type Review = ReviewCore & {
  ledger: Ledger;
  convergence: Convergence;
  presentation?: ReviewPresentation;
};
export type RoundScope = {
  round: number;
  priorHead: string | null;
  full: boolean;
  diff: string;
  files: Facts["files"];
  entries: Ledger["entries"];
};
export type ReviewResult =
  | ({
      kind: "reviewed";
      report: string;
      publication: z.infer<typeof publicationSchema> | null;
    } & Review)
  | { kind: "classified"; request: ReviewRequest; classification: Classification }
  | { kind: "error"; stage: string; diagnostic: string; mergeEligible: false };
export type CallContext = { signal: AbortSignal };
export type ReviewPhaseTitle =
  | "Margot: preflight complete — setting up the review runner"
  | "Margot: council is reviewing the changes"
  | "Margot: posting the verdict";
export interface Services {
  readonly provenance: string;
  /** Transient operator-facing run data; never part of the convergence receipt. */
  reviewMetadata?(): { costUsd?: number; durationMs?: number; runUrl?: string };
  /** Report a phase only after the review has actually entered it. */
  progress?(title: ReviewPhaseTitle, context: CallContext): Promise<unknown>;
  facts(request: ReviewRequest, context: CallContext): Promise<unknown>;
  compare?(request: ReviewRequest, priorHead: string, context: CallContext): Promise<unknown>;
  classify(
    facts: Facts,
    questions: Readonly<Record<string, string>>,
    context: CallContext,
  ): Promise<unknown>;
  route(
    facts: Facts,
    classification: Classification,
    questions: Readonly<Record<string, string>>,
    context: CallContext,
  ): Promise<unknown>;
  risk(
    facts: Facts,
    cards: Card[],
    questions: Readonly<Record<string, readonly string[]>>,
    context: CallContext,
  ): Promise<unknown>;
  bundle(commit: string, context: CallContext): Promise<unknown>;
  card(
    input: {
      facts: Facts;
      name: Card["name"];
      classification: Classification;
      cardPath: string;
      agent: Bundle["reviewerAgent"];
      round: RoundScope;
    },
    context: CallContext,
  ): Promise<unknown>;
  voice(
    input: {
      facts: Facts;
      classification: Classification;
      cards: Card[];
      rating: Rating;
      agent: Bundle["voiceAgent"];
      round: RoundScope;
    },
    context: CallContext,
  ): Promise<unknown>;
  head(request: ReviewRequest, context: CallContext): Promise<unknown>;
  disableAutoMerge(request: ReviewRequest, context: CallContext): Promise<unknown>;
  /** Must bind every write to expectedHead, abort on movement, and never enable merge. */
  publish(
    input: { expectedHead: string; review: Review; report: string },
    context: CallContext,
  ): Promise<unknown>;
}
