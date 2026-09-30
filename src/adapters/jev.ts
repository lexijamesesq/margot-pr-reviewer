import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import { routingExposureQuestion } from "../questions.js";
import {
  cardNames,
  classificationSchema,
  dimensions,
  riskSchema,
  routeSchema,
} from "../schemas.js";
import type { CallContext, Services } from "../types.js";

const probability = z.number().min(0).max(1);
const noul = z.object({ type: z.literal("noul"), noul: probability });
const score = z.object({
  type: z.literal("score"),
  confidence: probability,
  probabilities: z.object({
    "0": probability,
    "1": probability,
    "2": probability,
    "3": probability,
  }),
});
export function jevAdapter(options: {
  key: string;
  model: string;
  url?: string;
  fetch?: typeof fetch;
  retries?: number;
  minTimeout?: number;
}) {
  const transport = options.fetch ?? fetch;
  async function decide(questions: object, state: unknown, c: CallContext) {
    const raw = await pRetry(
      async () => {
        let response: Response;
        try {
          response = await transport(options.url ?? "https://api.typesafe.ai/v1/systemone", {
            method: "POST",
            headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: options.model, questions, state }),
            signal: c.signal,
          });
        } catch {
          throw new Error("Jev transport unavailable");
        }
        if (!response.ok) {
          const error = new Error(`Jev HTTP ${response.status}`);
          if (response.status !== 429 && response.status < 500) throw new AbortError(error);
          throw error;
        }
        try {
          return await response.json();
        } catch {
          throw new Error("Jev response is not JSON");
        }
      },
      {
        retries: options.retries ?? 4,
        minTimeout: options.minTimeout ?? 1000,
        maxTimeout: 8000,
        randomize: true,
        signal: c.signal,
      },
    );
    const envelope = z
      .object({ model: z.literal(options.model), answers: z.record(z.string(), z.unknown()) })
      .parse(raw);
    return envelope.answers;
  }
  const nouls = (questions: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(questions).map(([name, instructions]) => [
        name,
        { type: "noul", instructions },
      ]),
    );
  const classify: Services["classify"] = async (facts, questions, c) => {
    const a = await decide(nouls(questions), facts, c);
    return classificationSchema.parse({
      source: "jev",
      ...Object.fromEntries(Object.keys(questions).map((k) => [k, noul.parse(a[k]).noul])),
    });
  };
  const route: Services["route"] = async (facts, _classification, questions, c) => {
    const a = await decide({ ...nouls(questions), exposure: routingExposureQuestion }, facts, c);
    const cards = Object.fromEntries(cardNames.map((k) => [k, noul.parse(a[k]).noul]));
    return routeSchema.parse({
      source: "jev",
      cards,
      confidence: score.parse(a.exposure).confidence,
      documentationSubstantive: questions.documentationSubstantive
        ? noul.parse(a.documentationSubstantive).noul
        : null,
    });
  };
  const risk: Services["risk"] = async (facts, cards, questions, c) => {
    const a = await decide(
      Object.fromEntries(
        Object.entries(questions).map(([name, criteria]) => [
          name,
          {
            type: "score",
            instructions: `Score this change's ${name.replaceAll("_", " ")} against these anchors.`,
            criteria,
          },
        ]),
      ),
      { facts, cards },
      c,
    );
    return riskSchema.parse({
      source: "jev",
      dimensions: Object.fromEntries(
        dimensions.map((k) => {
          const s = score.parse(a[k]);
          return [
            k,
            {
              confidence: s.confidence,
              probabilities: [
                s.probabilities["0"],
                s.probabilities["1"],
                s.probabilities["2"],
                s.probabilities["3"],
              ],
            },
          ];
        }),
      ),
    });
  };
  return { classify, route, risk };
}
