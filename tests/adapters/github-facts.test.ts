import { readFileSync } from "node:fs";
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import * as githubModule from "../../src/adapters/github.js";
import { githubAdapter } from "../../src/adapters/github.js";
import { liveServices } from "../../src/adapters/live.js";
import { changedLineCount } from "../../src/diff.js";
import type { Recording } from "../../src/index.js";
import { factsSchema, requestSchema } from "../../src/schemas.js";
import { context, github, request } from "../helpers/adapters.js";

it("follows the second page of the file listing", async () => {
  const { adapter, calls } = github({ pageTwo: true, count: 2 });
  const facts = await adapter.facts(request, context());
  expect(facts.files.length === 2 && calls.some((c) => c.includes("page=2"))).toBe(true);
});
it("takes the file count from the diff when the pull request's changed_files count lags", async () => {
  // GitHub's `changed_files` lags on a fresh push and the listing is capped at 3,000; the
  // file list comes from the diff, and the two are never compared.
  const result = await github({ count: 2 }).adapter.facts(request, context());
  expect(result.fileCount).toBe(1);
  expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
});
it("reviews a file the diff names but the listing omits", async () => {
  const result = await github({
    diff: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-old\n+new\n",
  }).adapter.facts(request, context());
  expect(result.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
});
it("accepts a file listed without its own patch when the whole diff carries it", async () => {
  const result = await github({ patch: null }).adapter.facts(request, context());
  expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
});
it("refuses a file whose supplied counts the whole diff does not match", async () => {
  await expect(github({ additions: 3 }).adapter.facts(request, context())).rejects.toThrow(
    "Diff hunks are incomplete",
  );
});
it("defers to the whole diff when a listing entry has no patch and zero counts", async () => {
  // GitHub listed 272 files for a real PR with additions 0, deletions 0 and no patch for files
  // past its size threshold; the diff carried 146- and 373-line deletions for them.
  const deleted = Array.from({ length: 4 }, (_, i) => `-line ${i}`).join("\n");
  const result = await github({
    patch: null,
    additions: 0,
    deletions: 0,
    status: "removed",
    diff: `diff --git a/a.ts b/a.ts\n@@ -1,4 +0,0 @@\n${deleted}\n`,
  }).adapter.facts(request, context());
  expect(result.files[0]).toMatchObject({ path: "a.ts" });
});
it("refuses a diff missing its file header", async () => {
  await expect(
    github({
      diff: "not a diff",
    }).adapter.facts(request, context()),
  ).rejects.toThrow();
});
it("refuses head movement during fact collection", async () => {
  await expect(github({ moved: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("refuses draft pull requests", async () => {
  await expect(github({ draft: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("refuses fork pull requests", async () => {
  await expect(github({ fork: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("reports history as incomplete when GitHub history is unreadable", async () => {
  expect(
    !(await github({ historyFailure: true }).adapter.facts(request, context())).history.complete,
  ).toBe(true);
});
it("detects an existing ledger outside an explicit fresh shadow", async () => {
  expect(
    (await github({ ledger: true }).adapter.facts(request, context())).history.priorLedger,
  ).toBe(true);
});
it("completes a removed file with no patch when the whole diff carries its deletion", async () => {
  // GitHub omits `patch` for large changes; a 2,289-line deletion in a real PR had none.
  const deleted = Array.from({ length: 5 }, (_, i) => `-line ${i}`).join("\n");
  const result = await github({
    patch: null,
    additions: 0,
    deletions: 5,
    status: "removed",
    diff: `diff --git a/a.ts b/a.ts\n@@ -1,5 +0,0 @@\n${deleted}\n`,
  }).adapter.facts(request, context());
  expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
});
it("names deleted, added, renamed and oddly named files from the diff's own header lines", async () => {
  // Real diffs carry `---`/`+++`/`rename` lines; the `diff --git a/X b/Y` header is never split,
  // so a path containing " b/" or spaces survives.
  const diff = [
    "diff --git a/dir b/x.ts b/dir b/x.ts",
    "deleted file mode 100644",
    "--- a/dir b/x.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-old",
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1 @@",
    "+new",
    "diff --git a/old.ts b/renamed.ts",
    "similarity index 100%",
    "rename from old.ts",
    "rename to renamed.ts",
    'diff --git "a/sp ace.ts" "b/sp ace.ts"',
    '--- "a/sp ace.ts"',
    '+++ "b/sp ace.ts"',
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
  const result = await github({ diff, patch: null, additions: 0, deletions: 0 }).adapter.facts(
    request,
    context(),
  );
  expect(result.files).toEqual([
    { path: "dir b/x.ts" },
    { path: "new.ts" },
    { path: "renamed.ts", previousPath: "old.ts" },
    { path: "sp ace.ts" },
    { path: "a.ts" },
  ]);
});
it("refuses a diff path the complete listing does not know", async () => {
  await expect(
    github({
      diff: "diff --git a/zzz.ts b/zzz.ts\n--- a/zzz.ts\n+++ b/zzz.ts\n@@ -1 +1 @@\n-old\n+new\n",
    }).adapter.facts(request, context()),
  ).rejects.toThrow("Diff and file listing disagree");
});
it("refuses a partial final hunk as incomplete facts", async () => {
  await expect(
    github({
      diff: "diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new",
    }).adapter.facts(request, context()),
  ).rejects.toThrow("Diff hunks are incomplete");
});
const modeOnlyDiff = "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n";
for (const [name, id, diff] of [
  [
    "accepts a zero-change rename without a patch",
    "zero-rename",
    "diff --git a/old.ts b/a.ts\nsimilarity index 100%\nrename from old.ts\nrename to a.ts\n",
  ],
  [
    "accepts an empty added file without a patch",
    "empty-added",
    "diff --git a/a.ts b/a.ts\nnew file mode 100644\nindex 0000000..e69de29\n",
  ],
  [
    "accepts a mode-only change without a patch",
    "mode-only",
    "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n",
  ],
] as const) {
  it(name, async () => {
    const result = await github({
      patch: null,
      additions: 0,
      deletions: 0,
      status: id === "zero-rename" ? "renamed" : id === "empty-added" ? "added" : "modified",
      ...(id === "zero-rename" ? { previousFilename: "old.ts" } : {}),
      diff: diff,
    }).adapter.facts(request, context());
    expect(
      result.complete &&
        result.fileCount === 1 &&
        result.files[0]?.path === "a.ts" &&
        (id !== "zero-rename" || result.files[0]?.previousPath === "old.ts"),
    ).toBe(true);
  });
}
for (const [name, marker] of [
  ["lists a binary file as a change with no text lines", "Binary files a/a.ts and b/a.ts differ"],
  [
    "lists an encoded binary patch as a change with no text lines",
    "GIT binary patch\nliteral 1\nIc${Nk000310RR91",
  ],
] as const) {
  it(name, async () => {
    const result = await github({
      patch: null,
      additions: 0,
      deletions: 0,
      diff: `${modeOnlyDiff}${marker}\n`,
    }).adapter.facts(request, context());
    expect(result.complete && result.files[0]?.path).toBe("a.ts");
  });
}
it("fails the final freshness check when the base moved", async () => {
  await expect(github({ base: "f".repeat(40) }).adapter.head(request, context())).rejects.toThrow();
});
it("starts a before-head shadow fresh despite same-head publication", async () => {
  const facts = await github({ ledger: true, shadowBeforeHead: true }).adapter.facts(
    request,
    context(),
  );
  expect({ priorLedger: facts.history.priorLedger }).toMatchObject({ priorLedger: false });
});
describe("GitHub triage and diff size", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const request = requestSchema.parse(seed.request);
  const context = () => ({ signal: AbortSignal.timeout(3000) });
  it("uses only the newest triage check matching the configured App and check name", async () => {
    const files = Symbol("files"),
      checks = Symbol("checks"),
      reviews = Symbol("reviews");
    const check = (id: number, app: number, name: string, classification: string) => ({
      id,
      name,
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
                check(1, 321, "custom / triage", "mechanical"),
                check(2, 321, "custom / triage", "documentation"),
                check(3, 123, "custom / triage", "mechanical"),
                check(4, 321, "other / triage", "mechanical"),
                check(5, 4862659, "review / triage", "mechanical"),
              ]
            : [],
    } as unknown as Octokit;
    const config = JSON.parse(
      readFileSync(new URL("../../samples/config.sample.json", import.meta.url), "utf8"),
    );
    config.publisher = {
      checks: { triage: "custom / triage", review: "custom / review", authority: "authority" },
      actor: "custom[bot]",
      appId: 321,
      runUrl: "https://example.invalid/run/1",
    };
    const clientSpy = vi.spyOn(githubModule, "githubClient").mockReturnValue(client);
    try {
      const result = factsSchema.parse(
        await liveServices(config, { jevKey: "unused" }).services.facts(request, context()),
      );
      const unconfigured = await githubAdapter(client).facts(request, context());
      expect({ triage: result.triage, unconfigured: unconfigured.triage }).toMatchObject({
        triage: { actor: "triage-app", head: request.head, classification: "documentation" },
        unconfigured: null,
      });
    } finally {
      clientSpy.mockRestore();
    }
  });
  it("counts diff headers and context toward the review size limit", () => {
    expect({
      lines: changedLineCount(
        "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n context\n+a\n-b\nlast",
      ),
    }).toMatchObject({ lines: 7 });
  });
});
it("refuses GitHub write authority for a shadow history selection", async () => {
  const config = JSON.parse(
    readFileSync(new URL("../../samples/config.sample.json", import.meta.url), "utf8"),
  );
  config.review.publication = "github";
  config.github.shadowBeforeHead = true;
  config.publisher = {
    checks: { triage: "triage", review: "review", authority: "authority" },
    actor: "example[bot]",
    appId: 1,
    runUrl: "https://example.invalid/run/1",
  };
  expect(() => liveServices(config, { jevKey: "unused", writeToken: "unused" })).toThrow();
});
