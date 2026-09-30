import type { z } from "zod";
import type {
  bundleSchema,
  cardSchema,
  classSchema,
  configSchema,
  factsSchema,
  requestSchema,
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
export type Band = "LOW" | "MEDIUM" | "HIGH";
export type Rating = {
  band: Band;
  rationale: string;
  evidence: RiskEvidence | null;
  ignoredDimensions: string[];
  voiceOverride: Band | null;
};
export type Decision = {
  outcome: Voice["outcome"];
  rating: Rating;
  mergeEligible: boolean;
  holdReasons: string[];
};
export type Review = {
  request: ReviewRequest;
  classification: Classification;
  cards: Card[];
  voice: Voice | null;
  decision: Decision;
  provenance: { cardBundle: string; classification: "fresh-jev"; services: string };
};
export type ReviewResult =
  | ({
      kind: "reviewed";
      report: string;
      publication: { head: string; recorded: true; id: string } | null;
    } & Review)
  | { kind: "classified"; request: ReviewRequest; classification: Classification }
  | { kind: "error"; stage: string; diagnostic: string; mergeEligible: false };
export type CallContext = { signal: AbortSignal };
export interface Services {
  readonly provenance: string;
  facts(request: ReviewRequest, context: CallContext): Promise<unknown>;
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
    },
    context: CallContext,
  ): Promise<unknown>;
  head(request: ReviewRequest, context: CallContext): Promise<string>;
  disableAutoMerge(request: ReviewRequest, context: CallContext): Promise<boolean>;
  /** Must bind every write to expectedHead, abort on movement, and never enable merge. */
  publish(
    input: { expectedHead: string; review: Review; report: string },
    context: CallContext,
  ): Promise<unknown>;
}
