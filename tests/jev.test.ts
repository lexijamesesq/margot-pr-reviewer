import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decisionFallback } from "../src/adapters/decision-fallback.js";
import { jevAdapter } from "../src/adapters/jev.js";
import * as processAdapter from "../src/adapters/process.js";
import { type Recording, recordedServices, review } from "../src/index.js";
import { classificationQuestions, riskQuestions, routeQuestions } from "../src/questions.js";
import {
  cardNames,
  classificationSchema,
  dimensions,
  factsSchema,
  requestSchema,
  riskSchema,
  routeSchema,
} from "../src/schemas.js";
import measuredP1 from "./p1-questions.json" with { type: "json" };
import { present } from "./present.js";

const recording = JSON.parse(
  readFileSync(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
) as Recording;
const request = requestSchema.parse(recording.request);
const facts = factsSchema.parse(recording.facts);
const context = () => ({ signal: AbortSignal.timeout(3000) });
function jev(
  answer: unknown,
  options: {
    failures?: number;
    status?: number;
  } = {},
) {
  let attempts = 0;
  const calls: unknown[] = [];
  const adapter = jevAdapter({
    key: "test-only",
    model: "test-model",
    retries: 1,
    minTimeout: 1,
    fetch: async (_input, init) => {
      attempts++;
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ model: "test-model", answers: answer }), {
        status: attempts <= (options.failures ?? 0) ? (options.status ?? 503) : 200,
      });
    },
  });
  return { adapter, calls, attempts: () => attempts };
}
const classes = {
  functional: { type: "noul", noul: 0 },
  documentation: { type: "noul", noul: 0 },
  mechanical: { type: "noul", noul: 1 },
};
it("normalizes Jev nouls into classification probabilities", async () => {
  const j = jev({ ...classes, mechanical: { type: "noul", noul: 1 } });
  const result = await j.adapter.classify(facts, classificationQuestions, context());
  expect(classificationSchema.parse(result).mechanical === 1).toBe(true);
});
it("sends the exact measured P1 questions for classification", async () => {
  const j = jev(classes);
  await j.adapter.classify(facts, classificationQuestions, context());
  expect(
    JSON.stringify(
      (
        j.calls[0] as {
          questions: unknown;
        }
      ).questions,
    ) === JSON.stringify(measuredP1),
  ).toBe(true);
});
it("keeps full code evidence and excludes author prose in classification", async () => {
  const j = jev(classes);
  await j.adapter.classify(
    {
      ...facts,
      title: "External release changes",
      body: "New external behavior",
      author: "release-bot",
    },
    classificationQuestions,
    context(),
  );
  const sent = (
    j.calls[0] as {
      state: Record<string, unknown>;
    }
  ).state;
  expect(
    j.calls.length === 1 &&
      sent.diff === facts.diff &&
      sent.head === facts.head &&
      sent.base === facts.base &&
      ["title", "body", "author", "history"].every((name) => !(name in sent)),
  ).toBe(true);
});
it("fails validation for a malformed Jev classification", async () => {
  await expect(
    jev({ ...classes, mechanical: { type: "noul", noul: "yes" } }).adapter.classify(
      facts,
      classificationQuestions,
      context(),
    ),
  ).rejects.toThrow();
});
it("retries a transient Jev response and recovers", async () => {
  const j = jev(classes, { failures: 1 });
  await j.adapter.classify(facts, classificationQuestions, context());
  expect(j.attempts() === 2).toBe(true);
});
it("treats Jev authentication failures as terminal", async () => {
  const j = jev(classes, { failures: 1, status: 401 });
  const answer = (await j.adapter.classify(facts, classificationQuestions, context())) as {
    source: string;
  };
  expect(answer.source === "jev_unreachable" && j.attempts() === 1).toBe(true);
});
it("requests functional review during a classifier outage", async () => {
  const j = jev(classes, { failures: 3 });
  const services = { ...recordedServices(recording), classify: j.adapter.classify };
  const result = await review({ ...request, phase: "triage" }, recording.config, services);
  expect(result).toMatchObject({
    kind: "classified",
    classification: "functional",
    decision_source: "jev_unreachable",
  });
});
it("preserves risk levels in Jev score distributions", async () => {
  const answers = Object.fromEntries(
    dimensions.map((d) => [
      d,
      {
        type: "score",
        confidence: 0.8,
        probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 },
      },
    ]),
  );
  const r = await jev(answers).adapter.risk(facts, [], riskQuestions, context());
  expect(riskSchema.parse(r).dimensions.operations.probabilities[2] === 1).toBe(true);
});
it("preserves routing uncertainty in Jev exposure confidence", async () => {
  const answers = Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0.5 }]));
  const r = await jev({
    ...answers,
    documentationSubstantive: { type: "noul", noul: 1 },
    exposure: {
      type: "score",
      confidence: 0,
      probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 },
    },
  }).adapter.route(facts, "documentation", routeQuestions, context());
  expect(routeSchema.parse(r).confidence === 0).toBe(true);
});
describe("bound evidence batching", () => {
  const source = JSON.parse(
    readFileSync(new URL("../recordings/council-clear.json", import.meta.url), "utf8"),
  ) as Recording;
  const facts = factsSchema.parse(source.facts);
  for (const [name, check] of [
    ["retains every evidence byte when batching", "evidence"],
    ["takes conservative maximum tails across batched risk", "severity"],
    ["preserves the lowest confidence across batches", "confidence"],
  ] as const)
    it(name, async () => {
      const { jevAdapter } = await import("../src/adapters/jev.js");
      const requests: Record<string, unknown>[] = [];
      const { riskQuestions } = await import("../src/questions.js");
      const data = { ...facts, diff: "a.ts evidence 🐱 ".repeat(8000) };
      const client = jevAdapter({
        key: "test",
        model: "test",
        fetch: (async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          requests.push(request.state);
          const last = request.state.evidencePart === request.state.totalParts;
          const high = last;
          return new Response(
            JSON.stringify({
              model: "test",
              answers: Object.fromEntries(
                Object.keys(riskQuestions).map((k) => [
                  k,
                  {
                    type: "score",
                    confidence: last ? 0.1 : 0.9,
                    probabilities: high
                      ? { "0": 0, "1": 0, "2": 0, "3": 1 }
                      : { "0": 1, "1": 0, "2": 0, "3": 0 },
                  },
                ]),
              ),
            }),
          );
        }) as typeof fetch,
      });
      const output = (await client.risk(data, [], riskQuestions, {
        signal: AbortSignal.timeout(3000),
      })) as {
        dimensions: {
          operations: {
            probabilities: number[];
            confidence: number;
          };
        };
      };
      const expected = { facts: { ...data } as Partial<typeof facts>, cards: [] };
      delete expected.facts.history;
      const reconstructed = requests.map((r) => r.evidence).join("");
      expect(
        check === "evidence"
          ? { ok: reconstructed === JSON.stringify(expected) }
          : check === "severity"
            ? { ok: output.dimensions.operations.probabilities[3] === 1 }
            : { ok: output.dimensions.operations.confidence === 0.1 },
      ).toMatchObject({ ok: true });
    });
  it("keeps functional evidence from the final batch through aggregation", async () => {
    const { jevAdapter } = await import("../src/adapters/jev.js");
    const { classificationQuestions } = await import("../src/questions.js");
    const client = jevAdapter({
      key: "test",
      model: "test",
      fetch: (async (_url, init) => {
        const r = JSON.parse(String(init?.body));
        const last = r.state.evidencePart === r.state.totalParts;
        return new Response(
          JSON.stringify({
            model: "test",
            answers: {
              functional: { type: "noul", noul: last ? 0.9 : 0.1 },
              documentation: { type: "noul", noul: 0.1 },
              mechanical: { type: "noul", noul: 0.9 },
            },
          }),
        );
      }) as typeof fetch,
    });
    expect(
      await client.classify(
        { ...facts, diff: "a.ts evidence ".repeat(4000) },
        classificationQuestions,
        { signal: AbortSignal.timeout(3000) },
      ),
    ).toMatchObject({ functional: 0.9 });
  });
});
describe("fallback decisions", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  const context = () => ({ signal: AbortSignal.timeout(3000) });
  const outage = (fallback: NonNullable<Parameters<typeof jevAdapter>[0]["fallback"]>) =>
    jevAdapter({
      key: "test",
      model: "test",
      retries: 0,
      fetch: async () => new Response("{}", { status: 503 }),
      fallback,
    });
  it("requests functional review without fallback classification during a Jev outage", async () => {
    let calls = 0;
    const adapter = outage(async () => {
      calls++;
      return {};
    });
    const result = await adapter.classify(facts, classificationQuestions, context());
    expect({ answer: result, calls }).toMatchObject({
      answer: { source: "jev_unreachable", functional: 1 },
      calls: 0,
    });
  });
  it("routes functional reviews through the fallback during a Jev outage", async () => {
    let calls = 0;
    const adapter = outage(async (questions, state) => {
      calls++;
      expect(state).toHaveProperty("diff", facts.diff);
      return Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          key === "exposure"
            ? { type: "score", confidence: 0, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } }
            : { type: "noul", noul: 1 },
        ]),
      );
    });
    const answer = await adapter.route(facts, "functional", routeQuestions, context());
    expect({ answer, calls }).toMatchObject({
      answer: { source: "fallback", cards: Object.fromEntries(cardNames.map((name) => [name, 1])) },
      calls: 1,
    });
  });
  it("routes documentation to every card without calling the fallback during a Jev outage", async () => {
    let calls = 0;
    const adapter = outage(async (questions) => {
      calls++;
      return Object.fromEntries(
        Object.keys(questions).map((name) => [
          name,
          name === "exposure"
            ? { type: "score", confidence: 0, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } }
            : { type: "noul", noul: 1 },
        ]),
      );
    });
    const answer = await adapter.route(facts, "documentation", routeQuestions, context());
    expect({ answer, calls }).toMatchObject({
      answer: {
        source: "jev_unreachable",
        documentationSubstantive: 1,
        cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
      },
      calls: 0,
    });
  });
  it("fails functional routing when Jev and the fallback are unavailable", async () => {
    const adapter = outage(async () => {
      throw new Error("Haiku unavailable");
    });
    await expect(adapter.route(facts, "functional", routeQuestions, context())).rejects.toThrow();
  });
  it("asks Haiku for structured decisions with bound evidence and no tools", async () => {
    const spy = vi.spyOn(processAdapter, "execute");
    let flags: string[] = [];
    spy.mockImplementation(async (_file, args) => {
      flags = args;
      return JSON.stringify({
        result: JSON.stringify({ lens: { noul: 0.9 }, exposure: { score: 2 } }),
      });
    });
    try {
      const answers = await decisionFallback(
        {
          lens: { type: "noul", instructions: "Lens needed?" },
          exposure: { type: "score", criteria: ["none", "low", "medium", "high"] },
        },
        { diff: facts.diff },
        context(),
      );
      const forbidden = flags.indexOf("--tools");
      const schema = JSON.parse(present(flags[flags.indexOf("--json-schema") + 1]));
      return expect({
        answers,
        model: flags[flags.indexOf("--model") + 1],
        tools: flags[forbidden + 1],
        strict: flags.includes("--strict-mcp-config"),
        state: present(flags[1]).includes(JSON.stringify({ diff: facts.diff })),
        required: schema.required,
      }).toMatchObject({
        answers: { lens: { noul: 0.9 }, exposure: { confidence: 0, probabilities: { "2": 1 } } },
        model: "claude-haiku-4-5",
        tools: "",
        strict: true,
        state: true,
        required: ["lens", "exposure"],
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("rejects an error-marked fallback response", async () => {
    const spy = vi.spyOn(processAdapter, "execute").mockResolvedValue(
      JSON.stringify({
        is_error: true,
        subtype: "error_max_turns",
        result: { lens: { noul: 0.8 } },
      }),
    );
    try {
      await expect(decisionFallback({ lens: { type: "noul" } }, {}, context())).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
describe("Jev failure diagnostics", () => {
  async function classifyDuring(status: number) {
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((message) => {
      warnings.push(String(message));
    });
    try {
      const j = jev({}, { failures: 99, status });
      const result = await j.adapter.classify(facts, classificationQuestions, context());
      return { result, warnings: warnings.join("\n"), attempts: j.attempts() };
    } finally {
      warn.mockRestore();
    }
  }
  it.each([401, 403])(
    "reports a rejected credential (HTTP %i) as authentication",
    async (status) => {
      const { result, warnings } = await classifyDuring(status);
      expect(result).toMatchObject({ source: "jev_unreachable", functional: 1 });
      expect(warnings).toContain(`Jev authentication rejected (HTTP ${status})`);
      expect(warnings).not.toContain("Jev unavailable");
    },
  );
  it("reports a server error as an outage, not an authentication failure", async () => {
    const { result, warnings } = await classifyDuring(503);
    expect(result).toMatchObject({ source: "jev_unreachable", functional: 1 });
    expect(warnings).toContain("Jev unavailable (HTTP 503)");
    expect(warnings).not.toContain("authentication");
  });
  it("reports a transport failure with its cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = jevAdapter({
        key: "test-only",
        model: "test-model",
        retries: 0,
        fetch: async () => {
          throw new Error("connect ETIMEDOUT");
        },
      });
      await adapter.classify(facts, classificationQuestions, context());
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "Jev transport unavailable: connect ETIMEDOUT",
      );
    } finally {
      warn.mockRestore();
    }
  });
  it("names the authentication cause when documentation routing degrades", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const j = jev({}, { failures: 99, status: 401 });
      const answer = await j.adapter.route(facts, "documentation", routeQuestions, context());
      expect(answer).toMatchObject({ source: "jev_unreachable" });
      expect(String(warn.mock.calls[0]?.[0])).toContain("Jev authentication rejected (HTTP 401)");
    } finally {
      warn.mockRestore();
    }
  });
});
