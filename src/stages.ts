/**
 * The stage a review was in when it failed: the `stage` of an error result. The review
 * records these and the publisher decides from them what the pull request is told, so
 * both import this one list and a rename is a compile error on either side.
 */
export const stages = {
  input: "input",
  facts: "facts",
  holdHead: "hold-head",
  history: "history",
  triage: "triage",
  classification: "classification",
  checks: "checks",
  compare: "compare",
  bundle: "bundle",
  route: "route",
  cards: "cards",
  risk: "risk",
  voice: "voice",
  render: "render",
  templateGate: "template-gate",
  publicationProgress: "publication-progress",
  publicationHead: "publication-head",
  publication: "publication",
  disableAutoMerge: "disable-auto-merge",
  disableAutoMergeAfterError: "disable-auto-merge-after-error",
} as const;

export type Stage = (typeof stages)[keyof typeof stages];
export type CardStage = `card:${string}`;

/** The stage of one council card's review. */
export const cardStage = (card: string): CardStage => `card:${card}`;

/** Initial classification budgets; routing and risk retain their existing limits. */
export const classificationLimits = {
  jevAttempts: 2,
  retryDelayMs: 1_000,
  jevMs: 15_000,
  fallbackMs: 90_000,
  stageMs: 130_000,
} as const;
