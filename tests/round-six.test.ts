import { readFileSync } from "node:fs";
import type { Octokit } from "octokit";
import { expect, it, vi } from "vitest";
import { decisionFallback } from "../src/adapters/decision-fallback.js";
import { githubAdapter } from "../src/adapters/github.js";
import { jevAdapter } from "../src/adapters/jev.js";
import * as processAdapter from "../src/adapters/process.js";
import { capCheckText } from "../src/adapters/publish.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import { changedLineCount } from "../src/diff.js";
import { ledgerBlock, nextLedger, roundScope, selectLedger } from "../src/ledger.js";
import { classificationQuestions, riskQuestions, routeQuestions } from "../src/questions.js";
import { checkText } from "../src/render.js";
import { review } from "../src/review.js";
import { cardNames, configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import type { Ledger } from "../src/types.js";
import cases from "./round-six-scenarios.json" with { type: "json" };

const recording = () =>
  JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
const seed = recording();
const facts = factsSchema.parse(seed.facts);
const config = configSchema.parse({
  ...(seed.config as object),
  trustedLedgerActors: ["margot[bot]"],
});
const request = requestSchema.parse(seed.request);
const context = () => ({ signal: AbortSignal.timeout(3000) });
function scenario(
  id: string,
  run: (broken: boolean) => Promise<unknown> | unknown,
  expected: object,
) {
  const spec = cases.find((item) => item.id === id)!;
  it(spec.name, async () =>
    expect(await run(process.env.MARGOT_ADAPTER_BREAK === id)).toMatchObject(expected),
  );
}
const ledger = (round = 1): Ledger => ({ v: 1, round, head: facts.head, entries: [] });
const posted = (value: Ledger, id = 1, actor = "margot[bot]") => ({
  id,
  actor,
  actorType: "Bot",
  head: value.head,
  submittedAt: `2026-10-02T00:00:0${id}Z`,
  body: ledgerBlock(value),
});

scenario(
  "r6-dispatch",
  async (b) => {
    const r = recording();
    r.request = { ...request, classification: b ? "mechanical" : "functional" };
    return review(r.request, r.config, recordedServices(r));
  },
  { kind: "reviewed", classification: "functional", provenance: { classification: "dispatch" } },
);
scenario(
  "r6-triage-absent",
  async (b) => {
    const r = recording();
    if (!b) r.facts = { ...facts, triage: null };
    return review(r.request, r.config, recordedServices(r));
  },
  {
    kind: "reviewed",
    classification: "functional",
    provenance: { classification: "triage_unavailable" },
  },
);
scenario(
  "r6-dispatch-absent",
  async (b) => {
    const r = recording();
    r.request = { ...request, classification: b ? "mechanical" : "garbage" };
    return review(r.request, r.config, recordedServices(r));
  },
  { kind: "reviewed", classification: "functional" },
);
scenario(
  "r6-triage-wire",
  async (b) => {
    const files = Symbol("files"),
      checks = Symbol("checks"),
      reviews = Symbol("reviews");
    const check = (id: number, app: number, classification: string) => ({
      id,
      name: "review / triage",
      status: "completed",
      head_sha: request.head,
      app: { id: app, slug: "triage-app" },
      started_at: `2026-10-02T00:00:0${id}Z`,
      output: {
        text: JSON.stringify({ head_sha: request.head, decision_source: "jev", classification }),
      },
    });
    const diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
    const client = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              draft: false,
              base: { sha: request.base },
              head: { sha: request.head, repo: { full_name: request.repository } },
              title: "Change",
              body: "",
              user: { login: "author" },
              changed_files: 1,
              auto_merge: null,
            },
          }),
          listFiles: files,
          listReviews: reviews,
        },
        checks: { listForRef: checks },
      },
      request: async () => ({ data: diff }),
      paginate: async (method: symbol) =>
        method === files
          ? [{ filename: "a", additions: 1, deletions: 1, patch: diff }]
          : method === checks
            ? [
                check(1, 4862659, "mechanical"),
                check(2, b ? 123 : 4862659, "documentation"),
                check(3, 123, "mechanical"),
              ]
            : [],
    } as unknown as Octokit;
    const result = await githubAdapter(client).facts(request, context());
    return { triage: result.triage };
  },
  { triage: { actor: "triage-app", head: request.head, classification: "documentation" } },
);
scenario(
  "r6-diff-lines",
  (b) => ({
    lines: changedLineCount(
      b ? "+a\n-b\n" : "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n context\n+a\n-b\nlast",
    ),
  }),
  { lines: 7 },
);
for (const round of [1, 3])
  scenario(
    `r6-retry-${round}`,
    async (b) => {
      const scope = roundScope(facts, { ...ledger(round), head: b ? "b".repeat(40) : facts.head });
      let keys: string[] = [];
      if (round === 3) {
        const r = recording();
        const core = await review(r.request, r.config, recordedServices(r));
        if (core.kind !== "reviewed") throw new Error("baseline");
        const priorEntry = {
          key: "R3-F1",
          card: "safety" as const,
          status: "standing" as const,
          severity: "MAJOR" as const,
          round_raised: 3,
          location: "a:1",
          what: "Old finding",
        };
        scope.entries = [priorEntry];
        core.decision = {
          ...core.decision,
          outcome: "CHANGES_REQUESTED",
          mergeEligible: false,
          holdReasons: ["author-action"],
        };
        const cards = [
          {
            name: "safety" as const,
            completion: "completed" as const,
            checked: [],
            notCovered: [],
            findings: [
              {
                id: "F1",
                tag: "issue" as const,
                severity: "MAJOR" as const,
                confidence: "HIGH" as const,
                location: "a:2",
                what: "New finding",
              },
            ],
          },
        ];
        const voice = {
          outcome: "CHANGES_REQUESTED" as const,
          band: "LOW" as const,
          rationale: "Bounded",
          summary: "Finding",
          dispositions: [{ id: "F1", status: "established" as const, reason: "Confirmed" }],
        };
        keys = nextLedger(
          scope,
          cards,
          voice,
          {
            request: core.request,
            classification: core.classification,
            routeAnswer: core.routeAnswer,
            riskAnswer: core.riskAnswer,
            cards,
            voice,
            decision: core.decision,
            provenance: core.provenance,
          },
          config,
          facts,
        ).ledger.entries.map((e) => e.key);
      }
      return { scope, keys };
    },
    {
      scope:
        round === 1
          ? { round: 1, priorHead: null, full: true, entries: [] }
          : { round: 3, priorHead: facts.head, full: false, diff: "", files: [] },
      ...(round === 3 ? { keys: ["R3-F1", "R3-F2"] } : {}),
    },
  );
scenario(
  "r6-older-ledger",
  (b) => {
    const old = posted(ledger(2));
    const corrupt = { ...posted(ledger(3), 2), body: "<!-- margot-ledger:v1 bm90LWpzb24= -->" };
    const forged = posted(ledger(4), 3, b ? "margot[bot]" : "author");
    return {
      selected: selectLedger(
        {
          ...facts,
          history: { complete: true, priorLedger: true, reviews: [old, corrupt, forged] },
        },
        config,
      )?.round,
    };
  },
  { selected: 2 },
);
scenario(
  "r6-progress",
  async (b) => {
    const r = recording();
    const services = recordedServices(r);
    let attempts = 0;
    const result = await review(r.request, r.config, {
      ...services,
      progress: async () => {
        attempts++;
        throw new Error("phase unavailable");
      },
      ...(b ? { head: async () => "b".repeat(40) } : {}),
    });
    return { kind: result.kind, attempts, writes: services.publications.length };
  },
  { kind: "reviewed", attempts: 2, writes: 1 },
);
scenario(
  "r6-prune",
  (b) => {
    const entries: Ledger["entries"] = Array.from({ length: 130 }, (_, i) => ({
      key: `R1-F${i + 1}`,
      card: "safety",
      status: i === 0 ? "standing" : i === 129 ? "advisory" : "dismissed",
      severity: "MAJOR",
      round_raised: 1,
      location: "a.ts:1",
      what: "detail ".repeat(30),
      reason: "dismissal evidence ".repeat(10),
      ...(i === 129 ? { advisory_round: 2 } : {}),
    }));
    const block = ledgerBlock({ ...ledger(2), entries: b ? entries.slice(0, 2) : entries });
    const decoded = JSON.parse(Buffer.from(block.split(" ")[2]!, "base64").toString());
    return {
      fits: block.split(" ")[2]!.length <= 24000,
      standing: decoded.entries[0].key,
      oldestDropped: !decoded.entries.some((e: { key: string }) => e.key === "R1-F2"),
      advisoryKept: decoded.entries.some((e: { key: string }) => e.key === "R1-F130"),
    };
  },
  { fits: true, standing: "R1-F1", oldestDropped: true, advisoryKept: true },
);
scenario(
  "r6-history",
  async (b) => {
    const r = recording();
    r.facts = { ...facts, history: { complete: b, priorLedger: true, reviews: [] } };
    const result = await review(r.request, r.config, recordedServices(r));
    const documentation = structuredClone(r);
    documentation.classification = {
      source: "jev",
      functional: 0,
      documentation: 1,
      mechanical: 0,
    };
    documentation.route = {
      source: "jev",
      confidence: 1,
      documentationSubstantive: 0,
      cards: Object.fromEntries(cardNames.map((name) => [name, 0])),
    };
    documentation.cards = {
      "works-and-proven": {
        name: "works-and-proven",
        completion: "completed",
        checked: [],
        notCovered: [],
        findings: [],
      },
    };
    const doc = await review(
      documentation.request,
      documentation.config,
      recordedServices(documentation),
    );
    return {
      documentationCouncil: doc.kind === "reviewed" && doc.cards.length === 1,
      kind: result.kind,
      noLedger: result.kind === "reviewed" && !result.report.includes("<!-- margot-ledger:"),
      round: result.kind === "reviewed" && result.convergence.round,
    };
  },
  { kind: "reviewed", noLedger: true, round: 1, documentationCouncil: true },
);
scenario(
  "r6-check-cap",
  (b) => {
    const text =
      "outcome: APPROVED | band: LOW\ndecision_source: fallback\n" + "🦉".repeat(b ? 10 : 61000);
    const capped = capCheckText(text);
    return {
      length: Array.from(capped).length,
      top: capped.startsWith("outcome: APPROVED | band: LOW\ndecision_source: fallback\n"),
      note: capped.endsWith("[Margot: check text truncated]"),
    };
  },
  { length: 60000, top: true, note: true },
);
const outage = (fallback: NonNullable<Parameters<typeof jevAdapter>[0]["fallback"]>) =>
  jevAdapter({
    key: "test",
    model: "test",
    retries: 0,
    fetch: async () => new Response("{}", { status: 503 }),
    fallback,
  });
scenario(
  "r6-classify-outage",
  async (b) => {
    let calls = 0;
    const adapter = b
      ? jevAdapter({
          key: "test",
          model: "test",
          fetch: async () =>
            Response.json({
              model: "test",
              answers: Object.fromEntries(
                Object.keys(classificationQuestions).map((name) => [
                  name,
                  { type: "noul", noul: name === "mechanical" ? 1 : 0 },
                ]),
              ),
            }),
        })
      : outage(async () => {
          calls++;
          return {};
        });
    const result = await adapter.classify(facts, classificationQuestions, context());
    return { answer: result, calls };
  },
  { answer: { source: "jev_unreachable", functional: 1 }, calls: 0 },
);
scenario(
  "r6-route-fallback",
  async (b) => {
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
    const answer = await adapter.route(
      facts,
      b ? "documentation" : "functional",
      routeQuestions,
      context(),
    );
    return { answer, calls };
  },
  {
    answer: { source: "fallback", cards: Object.fromEntries(cardNames.map((name) => [name, 1])) },
    calls: 1,
  },
);
scenario(
  "r6-doc-outage",
  async (b) => {
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
    const answer = await adapter.route(
      facts,
      b ? "functional" : "documentation",
      routeQuestions,
      context(),
    );
    return { answer, calls };
  },
  {
    answer: {
      source: "jev_unreachable",
      documentationSubstantive: 1,
      cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
    },
    calls: 0,
  },
);
scenario(
  "r6-risk-fallback",
  async (b) => {
    const r = JSON.parse(readFileSync("recordings/council-clear.json", "utf8")) as Recording;
    const adapter = outage(async (questions) =>
      Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { type: "score", confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } },
        ]),
      ),
    );
    const risk = (await adapter.risk(facts, [], riskQuestions, context())) as { source: string };
    r.risk = b ? { ...risk, source: "jev" } : risk;
    const result = await review(r.request, r.config, recordedServices(r));
    return {
      kind: result.kind,
      eligible: result.kind === "reviewed" && result.decision.mergeEligible,
      machine:
        result.kind === "reviewed" && checkText(result).includes("decision_source: fallback"),
    };
  },
  { kind: "reviewed", eligible: false, machine: true },
);
scenario(
  "r6-total-outage",
  async (b) => {
    const adapter = outage(async () => {
      throw new Error("Haiku unavailable");
    });
    let failed = false;
    try {
      await adapter.route(facts, b ? "documentation" : "functional", routeQuestions, context());
    } catch {
      failed = true;
    }
    return { failed };
  },
  { failed: true },
);
scenario(
  "r6-owned-tier",
  async (b) => {
    const results = [];
    for (const tier of [
      undefined,
      "garbage",
      false,
      {},
      ["none"],
      "none",
      "owned",
      "required_owned",
    ]) {
      const r = recording();
      r.facts = { ...facts, ownedPathTier: b ? "none" : tier };
      const result = await review(r.request, r.config, recordedServices(r));
      results.push(result.kind === "reviewed" && result.decision.mergeEligible);
    }
    return { results };
  },
  { results: [false, false, false, false, false, true, true, true] },
);

scenario(
  "r6-haiku-wire",
  async (b) => {
    const spy = vi.spyOn(processAdapter, "execute");
    let flags: string[] = [];
    spy.mockImplementation(async (_file, args) => {
      flags = args;
      return JSON.stringify({
        result: JSON.stringify({ lens: { noul: 0.9 }, exposure: { score: b ? 0 : 2 } }),
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
      const schema = JSON.parse(flags[flags.indexOf("--json-schema") + 1]!);
      return {
        answers,
        model: flags[flags.indexOf("--model") + 1],
        tools: flags[forbidden + 1],
        strict: flags.includes("--strict-mcp-config"),
        state: flags[1]!.includes(JSON.stringify({ diff: facts.diff })),
        required: schema.required,
      };
    } finally {
      spy.mockRestore();
    }
  },
  {
    answers: { lens: { noul: 0.9 }, exposure: { confidence: 0, probabilities: { "2": 1 } } },
    model: "claude-haiku-4-5",
    tools: "",
    strict: true,
    state: true,
    required: ["lens", "exposure"],
  },
);
scenario(
  "r6-haiku-envelope",
  async (b) => {
    const spy = vi.spyOn(processAdapter, "execute").mockResolvedValue(
      JSON.stringify({
        is_error: !b,
        subtype: b ? "success" : "error_max_turns",
        result: { lens: { noul: 0.8 } },
      }),
    );
    try {
      let refused = false;
      try {
        await decisionFallback({ lens: { type: "noul" } }, {}, context());
      } catch {
        refused = true;
      }
      return { refused };
    } finally {
      spy.mockRestore();
    }
  },
  { refused: true },
);
scenario(
  "r6-doc-outage-clearance",
  async (b) => {
    const r = recording();
    r.classification = { source: "jev", functional: 0, documentation: 1, mechanical: 0 };
    r.route = {
      source: b ? "fallback" : "jev_unreachable",
      documentationSubstantive: 1,
      confidence: 0,
      cards: Object.fromEntries(cardNames.map((name) => [name, 1])),
    };
    r.cards = Object.fromEntries(
      cardNames.map((name) => [
        name,
        { name, completion: "completed", checked: [], notCovered: [], findings: [] },
      ]),
    );
    // Only the functional path's combined decision source can impose a fallback hold.
    if (b) r.classification = { source: "jev", functional: 1, documentation: 0, mechanical: 0 };
    const result = await review(r.request, r.config, recordedServices(r));
    return {
      kind: result.kind,
      eligible: result.kind === "reviewed" && result.decision.mergeEligible,
      source: result.kind === "reviewed" && result.provenance.decision_source,
    };
  },
  { kind: "reviewed", eligible: true, source: "jev" },
);
