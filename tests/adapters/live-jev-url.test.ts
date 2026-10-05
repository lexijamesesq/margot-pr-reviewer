import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveServices } from "../../src/adapters/live.js";
import type { Recording } from "../../src/index.js";
import { classificationQuestions } from "../../src/questions.js";
import { factsSchema, liveConfigSchema } from "../../src/schemas.js";

const sample = () =>
  JSON.parse(readFileSync(new URL("../../samples/config.sample.json", import.meta.url), "utf8"));
const facts = factsSchema.parse(
  (
    JSON.parse(
      readFileSync(new URL("../../recordings/mechanical-bump.json", import.meta.url), "utf8"),
    ) as Recording
  ).facts,
);

/** The URL the live services call when asked to classify, with fetch stubbed out. */
async function classifyUrl(jev: Record<string, unknown>) {
  const config = { ...sample(), jev: { ...sample().jev, ...jev } };
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        model: config.jev.model,
        answers: Object.fromEntries(
          Object.keys(classificationQuestions).map((name) => [name, { type: "noul", noul: 0 }]),
        ),
      }),
    ),
  );
  await liveServices(config, { jevKey: "key" }).services.classify(facts, classificationQuestions, {
    signal: AbortSignal.timeout(3000),
  });
  return String(fetchSpy.mock.calls[0]?.[0]);
}

describe("the Jev endpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls the configured jev.url", async () => {
    expect(await classifyUrl({ url: "https://jev.example.test/v1/score" })).toBe(
      "https://jev.example.test/v1/score",
    );
  });

  it("calls the TypeSafe endpoint when no url is configured", async () => {
    expect(await classifyUrl({})).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("rejects a jev.url that is not https", () => {
    const config = { ...sample(), jev: { model: "m", url: "http://jev.example.test" } };
    expect(liveConfigSchema.safeParse(config).success).toBe(false);
  });
});
