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
import type { CallContext, Card, Facts, Services } from "../types.js";
import { decisionFallback } from "./decision-fallback.js";

const noul = z.object({ type: z.literal("noul"), noul: probability });
const score = z.object({
  type: z.literal("score"),
  confidence: probability,
  // Jev's expected level, 0 to 3.
  score: z.number().min(0).max(3).optional(),
  probabilities: z.object({
    "0": probability,
    "1": probability,
    "2": probability,
    "3": probability,
  }),
});
/**
 * The prose state Jev scores for routing and risk: the PR, its title and body, its files and
 * ownership tier. Routing and risk read no diff unless `extra` carries one.
 */
const changedFiles = (facts: Facts) =>
  facts.files.flatMap((f) => [f.path, ...(f.previousPath ? [f.previousPath] : [])]);
const ownershipTier = (facts: Facts) =>
  typeof facts.ownedPathTier === "string" ? facts.ownedPathTier || "none" : "unknown";
export function jevState(facts: Facts, extra = ""): string {
  const files = changedFiles(facts);
  const body = Array.from(facts.body).slice(0, 1500).join("");
  return [
    `Pull request #${facts.pr} in ${facts.repository} by ${facts.author || "unknown"}.`,
    `Title: ${facts.title}`,
    facts.body ? `Body: ${body}` : "Body: (none)",
    `Changed files (${files.length}): ${files.slice(0, 60).join(", ")}`,
    `CODEOWNERS ownership tier: ${ownershipTier(facts)}`,
    ...(extra ? [extra] : []),
  ].join("\n");
}
/**
 * The state Jev classifies: the code change alone, its files, ownership tier and whole diff.
 * Never the title, body or author: an author's prose must not sway the light path.
 */
export function classificationState(facts: Facts): string {
  const files = changedFiles(facts);
  return [
    `Pull request #${facts.pr} in ${facts.repository}.`,
    `Changed files (${files.length}): ${files.slice(0, 60).join(", ")}`,
    `CODEOWNERS ownership tier: ${ownershipTier(facts)}`,
    `Diff:\n${facts.diff}`,
  ].join("\n");
}
/** The council's findings in the cards' own convention, one `===CARD: name===` block each. */
export function councilText(cards: Card[]): string {
  return cards
    .map((card) =>
      [
        `===CARD: ${card.name}===`,
        `card: ${card.name}`,
        `completion: ${card.completion}${card.completionReason ? `: ${card.completionReason}` : ""}`,
        "Checked:",
        ...card.checked.map((line) => `- ${line}`),
        "Not covered:",
        ...card.notCovered.map((line) => `- ${line}`),
        "Findings:",
        // Findings the ledger synthesized are Margot's, not the card's.
        ...card.findings
          .filter((f) => !f.unconfirmed)
          .flatMap((f) => [
            `- [${f.tag}] ${f.location} · severity=${f.severity} · confidence=${f.confidence}${f.ledger ? ` · ledger=${f.ledger}` : ""}${f.late ? ` · late=${f.late}` : ""}`,
            `    what: ${f.what}`,
            ...(f.detail ? [`    ${f.detail}`] : []),
          ]),
      ].join("\n"),
    )
    .join("\n\n");
}
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
  /** One prose state, whole, as the previous reviewer sent it; never split into excerpts. */
  async function decide(questions: object, state: string, c: CallContext, fallback = false) {
    try {
      return { answers: await ask(questions, state, c), source: "jev" as const };
    } catch (error) {
      if (!fallback || c.signal.aborted) throw error;
      console.warn(`Margot: ${errorMessage(error)}; using the fallback decider`);
      return {
        answers: await (options.fallback ?? decisionFallback)(
          questions,
          state,
          c,
          options.fallbackClaude,
        ),
        source: "fallback" as const,
      };
    }
  }
  const nouls = (questions: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(questions).map(([name, instructions]) => [
        name,
        { type: "noul", instructions },
      ]),
    );
  const classify: Services["classify"] = async (facts, questions, c) => {
    let a: Record<string, unknown>;
    try {
      a = (await decide(nouls(questions), classificationState(facts), c)).answers;
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
    const documentation = classification === "documentation";
    const { documentation_substantive: substance, ...cardQuestions } = questions;
    let response: Awaited<ReturnType<typeof decide>>;
    try {
      response = await decide(
        {
          exposure: routingExposureQuestion,
          ...nouls(cardQuestions),
          ...(documentation && substance ? nouls({ documentation_substantive: substance }) : {}),
        },
        // Only documentation routing reads the diff.
        jevState(facts, documentation ? `Diff:\n${facts.diff}` : ""),
        c,
        !documentation,
      );
    } catch (error) {
      if (!documentation) throw error;
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
      documentationSubstantive:
        documentation && substance ? noul.parse(a.documentation_substantive).noul : null,
    });
  };
  const risk: Services["risk"] = async (facts, cards, questions, c) => {
    const { answers: a, source } = await decide(
      Object.fromEntries(
        Object.entries(questions).map(([name, criteria]) => [
          name,
          {
            type: "score",
            instructions: `Score the change's ${name.replaceAll("_", " ")} against the anchors.`,
            criteria,
          },
        ]),
      ),
      jevState(facts, `Council findings:\n${councilText(cards) || "(no council: no_council)"}`),
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
              ...(s.score === undefined ? {} : { score: s.score }),
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
