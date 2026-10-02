import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { githubAdapter } from "../src/adapters/github.js";
import { parseCard } from "../src/adapters/prose.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import {
  ledgerBlock,
  nextLedger,
  prepareFindings,
  roundScope,
  selectLedger,
} from "../src/ledger.js";
import { mandatory, validateVoice } from "../src/policy.js";
import { review } from "../src/review.js";
import { configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import type { Card, Ledger, ReviewCore, RoundScope, Voice } from "../src/types.js";
import cases from "./ledger-scenarios.json" with { type: "json" };

const source = JSON.parse(
  readFileSync(new URL("../recordings/council-clear.json", import.meta.url), "utf8"),
) as Recording;
const facts = factsSchema.parse(source.facts);
const config = configSchema.parse({
  ...(source.config as object),
  trustedLedgerActors: ["reviewer[bot]"],
});
const oldHead = "b".repeat(40);
const entry = (
  severity: "MINOR" | "MAJOR" | "BLOCKING" = "MAJOR",
  status: "standing" | "dismissed" = "standing",
): Ledger["entries"][number] => ({
  key: "R1-F1",
  card: "safety",
  status,
  severity,
  round_raised: 1,
  location: "a.ts:1",
  what: "Unsafe access",
  ...(status === "dismissed" ? { reason: "Operator authorization" } : {}),
});
const prior = (entries = [entry()], round = 1): Ledger => ({ v: 1, head: oldHead, round, entries });
const posted = (ledger: Ledger, actor = "reviewer[bot]") => ({
  id: 1,
  actor,
  actorType: "Bot",
  head: ledger.head,
  submittedAt: "2026-09-01T00:00:00Z",
  body: `review\n${ledgerBlock(ledger)}`,
});
const history = (ledger = prior()) => ({
  ...facts,
  history: { complete: true, priorLedger: true, reviews: [posted(ledger)] },
});
const scope = (entries = [entry()], round = 2): RoundScope => ({
  round,
  priorHead: oldHead,
  full: false,
  diff: "delta",
  files: [{ path: "a.ts" }],
  entries,
});
const card = (findings: Card["findings"] = [], name: Card["name"] = "safety"): Card => ({
  name,
  completion: "completed",
  checked: ["Checked access at a.ts:1"],
  notCovered: [],
  findings,
});
const finding = (
  severity: "MINOR" | "MAJOR" | "BLOCKING" = "MAJOR",
  extra: Partial<Card["findings"][number]> = {},
): Card["findings"][number] => ({
  id: "F1",
  tag: "issue",
  severity,
  confidence: "HIGH",
  location: "a.ts:1",
  what: "Unsafe access",
  late: "new",
  ...extra,
});
const voice = (status: "established" | "dismissed" = "dismissed", id = "verify-R1-F1"): Voice => ({
  outcome: status === "dismissed" ? "APPROVED" : "CHANGES_REQUESTED",
  band: "LOW",
  rationale: "Bounded change",
  summary: "Checked",
  dispositions: [{ id, status, reason: "a.ts:1 now validates access" }],
});
const core = (cards: Card[], v: Voice | null): ReviewCore => ({
  request: requestSchema.parse(source.request),
  classification: "functional",
  routeAnswer: null,
  riskAnswer: null,
  cards,
  voice: v,
  decision: {
    outcome: v?.outcome ?? "APPROVED",
    rating: {
      band: "LOW",
      rationale: "Bounded",
      evidence: null,
      ignoredDimensions: [],
      voiceOverride: null,
    },
    mergeEligible: v?.outcome !== "CHANGES_REQUESTED",
    holdReasons: [],
  },
  provenance: {
    cardBundle: config.cardBundle.commit,
    classification: "fresh-jev",
    services: "recorded",
  },
});
function scenario(
  id: string,
  run: (broken: boolean) => unknown | Promise<unknown>,
  expected: Record<string, unknown> = { ok: true },
) {
  const spec = cases.find((c) => c.id === id);
  if (!spec) throw new Error(id);
  it(spec.name, async () => {
    let observed: unknown;
    try {
      observed = await run(process.env.MARGOT_ADAPTER_BREAK === id);
    } catch (error) {
      observed = { error: String(error) };
    }
    expect(observed).toMatchObject(expected);
  });
}
function rejects(run: () => unknown) {
  try {
    run();
    return { ok: false };
  } catch {
    return { ok: true };
  }
}
scenario("ledger-auth", (b) => ({
  ok:
    selectLedger(
      {
        ...facts,
        history: {
          complete: true,
          priorLedger: true,
          reviews: [posted(prior(), b ? "reviewer[bot]" : "author")],
        },
      },
      config,
    ) === null,
}));
scenario("ledger-binding", (b) => {
  const f = history();
  f.history.reviews[0]!.head = b ? oldHead : "f".repeat(40);
  return { ok: selectLedger(f, config) === null };
});
scenario("ledger-corrupt", (b) => {
  const f = history();
  if (!b) f.history.reviews[0]!.body = "review\n<!-- margot-ledger:v1 garbage -->";
  return { ok: selectLedger(f, config) === null };
});
scenario("ledger-unreadable", (b) => ({
  ok:
    selectLedger({ ...history(), history: { ...history().history, complete: b } }, config) === null,
}));
scenario(
  "ledger-newest",
  (b) => {
    const f = history();
    f.history.reviews.push({
      ...posted(prior([], 3)),
      id: 2,
      submittedAt: b ? "2026-08-01T00:00:00Z" : "2026-09-02T00:00:00Z",
    });
    return { round: selectLedger(f, config)?.round };
  },
  { round: 3 },
);
scenario(
  "ledger-human-quote",
  (broken) => {
    const f = history();
    f.history.reviews.push({
      ...posted(prior([], 3), "human"),
      actorType: broken ? "Bot" : "User",
      actor: broken ? "reviewer[bot]" : "human",
      id: 2,
      submittedAt: "2026-09-02T00:00:00Z",
      body: broken
        ? `review\n${ledgerBlock(prior([], 3))}`
        : 'The review quotes "margot-ledger:" here.',
    });
    return { ledger: selectLedger(f, config) };
  },
  { ledger: prior() },
);
scenario("ledger-duplicate", (b) => ({
  ok: selectLedger(history(prior(b ? [entry()] : [entry(), entry()])), config) === null,
}));
scenario("ledger-terminal", (b) => {
  const f = history();
  if (!b) f.history.reviews[0]!.body += "\nquoted text";
  return { ok: selectLedger(f, config) === null };
});
const diff = (path = "a.ts") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
const comparison = (text = diff()) => ({
  base: oldHead,
  head: facts.head,
  status: "ahead",
  diff: text,
  complete: true,
});
scenario(
  "ledger-delta",
  (b) => ({
    files: roundScope(
      { ...facts, files: [{ path: "a.ts" }] },
      prior(),
      comparison(diff(b ? "b.ts" : "a.ts") + diff("main.ts")),
    ).files,
  }),
  { files: [{ path: "a.ts" }] },
);
for (const [id, change] of [
  ["ledger-rebase", { status: "diverged" }],
  ["ledger-incomplete-delta", { complete: false }],
  ["ledger-bad-hunk", { diff: diff().replace("+new\n", "") }],
] as const) {
  scenario(
    id,
    (b) => ({ full: roundScope(facts, prior(), { ...comparison(), ...(b ? {} : change) }).full }),
    { full: true },
  );
}
scenario(
  "ledger-unreadable-compare",
  (b) => ({ full: roundScope(facts, prior(), b ? comparison() : null).full }),
  { full: true },
);
scenario("ledger-wrong-delta", (b) =>
  rejects(() =>
    roundScope(facts, prior(), { ...comparison(), head: b ? facts.head : "f".repeat(40) }),
  ),
);
scenario(
  "ledger-300",
  (b) => {
    const files = Array.from({ length: 301 }, (_, i) => ({ path: `f${i}.ts` }));
    const s = roundScope(
      { ...facts, files },
      prior(),
      comparison(
        files
          .slice(0, b ? 300 : 301)
          .map((f) => diff(f.path))
          .join(""),
      ),
    );
    return { count: s.files.length };
  },
  { count: 301 },
);
for (const [id, severity, name, late, expected] of [
  ["ledger-minor", "MINOR", "safety", "new", 0],
  ["ledger-major", "MAJOR", "safety", "new", 1],
  ["ledger-late-major", "MAJOR", "house-style", "missed: absent in round 1", 0],
  // Python's `_late_missed` reads the bare `late=missed` mark its golden cards carry.
  ["ledger-late-bare", "MAJOR", "house-style", "missed", 0],
  ["ledger-late-blocking", "BLOCKING", "house-style", "missed: absent in round 1", 1],
  ["ledger-late-safety", "MAJOR", "safety", "missed: absent in round 1", 1],
  ["ledger-reach", "MAJOR", "house-style", "delta-reach: new caller", 1],
] as const)
  scenario(
    id,
    (b) => {
      const f = finding(b ? (expected ? "MINOR" : "BLOCKING") : severity, { late });
      const cards = [card([f], name)];
      prepareFindings(cards, scope([]));
      return { count: mandatory(cards).length };
    },
    { count: expected },
  );
scenario(
  "ledger-round-one-minor",
  (b) => {
    const cards = [card([finding("MINOR")])];
    prepareFindings(cards, scope([], b ? 2 : 1));
    return { count: mandatory(cards).length };
  },
  { count: 1 },
);
scenario(
  "ledger-round-four",
  (b) => {
    const cards = [card([finding(b ? "MINOR" : "MAJOR", { ledger: "R1-F1" })])];
    prepareFindings(cards, scope([entry()], 4));
    return { count: mandatory(cards).length };
  },
  { count: 1 },
);
scenario(
  "ledger-full-not-late",
  (b) => {
    const cards = [card([finding("MAJOR", { late: "missed: round 1" })], "house-style")];
    prepareFindings(cards, { ...scope([]), full: !b });
    return { count: mandatory(cards).length };
  },
  { count: 1 },
);
scenario(
  "ledger-dismissal",
  (b) => {
    const cards = [
      card([
        finding("MAJOR", { ledger: "R1-F1", ...(b ? { reopens: "a.ts:1 changed access" } : {}) }),
      ]),
    ];
    prepareFindings(cards, scope([entry("MAJOR", "dismissed")]));
    return { count: mandatory(cards).length };
  },
  { count: 0 },
);
scenario(
  "ledger-reopened",
  (b) => {
    const cards = [
      card([
        finding("MAJOR", { ledger: "R1-F1", ...(!b ? { reopens: "a.ts:1 changed access" } : {}) }),
      ]),
    ];
    prepareFindings(cards, scope([entry("MAJOR", "dismissed")]));
    return { count: mandatory(cards).length };
  },
  { count: 1 },
);
scenario("ledger-foreign", (b) =>
  rejects(() =>
    prepareFindings([card([finding("MAJOR", { ledger: b ? "R1-F1" : "R1-F2" })])], scope()),
  ),
);
scenario("ledger-attribution", (b) => {
  const f = finding();
  if (!b) delete f.late;
  return rejects(() => prepareFindings([card([f])], scope([])));
});
scenario("ledger-margot-fields", (b) =>
  rejects(() =>
    prepareFindings(
      [card([finding("MAJOR", b ? {} : { advisory: "carried-dismissal" })])],
      scope([]),
    ),
  ),
);
scenario(
  "ledger-unconfirmed",
  (b) => {
    const cards = [card()];
    prepareFindings(cards, scope(b ? [] : [entry()]));
    return { findings: cards[0]!.findings };
  },
  { findings: [{ id: "verify-R1-F1", unconfirmed: true, confidence: "LOW" }] },
);
scenario(
  "ledger-minor-fixed",
  (b) => {
    const s = scope([entry(b ? "MAJOR" : "MINOR")]);
    const cards = [card()];
    prepareFindings(cards, s);
    return nextLedger(
      s,
      cards,
      b ? voice("established") : null,
      core(cards, b ? voice("established") : null),
      config,
      facts,
    ).convergence;
  },
  { fixed: 1, standing: 0 },
);
scenario(
  "ledger-major-fixed",
  (b) => {
    const s = scope();
    const cards = [card()];
    prepareFindings(cards, s);
    const v = voice(b ? "established" : "dismissed");
    return nextLedger(s, cards, v, core(cards, v), config, facts).convergence;
  },
  { fixed: 1, standing: 0, unconfirmed: 1 },
);
scenario(
  "ledger-upheld-wins",
  (b) => {
    const s = scope();
    const cards = [
      card([
        finding("MAJOR", { ledger: "R1-F1" }),
        finding("MAJOR", { id: "F2", ledger: "R1-F1" }),
      ]),
    ];
    prepareFindings(cards, s);
    const v = voice("dismissed", "F1");
    v.outcome = b ? "APPROVED" : "CHANGES_REQUESTED";
    v.dispositions.push({
      id: "F2",
      status: b ? "dismissed" : "established",
      reason: "still unsafe at a.ts:1",
    });
    return nextLedger(s, cards, v, core(cards, v), config, facts).convergence;
  },
  { standing: 1, fixed: 0, new: 0 },
);
scenario(
  "ledger-keys",
  (b) => {
    const s = scope([]);
    const cards = [card([finding()])];
    prepareFindings(cards, s);
    const v = voice("established", "F1");
    if (b) s.round = 3;
    return { key: nextLedger(s, cards, v, core(cards, v), config, facts).ledger.entries[0]?.key };
  },
  { key: "R2-F1" },
);
scenario(
  "ledger-late-count",
  (b) => {
    const s = scope([]);
    const cards = [
      card([finding("MAJOR", { late: b ? "new" : "missed: round 1" })], "house-style"),
    ];
    prepareFindings(cards, s);
    const v = b ? voice("established", "F1") : null;
    return nextLedger(s, cards, v, core(cards, v), config, facts).convergence;
  },
  { late: 1, new: 0, standing: 0 },
);
scenario(
  "ledger-prune",
  (b) => {
    const s = scope([
      { ...entry(), status: b ? "standing" : "fixed", fixed_round: 1 },
      { ...entry("MAJOR", "dismissed"), key: "R1-F2" },
    ]);
    return {
      entries: nextLedger(
        s,
        [],
        null,
        core([], b ? voice("established") : null),
        config,
        facts,
      ).ledger.entries.map((e) => `${e.key}:${e.status}`),
    };
  },
  { entries: ["R1-F2:dismissed"] },
);
scenario("ledger-budget", (b) => ({
  ok: ledgerBlock(prior([{ ...entry(), what: "x".repeat(b ? 10 : 50000) }])).length > 24000,
}));
async function margot(b: boolean, classification = "mechanical", editorial = false) {
  const r = structuredClone(source);
  r.config = { ...config, publication: "none" };
  r.facts = history();
  r.classification = {
    source: "jev",
    functional: classification === "functional" ? 1 : 0,
    mechanical: classification === "mechanical" ? 1 : 0,
    documentation: classification === "documentation" ? 1 : 0,
  };
  r.route = {
    source: "jev",
    cards: Object.fromEntries(
      [
        "safety",
        "works-and-proven",
        "principal-engineer",
        "achieves-the-objective",
        "maintainable-no-slop",
        "house-style",
      ].map((n) => [n, 0]),
    ),
    confidence: 1,
    documentationSubstantive: editorial ? 0 : null,
  };
  r.cards = { safety: card() };
  r.voice = voice("established");
  if (b) r.facts = history(prior([]));
  const services = recordedServices(r);
  const result = await review(r.request, r.config, services);
  return { result, services, r };
}
scenario(
  "ledger-mechanical-recall",
  async (b) => {
    const { result } = await margot(b);
    return result;
  },
  { kind: "reviewed", decision: { outcome: "CHANGES_REQUESTED" }, cards: [{ name: "safety" }] },
);
scenario(
  "ledger-editorial-recall",
  async (b) => {
    const { result } = await margot(b, "documentation", true);
    return result;
  },
  { kind: "reviewed", decision: { outcome: "CHANGES_REQUESTED" }, cards: [{ name: "safety" }] },
);
scenario(
  "ledger-card-isolation",
  async (b) => {
    const { r } = await margot(false);
    const f = history(
      prior([entry(), { ...entry("MAJOR", "dismissed"), key: "R1-F2", card: "house-style" }]),
    );
    r.facts = f;
    if (b)
      f.history.reviews = [
        posted(prior([entry(), { ...entry("MAJOR", "dismissed"), key: "R1-F2", card: "safety" }])),
      ];
    const s = recordedServices(r);
    await review(r.request, r.config, s);
    const input = s.calls.find((c) => c.name === "card:safety")!.input as {
      round: RoundScope;
      facts: typeof facts;
    };
    return {
      keys: input.round.entries.map((e) => e.key),
      rawHistory: input.facts.history.reviews ?? [],
    };
  },
  { keys: ["R1-F1"], rawHistory: [] },
);
scenario(
  "ledger-retry",
  async (b) => {
    const { result, r } = await margot(false);
    if (result.kind !== "reviewed") throw new Error("baseline");
    const f = factsSchema.parse(r.facts);
    f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
    r.facts = f;
    const s = recordedServices(r);
    if (b) (r.config as { routeThreshold: number }).routeThreshold = 0.9;
    const retry = await review(r.request, r.config, s);
    return {
      equal: JSON.stringify(result) === JSON.stringify(retry),
      calls: s.calls.map((c) => c.name),
    };
  },
  { equal: true, calls: ["facts", "classification", "head"] },
);
scenario(
  "ledger-retry-040-receipt",
  async () => {
    const { result, r } = await margot(false);
    if (result.kind !== "reviewed" || !result.ledger.receipt) throw new Error("baseline");
    const {
      routeAnswer: _routeAnswer,
      riskAnswer: _riskAnswer,
      ...review040
    } = result.ledger.receipt.review;
    const { receipt, ...ledger040 } = result.ledger;
    const receipt040 = { ...receipt, review: review040 };
    const transport040 = {
      ...ledger040,
      v: 1,
      receipt_v2: deflateSync(Buffer.from(JSON.stringify(receipt040)), { level: 9 }).toString(
        "base64",
      ),
    };
    const review040Body = `review\n<!-- margot-ledger:v1 ${Buffer.from(
      JSON.stringify(transport040),
    ).toString("base64")} -->`;
    const f = factsSchema.parse(r.facts);
    f.history = {
      complete: true,
      priorLedger: true,
      reviews: [{ ...posted(result.ledger), body: review040Body }],
    };
    r.facts = f;
    return await review(r.request, r.config, recordedServices(r));
  },
  { kind: "reviewed", routeAnswer: null, riskAnswer: null, convergence: { round: 2 } },
);
scenario(
  "ledger-retry-checks",
  async (b) => {
    const { result, r } = await margot(false);
    if (result.kind !== "reviewed") throw new Error("baseline");
    const f = factsSchema.parse(r.facts);
    f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
    if (!b) f.checks[0]!.conclusion = "failure";
    r.facts = f;
    return await review(r.request, r.config, recordedServices(r));
  },
  { kind: "error", stage: "checks" },
);
scenario(
  "ledger-retry-legacy",
  async (b) => {
    const { r } = await margot(false);
    r.facts = history({ ...prior(), head: b ? oldHead : facts.head });
    return await review(r.request, r.config, recordedServices(r));
  },
  { kind: "reviewed", convergence: { round: 1 } },
);
scenario(
  "ledger-prose",
  (b) =>
    parseCard(
      `card: safety\ncompletion: completed\nChecked:\n- a.ts access\nNot covered:\nResolved:\n- R1-F2 · a.ts:3 validates input\nFindings:\n- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH · ledger=${b ? "R1-F3" : "R1-F1"} · late=delta-reach: new caller\n what: unsafe\n consequence: exposure\n action: validate\n`,
      "safety",
    ),
  {
    // Python never parsed `Resolved:`; the section is prose, and fixed-ness comes from absence.
    findings: [{ ledger: "R1-F1", late: "delta-reach: new caller" }],
  },
);
for (const id of ["ledger-pagination", "ledger-page-two-failure"])
  scenario(
    id,
    async (b) => {
      const pages: string[] = [];
      const transport = (async (input: string | URL | Request, init?: RequestInit) => {
        const u = new URL(String(input));
        pages.push(u.href);
        const isSecond = u.searchParams.get("page") === "2";
        let data: unknown;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (u.pathname.endsWith("/reviews")) {
          data = isSecond
            ? [
                {
                  id: 2,
                  user: { login: "reviewer[bot]", type: "Bot" },
                  commit_id: oldHead,
                  submitted_at: "2026-09-01T00:00:00Z",
                  body: `review\n${ledgerBlock(prior())}`,
                },
              ]
            : [];
          if (!isSecond && (!b || id === "ledger-page-two-failure"))
            headers.link = `<${u.origin}${u.pathname}?page=2>; rel="next"`;
        } else if (u.pathname.endsWith("/files"))
          data = [
            { filename: "a.ts", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" },
          ];
        else if (u.pathname.endsWith("/check-runs")) data = { check_runs: [], total_count: 0 };
        else if (new Headers(init?.headers).get("accept")?.includes("diff")) data = diff();
        else
          data = {
            base: { sha: facts.base },
            head: { sha: facts.head, repo: { full_name: facts.repository } },
            title: "Change",
            body: "Intent",
            user: { login: "author" },
            draft: false,
            changed_files: 1,
            auto_merge: null,
          };
        const response = new Response(typeof data === "string" ? data : JSON.stringify(data), {
          headers,
          status: isSecond && id === "ledger-page-two-failure" && !b ? 403 : 200,
        });
        Object.defineProperty(response, "url", { value: u.href });
        return response;
      }) as typeof fetch;
      const client = new Octokit({ request: { fetch: transport } });
      try {
        const f = factsSchema.parse(
          await githubAdapter(client).facts(requestSchema.parse(source.request), {
            signal: AbortSignal.timeout(3000),
          }),
        );
        if (id === "ledger-page-two-failure") return { failed: !f.history.complete };
        return {
          round: selectLedger(f, config)?.round,
          pages: pages.filter((p) => p.includes("/reviews")).length,
        };
      } catch (error) {
        if (id === "ledger-page-two-failure") return { failed: true };
        throw error;
      }
    },
    id === "ledger-page-two-failure" ? { failed: true } : { round: 1, pages: 2 },
  );
scenario(
  "ledger-info-cannot-close",
  (b) => {
    const cards = [card([finding("MAJOR", { ledger: "R1-F1", tag: b ? "issue" : "info" })])];
    prepareFindings(cards, scope());
    return { unconfirmed: cards[0]!.findings.filter((f) => f.unconfirmed).length };
  },
  { unconfirmed: 1 },
);
scenario(
  "ledger-astra-unproven",
  (b) => {
    const dismissed = { ...entry("MAJOR", "dismissed"), key: "R1-F2" };
    const cards = [card([])];
    prepareFindings(cards, scope([entry(b ? "MINOR" : "MAJOR"), dismissed]));
    const omitted = voice("dismissed", "R1-F2");
    const accounted: Voice = {
      ...voice("established"),
      dispositions: [
        { id: "verify-R1-F1", status: "established", reason: "Still unproven" },
        { id: "R1-F2", status: "dismissed", reason: "Prior dismissal remains accepted" },
      ],
    };
    return {
      synthesized: cards[0]?.findings.map((finding) => finding.id),
      omittedRejected: rejects(() => validateVoice(cards, omitted)).ok,
      dismissedAlongsideAccepted: !rejects(() => validateVoice(cards, accounted)).ok,
    };
  },
  {
    synthesized: ["verify-R1-F1"],
    omittedRejected: true,
    dismissedAlongsideAccepted: true,
  },
);
scenario(
  "ledger-retry-evidence",
  async (b) => {
    const { result, r } = await margot(false);
    if (result.kind !== "reviewed") throw new Error("baseline");
    const f = factsSchema.parse(r.facts);
    f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
    if (!b) f.body = "New authorization request";
    r.facts = f;
    return await review(r.request, r.config, recordedServices(r));
  },
  { kind: "error", stage: "history" },
);
scenario("ledger-voice-advisory", async (b) => {
  const { validateVoice } = await import("../src/policy.js");
  const c = card([finding("MINOR", b ? {} : { advisory: "minor-after-round-1" })]);
  return rejects(() => validateVoice([c], voice("established", "F1")));
});
scenario(
  "process-stdin",
  async (b) => {
    const { execute } = await import("../src/adapters/process.js");
    const input = "evidence".repeat(100000);
    const out = await execute(
      process.execPath,
      ["-e", "process.stdin.on('data',d=>process.stdout.write(d))"],
      { input: b ? "truncated" : input },
    );
    return { complete: out === input };
  },
  { complete: true },
);
for (const id of ["jev-batch-evidence", "jev-batch-severity", "jev-batch-confidence"])
  scenario(id, async (b) => {
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
        const high = last && !(b && id === "jev-batch-severity");
        return new Response(
          JSON.stringify({
            model: "test",
            answers: Object.fromEntries(
              Object.keys(riskQuestions).map((k) => [
                k,
                {
                  type: "score",
                  confidence: last && !(b && id === "jev-batch-confidence") ? 0.1 : 0.9,
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
    })) as { dimensions: { operations: { probabilities: number[]; confidence: number } } };
    const expected = { facts: { ...data } as Partial<typeof facts>, cards: [] };
    delete expected.facts.history;
    const reconstructed = requests.map((r) => r.evidence).join("");
    return id === "jev-batch-evidence"
      ? { ok: reconstructed === JSON.stringify(expected) }
      : id === "jev-batch-severity"
        ? { ok: output.dimensions.operations.probabilities[3] === 1 }
        : { ok: output.dimensions.operations.confidence === 0.1 };
  });
scenario("evidence-diff-pages", async (b) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const directory = await mkdtemp(`${tmpdir()}/margot-diff-`);
  const path = `${directory}/diff`;
  const input = "abcdef".repeat(6000);
  await writeFile(path, b ? input.slice(1) : input);
  const server = createEvidenceServer({ request: source.request, diffPath: path });
  const client = new Client({ name: "test", version: "1" });
  const [a, z] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), client.connect(z)]);
    let offset = 0,
      out = "";
    do {
      const response = await client.callTool({
        name: "read_diff",
        arguments: { offset, limit: 16000 },
      });
      const content = response.content as { text: string }[];
      const chunk = JSON.parse(content[0]!.text);
      out += chunk.text;
      offset = chunk.end;
      if (offset === chunk.total) break;
    } while (offset < input.length);
    return { ok: out === input };
  } finally {
    await client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
scenario(
  "reference-sha",
  async (b) => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
    let observed: unknown;
    const server = createEvidenceServer(
      {
        request: source.request,
        references: { hooks: { repository: "reference/hooks", head: b ? facts.head : oldHead } },
      },
      {
        ...githubAdapter(new Octokit()),
        async readFile(r, path) {
          observed = { repository: r.repository, head: r.head, path };
          return "pinned source";
        },
      },
    );
    const client = new Client({ name: "test", version: "1" });
    const [a, z] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(a), client.connect(z)]);
      await client.callTool({
        name: "read_reference",
        arguments: {
          reference: "hooks",
          path: "hook.ts",
          head: "f".repeat(40),
          repository: "forged/repo",
        },
      });
      return observed;
    } finally {
      await client.close();
      await server.close();
    }
  },
  { repository: "reference/hooks", head: oldHead, path: "hook.ts" },
);
scenario(
  "reference-unknown",
  async (b) => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
    let calls = 0;
    const server = createEvidenceServer(
      {
        request: source.request,
        references: { hooks: { repository: "reference/hooks", head: oldHead } },
      },
      {
        ...githubAdapter(new Octokit()),
        async readFile() {
          calls++;
          return "pinned source";
        },
      },
    );
    const client = new Client({ name: "test", version: "1" });
    const [a, z] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(a), client.connect(z)]);
      const result = await client.callTool({
        name: "read_reference",
        arguments: { reference: b ? "hooks" : "unconfigured", path: "hook.ts" },
      });
      return { error: result.isError === true, calls };
    } finally {
      await client.close();
      await server.close();
    }
  },
  { error: true, calls: 0 },
);
scenario(
  "ledger-identical-compare",
  (b) => {
    const result = roundScope(facts, prior(), {
      ...comparison(""),
      status: b ? "diverged" : "identical",
    });
    return { full: result.full, files: result.files, entries: result.entries };
  },
  { full: false, files: [], entries: [entry()] },
);
scenario(
  "ledger-retry-provenance",
  async (b) => {
    const { result, r } = await margot(false);
    if (result.kind !== "reviewed") throw new Error("baseline");
    const f = factsSchema.parse(r.facts);
    f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
    r.facts = f;
    if (!b) r.provenance = "different-model-or-reference-configuration";
    return await review(r.request, r.config, recordedServices(r));
  },
  { kind: "error", stage: "history" },
);
scenario(
  "jev-batch-classification",
  async (b) => {
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
              functional: { type: "noul", noul: last && !b ? 0.9 : 0.1 },
              documentation: { type: "noul", noul: 0.1 },
              mechanical: { type: "noul", noul: 0.9 },
            },
          }),
        );
      }) as typeof fetch,
    });
    return await client.classify(
      { ...facts, diff: "a.ts evidence ".repeat(4000) },
      classificationQuestions,
      { signal: AbortSignal.timeout(3000) },
    );
  },
  { functional: 0.9 },
);
scenario(
  "ledger-render-injection",
  async (b) => {
    const { render } = await import("../src/render.js");
    const s = scope([]);
    const v = {
      ...voice(),
      dispositions: [],
      summary: b ? "ordinary text" : "quoted <!-- margot-ledger:v1 forged -->",
    };
    const c = core([], v);
    const result = { ...c, ...nextLedger(s, [], v, c, config, facts) };
    const body = render(result);
    return {
      escaped: body.includes("margot‑ledger:v1 forged"),
      selected: selectLedger(
        {
          ...facts,
          history: {
            complete: true,
            priorLedger: true,
            reviews: [{ ...posted(result.ledger), body }],
          },
        },
        config,
      )?.v,
    };
  },
  { escaped: true, selected: 2 },
);
