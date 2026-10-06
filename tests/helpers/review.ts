import { type Recording, recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import { cardNames, dimensions } from "../../src/schemas.js";
import type { ReviewResult } from "../../src/types.js";
import { readRecording } from "./recordings.js";

/*
 * Builders for review tests. A test starts from a recording in `recordings/` and applies
 * small named changes in code, so the test body states both its input and its expectation.
 * The recordings are the only JSON these tests read.
 */

type Obj = Record<string, unknown>;
export type CardName = (typeof cardNames)[number];

/** A recording whose parts are open to editing. Values are still untrusted, as in production. */
export interface Draft extends Recording {
  request: Obj;
  config: Obj | null;
  facts: Obj & { checks: Obj[]; files: Obj[] };
  classification: Obj;
  route: Obj & { cards: Obj };
  risk: Obj & { dimensions: Record<string, Obj> };
  bundle: Obj;
  cards: Record<string, Obj>;
  voice: Obj;
}
/** One named edit to a recording. */
export type Change = (draft: Draft) => void;

export type RecordingName =
  | "author-changes"
  | "council-clear"
  | "invalid-accounting"
  | "mechanical-bump"
  | "no-council-floor"
  | "prior-ledger"
  | "voice-hold";

export const missingHead = "b".repeat(40);
export const currentHead = "0000000000000000000000000000000000000002";

export function loadRecording(name: RecordingName): Draft {
  return readRecording(name) as unknown as Draft;
}

/** Loads a recording and applies each change in order. */
export function recorded(name: RecordingName, ...changes: Change[]): Draft {
  const draft = loadRecording(name);
  for (const change of changes) change(draft);
  return draft;
}

/** Runs the review against the recording and keeps what the services saw. */
export async function reviewRecording(draft: Draft) {
  const services = recordedServices(draft);
  const result = await review(draft.request, draft.config, services);
  return {
    result,
    calls: services.calls.map((call) => call.name),
    /** The input a service received; fails the test when the service was never called. */
    callInput: (name: string): Obj => {
      const call = services.calls.find((candidate) => candidate.name === name);
      if (!call) throw new Error(`Expected the review to call ${name}`);
      return call.input as Obj;
    },
    publications: services.publications,
  };
}

export type Reviewed = Extract<ReviewResult, { kind: "reviewed" }>;

/** Reviews the recording and fails the test unless the review completed. */
export async function reviewed(draft: Draft) {
  const run = await reviewRecording(draft);
  if (run.result.kind !== "reviewed")
    throw new Error(`Expected a completed review, got ${JSON.stringify(run.result)}`);
  return { ...run, result: run.result as Reviewed };
}

// --- Changes to the request, configuration and facts ---

export const withRequest =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.request, fields);
  };
export const withConfig =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.config as Obj, fields);
  };
export const withoutConfig = (): Change => (draft) => {
  draft.config = null;
};
export const withFacts =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.facts, fields);
  };
export const withFiles =
  (...paths: (string | Obj)[]): Change =>
  (draft) => {
    draft.facts.files = paths.map((file) => (typeof file === "string" ? { path: file } : file));
  };
/** Replaces the recorded required-check runs. */
export const withChecks =
  (...checks: Obj[]): Change =>
  (draft) => {
    draft.facts.checks = checks;
  };
/** Edits the first recorded check run. */
export const withCheck =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.facts.checks[0] as Obj, fields);
  };
export const checkRun = (conclusion: string, id: number, startedAt: string): Obj => ({
  name: "ci",
  actor: "checks-app",
  head: currentHead,
  conclusion,
  startedAt,
  id,
});
export const withTriage =
  (fields: Obj): Change =>
  (draft) => {
    draft.facts.triage = {
      actor: "triage-app",
      base: "a".repeat(40),
      head: currentHead,
      classification: "mechanical",
      ...fields,
    };
  };

// --- Changes to what the services answered ---

/** No verified triage for this head, so the review asks Jev to classify. */
export const withoutTriage = (): Change => withFacts({ triage: null });
export const withClassification =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.classification, fields);
  };
export const classifiedAs = (functional: number, documentation: number, mechanical: number) =>
  ({ source: "jev", functional, documentation, mechanical }) satisfies Obj;
export const withRoute =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.route, fields);
  };
/** Routes exactly these lenses with the given scores; every other lens scores zero. */
export const withRoutedCards =
  (scores: Partial<Record<CardName, number>> = {}): Change =>
  (draft) => {
    draft.route.cards = Object.fromEntries(cardNames.map((name) => [name, scores[name] ?? 0]));
  };
export const withNoCouncil = (): Change => withRoutedCards({});
export const withRouteConfidence = (confidence: number): Change => withRoute({ confidence });

export type Dimension = { probabilities: number[]; confidence: number };
export const riskDimensions = dimensions;
/** A risk answer that gives every dimension the same distribution. */
export const uniformRisk = (dimension: Dimension): Obj => ({
  source: "jev",
  dimensions: Object.fromEntries(riskDimensions.map((name) => [name, { ...dimension }])),
});
export const withRisk =
  (risk: Obj): Change =>
  (draft) => {
    draft.risk = risk as Draft["risk"];
  };
export const withRiskDimension =
  (name: (typeof riskDimensions)[number], dimension: Dimension | null): Change =>
  (draft) => {
    draft.risk.dimensions[name] = dimension as Obj;
  };
export const confidentLow: Dimension = { probabilities: [0, 1, 0, 0], confidence: 1 };

export const finding = (fields: Obj = {}): Obj => ({
  id: "one",
  tag: "issue",
  severity: "MAJOR",
  confidence: "HIGH",
  location: "guide.md:1",
  what: "The documented command deletes required data.",
  ...fields,
});
export const completedCard = (name: string, findings: Obj[] = []): Obj => ({
  name,
  completion: "completed",
  checked: ["Compared the documented command to executable behavior."],
  notCovered: [],
  findings,
});
export const withCard =
  (name: CardName, card: Obj): Change =>
  (draft) => {
    draft.cards[name] = card;
  };
export const withCardFields =
  (name: CardName, fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.cards[name] as Obj, fields);
  };

/**
 * A documentation change, as the verified triage classified it, whose lens answers are
 * recorded: routing selects no lens, Jev says whether the documentation changes meaning,
 * and the proof card is available.
 */
export const asDocumentation =
  (substantive: 1 | 0 | null, ...changes: Change[]): Change =>
  (draft) => {
    withTriage({ classification: "documentation" })(draft);
    withNoCouncil()(draft);
    withRoute({ documentationSubstantive: substantive })(draft);
    withCard("works-and-proven", completedCard("works-and-proven"))(draft);
    for (const change of changes) change(draft);
  };

export const disposition = (id: string, status: string, reason: string): Obj => ({
  id,
  status,
  reason,
});
export const voiceRuling = (
  outcome: string,
  band: string,
  dispositions: Obj[] = [],
  fields: Obj = {},
): Obj => ({
  outcome,
  band,
  rationale: "The bounded behavior is proven.",
  summary: "The selected checks establish the change.",
  dispositions,
  ...fields,
});
export const withVoice =
  (voice: Obj): Change =>
  (draft) => {
    draft.voice = voice;
  };
export const withVoiceFields =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.voice, fields);
  };

// --- Changes to the surrounding systems ---

export const withBundle =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.bundle, fields);
  };
export const withHead =
  (head: unknown): Change =>
  (draft) => {
    draft.head = head;
  };
export const withDisableAutoMerge =
  (answer: unknown): Change =>
  (draft) => {
    draft.disableAutoMerge = answer;
  };
export const withPublicationReceipt =
  (fields: Obj): Change =>
  (draft) => {
    Object.assign(draft.publication as Obj, fields);
  };
/** Makes a service throw. The message `never-returns` makes it hang until the deadline. */
export const withFailure =
  (service: string, message: string): Change =>
  (draft) => {
    draft.failures = { ...draft.failures, [service]: message };
  };

/** The lenses a council-clear review runs, in the order the review calls them. */
export const councilClearCards = [
  "safety",
  "works-and-proven",
  "principal-engineer",
  "maintainable-no-slop",
] as const;
export const councilClearCalls = [
  "facts",
  "route",
  "bundle",
  ...councilClearCards.map((name) => `card:${name}`),
  "risk",
];
