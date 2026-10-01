import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { type Recording, recordedServices, review } from "../src/index.js";

interface Patch {
  path: string;
  value: unknown;
}
interface Scenario {
  name: string;
  recording: string;
  patches: Patch[];
  expected: Record<string, unknown>;
  questionContract?: { key: string; rules: string[] };
  break: Patch[];
  defect: string;
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
      const questions = (classification?.input as { questions?: Record<string, unknown> })
        ?.questions;
      const question = questions?.[scenario.questionContract.key];
      observed.questionContract = scenario.questionContract.rules.every(
        (rule) => typeof question === "string" && question.includes(rule),
      );
    }
    const routing = services.calls.find((c) => c.name === "route");
    observed.askedMeaning =
      typeof (routing?.input as { questions?: Record<string, unknown> } | undefined)?.questions
        ?.documentationSubstantive === "string";
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
              },
              report: result.report,
            }),
        cardPaths: services.calls
          .filter((c) => c.name.startsWith("card:"))
          .map((c) => (c.input as { cardPath: string }).cardPath),
      });
    }
    expect(observed).toMatchObject(scenario.expected);
  });
}
