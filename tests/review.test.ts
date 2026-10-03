import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jevAdapter } from "../src/adapters/jev.js";
import { parseVoice } from "../src/adapters/prose.js";
import { type Recording, recordedServices, review } from "../src/index.js";
import { riskQuestions } from "../src/questions.js";
import { checkText } from "../src/render.js";
import { cardNames, configSchema, factsSchema, requestSchema } from "../src/schemas.js";

interface Patch {
  path: string;
  value: unknown;
}
interface Scenario {
  name: string;
  recording: string;
  patches: Patch[];
  expected: Record<string, unknown>;
  questionContract?: {
    key: string;
    rules: string[];
  };
}
const scenarios = JSON.parse(
  readFileSync(new URL("./scenarios.json", import.meta.url), "utf8"),
) as Scenario[];
function patch(target: unknown, changes: Patch[]): void {
  for (const change of changes) {
    const parts = change.path.split(".");
    const key = parts.pop();
    let parent = target as Record<string, unknown>;
    for (const part of parts) parent = parent[part] as Record<string, unknown>;
    if (key) parent[key] = change.value;
  }
}
for (const scenario of scenarios) {
  it(scenario.name, async () => {
    const recording = JSON.parse(
      readFileSync(new URL(`../recordings/${scenario.recording}.json`, import.meta.url), "utf8"),
    ) as Recording;
    patch(recording, scenario.patches);
    const services = recordedServices(recording);
    const result = await review(recording.request, recording.config, services);
    const observed: Record<string, unknown> = {
      kind: result.kind,
      calls: services.calls.map((c) => c.name),
      writes: services.publications.length,
    };
    if (scenario.questionContract) {
      const classification = services.calls.find((c) => c.name === "classification");
      const questions = (
        classification?.input as {
          questions?: Record<string, unknown>;
        }
      )?.questions;
      const question = questions?.[scenario.questionContract.key];
      observed.questionContract = scenario.questionContract.rules.every(
        (rule) => typeof question === "string" && question.includes(rule),
      );
    }
    const routing = services.calls.find((c) => c.name === "route");
    observed.askedMeaning =
      typeof (
        routing?.input as
          | {
              questions?: Record<string, unknown>;
            }
          | undefined
      )?.questions?.documentationSubstantive === "string";
    if (result.kind === "error")
      Object.assign(observed, {
        stage: result.stage,
        diagnostic: result.diagnostic,
        invalidExternalData:
          result.diagnostic.includes('"code": "invalid_type"') ||
          result.diagnostic.includes('"code": "invalid_format"'),
        eligible: result.mergeEligible,
      });
    if (result.kind === "classified") observed.classification = result.classification;
    if (result.kind === "reviewed") {
      Object.assign(observed, {
        convergence: result.convergence,
        hasLedger: result.report.includes("<!-- margot-ledger:"),
        classification: result.classification,
        routeAnswer: result.routeAnswer,
        riskAnswer: result.riskAnswer,
        routeAnswerMatches: JSON.stringify(result.routeAnswer) === JSON.stringify(recording.route),
        riskAnswerMatches: JSON.stringify(result.riskAnswer) === JSON.stringify(recording.risk),
        outcome: result.decision.outcome,
        band: result.decision.rating.band,
        eligible: result.decision.mergeEligible,
        holds: result.decision.holdReasons,
        cards: result.cards.map((c) => c.name),
        ignored: result.decision.rating.ignoredDimensions,
        voice: result.voice !== null,
        report: result.report,
        publication: result.publication,
        publicationMatches:
          services.publications.length === 1 &&
          JSON.stringify(services.publications[0]) ===
            JSON.stringify({
              expectedHead: result.request.head,
              review: {
                request: result.request,
                classification: result.classification,
                routeAnswer: result.routeAnswer,
                riskAnswer: result.riskAnswer,
                cards: result.cards,
                voice: result.voice,
                decision: result.decision,
                provenance: result.provenance,
                ledger: result.ledger,
                convergence: result.convergence,
                presentation: result.presentation,
              },
              report: result.report,
            }),
        cardPaths: services.calls
          .filter((c) => c.name.startsWith("card:"))
          .map(
            (c) =>
              (
                c.input as {
                  cardPath: string;
                }
              ).cardPath,
          ),
      });
    }
    expect(observed).toMatchObject(scenario.expected);
  });
}
describe("reviewer responses", () => {
  const recording = JSON.parse(
    readFileSync(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
  ) as Recording;
  const request = requestSchema.parse(recording.request);
  it("A moved head cannot approve with publication disabled", async () => {
    const copy = structuredClone(recording);
    copy.config = { ...configSchema.parse(copy.config), publication: "none" };
    copy.head = "f".repeat(40);
    const result = await review(request, copy.config, recordedServices(copy));
    expect(result.kind === "error" && !result.mergeEligible).toBe(true);
  });
});
describe("classification and availability", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  const request = requestSchema.parse(seed.request);
  const context = () => ({ signal: AbortSignal.timeout(3000) });
  it("carries measured mechanical confidence into the comment and saved result", async () => {
    const r = recording();
    r.classification = { source: "jev", functional: 0, documentation: 0, mechanical: 0.87 };
    const result = await review(r.request, r.config, recordedServices(r));
    expect(result).toMatchObject({
      kind: "reviewed",
      provenance: { mechanicalProbability: 0.87 },
      ledger: { receipt: { review: { provenance: { mechanicalProbability: 0.87 } } } },
      report: expect.stringContaining("Mechanical change (confidence 87%)"),
    });
  });
  it("uses the requested functional classification", async () => {
    const r = recording();
    r.request = { ...request, classification: "functional" };
    expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
      kind: "reviewed",
      classification: "functional",
      provenance: { classification: "dispatch" },
    });
  });
  it("reviews as functional when trusted triage is unavailable", async () => {
    const r = recording();
    r.facts = { ...facts, triage: null };
    expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
      kind: "reviewed",
      classification: "functional",
      provenance: { classification: "triage_unavailable" },
    });
  });
  it("reviews as functional when the requested classification is invalid", async () => {
    const r = recording();
    r.request = { ...request, classification: "garbage" };
    expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
      kind: "reviewed",
      classification: "functional",
    });
  });
  it("publishes the review even when progress updates fail", async () => {
    const r = recording();
    const services = recordedServices(r);
    let attempts = 0;
    const result = await review(r.request, r.config, {
      ...services,
      progress: async () => {
        attempts++;
        throw new Error("phase unavailable");
      },
    });
    expect({ kind: result.kind, attempts, writes: services.publications.length }).toMatchObject({
      kind: "reviewed",
      attempts: 2,
      writes: 1,
    });
  });
  it("holds incomplete history for the operator and disarms auto-merge before model calls", async () => {
    const r = recording();
    r.facts = { ...facts, history: { complete: false, priorLedger: true, reviews: [] } };
    const services = recordedServices(r);
    expect(await review(r.request, r.config, services)).toEqual({
      kind: "held",
      request: r.request,
      reason: "Review history unavailable",
      recovery:
        "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
      mergeEligible: false,
    });
    expect(services.calls.map((call) => call.name)).toEqual(["facts", "head", "disableAutoMerge"]);
    expect(services.publications).toEqual([]);
  });
  it("holds functional reviews with unreadable history even when the council would clear", async () => {
    const r = JSON.parse(readFileSync("recordings/council-clear.json", "utf8")) as Recording;
    r.facts = { ...factsSchema.parse(r.facts), history: { complete: false, priorLedger: false } };
    const services = recordedServices(r);
    expect(await review(r.request, r.config, services)).toEqual({
      kind: "held",
      request: r.request,
      reason: "Review history unavailable",
      recovery:
        "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
      mergeEligible: false,
    });
    expect(services.publications).toEqual([]);
  });
  const outage = (fallback: NonNullable<Parameters<typeof jevAdapter>[0]["fallback"]>) =>
    jevAdapter({
      key: "test",
      model: "test",
      retries: 0,
      fetch: async () => new Response("{}", { status: 503 }),
      fallback,
    });
  it("holds approval and records fallback provenance when risk uses the fallback", async () => {
    const r = JSON.parse(readFileSync("recordings/council-clear.json", "utf8")) as Recording;
    const adapter = outage(async (questions) =>
      Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { type: "score", confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
        ]),
      ),
    );
    const risk = (await adapter.risk(facts, [], riskQuestions, context())) as {
      source: string;
    };
    r.risk = risk;
    const result = await review(r.request, r.config, recordedServices(r));
    expect({
      kind: result.kind,
      eligible: result.kind === "reviewed" && result.decision.mergeEligible,
      machine:
        result.kind === "reviewed" && checkText(result).includes("decision_source: fallback"),
    }).toMatchObject({ kind: "reviewed", eligible: false, machine: true });
  });
  it("allows clear documentation reviews after conservative outage routing", async () => {
    const r = recording();
    r.classification = { source: "jev", functional: 0, documentation: 1, mechanical: 0 };
    r.route = {
      source: "jev_unreachable",
      documentationSubstantive: 1,
      confidence: 0,
      cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
    };
    r.cards = Object.fromEntries(
      cardNames.map((name) => [
        name,
        { name, completion: "completed", checked: [], notCovered: [], findings: [] },
      ]),
    );
    const result = await review(r.request, r.config, recordedServices(r));
    expect({
      kind: result.kind,
      eligible: result.kind === "reviewed" && result.decision.mergeEligible,
      source: result.kind === "reviewed" && result.provenance.decision_source,
    }).toMatchObject({ kind: "reviewed", eligible: true, source: "jev" });
  });
});

describe("voice publication safeguards", () => {
  function voiceRecording(prose: string): Recording {
    const recording = JSON.parse(
      readFileSync("recordings/mechanical-bump.json", "utf8"),
    ) as Recording;
    recording.request = { ...requestSchema.parse(recording.request), classification: "functional" };
    recording.route = {
      source: "jev",
      cards: Object.fromEntries(cardNames.map((name) => [name, 0])),
      confidence: 0,
      documentationSubstantive: null,
    };
    recording.voice = parseVoice(prose);
    return recording;
  }

  it("refuses approval with an open clarification before publication", async () => {
    const recording = voiceRecording(
      "outcome: APPROVED\nband: LOW\nband_reason: Bounded change\nrisk: configuration change\nsummary: Reviewed\nclarification: Which behavior should callers receive?\nestablished:\ndismissed:\n",
    );
    const services = recordedServices(recording);
    expect(await review(recording.request, recording.config, services)).toMatchObject({
      kind: "error",
      mergeEligible: false,
      diagnostic: "Approval contradicts an open clarification",
    });
    expect(services.publications).toEqual([]);
  });

  it("refuses approval with an established finding outside the mandatory set", async () => {
    const recording = voiceRecording(
      "outcome: APPROVED\nband: LOW\nband_reason: Bounded change\nsummary: Reviewed\nestablished:\n- F999 · The guard is missing\ndismissed:\n",
    );
    const services = recordedServices(recording);
    expect(await review(recording.request, recording.config, services)).toMatchObject({
      kind: "error",
      mergeEligible: false,
      diagnostic: "Approval contradicts unresolved findings",
    });
    expect(services.publications).toEqual([]);
  });

  it.each(["summary", "risk", "band_reason", "finding", "clarification"])(
    "refuses self-attribution in the voice's %s before publication",
    async (field) => {
      const fields = {
        outcome: "CHANGES_REQUESTED",
        band: "LOW",
        band_reason: "Bounded change",
        risk: "configuration change",
        summary: "Reviewed",
        finding: "",
        clarification: "",
        [field]: "Generated with Claude Code",
      };
      const recording = voiceRecording(
        Object.entries(fields)
          .map(([name, value]) => `${name}: ${value}`)
          .join("\n"),
      );
      const services = recordedServices(recording);
      expect(await review(recording.request, recording.config, services)).toMatchObject({
        kind: "error",
        mergeEligible: false,
        diagnostic: expect.stringContaining("Attribution leak in review prose"),
      });
      expect(services.publications).toEqual([]);
    },
  );
});
