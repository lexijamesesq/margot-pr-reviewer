import { recordedServices } from "../../src/adapters/recorded.js";
import { ledgerBlock } from "../../src/ledger.js";
import { review } from "../../src/review.js";
import { cardNames, configSchema, factsSchema, requestSchema } from "../../src/schemas.js";
import type { Card, Ledger, ReviewCore, RoundScope, Voice } from "../../src/types.js";
import { readRecording } from "./recordings.js";

export const source = readRecording("council-clear");
export const facts = factsSchema.parse(source.facts);
export const config = configSchema.parse({
  ...(source.config as object),
  trustedLedgerActors: ["reviewer[bot]"],
});
export const oldHead = "b".repeat(40);
export const entry = (
  severity: "MINOR" | "MAJOR" | "BLOCKING" = "MAJOR",
  status: "standing" | "dismissed" = "standing",
): Ledger["entries"][number] => ({
  key: "R1-F1",
  card: "safety",
  status,
  severity,
  round_raised: 1,
  location: "a.ts:1",
  what: "Unsafe access",
  ...(status === "dismissed" ? { reason: "Operator authorization" } : {}),
});
export const prior = (entries = [entry()], round = 1): Ledger => ({
  v: 1,
  head: oldHead,
  round,
  entries,
});
export const posted = (ledger: Ledger, actor = "reviewer[bot]") => ({
  id: 1,
  actor,
  actorType: "Bot",
  head: ledger.head,
  submittedAt: "2026-09-01T00:00:00Z",
  body: `review\n${ledgerBlock(ledger)}`,
});
export const history = (ledger = prior()) => ({
  ...facts,
  history: { complete: true, priorLedger: true, reviews: [posted(ledger)] },
});
export const scope = (entries = [entry()], round = 2): RoundScope => ({
  round,
  priorHead: oldHead,
  full: false,
  diff: "delta",
  files: [{ path: "a.ts" }],
  entries,
});
export const card = (findings: Card["findings"] = [], name: Card["name"] = "safety"): Card => ({
  name,
  completion: "completed",
  checked: ["Checked access at a.ts:1"],
  notCovered: [],
  findings,
});
export const finding = (
  severity: "MINOR" | "MAJOR" | "BLOCKING" = "MAJOR",
  extra: Partial<Card["findings"][number]> = {},
): Card["findings"][number] => ({
  id: "F1",
  tag: "issue",
  severity,
  confidence: "HIGH",
  location: "a.ts:1",
  what: "Unsafe access",
  late: "new",
  ...extra,
});
export const voice = (
  status: "established" | "dismissed" = "dismissed",
  id = "verify-R1-F1",
): Voice => ({
  outcome: status === "dismissed" ? "APPROVED" : "CHANGES_REQUESTED",
  band: "LOW",
  rationale: "Bounded change",
  summary: "Checked",
  risk: "access control",
  dispositions: [{ id, status, reason: "a.ts:1 now validates access" }],
});
export const core = (cards: Card[], v: Voice | null): ReviewCore => ({
  request: requestSchema.parse(source.request),
  classification: "functional",
  routeAnswer: null,
  riskAnswer: null,
  cards,
  voice: v,
  decision: {
    outcome: v?.outcome ?? "APPROVED",
    rating: {
      band: "LOW",
      rationale: "Bounded",
      evidence: null,
      ignoredDimensions: [],
      voiceOverride: null,
    },
    mergeEligible: v?.outcome !== "CHANGES_REQUESTED",
    holdReasons: [],
  },
  provenance: {
    cardBundle: config.cardBundle.commit,
    classification: "fresh-jev",
    services: "recorded",
  },
});
export const diff = (path = "a.ts") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
export const comparison = (text = diff()) => ({
  base: oldHead,
  head: facts.head,
  status: "ahead",
  diff: text,
  complete: true,
});
export async function margot(classification = "mechanical", editorial = false) {
  const r = structuredClone(source);
  r.config = { ...config, publication: "none" };
  // The verified triage carries the class under test.
  r.facts = {
    ...history(),
    triage: { ...(source.facts as { triage: object }).triage, classification },
  };
  r.classification = {
    source: "jev",
    functional: classification === "functional" ? 1 : 0,
    mechanical: classification === "mechanical" ? 1 : 0,
    documentation: classification === "documentation" ? 1 : 0,
  };
  r.route = {
    source: "jev",
    cards: Object.fromEntries(cardNames.map((n) => [n, 0])),
    confidence: 1,
    documentationSubstantive: editorial ? 0 : null,
  };
  r.cards = { safety: card() };
  r.voice = voice("established");
  const services = recordedServices(r);
  const result = await review(r.request, r.config, services);
  return { result, services, r };
}
