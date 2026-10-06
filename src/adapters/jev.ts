import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import { errorMessage } from "../errors.js";
import { routingExposureQuestion } from "../questions.js";
import {
  cardNames,
  classificationSchema,
  dimensions,
  distributionTolerance,
  probability,
  riskSchema,
  routeSchema,
  sumsToOne,
} from "../schemas.js";
import type { CallContext, Card, Facts, Services } from "../types.js";
import { decisionFallback } from "./decision-fallback.js";

const noul = z.object({ type: z.literal("noul"), noul: probability });
const distribution = z.object({
  "0": probability,
  "1": probability,
  "2": probability,
  "3": probability,
});
const score = z.object({
  type: z.literal("score"),
  confidence: probability,
  // Jev's expected level, 0 to 3.
  score: z.number().min(0).max(3).optional(),
  probabilities: distribution,
});
const changedFiles = (facts: Facts) =>
  facts.files.flatMap((f) => [f.path, ...(f.previousPath ? [f.previousPath] : [])]);
const ownershipTier = (facts: Facts) =>
  typeof facts.ownedPathTier === "string" ? facts.ownedPathTier || "none" : "unknown";
/**
 * The prose state Jev scores for routing and risk: the PR, its title and body, its files and
 * ownership tier. Routing and risk read no diff unless `extra` carries one.
 */
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
        ...(card.resolved?.length
          ? ["Resolved:", ...card.resolved.map((line) => `- ${line}`)]
          : []),
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
/** The first question whose noul answer is missing or unreadable, or null. */
function unreadableNouls(answers: Record<string, unknown>, keys: string[]) {
  const key = keys.find((k) => !noul.safeParse(answers[k]).success);
  return key === undefined ? null : `${key}: unreadable`;
}
/** Why a risk dimension falls to a conservative default, or null when it is well-formed. */
function malformedDimension(answer: unknown): string | null {
  if (!answer || typeof answer !== "object") return "missing";
  const distribution = partialDistribution.safeParse(
    (answer as Record<string, unknown>).probabilities,
  ).data;
  if (!distribution) return "no readable distribution";
  if (Object.keys(distribution).length < 4) return "a partial distribution";
  return sumsToOne(Object.values(distribution).map((p) => p ?? 0))
    ? null
    : `a sum off by ${distributionTolerance} or more`;
}
/** A distribution as the previous reviewer read one: any non-empty set of levels, missing ones 0. */
const partialDistribution = z
  .strictObject({
    "0": probability.optional(),
    "1": probability.optional(),
    "2": probability.optional(),
    "3": probability.optional(),
  })
  .refine((levels) => Object.keys(levels).length > 0);
/**
 * One risk dimension, read conservatively: any non-empty distribution is kept, with missing
 * levels read as 0 and the dimension marked `partial`; with none, the level of Jev's score,
 * and with no score level 2. `rate()` rates a well-formed distribution by its tail and a
 * malformed one, partial or off its sum, at no lower than Jev's rounded score. An unreadable
 * confidence is null, which keeps the cautious band: the no-council floor lowers nothing, so
 * a band above LOW is held or ruled by the voice as usual.
 */
function riskDimension(answer: unknown) {
  const raw = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  const level = z.number().min(0).max(3).safeParse(raw.score).data;
  const distribution = partialDistribution.safeParse(raw.probabilities).data;
  const probabilities: number[] = distribution
    ? [
        distribution["0"] ?? 0,
        distribution["1"] ?? 0,
        distribution["2"] ?? 0,
        distribution["3"] ?? 0,
      ]
    : [0, 1, 2, 3].map((l) => Number(l === Math.round(level ?? 2)));
  return {
    confidence: probability.safeParse(raw.confidence).data ?? null,
    ...(level === undefined ? {} : { score: level }),
    ...(distribution && Object.keys(distribution).length < 4 ? { partial: true } : {}),
    probabilities,
  };
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
  /** Told of each re-ask of a malformed answer, for the run's diagnostics. */
  onJevRetry?: (retry: { question: string; attempt: number; reason: string }) => void;
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
  /**
   * One prose state, whole, as the previous reviewer sent it; never split into excerpts. A Jev
   * answer `malformed` faults is asked again, up to three answers in all; the first well-formed
   * one is used, and only when every one is malformed do the conservative defaults apply.
   */
  async function decide(
    question: string,
    malformed: (answers: Record<string, unknown>) => string | null,
    questions: object,
    state: string,
    c: CallContext,
    fallback = false,
  ) {
    let answers: Record<string, unknown>;
    try {
      answers = await ask(questions, state, c);
      for (let attempt = 2; attempt <= 3; attempt++) {
        const reason = malformed(answers);
        if (reason === null) break;
        console.warn(
          `Margot: Jev's ${question} answer is malformed (${reason}); asking again (attempt ${attempt} of 3)`,
        );
        options.onJevRetry?.({ question, attempt, reason });
        answers = await ask(questions, state, c);
      }
      return { answers, source: "jev" as const };
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
      a = (
        await decide(
          "classification",
          (answers) => unreadableNouls(answers, Object.keys(questions)),
          nouls(questions),
          classificationState(facts),
          c,
        )
      ).answers;
    } catch (error) {
      console.warn(
        `Margot: classification unavailable (${errorMessage(error)}); assuming functional`,
      );
      return { source: "jev_unreachable", functional: 1, documentation: 0, mechanical: 0 };
    }
    // An unreadable answer to any class question classifies the change as functional.
    if (unreadableNouls(a, Object.keys(questions))) {
      console.warn("Margot: Jev's classification answer is unreadable; classifying as functional");
      return { source: "jev", functional: 1, documentation: 0, mechanical: 0 };
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
        "route",
        (answers) =>
          (score.safeParse(answers.exposure).success ? null : "exposure: unreadable") ??
          unreadableNouls(answers, [
            ...Object.keys(cardQuestions),
            ...(documentation && substance ? ["documentation_substantive"] : []),
          ]),
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
    // A missing or unreadable answer summons the card, leaves routing unsure, and treats
    // documentation as substantive.
    const answer = (key: string) => noul.safeParse(a[key]).data?.noul ?? 1;
    return routeSchema.parse({
      source,
      cards: Object.fromEntries(cardNames.map((k) => [k, answer(k)])),
      confidence: score.safeParse(a.exposure).data?.confidence ?? 0,
      documentationSubstantive:
        documentation && substance ? answer("documentation_substantive") : null,
    });
  };
  const risk: Services["risk"] = async (facts, cards, questions, c) => {
    const { answers: a, source } = await decide(
      "risk",
      (answers) => {
        for (const name of dimensions) {
          const reason = malformedDimension(answers[name]);
          if (reason) return `${name}: ${reason}`;
        }
        return null;
      },
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
      dimensions: Object.fromEntries(dimensions.map((k) => [k, riskDimension(a[k])])),
    });
  };
  /**
   * The previous reviewer's advisory template-adherence check: is the risk line a short
   * classification, and does each card with findings state its own lens's contribution. It
   * never falls back and never throws: a Jev outage is `unchecked`, and an answer still
   * missing after the re-asks reads as a pass, so it never spuriously flags.
   */
  const adherence: NonNullable<Services["adherence"]> = async (input, c) => {
    const withFindings = input.cards.filter((card) => card.findings.length > 0);
    const questions: Record<string, { type: "noul"; instructions: string }> = {
      risk_is_classification: {
        type: "noul",
        instructions:
          "Is the risk line a SHORT CLASSIFICATION — a few-word noun phrase naming the KIND of exposure (e.g. 'workflow-injection risk' or 'dependency bump, non-behavioral') — rather than a full explanatory sentence? True = a classification; False = a sentence.",
      },
    };
    for (const card of withFindings)
      questions[`distinct__${card.name}`] = {
        type: "noul",
        instructions: `Does the '${card.name}' card's finding state ITS OWN review lens's distinct contribution, rather than merely RESTATE in similar words the same root-cause chain another card's finding already states? Several cards independently corroborating one real defect from their own distinct angles is legitimate and is True; only a phrasing-level restatement adding no lens-specific point is False.`,
      };
    const state = [
      `Risk line: ${input.risk}`,
      `Summary: ${input.summary}`,
      "",
      "Council findings (card: finding):",
      ...input.cards.flatMap((card) =>
        card.findings.map((finding) => `- [${card.name}] ${finding.what}`),
      ),
    ].join("\n");
    let answers: Record<string, unknown>;
    try {
      answers = (
        await decide(
          "adherence",
          (a) => unreadableNouls(a, Object.keys(questions)),
          questions,
          state,
          c,
        )
      ).answers;
    } catch (error) {
      console.warn(`Margot: adherence check unchecked (${errorMessage(error)})`);
      return { status: "unchecked" };
    }
    const value = (key: string) => noul.safeParse(answers[key]).data?.noul ?? 1;
    const riskClassificationOk = value("risk_is_classification") >= 0.5;
    const cardsRestating = withFindings
      .filter((card) => value(`distinct__${card.name}`) < 0.5)
      .map((card) => card.name);
    return {
      status: "checked",
      riskClassificationOk,
      cardsRestating,
      ok: riskClassificationOk && cardsRestating.length === 0,
      nouls: Object.fromEntries(Object.keys(questions).map((key) => [key, value(key)])),
    };
  };
  return { classify, route, risk, adherence };
}
