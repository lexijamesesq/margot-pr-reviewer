import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import { errorMessage } from "../errors.js";
import { routingExposureQuestion } from "../questions.js";
import {
  cardNames,
  classificationSchema,
  dimensions,
  probability,
  riskSchema,
  routeSchema,
} from "../schemas.js";
import type { CallContext, Services } from "../types.js";
import { decisionFallback } from "./decision-fallback.js";

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
  fallbackClaude: { executable: string; version: string; reviewerModel: string };
  fallback?: typeof decisionFallback;
}) {
  const transport = options.fetch ?? fetch;
  async function ask(questions: object, state: unknown, c: CallContext) {
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
        } catch (error) {
          throw new Error(`Jev transport unavailable: ${errorMessage(error)}`);
        }
        if (!response.ok) {
          // A rejected credential is distinguishable from an outage in every diagnostic.
          const error = new Error(
            response.status === 401 || response.status === 403
              ? `Jev authentication rejected (HTTP ${response.status})`
              : `Jev unavailable (HTTP ${response.status})`,
          );
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
  async function decide(questions: object, input: unknown, c: CallContext, fallback = false) {
    // History belongs to the convergence reducer, not Jev. Keep every byte of the diff.
    const state = structuredClone(input) as Record<string, unknown>;
    const facts = (state.facts ?? state) as Record<string, unknown>;
    delete facts.history;
    const evidence = JSON.stringify(state);
    const chunks = evidence.match(/[\s\S]{1,16000}/gu) ?? [evidence];
    const answers: Record<string, unknown>[] = [];
    let source: "jev" | "fallback" = "jev";
    for (const [index, chunk] of chunks.entries()) {
      const batch =
        chunks.length === 1
          ? state
          : {
              repository: facts.repository,
              pr: facts.pr,
              head: facts.head,
              base: facts.base,
              evidencePart: index + 1,
              totalParts: chunks.length,
              evidence: chunk,
              scope:
                "Contiguous excerpt of complete JSON evidence, possibly continuing across boundaries. Assess the evidence visible in this excerpt; Margot combines every excerpt conservatively.",
            };
      try {
        answers.push(await ask(questions, batch, c));
      } catch (error) {
        if (!fallback || c.signal.aborted) throw error;
        console.warn(`Margot: ${errorMessage(error)}; using the fallback decider`);
        answers.push(
          await (options.fallback ?? decisionFallback)(questions, batch, c, options.fallbackClaude),
        );
        source = "fallback";
      }
    }
    if (answers.length === 1 && answers[0]) return { answers: answers[0], source };
    return {
      source,
      answers: Object.fromEntries(
        Object.keys(questions).map((name) => {
          const values = answers.map((a) => a[name]);
          if (noul.safeParse(values[0]).success)
            return [
              name,
              { type: "noul", noul: Math.max(...values.map((v) => noul.parse(v).noul)) },
            ];
          const scores = values.map((v) => score.parse(v));
          // Maximum tail at each level is a valid conservative distribution.
          const tails = [0, 1, 2, 3].map((level) =>
            Math.max(
              ...scores.map((s) =>
                Object.values(s.probabilities)
                  .slice(level)
                  .reduce((a, b) => a + b, 0),
              ),
            ),
          );
          return [
            name,
            {
              type: "score",
              confidence: Math.min(...scores.map((s) => s.confidence)),
              probabilities: Object.fromEntries(
                tails.map((tail, i) => [String(i), Math.max(0, tail - (tails[i + 1] ?? 0))]),
              ),
            },
          ];
        }),
      ),
    };
  }
  const nouls = (questions: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(questions).map(([name, instructions]) => [
        name,
        { type: "noul", instructions },
      ]),
    );
  const classify: Services["classify"] = async (facts, questions, c) => {
    // Match the measured classifier's code-only evidence. Release notes and author
    // claims describe external behavior and must not change the light-path decision.
    const { title: _title, body: _body, author: _author, ...evidence } = facts;
    let a: Record<string, unknown>;
    try {
      a = (await decide(nouls(questions), evidence, c)).answers;
    } catch (error) {
      console.warn(
        `Margot: classification unavailable (${errorMessage(error)}); assuming functional`,
      );
      return { source: "jev_unreachable", functional: 1, documentation: 0, mechanical: 0 };
    }
    return classificationSchema.parse({
      source: "jev",
      ...Object.fromEntries(Object.keys(questions).map((k) => [k, noul.parse(a[k]).noul])),
    });
  };
  const route: Services["route"] = async (facts, classification, questions, c) => {
    let response: Awaited<ReturnType<typeof decide>>;
    try {
      response = await decide(
        { ...nouls(questions), exposure: routingExposureQuestion },
        facts,
        c,
        classification !== "documentation",
      );
    } catch (error) {
      if (classification !== "documentation") throw error;
      console.warn(`Margot: routing unavailable (${errorMessage(error)}); routing to every card`);
      return {
        source: "jev_unreachable",
        cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
        confidence: 0,
        documentationSubstantive: 1,
      };
    }
    const { answers: a, source } = response;
    const cards = Object.fromEntries(cardNames.map((k) => [k, noul.parse(a[k]).noul]));
    return routeSchema.parse({
      source,
      cards,
      confidence: score.parse(a.exposure).confidence,
      documentationSubstantive: questions.documentationSubstantive
        ? noul.parse(a.documentationSubstantive).noul
        : null,
    });
  };
  const risk: Services["risk"] = async (facts, cards, questions, c) => {
    const { answers: a, source } = await decide(
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
      true,
    );
    return riskSchema.parse({
      source,
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
