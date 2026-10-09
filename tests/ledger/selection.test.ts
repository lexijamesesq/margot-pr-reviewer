import { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { githubAdapter } from "../../src/adapters/github.js";
import { recordedServices } from "../../src/adapters/recorded.js";
import { ledgerBlock, selectLedger } from "../../src/ledger.js";
import { review } from "../../src/review.js";
import { configSchema, factsSchema, requestSchema } from "../../src/schemas.js";
import {
  config,
  diff,
  entry,
  facts,
  history,
  oldHead,
  posted,
  prior,
  source,
} from "../helpers/ledger.js";
import { present } from "../helpers/present.js";
import { readRecording } from "../helpers/recordings.js";

it("ignores ledger history posted by an untrusted author", () => {
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
    ),
  ).toBe(null);
});
it("ignores a ledger whose head differs from the review commit", () => {
  const f = history();
  present(f.history.reviews[0]).head = "f".repeat(40);
  expect(selectLedger(f, config)).toBe(null);
});
it("holds for the operator when the trusted ledger is corrupt", async () => {
  const f = history();
  present(f.history.reviews[0]).body = "review\n<!-- margot-ledger:v1 garbage -->";
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
it("selects the newest submitted ledger", () => {
  const f = history();
  f.history.reviews.push({
    ...posted(prior([], 3)),
    id: 2,
    submittedAt: "2026-09-02T00:00:00Z",
  });
  expect({ round: selectLedger(f, config)?.round }).toMatchObject({ round: 3 });
});
it("selects the trusted App ledger when a newer human comment quotes a marker", () => {
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
it("rejects a ledger with duplicate keys", () => {
  expect(selectLedger(history(prior([entry(), entry()])), config)).toBe(null);
});
it("skips a quoted ledger that is not the terminal marker", () => {
  const f = history();
  present(f.history.reviews[0]).body += "\nquoted text";
  expect(selectLedger(f, config)).toBe(null);
});
it("holds for the operator when a trusted ledger marker has malformed encoding", async () => {
  const f = history();
  present(f.history.reviews[0]).body = "review\n<!-- margot-ledger:v1 !!! -->";
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
for (const [name, pageTwoFails] of [
  ["selects a ledger found on the second page of reviews", false],
  ["reports incomplete history when the second review page is unreadable", true],
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
      await githubAdapter(client).facts(
        { ...requestSchema.parse(source.request), phase: "triage" },
        {
          signal: AbortSignal.timeout(3000),
        },
      ),
    );
    if (pageTwoFails) {
      expect(f.history.complete).toBe(false);
    } else {
      expect(selectLedger(f, config)?.round).toBe(1);
      expect(pages.filter((p) => p.includes("/reviews"))).toHaveLength(2);
    }
  });
describe("history warnings", () => {
  it.each(["corrupt", "revision"])(
    "holds for the operator when a newer %s ledger obscures valid history",
    async (defect) => {
      const recording = readRecording("mechanical-bump");
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
