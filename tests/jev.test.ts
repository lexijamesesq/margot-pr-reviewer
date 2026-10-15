import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decisionFallback } from "../src/adapters/decision-fallback.js";
import { jevAdapter } from "../src/adapters/jev.js";
import * as processAdapter from "../src/adapters/process.js";
import { recordedServices, review } from "../src/index.js";
import { rate } from "../src/policy.js";
import {
  adherenceQuestions,
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
    fallback: async () => {
      throw new Error("fallback unavailable");
    },
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
  expect((j.calls[0] as { questions: unknown }).questions).toEqual(goldenClassificationQuestions);
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
    const withoutExposure = Object.fromEntries(
      cardNames.map((name) => [name, { type: "noul", noul: 0 }]),
    );
    const unsure = routeSchema.parse(
      await jev(withoutExposure).adapter.route(facts, "functional", functional, context()),
    );
    expect(unsure.confidence).toBe(0);
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
it("uses fallback after rejected credentials while retrying a transient classification outage", async () => {
  for (const [status, attempts, source] of [
    [401, 1, "fallback"],
    [503, 2, "jev"],
  ] as const) {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ model: "test-model", answers: classes }), {
          status: fetch.mock.calls.length === 1 ? status : 200,
        }),
    );
    const fallback = vi.fn(async () => classes);
    const onJevRetry = vi.fn();
    const adapter = jevAdapter({
      key: "test-only",
      model: "test-model",
      fallbackClaude: pinnedClaude,
      fetch,
      fallback,
      onJevRetry,
    });
    const answer = await adapter.classify(facts, classificationQuestions, context());
    expect(answer).toMatchObject({ source, mechanical: 1 });
    expect(fetch).toHaveBeenCalledTimes(attempts);
    expect(fallback).toHaveBeenCalledTimes(source === "fallback" ? 1 : 0);
    expect(onJevRetry).toHaveBeenCalledTimes(source === "fallback" ? 0 : 1);
  }
});
it("prepares only a missing native Claude after Jev is exhausted, then reuses it", async () => {
  const root = await mkdtemp(join(tmpdir(), "margot-fallback-"));
  const executable = `${root}//node_modules/.bin/claude`;
  vi.stubEnv("MARGOT_ROOT", root);
  for (const name of [
    "GH_TOKEN",
    "MARGOT_WRITE_TOKEN",
    "JEV_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
  ])
    vi.stubEnv(name, "test-only-secret");
  let failed = false;
  let attempts = 0;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const execute = vi.spyOn(processAdapter, "execute").mockImplementation(async (file, args) => {
    if (file === "npm") {
      expect(attempts).toBe(3); // One success, then both failed classification attempts.
      if (args[0] === "rebuild") {
        await mkdir(join(root, "node_modules/.bin"), { recursive: true });
        await writeFile(executable, "installed CLI fixture");
      }
      return "";
    }
    return args[0] === "--version"
      ? "1.0.0 (Claude Code)"
      : JSON.stringify({ result: JSON.stringify(classes) });
  });
  try {
    const adapter = jevAdapter({
      key: "test-only",
      model: "test-model",
      fallbackClaude: { ...pinnedClaude, executable },
      fetch: async () => {
        attempts++;
        return failed
          ? new Response("{}", { status: 400 })
          : new Response(JSON.stringify({ model: "test-model", answers: classes }));
      },
    });
    expect(await adapter.classify(facts, classificationQuestions, context())).toMatchObject({
      source: "jev",
    });
    expect(execute).not.toHaveBeenCalled();
    failed = true;
    expect(await adapter.classify(facts, classificationQuestions, context())).toMatchObject({
      source: "fallback",
    });
    const install = execute.mock.calls.filter(([file]) => file === "npm");
    expect(install.map(([, args]) => args)).toEqual([
      [
        "install",
        "--prefix",
        root,
        "--ignore-scripts",
        "--save-exact",
        "@anthropic-ai/claude-code@1.0.0",
      ],
      ["rebuild", "--prefix", root, "@anthropic-ai/claude-code"],
    ]);
    for (const [, , options] of install) {
      expect(Object.keys(options?.env ?? {})).not.toContain("GH_TOKEN");
      expect(Object.values(options?.env ?? {})).not.toContain("test-only-secret");
    }
    expect(new Set(execute.mock.calls.map(([, , options]) => options?.signal)).size).toBe(1);
    expect(await adapter.classify(facts, classificationQuestions, context())).toMatchObject({
      source: "fallback",
    });
    expect(execute.mock.calls.filter(([file]) => file === "npm")).toHaveLength(2);
  } finally {
    execute.mockRestore();
    warn.mockRestore();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
it("returns an explicit classification error after both providers fail", async () => {
  const j = jev(classes, { failures: 3 });
  const services = { ...recordedServices(recording), classify: j.adapter.classify };
  const result = await review({ ...request, phase: "triage" }, recording.config, services);
  expect(result).toMatchObject({
    kind: "error",
    stage: "classification",
  });
});
it("keeps Jev's score for each risk dimension", async () => {
  const answers = Object.fromEntries(
    dimensions.map((d, i) => [
      d,
      { type: "score", confidence: 0.8, score: i / 4, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
    ]),
  );
  const r = riskSchema.parse(await jev(answers).adapter.risk(facts, [], riskQuestions, context()));
  expect(dimensions.map((dimension) => r.dimensions[dimension].score)).toEqual([
    0, 0.25, 0.5, 0.75, 1,
  ]);
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
  it("routes functional changes once from summary evidence without the diff", async () => {
    const { client, requests } = capture();
    const { documentation_substantive: _substance, ...functional } = routeQuestions;
    await client.route(large, "functional", functional, context());
    expect(requests).toHaveLength(1);
    const state = String(requests[0]?.state);
    for (const evidence of [large.title, "Why:", "f0.ts", "owned"])
      expect(state).toContain(evidence);
    expect(state).not.toContain("a.ts evidence");
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual(
      ["exposure", ...cardNames].sort(),
    );
  });
  it("routes documentation with the complete diff and its substantive-meaning question", async () => {
    const { client, requests } = capture();
    await client.route(large, "documentation", routeQuestions, context());
    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.state)).toContain(large.diff);
    expect(requests[0]?.questions).toHaveProperty("documentation_substantive");
  });
  it("sends council finding meaning or an explicit no-council state to risk", async () => {
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
    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.state)).toContain("The token reaches the log.");
    expect(String(requests[0]?.state)).toContain("a.ts:1");
    await client.risk(facts, [], riskQuestions, context());
    expect(String(requests[1]?.state)).toContain("(no council: no_council)");
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
  it("rejects malformed fallback classification instead of fabricating a lane", async () => {
    const fallback = vi.fn(async () => ({}));
    await expect(
      outage(fallback).classify(facts, classificationQuestions, context()),
    ).rejects.toThrow();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("preserves fallback probabilities and provenance", async () => {
    expect(
      await outage(async () => classes).classify(facts, classificationQuestions, context()),
    ).toEqual({
      source: "fallback",
      functional: 0,
      documentation: 0,
      mechanical: 1,
    });
  });
  it("routes functional reviews through the fallback during a Jev outage", async () => {
    let calls = 0;
    const adapter = outage(async (questions, state) => {
      calls++;
      expect(state).toContain(facts.title);
      expect(state).toContain(facts.files[0]?.path ?? "");
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
    expect(routeSchema.parse(answer).confidence).toBe(0);
    await expect(
      outage(async () => {
        throw new Error("fallback unavailable");
      }).route(facts, "functional", routeQuestions, context()),
    ).rejects.toThrow("fallback unavailable");
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
  it("asks Haiku for structured decisions with bound evidence and no tools", async () => {
    const spy = vi.spyOn(processAdapter, "execute");
    let flags: string[] = [];
    let input: string | undefined;
    spy.mockImplementation(async (_file, args, options) => {
      if (args[0] === "--version") return "1.0.0 (Claude Code)";
      flags = args;
      input = options?.input;
      return JSON.stringify({
        result: JSON.stringify({ lens: { noul: 0.9 }, exposure: { score: 2 } }),
      });
    });
    try {
      const evidence = `fallback-evidence-canary ${facts.diff}`;
      const answers = await decisionFallback(
        {
          lens: { type: "noul", instructions: "Lens needed?" },
          exposure: { type: "score", criteria: ["none", "low", "medium", "high"] },
        },
        { diff: evidence },
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
        state: present(input).includes(JSON.stringify({ diff: evidence })),
        promptInArguments: flags.some((argument) => argument.includes("fallback-evidence-canary")),
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
        promptInArguments: false,
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
      const result = await j.adapter
        .classify(facts, classificationQuestions, context())
        .catch((error) => error);
      return { result, warnings: warnings.join("\n"), attempts: j.attempts() };
    } finally {
      warn.mockRestore();
    }
  }
  it("distinguishes authentication rejection from a service outage", async () => {
    for (const [status, category, other] of [
      [401, "authentication", "unavailable"],
      [503, "unavailable", "authentication"],
    ] as const) {
      const { result, warnings } = await classifyDuring(status);
      expect(result).toBeInstanceOf(Error);
      expect(warnings).toContain(category);
      expect(warnings).toContain(String(status));
      expect(warnings).not.toContain(other);
    }
  });
  it("correlates an HTTP failure without reading or exposing provider content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const retry = vi.fn();
    const fallback = vi.fn(async () => classes);
    const sent: string[] = [];
    const responses: Response[] = [];
    const fetch = vi.fn(async (_input, init) => {
      sent.push(String(init?.body));
      const response = new Response("provider-message-canary malformed-body-canary {", {
        status: 400,
        headers: { "x-typesafe-request-id": "req_trace-123" },
      });
      responses.push(response);
      return response;
    });
    try {
      const adapter = jevAdapter({
        key: "credential-canary",
        model: "test-model",
        fallbackClaude: pinnedClaude,
        fetch,
        fallback,
        onJevRetry: retry,
      });
      const diff = "private-diff-canary 🐱";
      expect(
        await adapter.classify({ ...facts, diff }, classificationQuestions, context()),
      ).toMatchObject({ source: "fallback", mechanical: 1 });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(responses.every((response) => !response.bodyUsed)).toBe(true);
      const request = present(sent[0]);
      const diagnostics = JSON.stringify({ warnings: warn.mock.calls, retries: retry.mock.calls });
      expect(diagnostics).toContain("HTTP 400");
      expect(diagnostics).toContain("model=test-model");
      expect(diagnostics).toContain(`request_bytes=${Buffer.byteLength(request, "utf8")}`);
      expect(diagnostics).toContain("request_id=req_trace-123");
      for (const secret of [
        "credential-canary",
        "private-diff-canary",
        "provider-message-canary",
        "malformed-body-canary",
      ])
        expect(diagnostics).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
  });
  it.each(["unsafe request-id-canary", "request-id-canary".repeat(20)])(
    "omits unsafe or oversized metadata from HTTP failure diagnostics (%#)",
    async (requestId) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const adapter = jevAdapter({
          key: "test-only",
          model: "unsafe-model-canary\nforged diagnostic",
          fallbackClaude: pinnedClaude,
          fallback: async () => classes,
          fetch: async () =>
            new Response("{}", {
              status: 401,
              headers: { "x-typesafe-request-id": requestId },
            }),
        });
        expect(await adapter.classify(facts, classificationQuestions, context())).toMatchObject({
          source: "fallback",
        });
        const diagnostics = warn.mock.calls.map(([message]) => String(message)).join("\n");
        expect(diagnostics).toContain("authentication rejected (HTTP 401)");
        expect(diagnostics).toContain("model=(invalid)");
        expect(diagnostics).not.toContain("unsafe-model-canary");
        expect(diagnostics).not.toContain("request-id-canary");
      } finally {
        warn.mockRestore();
      }
    },
  );
  it("reports a transport failure with its cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = jevAdapter({
        key: "test-only",
        model: "test-model",
        fallbackClaude: pinnedClaude,
        retries: 0,
        fallback: async () => {
          throw new Error("fallback unavailable");
        },
        fetch: async () => {
          throw new Error("connect ETIMEDOUT");
        },
      });
      await expect(adapter.classify(facts, classificationQuestions, context())).rejects.toThrow(
        "fallback unavailable",
      );
      const warnings = warn.mock.calls.map(([message]) => String(message)).join("\n");
      expect(warnings).toContain("transport");
      expect(warnings).toContain("connect ETIMEDOUT");
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
    const supplied = operations.probabilities;
    if (supplied && typeof supplied === "object") {
      expect(evidence.dimensions.operations.probabilities).toEqual(
        [0, 1, 2, 3].map((level) => (supplied as Record<string, number>)[String(level)] ?? 0),
      );
    }
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
      retries: [{ question: "risk", attempt: 2, reason: expect.any(String) }],
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
    const routed = routeSchema.parse(
      await routing.adapter.route(facts, "functional", routeQuestions, context()),
    );
    expect({
      mechanical: classificationSchema.parse(classified).mechanical,
      classifyCalls: classification.attempts(),
      routeCalls: routing.attempts(),
      routeConfidence: routed.confidence,
      routeRetry: routing.retries,
    }).toEqual({
      mechanical: 1,
      classifyCalls: 2,
      routeCalls: 2,
      routeConfidence: 0.9,
      routeRetry: [{ question: "route", attempt: 2, reason: expect.any(String) }],
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
  it("checks the posted risk, summary and distinct card findings as advisory evidence", async () => {
    const j = jev({
      risk_is_classification: { type: "noul", noul: 0.9 },
      distinct__safety: { type: "noul", noul: 0.2 },
      "distinct__works-and-proven": { type: "noul", noul: 0.8 },
    });
    const result = await j.adapter.adherence(input, questions, context());
    expect(j.calls).toHaveLength(1);
    const sent = j.calls[0] as { state: string; questions: Record<string, unknown> };
    expect(Object.keys(sent.questions).sort()).toEqual(
      ["risk_is_classification", "distinct__safety", "distinct__works-and-proven"].sort(),
    );
    for (const evidence of [
      input.risk,
      input.summary,
      "[safety] the token is printed",
      "[works-and-proven] no test",
      "[works-and-proven] no receipt",
    ])
      expect(sent.state).toContain(evidence);
    expect(result).toMatchObject({
      status: "checked",
      riskClassificationOk: true,
      cardsRestating: ["safety"],
      ok: false,
      nouls: {
        risk_is_classification: 0.9,
        distinct__safety: 0.2,
        "distinct__works-and-proven": 0.8,
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
  it("keeps advisory evidence unchecked when answers remain unreadable after reasks", async () => {
    const j = jev({ risk_is_classification: { type: "noul" } });
    const result = await j.adapter.adherence(input, questions, context());
    expect({ calls: j.attempts(), result }).toEqual({ calls: 3, result: { status: "unchecked" } });
  });
});

describe("bounded initial classification", () => {
  const setup = (
    fetch: NonNullable<Parameters<typeof jevAdapter>[0]["fetch"]>,
    fallback: NonNullable<Parameters<typeof jevAdapter>[0]["fallback"]>,
  ) =>
    jevAdapter({
      key: "test",
      model: "test",
      fallbackClaude: pinnedClaude,
      retries: 4,
      fetch,
      fallback,
    });
  it("bounds provider attempts and the enclosing review classification stage", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const fetch = vi.fn(async (_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return await new Promise<Response>(() => {});
      });
      const fallback = vi.fn(async (_questions, _state, context) => {
        signals.push(context.signal);
        return await new Promise<Record<string, unknown>>(() => {});
      });
      const result = setup(fetch, fallback).classify(facts, classificationQuestions, {
        signal: new AbortController().signal,
      });
      const rejected = expect(result).rejects.toThrow("Fallback classification timed out");
      await vi.advanceTimersByTimeAsync(15000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(signals[0]?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(15000);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(signals[1]?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(89999);
      expect(signals[2]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(signals[2]?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      const enclosing = review(
        { ...request, phase: "triage" },
        { ...configSchema.parse(recording.config), timeoutMs: 900000 },
        {
          ...recordedServices(recording),
          classify: async () => await new Promise<never>(() => {}),
        },
      );
      await vi.advanceTimersByTimeAsync(130000);
      expect(await enclosing).toMatchObject({ kind: "error", stage: "classification" });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["attempt", "pause", "fallback"])("parent cancellation wins during %s", async (phase) => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const fetch = vi.fn(async () =>
        phase === "attempt"
          ? await new Promise<Response>(() => {})
          : new Response("{}", { status: 503 }),
      );
      const fallback = vi.fn(async () => await new Promise<Record<string, unknown>>(() => {}));
      const result = setup(fetch, fallback).classify(facts, classificationQuestions, {
        signal: parent.signal,
      });
      const rejected = expect(result).rejects.toThrow("parent cancelled");
      await vi.advanceTimersByTimeAsync(phase === "fallback" ? 1000 : 0);
      parent.abort(new Error("parent cancelled"));
      await rejected;
      await vi.advanceTimersByTimeAsync(130000);
      expect(fetch).toHaveBeenCalledTimes(phase === "fallback" ? 2 : 1);
      expect(fallback).toHaveBeenCalledTimes(phase === "fallback" ? 1 : 0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["jev"])(
    "rejects a valid late %s response after parent cancellation",
    async (provider) => {
      vi.useFakeTimers();
      try {
        const parent = new AbortController();
        const fallback = vi.fn(async () => {
          parent.abort(new Error("parent cancelled"));
          return classes;
        });
        const fetch = vi.fn(async () => {
          if (provider === "fallback") return new Response("{}", { status: 503 });
          parent.abort(new Error("parent cancelled"));
          return new Response(JSON.stringify({ model: "test", answers: classes }));
        });
        const result = setup(fetch, fallback).classify(facts, classificationQuestions, {
          signal: parent.signal,
        });
        const rejected = expect(result).rejects.toThrow("parent cancelled");
        await vi.advanceTimersByTimeAsync(1000);
        await rejected;
        expect(fallback).toHaveBeenCalledTimes(provider === "fallback" ? 1 : 0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
