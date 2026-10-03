import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { githubAdapter } from "../src/adapters/github.js";
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
it("Forged author cannot supply ledger history", () => {
  expect(
    selectLedger(
      {
        ...facts,
        history: {
          complete: true,
          priorLedger: true,
          reviews: [posted(prior(), "author")],
        },
      },
      config,
    ) === null,
  ).toBe(true);
});
it("Ledger head must match GitHub review commit", () => {
  const f = history();
  f.history.reviews[0]!.head = "f".repeat(40);
  expect(selectLedger(f, config) === null).toBe(true);
});
it("holds for the operator when the trusted ledger is corrupt", async () => {
  const f = history();
  f.history.reviews[0]!.body = "review\n<!-- margot-ledger:v1 garbage -->";
  const services = recordedServices({ ...source, facts: f });
  expect(await review(source.request, config, services)).toEqual({
    kind: "held",
    request: source.request,
    reason: expect.stringMatching(/Review history corrupt:.*review 1/),
    recovery: expect.stringContaining("review and merge this PR yourself"),
    mergeEligible: false,
  });
  expect(services.publications).toEqual([]);
});
it("holds unreadable history without inventing a verdict or risk band", async () => {
  const services = recordedServices({
    ...source,
    facts: { ...history(), history: { ...history().history, complete: false } },
  });
  expect(await review(source.request, config, services)).toEqual({
    kind: "held",
    request: source.request,
    reason: "Review history unavailable",
    recovery:
      "Margot cannot verify earlier findings were resolved. Re-run once GitHub returns the full review history, or review and merge this PR yourself; a new push does not clear this hold.",
    mergeEligible: false,
  });
  expect(services.publications).toEqual([]);
});
it("Newest submitted ledger wins", () => {
  const f = history();
  f.history.reviews.push({
    ...posted(prior([], 3)),
    id: 2,
    submittedAt: "2026-09-02T00:00:00Z",
  });
  expect({ round: selectLedger(f, config)?.round }).toMatchObject({ round: 3 });
});
it("Newer human marker quote does not hide the trusted App ledger", () => {
  const f = history();
  f.history.reviews.push({
    ...posted(prior([], 3), "human"),
    actorType: "User",
    actor: "human",
    id: 2,
    submittedAt: "2026-09-02T00:00:00Z",
    body: 'The review quotes "margot-ledger:" here.',
  });
  expect({ ledger: selectLedger(f, config) }).toMatchObject({ ledger: prior() });
});
it("Duplicate ledger keys are rejected", () => {
  expect(selectLedger(history(prior([entry(), entry()])), config) === null).toBe(true);
});
it("Quoted nonterminal ledger is skipped", () => {
  const f = history();
  f.history.reviews[0]!.body += "\nquoted text";
  expect(selectLedger(f, config) === null).toBe(true);
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
it("Delta excludes unrelated main changes", () => {
  expect({
    files: roundScope(
      { ...facts, files: [{ path: "a.ts" }] },
      prior(),
      comparison(diff("a.ts") + diff("main.ts")),
    ).files,
  }).toMatchObject({ files: [{ path: "a.ts" }] });
});
for (const [name, change] of [
  ["Rebase keeps ledger and reviews full PR", { status: "diverged" }],
  ["Incomplete compare uses complete full PR", { complete: false }],
  ["Truncated delta hunk uses complete full PR", { diff: diff().replace("+new\n", "") }],
] as const) {
  it(name, () => {
    expect({ full: roundScope(facts, prior(), { ...comparison(), ...change }).full }).toMatchObject(
      { full: true },
    );
  });
}
it("Unreadable compare uses complete full PR", () => {
  expect({ full: roundScope(facts, prior(), null).full }).toMatchObject({ full: true });
});
it("Wrong compare revision is rejected", () => {
  expect(() => roundScope(facts, prior(), { ...comparison(), head: "f".repeat(40) })).toThrow();
});
it("Delta inventory exceeds 300 files", () => {
  const files = Array.from({ length: 301 }, (_, i) => ({ path: `f${i}.ts` }));
  const s = roundScope(
    { ...facts, files },
    prior(),
    comparison(
      files
        .slice(0, 301)
        .map((f) => diff(f.path))
        .join(""),
    ),
  );
  expect({ count: s.files.length }).toMatchObject({ count: 301 });
});
for (const [behaviour, severity, name, late, expected] of [
  ["Round two MINOR is advisory", "MINOR", "safety", "new", 0],
  ["Round two MAJOR still blocks", "MAJOR", "safety", "new", 1],
  ["Late non-safety MAJOR is advisory", "MAJOR", "house-style", "missed: absent in round 1", 0],
  ["treats a bare late=missed finding as a late advisory", "MAJOR", "house-style", "missed", 0],
  ["Late BLOCKING still blocks", "BLOCKING", "house-style", "missed: absent in round 1", 1],
  ["Late safety MAJOR still blocks", "MAJOR", "safety", "missed: absent in round 1", 1],
  [
    "Delta-reach regression blocks at honest severity",
    "MAJOR",
    "house-style",
    "delta-reach: new caller",
    1,
  ],
] as const)
  it(behaviour, () => {
    const f = finding(severity, { late });
    const cards = [card([f], name)];
    prepareFindings(cards, scope([]));
    expect({ count: mandatory(cards).length }).toMatchObject({ count: expected });
  });
it("Round one MINOR still blocks", () => {
  const cards = [card([finding("MINOR")])];
  prepareFindings(cards, scope([], 1));
  expect({ count: mandatory(cards).length }).toMatchObject({ count: 1 });
});
it("Unfixed MAJOR remains blocking at round four", () => {
  const cards = [card([finding("MAJOR", { ledger: "R1-F1" })])];
  prepareFindings(cards, scope([entry()], 4));
  expect({ count: mandatory(cards).length }).toMatchObject({ count: 1 });
});
it("Rebase full review has no late demotion", () => {
  const cards = [card([finding("MAJOR", { late: "missed: round 1" })], "house-style")];
  prepareFindings(cards, { ...scope([]), full: true });
  expect({ count: mandatory(cards).length }).toMatchObject({ count: 1 });
});
it("Unchanged dismissal carries without another ruling", () => {
  const cards = [card([finding("MAJOR", { ledger: "R1-F1" })])];
  prepareFindings(cards, scope([entry("MAJOR", "dismissed")]));
  expect({ count: mandatory(cards).length }).toMatchObject({ count: 0 });
});
it("Changed dismissed code can receive a new ruling", () => {
  const cards = [
    card([finding("MAJOR", { ledger: "R1-F1", ...{ reopens: "a.ts:1 changed access" } })]),
  ];
  prepareFindings(cards, scope([entry("MAJOR", "dismissed")]));
  expect({ count: mandatory(cards).length }).toMatchObject({ count: 1 });
});
it("Card cannot attribute another ledger key", () => {
  expect(() => prepareFindings([card([finding("MAJOR", { ledger: "R1-F2" })])], scope())).toThrow();
});
it("New delta findings require scope attribution", () => {
  const f = finding();
  delete f.late;
  expect(() => prepareFindings([card([f])], scope([]))).toThrow();
});
it("Card cannot forge Margot advisory annotations", () => {
  expect(() =>
    prepareFindings([card([finding("MAJOR", { advisory: "carried-dismissal" })])], scope([])),
  ).toThrow();
});
it("Silent MAJOR returns to voice for confirmation", () => {
  const cards = [card()];
  prepareFindings(cards, scope([entry()]));
  expect({ findings: cards[0]!.findings }).toMatchObject({
    findings: [{ id: "verify-R1-F1", unconfirmed: true, confidence: "LOW" }],
  });
});
it("Silent MINOR counts as fixed", () => {
  const s = scope([entry("MINOR")]);
  const cards = [card()];
  prepareFindings(cards, s);
  return expect(
    nextLedger(s, cards, null, core(cards, null), config, facts).convergence,
  ).toMatchObject({ fixed: 1, standing: 0 });
});
it("Voice-confirmed fix counts once", () => {
  const s = scope();
  const cards = [card()];
  prepareFindings(cards, s);
  const v = voice("dismissed");
  expect(nextLedger(s, cards, v, core(cards, v), config, facts).convergence).toMatchObject({
    fixed: 1,
    standing: 0,
    unconfirmed: 1,
  });
});
it("Standing wins conflicting rulings on one key", () => {
  const s = scope();
  const cards = [
    card([finding("MAJOR", { ledger: "R1-F1" }), finding("MAJOR", { id: "F2", ledger: "R1-F1" })]),
  ];
  prepareFindings(cards, s);
  const v = voice("dismissed", "F1");
  v.outcome = "CHANGES_REQUESTED";
  v.dispositions.push({
    id: "F2",
    status: "established",
    reason: "still unsafe at a.ts:1",
  });
  expect(nextLedger(s, cards, v, core(cards, v), config, facts).convergence).toMatchObject({
    standing: 1,
    fixed: 0,
    new: 0,
  });
});
it("New findings receive current-round stable keys", () => {
  const s = scope([]);
  const cards = [card([finding()])];
  prepareFindings(cards, s);
  const v = voice("established", "F1");
  expect({
    key: nextLedger(s, cards, v, core(cards, v), config, facts).ledger.entries[0]?.key,
  }).toMatchObject({ key: "R2-F1" });
});
it("Late advisory counted without becoming new mandatory finding", () => {
  const s = scope([]);
  const cards = [card([finding("MAJOR", { late: "missed: round 1" })], "house-style")];
  prepareFindings(cards, s);
  const v = null;
  expect(nextLedger(s, cards, v, core(cards, v), config, facts).convergence).toMatchObject({
    late: 1,
    new: 0,
    standing: 0,
  });
});
it("Closed fixes and dismissals remain listed", () => {
  const s = scope([
    { ...entry(), status: "fixed", fixed_round: 1 },
    { ...entry("MAJOR", "dismissed"), key: "R1-F2" },
  ]);
  return expect({
    entries: nextLedger(s, [], null, core([], null), config, facts).ledger.entries.map(
      (e) => `${e.key}:${e.status}`,
    ),
  }).toMatchObject({ entries: ["R1-F2:dismissed"] });
});
it("Standing ledger entries survive an exceeded budget", () => {
  expect(ledgerBlock(prior([{ ...entry(), what: "x".repeat(50000) }])).length > 24000).toBe(true);
});
async function margot(classification = "mechanical", editorial = false) {
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
  const services = recordedServices(r);
  const result = await review(r.request, r.config, services);
  return { result, services, r };
}
it("Standing card defeats mechanical shortcut", async () => {
  const { result } = await margot();
  expect(result).toMatchObject({
    kind: "reviewed",
    decision: { outcome: "CHANGES_REQUESTED" },
    cards: [{ name: "safety" }],
    provenance: { summonedByLedger: ["safety"] },
    ledger: { receipt: { review: { provenance: { summonedByLedger: ["safety"] } } } },
  });
});
it("holds for the operator when a trusted ledger marker has malformed encoding", async () => {
  const f = history();
  f.history.reviews[0]!.body = "review\n<!-- margot-ledger:v1 !!! -->";
  const services = recordedServices({ ...source, facts: f });
  expect(await review(source.request, config, services)).toEqual({
    kind: "held",
    request: source.request,
    reason: expect.stringMatching(/Review history corrupt:.*review 1/),
    recovery: expect.stringContaining("review and merge this PR yourself"),
    mergeEligible: false,
  });
  expect(services.publications).toEqual([]);
});
it("Standing card defeats editorial shortcut", async () => {
  const { result } = await margot("documentation", true);
  expect(result).toMatchObject({
    kind: "reviewed",
    decision: { outcome: "CHANGES_REQUESTED" },
    cards: [{ name: "safety" }],
  });
});
it("Card receives only its own standing and dismissed history", async () => {
  const { r } = await margot();
  const f = history(
    prior([entry(), { ...entry("MAJOR", "dismissed"), key: "R1-F2", card: "house-style" }]),
  );
  r.facts = f;
  const s = recordedServices(r);
  await review(r.request, r.config, s);
  const input = s.calls.find((c) => c.name === "card:safety")!.input as {
    round: RoundScope;
    facts: typeof facts;
  };
  expect({
    keys: input.round.entries.map((e) => e.key),
    rawHistory: input.facts.history.reviews ?? [],
  }).toMatchObject({ keys: ["R1-F1"], rawHistory: [] });
});
it("Same head rechecks classification and reuses the council result", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  r.facts = f;
  const s = recordedServices(r);
  const retry = await review(r.request, r.config, s);
  expect({
    equal: JSON.stringify(result) === JSON.stringify(retry),
    calls: s.calls.map((c) => c.name),
  }).toMatchObject({ equal: true, calls: ["facts", "classification", "head"] });
});
it("Same head with a changed PR body is reviewed afresh in the same round, never refused", async () => {
  // Python re-reviewed a same-head re-run as the same round; a body edit between runs changes the
  // evidence, so the saved result is stale and the council runs again.
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  f.body = `${f.body}\n\nEdited after the first review.`;
  r.facts = f;
  const s = recordedServices(r);
  const retry = await review(r.request, r.config, s);
  expect(retry).toMatchObject({
    kind: "reviewed",
    convergence: { round: result.convergence.round },
  });
  expect(s.calls.map((c) => c.name)).toContain("route");
});
it("A receipt written by Margot 0.4.0 remains readable", async () => {
  const { result, r } = await margot();
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
  const review040Body = `review\n<!-- margot-ledger:v1 ${Buffer.from(JSON.stringify(transport040)).toString("base64")} -->`;
  const f = factsSchema.parse(r.facts);
  f.history = {
    complete: true,
    priorLedger: true,
    reviews: [{ ...posted(result.ledger), body: review040Body }],
  };
  r.facts = f;
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "reviewed",
    routeAnswer: null,
    riskAnswer: null,
    convergence: { round: 2 },
  });
});
it("Same-head retry revalidates required checks", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  f.checks[0]!.conclusion = "failure";
  r.facts = f;
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "error",
    stage: "checks",
  });
});
it("Legacy same-head round one retries fresh", async () => {
  const { r } = await margot();
  r.facts = history({ ...prior(), head: facts.head });
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "reviewed",
    convergence: { round: 1 },
  });
});
for (const [name, pageTwoFails] of [
  ["Ledger on page two participates in selection", false],
  ["Unreadable second review page cannot forget history", true],
] as const)
  it(name, async () => {
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
        if (!isSecond) headers.link = `<${u.origin}${u.pathname}?page=2>; rel="next"`;
      } else if (u.pathname.endsWith("/files"))
        data = [{ filename: "a.ts", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }];
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
        status: isSecond && pageTwoFails ? 403 : 200,
      });
      Object.defineProperty(response, "url", { value: u.href });
      return response;
    }) as typeof fetch;
    const client = new Octokit({ request: { fetch: transport } });
    const f = factsSchema.parse(
      await githubAdapter(client).facts(requestSchema.parse(source.request), {
        signal: AbortSignal.timeout(3000),
      }),
    );
    if (pageTwoFails) {
      expect(f.history.complete).toBe(false);
    } else {
      expect(selectLedger(f, config)?.round).toBe(1);
      expect(pages.filter((p) => p.includes("/reviews"))).toHaveLength(2);
    }
  });
it("An info-tagged repeat cannot silently close a MAJOR", () => {
  const cards = [card([finding("MAJOR", { ledger: "R1-F1", tag: "info" })])];
  prepareFindings(cards, scope());
  expect({ unconfirmed: cards[0]!.findings.filter((f) => f.unconfirmed).length }).toMatchObject({
    unconfirmed: 1,
  });
});
it("requires the voice to account for a prior MAJOR alongside a dismissed finding", () => {
  const dismissed = { ...entry("MAJOR", "dismissed"), key: "R1-F2" };
  const cards = [card([])];
  prepareFindings(cards, scope([entry("MAJOR"), dismissed]));
  const omitted = voice("dismissed", "R1-F2");
  const accounted: Voice = {
    ...voice("established"),
    dispositions: [
      { id: "verify-R1-F1", status: "established", reason: "Still unproven" },
      { id: "R1-F2", status: "dismissed", reason: "Prior dismissal remains accepted" },
    ],
  };
  expect(cards[0]?.findings.map((finding) => finding.id)).toEqual(["verify-R1-F1"]);
  expect(() => validateVoice(cards, omitted)).toThrow();
  expect(() => validateVoice(cards, accounted)).not.toThrow();
});
it("Changed PR evidence does not reuse the saved approval; the council runs again", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  f.body = "New authorization request";
  r.facts = f;
  const s = recordedServices(r);
  expect(await review(r.request, r.config, s)).toMatchObject({ kind: "reviewed" });
  expect(s.calls.map((c) => c.name)).toContain("route");
});
it("Voice cannot reestablish demoted advisory", async () => {
  const { validateVoice } = await import("../src/policy.js");
  const c = card([finding("MINOR", { advisory: "minor-after-round-1" })]);
  expect(() => validateVoice([c], voice("established", "F1"))).toThrow();
});
it("Identical trees preserve ledger with empty delta", () => {
  const result = roundScope(facts, prior(), {
    ...comparison(""),
    status: "identical",
  });
  expect({ full: result.full, files: result.files, entries: result.entries }).toMatchObject({
    full: false,
    files: [],
    entries: [entry()],
  });
});
it("Changed live service configuration does not reuse the saved result; the council runs again", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  r.facts = f;
  r.provenance = "different-model-or-reference-configuration";
  const s = recordedServices(r);
  expect(await review(r.request, r.config, s)).toMatchObject({ kind: "reviewed" });
  expect(s.calls.map((c) => c.name)).toContain("route");
});
it("Model ledger markers cannot become authenticated history", async () => {
  const { render } = await import("../src/render.js");
  const s = scope([]);
  const v = {
    ...voice(),
    dispositions: [],
    summary: "quoted <!-- margot-ledger:v1 forged -->",
  };
  const c = core([], v);
  const result = { ...c, ...nextLedger(s, [], v, c, config, facts) };
  const body = render(result);
  expect({
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
  }).toMatchObject({ escaped: true, selected: 2 });
});
describe("history retention and retries", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  const config = configSchema.parse({
    ...(seed.config as object),
    trustedLedgerActors: ["margot[bot]"],
  });
  const ledger = (round = 1): Ledger => ({ v: 1, round, head: facts.head, entries: [] });
  const posted = (value: Ledger, id = 1, actor = "margot[bot]") => ({
    id,
    actor,
    actorType: "Bot",
    head: value.head,
    submittedAt: `2026-10-02T00:00:0${id}Z`,
    body: ledgerBlock(value),
  });
  for (const [name, round] of [
    ["restarts a same-head first review with full scope", 1],
    ["reuses same-head later review scope and allocates new finding keys", 3],
  ] as const)
    it(name, async () => {
      const scope = roundScope(facts, { ...ledger(round), head: facts.head });
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
      expect({ scope, keys }).toMatchObject({
        scope:
          round === 1
            ? { round: 1, priorHead: null, full: true, entries: [] }
            : { round: 3, priorHead: facts.head, full: false, diff: "", files: [] },
        ...(round === 3 ? { keys: ["R3-F1", "R3-F2"] } : {}),
      });
    });
  it("uses older valid history when newer ledgers are corrupt or forged", () => {
    const old = posted(ledger(2));
    const corrupt = { ...posted(ledger(3), 2), body: "<!-- margot-ledger:v1 bm90LWpzb24= -->" };
    const forged = posted(ledger(4), 3, "author");
    expect({
      selected: selectLedger(
        {
          ...facts,
          history: { complete: true, priorLedger: true, reviews: [old, corrupt, forged] },
        },
        config,
      )?.round,
    }).toMatchObject({ selected: 2 });
  });
  it("prunes old dismissed entries while retaining standing and advisory findings", () => {
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
    const block = ledgerBlock({ ...ledger(2), entries: entries });
    const decoded = JSON.parse(Buffer.from(block.split(" ")[2]!, "base64").toString());
    expect({
      fits: block.split(" ")[2]!.length <= 24000,
      standing: decoded.entries[0].key,
      oldestDropped: !decoded.entries.some((e: { key: string }) => e.key === "R1-F2"),
      advisoryKept: decoded.entries.some((e: { key: string }) => e.key === "R1-F130"),
    }).toMatchObject({ fits: true, standing: "R1-F1", oldestDropped: true, advisoryKept: true });
  });
});
describe("history warnings", () => {
  it.each(["corrupt", "revision"])(
    "holds for the operator when a newer %s ledger obscures valid history",
    async (defect) => {
      const recording = JSON.parse(
        readFileSync("recordings/mechanical-bump.json", "utf8"),
      ) as Recording;
      const facts = factsSchema.parse(recording.facts);
      const config = configSchema.parse({
        ...(recording.config as object),
        trustedLedgerActors: ["margot[bot]"],
      });
      const old = {
        id: 41,
        actor: "margot[bot]",
        actorType: "Bot",
        head: facts.head,
        submittedAt: "2026-10-02T00:00:01Z",
        body: ledgerBlock({ v: 1, round: 2, head: facts.head, entries: [] }),
      };
      const bad = {
        ...old,
        id: 42,
        submittedAt: "2026-10-02T00:00:02Z",
        ...(defect === "corrupt"
          ? { body: "<!-- margot-ledger:v1 bm90LWpzb24= -->" }
          : { head: "b".repeat(40) }),
      };
      recording.facts = {
        ...facts,
        history: { complete: true, priorLedger: true, reviews: [old, bad] },
      };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = await review(recording.request, config, recordedServices(recording));
        expect(result).toEqual({
          kind: "held",
          request: recording.request,
          reason: expect.stringMatching(/Review history corrupt:.*review 42/),
          recovery: expect.stringContaining("review and merge this PR yourself"),
          mergeEligible: false,
        });
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          expect.stringMatching(defect === "corrupt" ? /JSON/i : /revision mismatch/),
        );
      } finally {
        warn.mockRestore();
      }
    },
  );
});
