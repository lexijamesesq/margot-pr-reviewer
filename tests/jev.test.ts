import { describe, expect, it, vi } from "vitest";
import { decisionFallback } from "../src/adapters/decision-fallback.js";
import { councilText, jevAdapter, jevState } from "../src/adapters/jev.js";
import * as processAdapter from "../src/adapters/process.js";
import { recordedServices, review } from "../src/index.js";
import { rate } from "../src/policy.js";
import {
  adherenceDistinctQuestion,
  adherenceQuestions,
  adherenceRiskQuestion,
  classificationQuestions,
  riskQuestions,
  routeQuestions,
} from "../src/questions.js";
import {
  cardNames,
  classificationSchema,
  configSchema,
  dimensions,
  factsSchema,
  requestSchema,
  riskSchema,
  routeSchema,
} from "../src/schemas.js";
import goldenClassificationQuestions from "./classification-questions.golden.json" with {
  type: "json",
};
import { present } from "./helpers/present.js";
import { readRecording } from "./helpers/recordings.js";

const recording = readRecording("mechanical-bump");
const request = requestSchema.parse(recording.request);
const facts = factsSchema.parse(recording.facts);
const pinnedClaude = {
  executable: "claude",
  version: "1.0.0",
  reviewerModel: "configured-reviewer-model",
};
const context = () => ({ signal: AbortSignal.timeout(3000) });
function jev(
  answer: unknown,
  options: {
    failures?: number;
    status?: number;
    /** Jev's answers in turn, one per successful response; the last one repeats. */
    sequence?: unknown[];
  } = {},
) {
  let attempts = 0;
  let answered = 0;
  const calls: unknown[] = [];
  const retries: unknown[] = [];
  const adapter = jevAdapter({
    key: "test-only",
    model: "test-model",
    fallbackClaude: pinnedClaude,
    retries: 1,
    minTimeout: 1,
    onJevRetry: (retry) => retries.push(retry),
    fetch: async (_input, init) => {
      attempts++;
      calls.push(JSON.parse(String(init?.body)));
      const failing = attempts <= (options.failures ?? 0);
      const answers = options.sequence
        ? options.sequence[Math.min(failing ? answered : answered++, options.sequence.length - 1)]
        : answer;
      return new Response(JSON.stringify({ model: "test-model", answers }), {
        status: failing ? (options.status ?? 503) : 200,
      });
    },
  });
  return { adapter, calls, retries, attempts: () => attempts };
}
const classes = {
  functional: { type: "noul", noul: 0 },
  documentation: { type: "noul", noul: 0 },
  mechanical: { type: "noul", noul: 1 },
};
it("normalizes Jev nouls into classification probabilities", async () => {
  const j = jev({ ...classes, mechanical: { type: "noul", noul: 1 } });
  const result = await j.adapter.classify(facts, classificationQuestions, context());
  expect(classificationSchema.parse(result).mechanical).toBe(1);
});
it("sends the golden classification questions, in order", async () => {
  const j = jev(classes);
  await j.adapter.classify(facts, classificationQuestions, context());
  expect(JSON.stringify((j.calls[0] as { questions: unknown }).questions)).toBe(
    JSON.stringify(goldenClassificationQuestions),
  );
});
it("classifies the code change alone: files, tier and the whole diff, in one request", async () => {
  const j = jev(classes);
  const diff = "a.ts evidence 🐱 ".repeat(8000);
  await j.adapter.classify(
    {
      ...facts,
      title: "External release changes",
      body: "New external behavior",
      author: "release-bot",
      files: [{ path: "b.ts", previousPath: "a.ts" }],
      ownedPathTier: "required_owned",
      diff,
    },
    classificationQuestions,
    context(),
  );
  expect({ requests: j.calls.length, state: (j.calls[0] as { state: unknown }).state }).toEqual({
    requests: 1,
    state: [
      `Pull request #${facts.pr} in ${facts.repository}.`,
      "Changed files (2): b.ts, a.ts",
      "CODEOWNERS ownership tier: required_owned",
      `Diff:\n${diff}`,
    ].join("\n"),
  });
});
describe("a malformed Jev answer takes the conservative default", () => {
  it("classifies as functional when any class answer is unreadable", async () => {
    expect(
      await jev({ ...classes, mechanical: { type: "noul", noul: "yes" } }).adapter.classify(
        facts,
        classificationQuestions,
        context(),
      ),
    ).toEqual({ source: "jev", functional: 1, documentation: 0, mechanical: 0 });
  });
  it("summons a card whose routing answer is missing or unreadable", async () => {
    const { documentation_substantive: _substance, ...functional } = routeQuestions;
    const answers = {
      ...Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0 }])),
      safety: { type: "noul", noul: "high" },
      "house-style": undefined,
      exposure: { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
    };
    const r = routeSchema.parse(
      await jev(answers).adapter.route(facts, "functional", functional, context()),
    );
    expect(
      Object.entries(r.cards)
        .filter(([, p]) => p === 1)
        .map(([n]) => n),
    ).toEqual(["safety", "house-style"]);
  });
  it("treats routing as unsure when the exposure answer is missing", async () => {
    const answers = Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0 }]));
    const { documentation_substantive: _substance, ...functional } = routeQuestions;
    const r = routeSchema.parse(
      await jev(answers).adapter.route(facts, "functional", functional, context()),
    );
    expect(r.confidence).toBe(0);
  });
  it("treats documentation as substantive when its meaning answer is unreadable", async () => {
    const answers = {
      ...Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0 }])),
      documentation_substantive: { type: "noul" },
      exposure: { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
    };
    const r = routeSchema.parse(
      await jev(answers).adapter.route(facts, "documentation", routeQuestions, context()),
    );
    expect(r.documentationSubstantive).toBe(1);
  });
  it("scores a missing risk dimension at level 2 with no confidence, and an unreadable one by its score", async () => {
    const answers = {
      ...Object.fromEntries(
        dimensions.map((d) => [
          d,
          { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
        ]),
      ),
      operations: undefined,
      data_security: { type: "score", confidence: "high", score: 2.6, probabilities: null },
    };
    const r = riskSchema.parse(
      await jev(answers).adapter.risk(facts, [], riskQuestions, context()),
    );
    expect({
      operations: r.dimensions.operations,
      dataSecurity: r.dimensions.data_security,
    }).toEqual({
      operations: { confidence: null, probabilities: [0, 0, 1, 0] },
      dataSecurity: { confidence: null, score: 2.6, probabilities: [0, 0, 0, 1] },
    });
  });
});
it("retries a transient Jev response and recovers", async () => {
  const j = jev(classes, { failures: 1 });
  await j.adapter.classify(facts, classificationQuestions, context());
  expect(j.attempts()).toBe(2);
});
it("treats Jev authentication failures as terminal", async () => {
  const j = jev(classes, { failures: 1, status: 401 });
  const answer = (await j.adapter.classify(facts, classificationQuestions, context())) as {
    source: string;
  };
  expect(answer.source).toBe("jev_unreachable");
  expect(j.attempts()).toBe(1);
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
  expect(riskSchema.parse(r).dimensions.operations.probabilities[2]).toBe(1);
});
it("rates any non-empty distribution by its tail, whatever it sums to, and only an absent one by its score", async () => {
  const answers = {
    ...Object.fromEntries(
      dimensions.map((d) => [
        d,
        { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
      ]),
    ),
    // Sums to 0.98: the tail puts it at level 2 (P(>=2) = 0.38); its score would say 1.
    operations: {
      type: "score",
      confidence: 0.9,
      score: 1,
      probabilities: { 0: 0.5, 1: 0.1, 2: 0.1, 3: 0.28 },
    },
    // A partial distribution counts its missing levels as 0.
    data_security: { type: "score", confidence: 0.9, score: 0, probabilities: { 2: 1 } },
  };
  const r = riskSchema.parse(await jev(answers).adapter.risk(facts, [], riskQuestions, context()));
  expect({
    operations: r.dimensions.operations.probabilities,
    dataSecurity: r.dimensions.data_security.probabilities,
  }).toEqual({ operations: [0.5, 0.1, 0.1, 0.28], dataSecurity: [0, 0, 1, 0] });
});
it("keeps Jev's score for each risk dimension", async () => {
  const answers = Object.fromEntries(
    dimensions.map((d, i) => [
      d,
      { type: "score", confidence: 0.8, score: i / 4, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
    ]),
  );
  const r = riskSchema.parse(await jev(answers).adapter.risk(facts, [], riskQuestions, context()));
  expect(dimensions.map((d) => r.dimensions[d].score)).toEqual([0, 0.25, 0.5, 0.75, 1]);
});
it("preserves routing uncertainty in Jev exposure confidence", async () => {
  const answers = Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0.5 }]));
  const r = await jev({
    ...answers,
    documentation_substantive: { type: "noul", noul: 1 },
    exposure: {
      type: "score",
      confidence: 0,
      probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 },
    },
  }).adapter.route(facts, "documentation", routeQuestions, context());
  expect(routeSchema.parse(r).confidence).toBe(0);
});
describe("routing and risk state", () => {
  const source = readRecording("council-clear");
  const facts = factsSchema.parse(source.facts);
  const scoreAll = (questions: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(questions).map((k) => [
        k,
        k in riskQuestions || k === "exposure"
          ? { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } }
          : { type: "noul", noul: 0.5 },
      ]),
    );
  const capture = () => {
    const requests: { state: unknown; questions: Record<string, { instructions: string }> }[] = [];
    const client = jevAdapter({
      key: "test",
      model: "test",
      fallbackClaude: pinnedClaude,
      fetch: (async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        return new Response(
          JSON.stringify({ model: "test", answers: scoreAll(request.questions) }),
        );
      }) as typeof fetch,
    });
    return { client, requests };
  };
  const large = {
    ...facts,
    title: "Pin the shell checker",
    body: `Why: ${"x".repeat(2000)}`,
    author: "octocat",
    files: Array.from({ length: 70 }, (_, i) => ({ path: `f${i}.ts` })),
    ownedPathTier: "owned",
    diff: "a.ts evidence 🐱 ".repeat(8000),
  };
  it("routes a functional change on the PR summary, without the diff, in one request", async () => {
    const { client, requests } = capture();
    const { documentation_substantive: _substance, ...functional } = routeQuestions;
    await client.route(large, "functional", functional, context());
    const state = String(requests[0]?.state);
    expect({
      requests: requests.length,
      lines: state.split("\n").map((line) => line.slice(0, 40)),
      body: state.split("\n")[2]?.length,
      files: state.split("\n")[3]?.split(", ").length,
      questions: Object.keys(requests[0]?.questions ?? {}),
      exposure: requests[0]?.questions.exposure?.instructions,
      safety: requests[0]?.questions.safety?.instructions,
    }).toEqual({
      requests: 1,
      lines: [
        "Pull request #2 in example/project by oc",
        "Title: Pin the shell checker",
        `Body: Why: ${"x".repeat(29)}`,
        "Changed files (70): f0.ts, f1.ts, f2.ts,",
        "CODEOWNERS ownership tier: owned",
      ],
      body: "Body: ".length + 1500,
      files: 60,
      questions: ["exposure", ...cardNames],
      exposure: "Score this change's overall security/operational exposure.",
      safety:
        "Does this change need the 'safety' review lens? It does when: a changed file can run, be sourced, grant access, or carry a credential shape.",
    });
  });
  it("routes a documentation change with the whole diff and asks whether its meaning changed", async () => {
    const { client, requests } = capture();
    await client.route(large, "documentation", routeQuestions, context());
    expect({
      requests: requests.length,
      diff: String(requests[0]?.state).endsWith(`\nDiff:\n${large.diff}`),
      last: Object.keys(requests[0]?.questions ?? {}).at(-1),
    }).toEqual({ requests: 1, diff: true, last: "documentation_substantive" });
  });
  it("scores risk on the PR summary and the council's findings, in one request", async () => {
    const { client, requests } = capture();
    const card = {
      name: "safety" as const,
      completion: "completed" as const,
      checked: ["Read the workflow"],
      notCovered: [],
      findings: [
        {
          id: "F1",
          tag: "issue" as const,
          severity: "MAJOR" as const,
          confidence: "HIGH" as const,
          location: "a.ts:1",
          what: "The token reaches the log.",
        },
      ],
    };
    await client.risk(large, [card], riskQuestions, context());
    expect({
      requests: requests.length,
      state: requests[0]?.state,
      instructions: requests[0]?.questions.blast_radius?.instructions,
    }).toEqual({
      requests: 1,
      state: jevState(large, `Council findings:\n${councilText([card])}`),
      instructions: "Score the change's blast radius against the anchors.",
    });
    expect(councilText([card])).toBe(
      [
        "===CARD: safety===",
        "card: safety",
        "completion: completed",
        "Checked:",
        "- Read the workflow",
        "Not covered:",
        "Findings:",
        "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH",
        "    what: The token reaches the log.",
      ].join("\n"),
    );
  });
  it("tells risk when no council ran", async () => {
    const { client, requests } = capture();
    await client.risk(facts, [], riskQuestions, context());
    expect(
      String(requests[0]?.state).endsWith("\nCouncil findings:\n(no council: no_council)"),
    ).toBe(true);
  });
});
describe("fallback decisions", () => {
  const recording = () => readRecording("mechanical-bump");
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  const context = () => ({ signal: AbortSignal.timeout(3000) });
  const outage = (fallback: NonNullable<Parameters<typeof jevAdapter>[0]["fallback"]>) =>
    jevAdapter({
      key: "test",
      model: "test",
      fallbackClaude: pinnedClaude,
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
      expect(state).toBe(jevState(facts));
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
      if (args[0] === "--version") return "1.0.0 (Claude Code)";
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
        pinnedClaude,
      );
      const forbidden = flags.indexOf("--tools");
      const schema = JSON.parse(present(flags[flags.indexOf("--json-schema") + 1]));
      return expect({
        answers,
        model: flags[flags.indexOf("--model") + 1],
        tools: flags[forbidden + 1],
        strict: flags.includes("--strict-mcp-config"),
        sources: flags[flags.indexOf("--setting-sources") + 1],
        state: present(flags[1]).includes(JSON.stringify({ diff: facts.diff })),
        required: schema.required,
      }).toMatchObject({
        answers: {
          lens: { noul: 0.9 },
          exposure: { confidence: 0, score: 2, probabilities: { "2": 1 } },
        },
        model: "configured-reviewer-model",
        tools: "",
        strict: true,
        sources: "",
        state: true,
        required: ["lens", "exposure"],
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("refuses a Claude CLI that is not the pinned version", async () => {
    const calls: string[][] = [];
    const spy = vi.spyOn(processAdapter, "execute").mockImplementation(async (_file, args) => {
      calls.push(args);
      return args[0] === "--version" ? "9.9.9 (Claude Code)" : "{}";
    });
    try {
      await expect(
        decisionFallback({ lens: { type: "noul" } }, {}, context(), pinnedClaude),
      ).rejects.toThrow("pin mismatch");
      expect(calls).toEqual([["--version"]]);
    } finally {
      spy.mockRestore();
    }
  });
  it("rejects an error-marked fallback response", async () => {
    const spy = vi.spyOn(processAdapter, "execute").mockImplementation(async (_file, args) =>
      args[0] === "--version"
        ? "1.0.0 (Claude Code)"
        : JSON.stringify({
            is_error: true,
            subtype: "error_max_turns",
            result: { lens: { noul: 0.8 } },
          }),
    );
    try {
      await expect(
        decisionFallback({ lens: { type: "noul" } }, {}, context(), pinnedClaude),
      ).rejects.toThrow("envelope reported an error");
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
        fallbackClaude: pinnedClaude,
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
describe("an irregular distribution, partial or not summing to one", () => {
  const band = async (operations: Record<string, unknown>) => {
    const answers = {
      ...Object.fromEntries(
        dimensions.map((d) => [
          d,
          { type: "score", confidence: 0.9, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
        ]),
      ),
      operations: { type: "score", confidence: 0.9, ...operations },
    };
    const evidence = riskSchema.parse(
      await jev(answers).adapter.risk(facts, [], riskQuestions, context()),
    );
    return rate(evidence, false, configSchema.parse(recording.config)).band;
  };
  it("is rated no lower than Jev's own score, and a regular one by its tail alone", async () => {
    expect({
      partialAtZero: await band({ probabilities: { 0: 1 }, score: 3 }),
      allZeros: await band({ probabilities: { 0: 0, 1: 0, 2: 0, 3: 0 }, score: 3 }),
      higherTail: await band({ probabilities: { 0: 0.5, 1: 0.1, 2: 0.1, 3: 0.28 }, score: 0 }),
      noScore: await band({ probabilities: { 0: 1 } }),
      regular: await band({ probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 }, score: 3 }),
    }).toEqual({
      partialAtZero: "HIGH",
      allZeros: "HIGH",
      higherTail: "MEDIUM",
      noScore: "LOW",
      regular: "LOW",
    });
  });
});
describe("a malformed Jev answer", () => {
  const regular = { type: "score", confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } };
  const wellFormed = Object.fromEntries(dimensions.map((d) => [d, regular]));
  const malformed = {
    ...wellFormed,
    operations: { type: "score", confidence: 0.9, score: 3, probabilities: { 0: 1 } },
  };
  it("is asked again, and the next well-formed answer is used", async () => {
    const j = jev(undefined, { sequence: [malformed, wellFormed] });
    const r = riskSchema.parse(await j.adapter.risk(facts, [], riskQuestions, context()));
    expect({
      operations: r.dimensions.operations.probabilities,
      calls: j.attempts(),
      retries: j.retries,
    }).toEqual({
      operations: [0, 0, 1, 0],
      calls: 2,
      retries: [{ question: "risk", attempt: 2, reason: "operations: a partial distribution" }],
    });
  });
  it("takes today's defaults only after three malformed answers", async () => {
    const j = jev(malformed);
    const r = riskSchema.parse(await j.adapter.risk(facts, [], riskQuestions, context()));
    expect({ operations: r.dimensions.operations, calls: j.attempts() }).toEqual({
      operations: { confidence: 0.9, score: 3, partial: true, probabilities: [1, 0, 0, 0] },
      calls: 3,
    });
  });
  it("is asked once when well-formed", async () => {
    const j = jev(wellFormed);
    await j.adapter.risk(facts, [], riskQuestions, context());
    expect({ calls: j.attempts(), retries: j.retries }).toEqual({ calls: 1, retries: [] });
  });
  it("re-asks an unreadable classification and a missing routing exposure", async () => {
    const classification = jev(undefined, {
      sequence: [{ ...classes, mechanical: { type: "noul" } }, classes],
    });
    const classified = await classification.adapter.classify(
      facts,
      classificationQuestions,
      context(),
    );
    const cardsOnly = Object.fromEntries(cardNames.map((k) => [k, { type: "noul", noul: 0 }]));
    const routing = jev(undefined, {
      sequence: [cardsOnly, { ...cardsOnly, exposure: regular }],
    });
    await routing.adapter.route(facts, "functional", routeQuestions, context());
    expect({
      mechanical: classificationSchema.parse(classified).mechanical,
      classifyCalls: classification.attempts(),
      routeCalls: routing.attempts(),
      routeRetry: routing.retries,
    }).toEqual({
      mechanical: 1,
      classifyCalls: 2,
      routeCalls: 2,
      routeRetry: [{ question: "route", attempt: 2, reason: "exposure: unreadable" }],
    });
  });
});
describe("the advisory template-adherence check", () => {
  const input = {
    risk: "workflow-injection risk",
    summary: "The change widens a token.",
    cards: [
      { name: "safety", findings: [{ what: "the token is printed" }] },
      { name: "house-style", findings: [] },
      { name: "works-and-proven", findings: [{ what: "no test" }, { what: "no receipt" }] },
    ],
  };
  const questions = adherenceQuestions(["safety", "works-and-proven"]);
  const distinct = (card: string) => ({
    type: "noul",
    instructions: adherenceDistinctQuestion(card),
  });
  it("keeps the previous reviewer's wording, verbatim", () => {
    expect({ risk: adherenceRiskQuestion, distinct: adherenceDistinctQuestion("safety") }).toEqual({
      risk: "Is the risk line a SHORT CLASSIFICATION — a few-word noun phrase naming the KIND of exposure (e.g. 'workflow-injection risk' or 'dependency bump, non-behavioral') — rather than a full explanatory sentence? True = a classification; False = a sentence.",
      distinct:
        "Does the 'safety' card's finding state ITS OWN review lens's distinct contribution, rather than merely RESTATE in similar words the same root-cause chain another card's finding already states? Several cards independently corroborating one real defect from their own distinct angles is legitimate and is True; only a phrasing-level restatement adding no lens-specific point is False.",
    });
  });
  it("asks the previous reviewer's questions over its prose state", async () => {
    const j = jev({
      risk_is_classification: { type: "noul", noul: 0.9 },
      distinct__safety: { type: "noul", noul: 0.2 },
      "distinct__works-and-proven": { type: "noul", noul: 0.8 },
    });
    const result = await j.adapter.adherence(input, questions, context());
    expect({ sent: j.calls, result }).toEqual({
      sent: [
        {
          model: "test-model",
          questions: {
            risk_is_classification: { type: "noul", instructions: adherenceRiskQuestion },
            distinct__safety: distinct("safety"),
            "distinct__works-and-proven": distinct("works-and-proven"),
          },
          state:
            "Risk line: workflow-injection risk\nSummary: The change widens a token.\n\nCouncil findings (card: finding):\n- [safety] the token is printed\n- [works-and-proven] no test\n- [works-and-proven] no receipt",
        },
      ],
      result: {
        status: "checked",
        riskClassificationOk: true,
        cardsRestating: ["safety"],
        ok: false,
        nouls: {
          risk_is_classification: 0.9,
          distinct__safety: 0.2,
          "distinct__works-and-proven": 0.8,
        },
      },
    });
  });
  it("is unchecked on a Jev outage, with no fallback and no throw", async () => {
    const fallback = vi.fn();
    const adapter = jevAdapter({
      key: "test-only",
      model: "test-model",
      fallbackClaude: pinnedClaude,
      fallback,
      retries: 0,
      minTimeout: 1,
      fetch: async () => new Response("{}", { status: 503 }),
    });
    expect({
      result: await adapter.adherence(input, questions, context()),
      fallback: fallback.mock.calls.length,
    }).toEqual({ result: { status: "unchecked" }, fallback: 0 });
  });
  it("re-asks an unreadable answer, then reads a still-missing one as a pass", async () => {
    const j = jev({ risk_is_classification: { type: "noul" } });
    const result = await j.adapter.adherence(input, questions, context());
    expect({ calls: j.attempts(), result }).toEqual({
      calls: 3,
      result: {
        status: "checked",
        riskClassificationOk: true,
        cardsRestating: [],
        ok: true,
        nouls: {
          risk_is_classification: 1,
          distinct__safety: 1,
          "distinct__works-and-proven": 1,
        },
      },
    });
  });
});
