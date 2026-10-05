import { z } from "zod";
import type { CallContext } from "../types.js";
import { claudeEnvironment } from "./claude.js";
import { execute } from "./process.js";

/** The tool-free fallback decider uses exactly the questions and state Jev saw. */
export async function decisionFallback(
  questions: object,
  state: unknown,
  context: CallContext,
  executable = "claude",
): Promise<Record<string, unknown>> {
  const properties = Object.fromEntries(
    Object.entries(questions).map(([name, question]) => {
      const noul = question.type === "noul";
      const key = noul ? "noul" : "score";
      return [
        name,
        {
          type: "object",
          properties: {
            [key]: { type: noul ? "number" : "integer", minimum: 0, maximum: noul ? 1 : 3 },
          },
          required: [key],
          additionalProperties: false,
        },
      ];
    }),
  );
  const schema = {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
  const prompt = `You are Margot's FALLBACK decider. Jev is unavailable. Judge ONLY the supplied change description. Answer every question. A noul is the probability [0,1] that review is needed. A score is an integer 0–3 against the supplied anchors. Your degraded decision cannot auto-merge. When uncertain prefer review and the higher score. Return only the required JSON.\n\n=== CHANGE DESCRIPTION (state) ===\n${JSON.stringify(state)}\n\n=== QUESTIONS ===\n${JSON.stringify(questions)}`;
  const raw = await execute(
    executable,
    [
      "-p",
      prompt,
      "--json-schema",
      JSON.stringify(schema),
      "--output-format",
      "json",
      "--model",
      "claude-haiku-4-5",
      "--no-session-persistence",
      "--setting-sources",
      "user",
      "--settings",
      '{"disableAllHooks":true}',
      "--strict-mcp-config",
      "--tools",
      "",
    ],
    { signal: context.signal, env: claudeEnvironment(process.env) },
  );
  const envelope = JSON.parse(raw);
  if (envelope.is_error || String(envelope.subtype ?? "").startsWith("error"))
    throw new Error("Fallback decider envelope reported an error");
  const answers = z
    .record(z.string(), z.unknown())
    .parse(typeof envelope.result === "string" ? JSON.parse(envelope.result) : envelope.result);
  return Object.fromEntries(
    Object.entries(questions).map(([name, question]) => {
      if (question.type === "noul")
        return [
          name,
          { type: "noul", ...z.object({ noul: z.number().min(0).max(1) }).parse(answers[name]) },
        ];
      const { score } = z.object({ score: z.number().int().min(0).max(3) }).parse(answers[name]);
      return [
        name,
        {
          type: "score",
          confidence: 0,
          probabilities: Object.fromEntries(
            [0, 1, 2, 3].map((level) => [String(level), Number(level === score)]),
          ),
        },
      ];
    }),
  );
}
