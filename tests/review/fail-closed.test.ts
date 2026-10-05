import { describe, expect, it } from "vitest";
import {
  type Change,
  missingHead,
  type RecordingName,
  recorded,
  reviewRecording,
  withBundle,
  withCardPath,
  withClassification,
  withConfig,
  withFacts,
  withFailure,
  withHead,
  withoutConfig,
  withPublicationReceipt,
  withRequest,
  withRiskDimension,
  withVoiceFields,
} from "../helpers/review.js";

interface Rejection {
  when: string;
  change: Change;
  stage: string;
  /** The recording the change applies to; defaults to council-clear. */
  recording?: RecordingName;
}

/** Inputs and answers that must stop the review with an error that cannot approve. */
const rejections: Rejection[] = [
  { when: "the trusted configuration is missing", change: withoutConfig(), stage: "input" },
  { when: "the request is malformed", change: withRequest({ pr: 0 }), stage: "input" },
  { when: "the facts are incomplete", change: withFacts({ complete: false }), stage: "facts" },
  { when: "the file listing is truncated", change: withFacts({ fileCount: 61 }), stage: "facts" },
  { when: "the fetched head is stale", change: withFacts({ head: missingHead }), stage: "facts" },
  {
    when: "the facts describe another repository",
    change: withFacts({ repository: "example/other" }),
    stage: "facts",
  },
  {
    when: "the classification came from the fallback",
    change: (draft) => {
      withRequest({ phase: "triage" })(draft);
      withClassification({ source: "fallback" })(draft);
    },
    stage: "classification",
  },
  {
    when: "a classification probability is out of range",
    change: (draft) => {
      withRequest({ phase: "triage" })(draft);
      withClassification({ mechanical: 2 })(draft);
    },
    stage: "classification",
  },
  {
    when: "a route score is null",
    change: (draft) => {
      draft.route.cards = { ...draft.route.cards, safety: null };
    },
    stage: "route",
  },
  {
    when: "a risk dimension is missing",
    change: withRiskDimension("operations", null),
    stage: "risk",
  },
  {
    when: "a risk distribution does not sum to one",
    change: withRiskDimension("operations", { probabilities: [1, 1, 1, 1], confidence: 1 }),
    stage: "risk",
  },
  {
    when: "the bundle commit differs from the pin",
    change: withBundle({ commit: missingHead }),
    stage: "bundle",
  },
  {
    when: "a selected lens has no explicit card path",
    change: withCardPath("safety", ""),
    stage: "bundle",
  },
  {
    when: "a card comes back under another lens's name",
    change: (draft) => {
      (draft.cards.safety as Record<string, unknown>).name = "house-style";
    },
    stage: "card:safety",
  },
  {
    when: "two cards reuse one finding ID",
    change: (draft) => {
      const findings = (draft.cards["maintainable-no-slop"] as { findings: { id: string }[] })
        .findings;
      (findings[0] as { id: string }).id = "F1";
    },
    stage: "cards",
    recording: "author-changes",
  },
  {
    when: "the head moved before publication",
    change: withHead(missingHead),
    stage: "publication-head",
  },
  {
    when: "the publication receipt names a different SHA",
    change: withPublicationReceipt({ head: missingHead }),
    stage: "publication",
  },
  {
    when: "the classification service fails",
    change: (draft) => {
      withRequest({ phase: "triage" })(draft);
      withFailure("classification", "service unavailable")(draft);
    },
    stage: "classification",
  },
  {
    when: "the route service fails",
    change: withFailure("route", "service unavailable"),
    stage: "route",
  },
  {
    when: "the risk service fails",
    change: withFailure("risk", "service unavailable"),
    stage: "risk",
  },
  {
    when: "a card service fails",
    change: withFailure("card:safety", "service unavailable"),
    stage: "card:safety",
  },
  {
    when: "the publish service fails",
    change: withFailure("publish", "service unavailable"),
    stage: "publication",
  },
  {
    when: "a card never returns before the deadline",
    change: (draft) => {
      withFailure("card:safety", "never-returns")(draft);
      withConfig({ timeoutMs: 10 })(draft);
    },
    stage: "card:safety",
  },
  {
    when: "the voice service fails",
    change: withFailure("voice", "voice failed"),
    stage: "voice",
    recording: "voice-hold",
  },
  {
    when: "the voice rules an unknown outcome",
    change: withVoiceFields({ outcome: "UNDECIDED" }),
    stage: "voice",
    recording: "voice-hold",
  },
];

describe("failing closed", () => {
  for (const { when, change, stage, recording = "council-clear" } of rejections) {
    it(`errors at the ${stage} stage without merge eligibility when ${when}`, async () => {
      const { result } = await reviewRecording(recorded(recording, change));
      expect(result).toMatchObject({ kind: "error", stage, mergeEligible: false });
    });
  }
});
