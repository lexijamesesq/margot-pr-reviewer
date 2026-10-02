import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { resolveBundle } from "../src/adapters/bundle.js";
import { claudeAdapter, claudeEnvironment } from "../src/adapters/claude.js";
import { ghFetch, githubAdapter } from "../src/adapters/github.js";
import { jevAdapter } from "../src/adapters/jev.js";
import { liveServices } from "../src/adapters/live.js";
import { execute } from "../src/adapters/process.js";
import { parseCard, parseVoice } from "../src/adapters/prose.js";
import { cliServices, configuredTicketingEnvironment } from "../src/cli-services.js";
import { type Recording, recordedServices, review } from "../src/index.js";
import { assignFindingIds, mandatory, needsVoice, rate } from "../src/policy.js";
import { classificationQuestions, riskQuestions, routeQuestions } from "../src/questions.js";
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
import cases from "./adapter-scenarios.json" with { type: "json" };
import measuredP1 from "./p1-questions.json" with { type: "json" };

const recording = JSON.parse(
  await readFile(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
) as Recording;
const request = requestSchema.parse(recording.request);
const facts = factsSchema.parse(recording.facts);
const config = configSchema.parse(recording.config);
const context = () => ({ signal: AbortSignal.timeout(3000) });
function scenario(
  id: string,
  exercise: (broken: boolean) => Promise<unknown>,
  expected: Record<string, unknown> = { ok: true },
) {
  const spec = cases.find((c) => c.id === id);
  if (!spec) throw new Error(`No break specification: ${id}`);
  it(spec.name, async () => {
    expect(await exercise(process.env.MARGOT_ADAPTER_BREAK === id)).toMatchObject(expected);
  });
}
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: false };
  } catch {
    return { ok: true };
  }
}
function cardText() {
  return "card: safety\ncompletion: completed\nChecked:\n- Inspected changed permission grants; would catch write access.\nNot covered:\n- Runtime execution; outside the change.\nFindings:\n";
}
function voiceText() {
  return "outcome: APPROVED\nband: LOW\nband_reason: Bounded.\nsummary: Clear.\nestablished:\ndismissed:\n";
}
function github(
  overrides: {
    pageTwo?: boolean;
    shadowBeforeHead?: boolean;
    base?: string;
    count?: number;
    patch?: string | null;
    additions?: number;
    deletions?: number;
    status?: string;
    previousFilename?: string;
    draft?: boolean;
    fork?: boolean;
    moved?: boolean;
    historyFailure?: boolean;
    diff?: string;
    ledger?: boolean;
  } = {},
) {
  let pulls = 0;
  const calls: string[] = [];
  const transport = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const pull = {
      title: "Change",
      body: "Intent",
      user: { login: "author" },
      draft: overrides.draft ?? false,
      head: {
        sha: overrides.moved && pulls > 1 ? "f".repeat(40) : request.head,
        repo: { full_name: overrides.fork ? "fork/repo" : request.repository },
      },
      base: { sha: overrides.base ?? request.base },
      changed_files: overrides.count ?? 1,
      auto_merge: null,
    };
    let data: unknown = pull;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (url.pathname.endsWith("/files")) {
      data = [
        {
          additions: overrides.additions ?? 1,
          deletions: overrides.deletions ?? 1,
          status: overrides.status ?? "modified",
          ...(overrides.previousFilename ? { previous_filename: overrides.previousFilename } : {}),
          filename: url.searchParams.get("page") === "2" ? "b.ts" : "a.ts",
          ...(overrides.patch === null
            ? {}
            : { patch: overrides.patch ?? "@@ -1 +1 @@\n-old\n+new" }),
        },
      ];
      if (overrides.pageTwo && url.searchParams.get("page") !== "2")
        headers.link = `<${url.origin}${url.pathname}?page=2>; rel="next"`;
    } else if (url.pathname.endsWith("/check-runs")) data = { total_count: 0, check_runs: [] };
    else if (url.pathname.endsWith("/reviews")) {
      if (overrides.historyFailure) throw new Error("History unavailable");
      data = overrides.ledger
        ? [{ body: "<!-- margot-ledger:v1 unknown -->", commit_id: request.head }]
        : [];
    } else {
      pulls++;
      pull.head.sha = overrides.moved && pulls > 1 ? "f".repeat(40) : request.head;
      data = pull;
    }
    const response = new Response(JSON.stringify(data), { headers });
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  }) as typeof fetch;
  // Octokit's transport receives the media type; serve the actual wire format.
  const fetcher: typeof fetch = async (input, init) => {
    if (new Headers(init?.headers).get("accept")?.includes("diff")) {
      const diff =
        overrides.diff ??
        `diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n${overrides.pageTwo ? "diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-old\n+new\n" : ""}`;
      const r = new Response(diff, { headers: { "content-type": "text/plain" } });
      Object.defineProperty(r, "url", { value: String(input) });
      return r;
    }
    return transport(input, init);
  };
  const client = new Octokit({
    request: { fetch: fetcher },
    retry: { enabled: false },
    throttle: { enabled: false },
  });
  return {
    adapter: githubAdapter(client, { shadowBeforeHead: overrides.shadowBeforeHead ?? false }),
    calls,
  };
}
scenario("pagination", async (broken) => {
  const { adapter, calls } = github({ pageTwo: !broken, count: broken ? 1 : 2 });
  const facts = await adapter.facts(request, context());
  return { ok: facts.files.length === 2 && calls.some((c) => c.includes("page=2")) };
});
scenario("missing-file", (broken) =>
  rejects(() => github({ count: broken ? 1 : 2 }).adapter.facts(request, context())),
);
scenario("missing-patch", (broken) =>
  rejects(() =>
    github({ patch: broken ? "@@ -1 +1 @@\n-a\n+b" : null }).adapter.facts(request, context()),
  ),
);
scenario("partial-diff", (broken) =>
  rejects(() =>
    github({
      diff: broken ? "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\n" : "not a diff",
    }).adapter.facts(request, context()),
  ),
);
scenario("moving-facts", (broken) =>
  rejects(() => github({ moved: !broken }).adapter.facts(request, context())),
);
scenario("draft", (broken) =>
  rejects(() => github({ draft: !broken }).adapter.facts(request, context())),
);
scenario("fork", (broken) =>
  rejects(() => github({ fork: !broken }).adapter.facts(request, context())),
);
scenario("history-outage", (broken) =>
  rejects(() => github({ historyFailure: !broken }).adapter.facts(request, context())),
);
scenario("ledger", async (broken) => ({
  ok: (await github({ ledger: !broken }).adapter.facts(request, context())).history.priorLedger,
}));
scenario("bridge-write", (broken) =>
  rejects(() =>
    ghFetch("not-a-real-command")("https://api.github.com/repos/example/project", {
      method: broken ? "GET" : "POST",
    }).catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ),
);
scenario("bridge-host", (broken) =>
  rejects(() =>
    ghFetch("not-a-real-command")(
      broken ? "https://api.github.com/x" : "https://other.invalid/x",
    ).catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ),
);
function jev(answer: unknown, options: { failures?: number; status?: number } = {}) {
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
scenario("jev-class", async (broken) => {
  const j = jev({ ...classes, mechanical: { type: "noul", noul: broken ? 0 : 1 } });
  const result = await j.adapter.classify(facts, classificationQuestions, context());
  return { ok: classificationSchema.parse(result).mechanical === 1 };
});
scenario("jev-measured-p1", async () => {
  const j = jev(classes);
  await j.adapter.classify(facts, classificationQuestions, context());
  // Compare the actual wire request with the independently retained eval contract.
  return {
    ok:
      JSON.stringify((j.calls[0] as { questions: unknown }).questions) ===
      JSON.stringify(measuredP1),
  };
});
scenario("jev-classification-code-only", async () => {
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
  const sent = (j.calls[0] as { state: Record<string, unknown> }).state;
  return {
    ok:
      j.calls.length === 1 &&
      sent.diff === facts.diff &&
      sent.head === facts.head &&
      sent.base === facts.base &&
      ["title", "body", "author", "history"].every((name) => !(name in sent)),
  };
});
scenario("jev-invalid", (broken) =>
  rejects(() =>
    jev({ ...classes, mechanical: { type: "noul", noul: broken ? 1 : "yes" } }).adapter.classify(
      facts,
      classificationQuestions,
      context(),
    ),
  ),
);
scenario("jev-retry", async (broken) => {
  const j = jev(classes, { failures: broken ? 0 : 1 });
  await j.adapter.classify(facts, classificationQuestions, context());
  return { ok: j.attempts() === 2 };
});
scenario("jev-auth", async (broken) => {
  const j = jev(classes, { failures: 1, status: broken ? 503 : 401 });
  const error = await rejects(() => j.adapter.classify(facts, classificationQuestions, context()));
  return { ok: error.ok && j.attempts() === 1 };
});
scenario("jev-outage", async (broken) => {
  const j = jev(classes, { failures: broken ? 0 : 3 });
  const services = { ...recordedServices(recording), classify: j.adapter.classify };
  const result = await review(request, recording.config, services);
  return {
    ok: result.kind === "error" && result.stage === "classification" && !result.mergeEligible,
  };
});
scenario("jev-risk", async (broken) => {
  const answers = Object.fromEntries(
    dimensions.map((d) => [
      d,
      {
        type: "score",
        confidence: 0.8,
        probabilities: { 0: 0, 1: broken ? 1 : 0, 2: broken ? 0 : 1, 3: 0 },
      },
    ]),
  );
  const r = await jev(answers).adapter.risk(facts, [], riskQuestions, context());
  return { ok: riskSchema.parse(r).dimensions.operations.probabilities[2] === 1 };
});
scenario("jev-route", async (broken) => {
  const answers = Object.fromEntries(cardNames.map((n) => [n, { type: "noul", noul: 0.5 }]));
  const r = await jev({
    ...answers,
    documentationSubstantive: { type: "noul", noul: 1 },
    exposure: {
      type: "score",
      confidence: broken ? 1 : 0,
      probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 },
    },
  }).adapter.route(facts, "documentation", routeQuestions, context());
  return {
    ok: routeSchema.parse(r).confidence === 0,
  };
});
scenario("no-publish-head", async (broken) => {
  const copy = structuredClone(recording);
  copy.config = { ...configSchema.parse(copy.config), publication: "none" };
  copy.head = broken ? request.head : "f".repeat(40);
  const result = await review(request, copy.config, recordedServices(copy));
  return { ok: result.kind === "error" && !result.mergeEligible };
});
scenario(
  "card-findings",
  async () => {
    const raw =
      cardText() +
      "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    consequence: Writes can escape.\n    action: Restore the guard.\n";
    return { findings: parseCard(raw, "safety").findings };
  },
  {
    findings: [
      {
        tag: "issue",
        severity: "MAJOR",
        confidence: "HIGH",
        location: "a.ts:1",
        what: "A guard is missing.",
        detail: "Consequence: Writes can escape. Restore the guard.",
      },
    ],
  },
);
// Python's parse_council reads the whole block for tagged bullets and never requires the
// Checked, Not covered or Findings labels; a label mentioned again in free text is not an error.
scenario(
  "card-headers-optional",
  async (broken) => {
    const finding =
      "- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n    action: Restore the guard.\n";
    const card = parseCard(
      `card: safety\ncompletion: completed\n\nI reviewed the change; see Findings: below.\n${broken ? "" : finding}`,
      "safety",
    );
    return { checked: card.checked, notCovered: card.notCovered, findings: card.findings.length };
  },
  { checked: [], notCovered: [], findings: 1 },
);
scenario(
  "card-incomplete",
  async (broken) => {
    const card = parseCard(
      broken
        ? cardText()
        : cardText().replace(
            "completion: completed",
            "completion: incomplete: the eval fixture is in another repository",
          ),
      "safety",
    );
    return {
      completion: card.completion,
      completionReason: card.completionReason ?? null,
      voice: needsVoice([card], rate(null, false, config), 1, config),
    };
  },
  {
    completion: "incomplete",
    completionReason: "the eval fixture is in another repository",
    voice: true,
  },
);
scenario("card-malformed", (broken) =>
  rejects(async () =>
    parseCard(cardText() + (broken ? "" : "- [issue] missing fields\n"), "safety"),
  ),
);
scenario(
  "card-ambiguous",
  async (broken) => {
    const card = parseCard(
      `card: safety\ncompletion: ${broken ? "skipped: no file matched" : "completed"}\n\nChecked:\n- Reviewed; completion: completed is restated here.\n\ncard: safety\ncompletion: incomplete: a draft line\n`,
      "safety",
    );
    return { completion: card.completion, checked: card.checked.length };
  },
  { completion: "completed", checked: 1 },
);
// Python's _TAG_BULLET tolerates emphasis around the tag and numbered bullets; its
// _finding_fields reads `k=v` in any order, ignores keys it does not know, and drops a
// `ledger=` value that is not a ledger key. `(none)` under Findings is prose, not a finding.
scenario(
  "card-tag-forms",
  async (broken) => {
    const card = parseCard(
      `card: safety\ncompletion: completed\nFindings:\n(none yet)\n- ${broken ? "**issue**" : "**[issue]**"} a.ts:1 · confidence=high · severity=**major** · owner=reviewer · ledger=not-a-key · late=missed\n    what: A guard is missing.\n1. *[ info ]* b.ts:2 · severity=MINOR · confidence=LOW\n    what: A note.\n    note: Optional.\n`,
      "safety",
    );
    return { findings: card.findings };
  },
  {
    findings: [
      { tag: "issue", location: "a.ts:1", severity: "MAJOR", confidence: "HIGH", late: "missed" },
      {
        tag: "info",
        location: "b.ts:2",
        severity: "MINOR",
        confidence: "LOW",
        detail: "Optional.",
      },
    ],
  },
);
// Python read only `what:`/`note:`; consequence and action are run-only fields that are never
// a reason to refuse: missing is empty, a repeated label takes the last value.
scenario(
  "card-subfields",
  async (broken) => {
    const card = parseCard(
      `card: safety\ncompletion: completed\nFindings:\n- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: A guard is missing.\n${broken ? "    consequence: Writes escape.\n" : ""}    action: Draft fix.\n    action: Restore the guard.\n- [info] b.ts:2 · severity=MINOR · confidence=LOW\n    note: Only a note line.\n`,
      "safety",
    );
    return { details: card.findings.map((f) => [f.what, f.detail ?? null]) };
  },
  {
    details: [
      ["A guard is missing.", "Restore the guard."],
      ["Only a note line.", "Only a note line."],
    ],
  },
);
// Python's ids: `[issue]` findings are F1…Fn across the council in card order, assigned once
// every card has parsed; an `[info]` carries none.
scenario(
  "card-global-ids",
  async (broken) => {
    const first = parseCard(
      "card: safety\ncompletion: completed\nFindings:\n- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: One.\n- [info] a.ts:2 · severity=MINOR · confidence=LOW\n    what: Note.\n",
      "safety",
    );
    const second = parseCard(
      "card: works-and-proven\ncompletion: completed\nFindings:\n- [issue] b.ts:1 · severity=MAJOR · confidence=HIGH\n    what: Two.\n",
      "works-and-proven",
    );
    const cards = broken ? [second, first] : [first, second];
    assignFindingIds(cards);
    return {
      ids: [first, second].map((card) => card.findings.map((f) => f.id ?? null)),
      mandatory: mandatory(cards),
    };
  },
  { ids: [["F1", null], ["F2"]], mandatory: ["F1", "F2"] },
);
// Python's _OUTCOMES includes ERROR: Margot's own fail-closed ruling, with a finding she could
// not resolve legitimately in neither list.
scenario(
  "voice-error-outcome",
  async (broken) => {
    const voice = parseVoice(
      `I read the council's findings against the cited lines.\n\noutcome: ${broken ? "CHANGES_REQUESTED" : "ERROR"}\nband: MEDIUM\nband_reason: the change touches one bounded behavior with a revert as its recovery\nrisk: retry-loop exposure\nsummary: The retry wraps one call and is bounded; the findings below decide it.\nfinding: F1 could not be checked: the head's file could not be read\nclarification: \nestablished:\ndismissed:\n`,
    );
    return { outcome: voice.outcome, band: voice.band, dispositions: voice.dispositions.length };
  },
  { outcome: "ERROR", band: "MEDIUM", dispositions: 0 },
);
scenario(
  "voice-accounting",
  async (broken) => {
    return parseVoice(
      `outcome: CHANGES_REQUESTED\nband: LOW\nband_reason: Bounded change.\nsummary: Restore the guard.\n${broken ? "dismissed" : "established"}:\n- safety-F1 · a.ts:1 · The guard is missing.\ndismissed:\n- safety-F2 · a.ts:2 · Existing check covers this.\n`,
    );
  },
  {
    outcome: "CHANGES_REQUESTED",
    band: "LOW",
    rationale: "Bounded change.",
    summary: "Restore the guard.",
    dispositions: [
      { id: "safety-F1", status: "established", reason: "a.ts:1 · The guard is missing." },
      { id: "safety-F2", status: "dismissed", reason: "a.ts:2 · Existing check covers this." },
    ],
  },
);
scenario(
  "voice-python-tolerance",
  async () => {
    const finalBlock = parseVoice(
      "outcome: CHANGES_REQUESTED\nband: HIGH\nband_reason: Draft.\nsummary: Draft.\n\nI reconsidered.\n**outcome:** **approved**.\n**band:** **medium**!\nband_reason: Final reason.\nsummary: Final summary.\nEstablished:\nDismissed:\n",
    );
    const forms = parseVoice(
      "outcome: approved.\nband: `low`\nband_reason: Bounded.\nsummary: Clear.\nEsTaBlIsHeD:\n- **alpha-F1** · dot reason\n- __beta_F2__ — dash reason\n- *gamma-F3*: colon reason\n- _delta_\n- `epsilon-5` · tick reason\n- (not an id) is ignored\n### Notes\n- after-heading · ignored\nESTABLISHED:\n- zeta-F6 · before rule\n---\n- after-rule · ignored\nestablished:\n- eta-F7 · before prose\nThese notes are optional.\n- **after-prose (MINOR):** ignored\nDISMISSED:\n- unknown-id: dismissed reason\n",
    );
    const liveFailure = parseVoice(
      "I checked the one finding that could still block and dismissed it, so this is approved. It's banded HIGH, though, which means you merge it, not me.\n\noutcome: APPROVED\nband: HIGH\nband_reason: I'm keeping the model's HIGH, and for a stronger reason than its scoring. The model's blast_radius and verification_gap readings have zero confidence. But this repository is the package Margot runs as. The change alters how the stranded-check closer concludes required checks: superseded and merged now close as `skipped`, which GitHub treats as passing. It also changes how `bind-request` reports a stop: it exits 75 with `stop_reason`/`live_sha` in GITHUB_OUTPUT, and the sample drops its `set +e` wrapper. Changing what grades or gates a review is above my authority, so the operator decides. The safety card checked that `skipped` only happens for superseded or merged, and that the leave-the-live-head rule still holds. That makes the risk a matter of who decides, not a defect. A lower band is not justified.\nrisk: changes to the reviewer's own gate\nsummary: This change renames Margot's install-location setting so that nothing is called \"engine\". It also makes every early stop close Margot's status check with the same result the older Python version gave, and it puts back saved records of past reviews that the first round had wrongly edited. The only blocking problem left from round one, the edited records, is fixed: the files match the originals exactly. Because the change affects how Margot's own pass/fail check is closed, the operator decides whether to merge. Three small notes are optional.\nfinding: none\nestablished:\ndismissed:\n- verify-R1-F2 · docs/live/documentation.json:54 · Fixed. Line 54 at head is byte-for-byte the same as base 4437550, and nothing under docs/ is in this PR's changed-file list anymore, so the saved record shows what GitHub actually supplied again. The maintainable-no-slop card's own resolution of R1-F2 says the same.\n\nThese three notes don't block and the author can take or leave them:\n- **achieves-the-objective-F1 (MINOR):** the PR description's \"grep finds only principal-engineer\" claim is now false. The restored lines `docs/SLICE4.md:22` and `docs/SLICE4.md:175` still contain \"engine\".\n- **maintainable-no-slop-F1 (MINOR):** in `src/closer.ts`, the `cancelled` and `unknown` entries repeat the same title and summary text.\n- **house-style-F1 (info):** the draft, fork, conflict and empty check titles in `src/closer.ts` don't start with \"Margot:\" like the other titles do.\n",
    );
    return {
      final: {
        outcome: finalBlock.outcome,
        band: finalBlock.band,
        rationale: finalBlock.rationale,
        summary: finalBlock.summary,
      },
      forms: forms.dispositions,
      live: liveFailure.dispositions,
    };
  },
  {
    final: {
      outcome: "APPROVED",
      band: "MEDIUM",
      rationale: "Final reason.",
      summary: "Final summary.",
    },
    forms: [
      { id: "alpha-F1", status: "established", reason: "dot reason" },
      { id: "beta_F2", status: "established", reason: "dash reason" },
      { id: "gamma-F3", status: "established", reason: "colon reason" },
      { id: "delta", status: "established", reason: "" },
      { id: "epsilon-5", status: "established", reason: "tick reason" },
      { id: "zeta-F6", status: "established", reason: "before rule" },
      { id: "eta-F7", status: "established", reason: "before prose" },
      { id: "unknown-id", status: "dismissed", reason: "dismissed reason" },
    ],
    live: [
      {
        id: "verify-R1-F2",
        status: "dismissed",
        reason:
          "docs/live/documentation.json:54 · Fixed. Line 54 at head is byte-for-byte the same as base 4437550, and nothing under docs/ is in this PR's changed-file list anymore, so the saved record shows what GitHub actually supplied again. The maintainable-no-slop card's own resolution of R1-F2 says the same.",
      },
    ],
  },
);
scenario("credential-isolation", async (broken) => {
  const env = claudeEnvironment({
    PATH: "/bin",
    JEV_KEY: "jev-canary",
    GH_TOKEN: "write-canary",
    UNRELATED_SECRET: "other",
  });
  if (broken) env.GH_TOKEN = "write-canary";
  return { ok: !env.JEV_KEY && !env.GH_TOKEN && !env.UNRELATED_SECRET && env.PATH === "/bin" };
});
scenario("process-error", (broken) =>
  rejects(() => execute(process.execPath, ["-e", `process.exit(${broken ? 0 : 1})`])),
);
scenario("process-timeout", (broken) =>
  rejects(() =>
    execute(process.execPath, ["-e", broken ? "" : "setTimeout(()=>{},10000)"], {
      signal: AbortSignal.timeout(100),
    }),
  ),
);
scenario("bundle-pin", async (broken) => {
  const root = await mkdtemp(join(tmpdir(), "margot-bundle-test-"));
  try {
    await execute("git", ["init", "-q", root]);
    await writeFile(join(root, "a"), "a");
    await execute("git", ["-C", root, "add", "a"]);
    await execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    const sha = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).trim();
    try {
      await resolveBundle(root, broken ? sha : "f".repeat(40), context());
      return { ok: false };
    } catch (e) {
      return { ok: String(e).includes("pin mismatch") };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
scenario("evidence-bound", async (broken) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const calls: unknown[] = [];
  const server = createEvidenceServer(
    { request },
    {
      ...github().adapter,
      async readFile(r, path, revision) {
        calls.push({ r, path, revision });
        return "safe file";
      },
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  try {
    await server.connect(a);
    await client.connect(b);
    await client.callTool({
      name: "read_file",
      arguments: {
        path: "a.ts",
        revision: broken ? "base" : "head",
        repository: "attacker/repo",
        head: "f".repeat(40),
      },
    });
    return {
      ok:
        JSON.stringify(calls) === JSON.stringify([{ r: request, path: "a.ts", revision: "head" }]),
    };
  } finally {
    await client.close();
    await server.close();
  }
});
scenario("evidence-tools", async (broken) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const server = createEvidenceServer({ request }, github().adapter);
  if (broken) server.registerTool("write_file", { inputSchema: {} }, async () => ({ content: [] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  try {
    await server.connect(a);
    await client.connect(b);
    return {
      ok:
        JSON.stringify((await client.listTools()).tools.map((t) => t.name).sort()) ===
        JSON.stringify(["list_files", "read_file", "search_file"]),
    };
  } finally {
    await client.close();
    await server.close();
  }
});
async function fakeClaude(
  options: {
    version?: string;
    tools?: string[];
    envelope?: Record<string, unknown>;
    facts?: typeof facts;
    delta?: string;
    ticketing?: {
      server: string;
      command: string;
      args: string[];
      env: string[];
      tools: string[];
    };
    ticketingEnvironment?: Record<string, string>;
    cliEnvironment?: NodeJS.ProcessEnv;
    role?: "card" | "voice";
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-test-"));
  try {
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents/pr-reviewer.md"),
      "---\ndescription: Test reviewer\nmodel: inherit\n---\nPinned test law.\n",
    );
    await writeFile(
      join(root, "agents/margot.md"),
      "---\ndescription: Test voice\nmodel: inherit\n---\nPinned test voice.\n",
    );
    const executable = join(root, "claude.cjs"),
      capture = join(root, "capture.json");
    const envelope = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: options.role === "voice" ? voiceText() : cardText(),
      total_cost_usd: 0,
      ...options.envelope,
    };
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  if (process.env.MARGOT_WRITE_TOKEN) process.exit(19);
  console.log(${JSON.stringify(options.version ?? "0.0.1 test")});
} else {
  console.log(JSON.stringify(${JSON.stringify({ type: "system", subtype: "init", tools: options.tools ?? [] })}));
  const args = process.argv.slice(2);
  const mcp = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  const evidence = JSON.parse(mcp.mcpServers.evidence.env.MARGOT_EVIDENCE);
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
    args,
    mcp,
    stdin: fs.readFileSync(0, "utf8"),
    diff: fs.readFileSync(evidence.diffPath, "utf8"),
  }));
  console.log(JSON.stringify(${JSON.stringify(envelope)}));
}`,
      { mode: 0o700 },
    );
    const claude = {
      executable,
      ...(options.ticketing ? { ticketing: options.ticketing } : {}),
      version: "0.0.1",
      pluginDirectory: root,
      reviewerModel: "example-model",
    };
    const adapter = options.cliEnvironment
      ? cliServices(
          {
            ...JSON.parse(
              await readFile(new URL("../samples/config.sample.json", import.meta.url), "utf8"),
            ),
            claude,
          },
          { JEV_KEY: "unused", ...options.cliEnvironment },
        ).services
      : claudeAdapter({
          ...claude,
          ...(options.ticketingEnvironment
            ? { ticketingEnvironment: options.ticketingEnvironment }
            : {}),
        });
    const round = {
      round: options.delta === undefined ? 1 : 2,
      priorHead: options.delta === undefined ? null : "b".repeat(40),
      full: options.delta === undefined,
      diff: options.delta ?? (options.facts ?? facts).diff,
      files: (options.facts ?? facts).files,
      entries: [],
    };
    const result =
      options.role === "voice"
        ? await adapter.voice(
            {
              facts: options.facts ?? facts,
              classification: "functional",
              cards: [],
              rating: {} as never,
              agent: "publish:margot",
              round,
            },
            context(),
          )
        : await adapter.card(
            {
              facts: options.facts ?? facts,
              name: "safety",
              classification: "functional",
              cardPath: join(root, "skills/pr-council/playbooks/safety.md"),
              agent: "publish:pr-reviewer",
              round,
            },
            context(),
          );
    return {
      ...(JSON.parse(await readFile(capture, "utf8")) as {
        args: string[];
        mcp: { mcpServers: Record<string, { command: string; env?: Record<string, string> }> };
        stdin: string;
        diff: string;
      }),
      result,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
scenario("claude-tools", async () => {
  const { args } = await fakeClaude();
  return {
    ok:
      args[args.indexOf("--tools") + 1] === "" &&
      args.includes("--strict-mcp-config") &&
      args.includes("--restricted") &&
      args[args.indexOf("--setting-sources") + 1] === "",
  };
});
const ticketing = {
  server: "tickets",
  command: "/opt/margot/bin/ticket-reader",
  args: ["--read-only", "--tenant", "example"],
  env: ["TICKETING_TOKEN", "TICKETING_TENANT"],
  tools: ["mcp__tickets__get_issue", "mcp__tickets__get_comments"],
};
scenario(
  "ticketing-card-tools",
  async (broken) => {
    const configured = {
      ticketing,
      ticketingEnvironment: {
        TICKETING_TOKEN: "test-only-ticket-token",
        TICKETING_TENANT: "test-only-tenant",
      },
    };
    const card = await fakeClaude(configured);
    const voice = await fakeClaude({ ...configured, role: "voice" });
    const cardAgent = JSON.parse(card.args[card.args.indexOf("--agents") + 1] ?? "{}")[
      "margot-bound"
    ];
    const voiceAgent = JSON.parse(voice.args[voice.args.indexOf("--agents") + 1] ?? "{}")[
      "margot-bound"
    ];
    const cardServer = card.mcp.mcpServers.tickets;
    if (broken && cardServer) voice.mcp.mcpServers.tickets = cardServer;
    return {
      cardTicketingServers: Object.keys(card.mcp.mcpServers)
        .filter((server) => server !== "evidence")
        .sort(),
      cardServer,
      cardTicketingTools: cardAgent.tools.filter((tool: string) =>
        tool.startsWith("mcp__tickets__"),
      ),
      voiceTicketingServers: Object.keys(voice.mcp.mcpServers)
        .filter((server) => server !== "evidence")
        .sort(),
      voiceServer: voice.mcp.mcpServers.tickets ?? null,
      voiceTicketingTools: voiceAgent.tools.filter((tool: string) =>
        tool.startsWith("mcp__tickets__"),
      ),
    };
  },
  {
    cardTicketingServers: ["tickets"],
    cardServer: {
      command: "/opt/margot/bin/ticket-reader",
      args: ["--read-only", "--tenant", "example"],
      env: {
        TICKETING_TOKEN: "test-only-ticket-token",
        TICKETING_TENANT: "test-only-tenant",
      },
    },
    cardTicketingTools: ticketing.tools,
    voiceTicketingServers: [],
    voiceServer: null,
    voiceTicketingTools: [],
  },
);
scenario(
  "ticketing-cli-environment",
  async (broken) => {
    const environment = {
      JEV_KEY: "unused",
      TICKETING_TOKEN: "test-only-cli-token",
      TICKETING_TENANT: "test-only-cli-tenant",
      UNRELATED_SECRET: "must-not-be-forwarded",
    };
    const invocation = await fakeClaude({
      ticketing,
      cliEnvironment: environment,
    });
    const selected = broken ? environment : configuredTicketingEnvironment(ticketing, environment);
    const forwarded = invocation.mcp.mcpServers.tickets?.env ?? {};
    return {
      selectedKeys: Object.keys(selected).sort(),
      selectedValues: selected,
      forwardedKeys: Object.keys(forwarded).sort(),
      forwardedValues: forwarded,
    };
  },
  {
    selectedKeys: ["TICKETING_TENANT", "TICKETING_TOKEN"],
    selectedValues: {
      TICKETING_TOKEN: "test-only-cli-token",
      TICKETING_TENANT: "test-only-cli-tenant",
    },
    forwardedKeys: ["TICKETING_TENANT", "TICKETING_TOKEN"],
    forwardedValues: {
      TICKETING_TOKEN: "test-only-cli-token",
      TICKETING_TENANT: "test-only-cli-tenant",
    },
  },
);
scenario(
  "ticketing-unconfigured",
  async (broken) => {
    const invocation = await fakeClaude({
      ...(broken ? { ticketing } : {}),
      ticketingEnvironment: {
        TICKETING_TOKEN: "test-only-ticket-token",
        TICKETING_TENANT: "test-only-tenant",
      },
    });
    const agent = JSON.parse(invocation.args[invocation.args.indexOf("--agents") + 1] ?? "{}")[
      "margot-bound"
    ];
    return {
      server: invocation.mcp.mcpServers.tickets ?? null,
      tools: agent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
    };
  },
  { server: null, tools: [] },
);
scenario(
  "ticketing-unset-environment",
  async (broken) => {
    const invocation = await fakeClaude({
      ticketing,
      ticketingEnvironment: {
        TICKETING_TOKEN: "test-only-ticket-token",
        ...(broken ? { TICKETING_TENANT: "unexpected-tenant" } : {}),
      },
    });
    const agent = JSON.parse(invocation.args[invocation.args.indexOf("--agents") + 1] ?? "{}")[
      "margot-bound"
    ];
    return {
      server: invocation.mcp.mcpServers.tickets ?? null,
      tools: agent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
    };
  },
  { server: null, tools: [] },
);
scenario("ticketing-secret-boundary", async (broken) => {
  const secrets = ["test-only-ticket-secret", "test-only-tenant-secret"] as const;
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: {
      TICKETING_TOKEN: secrets[0],
      TICKETING_TENANT: secrets[1],
    },
  });
  const exposed = `${JSON.stringify(invocation.result)}\n${invocation.stdin}`;
  return {
    ok: secrets.every((secret) => !(broken ? `${exposed}\n${secret}` : exposed).includes(secret)),
  };
});
scenario(
  "claude-stdin-delta",
  async () => {
    const fullDiff = `diff --git a/a.ts b/a.ts\n@@ -1 +1,20000 @@\n-old\n${"+full PR evidence\n".repeat(20000)}`;
    const delta = `diff --git a/a.ts b/a.ts\n@@ -1 +1,2000 @@\n-old\n${"+round delta\n".repeat(1999)}+delta tail\n`;
    const inputFacts = { ...facts, body: "Review context. ".repeat(2000), diff: fullDiff };
    try {
      const { args, stdin, diff } = await fakeClaude({ facts: inputFacts, delta });
      const supplied = JSON.parse(stdin.split("\n").at(-1) ?? "");
      return {
        stdinPrompt:
          stdin.startsWith("Perform shadow review round 2.") &&
          stdin.includes("Review only the supplied delta plus standing entries."),
        argvPrompt: args.some((arg) => arg.includes("Perform shadow review round")),
        facts: supplied.facts,
        round: supplied.round,
        diff,
        inlineDiff: stdin.includes("full PR evidence") || stdin.includes("delta tail"),
      };
    } catch {
      return { stdinPrompt: false };
    }
  },
  {
    stdinPrompt: true,
    argvPrompt: false,
    facts: { ...facts, body: "Review context. ".repeat(2000), diff: "Available through read_diff" },
    round: {
      round: 2,
      priorHead: "b".repeat(40),
      full: false,
      diff: "Available through read_diff",
      files: facts.files,
      entries: [],
    },
    diff: `diff --git a/a.ts b/a.ts\n@@ -1 +1,2000 @@\n-old\n${"+round delta\n".repeat(1999)}+delta tail\n`,
    inlineDiff: false,
  },
);
async function rejectsWith(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
    return { ok: false };
  } catch (error) {
    return { ok: String(error).includes(message) };
  }
}
scenario("claude-unexpected-tool", () =>
  rejectsWith(() => fakeClaude({ tools: ["Bash"] }), "unexpected tool"),
);
scenario("claude-version", () =>
  rejectsWith(() => fakeClaude({ version: "0.0.2 test" }), "pin mismatch"),
);
scenario("claude-envelope-subtype", () =>
  rejectsWith(() => fakeClaude({ envelope: { subtype: "error_during_execution" } }), "success"),
);
scenario("claude-envelope-error", () =>
  rejectsWith(() => fakeClaude({ envelope: { is_error: true } }), "is_error"),
);
scenario("claude-envelope-empty", () =>
  rejectsWith(() => fakeClaude({ envelope: { result: "" } }), "result"),
);
scenario("truncated-hunk", (broken) =>
  rejectsWith(
    () =>
      github({
        diff: `diff --git a/a.ts b/a.ts\n@@ -1,${broken ? 1 : 2} +1,${broken ? 1 : 2} @@\n-old\n+new`,
      }).adapter.facts(request, context()),
    "Diff hunks are incomplete",
  ),
);
scenario("process-redaction", async () => {
  const canary = "test-only-mcp-token-canary";
  try {
    await execute(process.execPath, [
      "-e",
      "process.stderr.write(process.argv[2]);process.exit(1)",
      "--",
      "--mcp-config",
      JSON.stringify({ mcpServers: { evidence: { env: { GH_TOKEN: canary } } } }),
    ]);
    return { ok: false };
  } catch (error) {
    const saved = JSON.stringify({
      message: String(error),
      stack: error instanceof Error ? error.stack : "",
    });
    return {
      ok:
        String(error).includes("Process failed:") &&
        !saved.includes(canary) &&
        !saved.includes("GH_TOKEN") &&
        !saved.includes("--mcp-config"),
    };
  }
});
const metadataDiffs = {
  "zero-rename":
    "diff --git a/old.ts b/a.ts\nsimilarity index 100%\nrename from old.ts\nrename to a.ts\n",
  "empty-added": "diff --git a/a.ts b/a.ts\nnew file mode 100644\nindex 0000000..e69de29\n",
  "mode-only": "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n",
};
for (const [id, diff] of Object.entries(metadataDiffs)) {
  scenario(id, async (broken) => {
    try {
      const result = await github({
        patch: null,
        additions: 0,
        deletions: 0,
        status: id === "zero-rename" ? "renamed" : id === "empty-added" ? "added" : "modified",
        ...(id === "zero-rename" ? { previousFilename: "old.ts" } : {}),
        diff: broken ? "" : diff,
      }).adapter.facts(request, context());
      return {
        ok:
          result.complete &&
          result.fileCount === 1 &&
          result.files[0]?.path === "a.ts" &&
          (id !== "zero-rename" || result.files[0]?.previousPath === "old.ts"),
      };
    } catch {
      return { ok: false };
    }
  });
}
for (const [id, marker] of Object.entries({
  "binary-diff": "Binary files a/a.ts and b/a.ts differ",
  "binary-patch": "GIT binary patch\nliteral 1\nIc${Nk000310RR91",
})) {
  scenario(id, (broken) =>
    rejectsWith(
      () =>
        github({
          patch: null,
          additions: 0,
          deletions: 0,
          diff: metadataDiffs["mode-only"] + (broken ? "" : `${marker}\n`),
        }).adapter.facts(request, context()),
      "Diff hunks are incomplete",
    ),
  );
}
scenario("evidence-range", async (broken) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const server = createEvidenceServer(
    { request },
    {
      ...github().adapter,
      async readFile() {
        return Array.from({ length: 700 }, (_, i) => `line-${i + 1}`).join("\n");
      },
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "large.ts", start_line: broken ? 1 : 601, max_lines: 2 },
    });
    return {
      ok:
        JSON.stringify(result).includes("601: line-601") &&
        JSON.stringify(result).includes("602: line-602") &&
        !JSON.stringify(result).includes("603: line-603"),
    };
  } finally {
    await client.close();
    await server.close();
  }
});
scenario("evidence-search", async (broken) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const server = createEvidenceServer(
    { request },
    {
      ...github().adapter,
      async readFile() {
        return "other\ncheck-yaml\nend";
      },
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: "search_file",
      arguments: { path: "test.ts", text: broken ? "missing" : "check-yaml" },
    });
    return { ok: JSON.stringify(result).includes("2: check-yaml") };
  } finally {
    await client.close();
    await server.close();
  }
});

scenario("base-freshness", (broken) =>
  rejects(() =>
    github({ base: broken ? request.base : "f".repeat(40) }).adapter.head(request, context()),
  ),
);
scenario("bundle-dirty", async (broken) => {
  const root = await mkdtemp(join(tmpdir(), "margot-dirty-bundle-"));
  try {
    await execute("git", ["init", "-q", root]);
    const paths = [
      ".claude-plugin/plugin.json",
      "agents/pr-reviewer.md",
      "agents/margot.md",
      "skills/pr-council/SKILL.md",
      ...cardNames.map((n) => `skills/pr-council/playbooks/${n}.md`),
    ];
    for (const path of paths) {
      const target = join(root, path);
      await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      await writeFile(target, "pinned content");
      await execute("git", ["-C", root, "add", path]);
    }
    await execute("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    const sha = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).trim();
    if (!broken) await writeFile(join(root, "agents/margot.md"), "changed instructions");
    return await rejects(() => resolveBundle(root, sha, context()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

scenario(
  "shadow-before-head",
  async (b) => {
    const facts = await github({ ledger: true, shadowBeforeHead: !b }).adapter.facts(
      request,
      context(),
    );
    return { priorLedger: facts.history.priorLedger };
  },
  { priorLedger: false },
);
scenario("shadow-cannot-publish", async (b) => {
  const config = JSON.parse(
    await readFile(new URL("../samples/config.sample.json", import.meta.url), "utf8"),
  );
  config.review.publication = "github";
  config.github.shadowBeforeHead = !b;
  config.publisher = {
    checks: { triage: "triage", review: "review", authority: "authority" },
    actor: "example[bot]",
    appId: 1,
    runUrl: "https://example.invalid/run/1",
  };
  return rejects(async () => {
    liveServices(config, { jevKey: "unused", writeToken: "unused" });
  });
});
scenario("claude-probe-credential", async () => {
  const previous = process.env.MARGOT_WRITE_TOKEN;
  process.env.MARGOT_WRITE_TOKEN = "test-only-publication-credential";
  try {
    await fakeClaude();
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    if (previous === undefined) delete process.env.MARGOT_WRITE_TOKEN;
    else process.env.MARGOT_WRITE_TOKEN = previous;
  }
});
