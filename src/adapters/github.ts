import { Octokit } from "octokit";
import parseDiff from "parse-diff";
import { z } from "zod";
import { factsSchema, requestSchema } from "../schemas.js";
import type { CallContext, ReviewRequest } from "../types.js";
import { execute } from "./process.js";

/** Optional credential broker bridge; Octokit still owns requests and pagination. GET only. */
export function ghFetch(executable: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== "https://api.github.com" || (init?.method ?? "GET") !== "GET")
      throw new Error("GitHub bridge permits GitHub GET only");
    const accept = new Headers(init?.headers).get("accept") ?? "application/vnd.github+json";
    const raw = await execute(
      executable,
      [
        "api",
        `${url.pathname.slice(1)}${url.search}`,
        "--method",
        "GET",
        "--include",
        "-H",
        `Accept: ${accept}`,
      ],
      init?.signal ? { signal: init.signal } : {},
    );
    const split = raw.search(/\r?\n\r?\n/);
    if (split < 0) throw new Error("Missing GitHub response headers");
    const header = raw.slice(0, split).split(/\r?\n/);
    const status = Number(header.shift()?.split(" ")[1]);
    const headers = new Headers();
    for (const line of header) {
      const colon = line.indexOf(":");
      if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    const response = new Response(raw.slice(split).replace(/^\r?\n\r?\n/, ""), { status, headers });
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  }) as typeof fetch;
}

export function githubAdapter(client: Octokit, options: { freshShadow?: boolean } = {}) {
  const params = (r: ReviewRequest, c: CallContext) => {
    requestSchema.parse(r);
    const [owner = "", repo = ""] = r.repository.split("/");
    return { owner, repo, pull_number: r.pr, request: { signal: c.signal } };
  };
  const pull = async (r: ReviewRequest, c: CallContext) =>
    (await client.rest.pulls.get(params(r, c))).data;
  return {
    async head(r: ReviewRequest, c: CallContext) {
      const current = await pull(r, c);
      if (
        current.base.sha !== r.base ||
        current.draft ||
        current.head.repo?.full_name !== r.repository
      )
        throw new Error("PR base or admission changed before completion");
      return current.head.sha;
    },
    async facts(r: ReviewRequest, c: CallContext) {
      const p = params(r, c);
      const before = await pull(r, c);
      // Shadow permits closed PRs for comparison; it never grants publication authority.
      if (before.draft || before.head.repo?.full_name !== r.repository)
        throw new Error("Draft or fork PR is not admitted");
      if (before.base.sha !== r.base || before.head.sha !== r.head)
        throw new Error("PR revision moved");
      const [files, diff, checks, reviews] = await Promise.all([
        client.paginate(client.rest.pulls.listFiles, { ...p, per_page: 100 }),
        client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
          ...p,
          mediaType: { format: "diff" },
        }),
        client.paginate(client.rest.checks.listForRef, {
          ...p,
          ref: r.head,
          per_page: 100,
          filter: "latest",
        }),
        client.paginate(client.rest.pulls.listReviews, { ...p, per_page: 100 }),
      ]);
      const after = await pull(r, c);
      if (
        after.head.sha !== r.head ||
        after.base.sha !== r.base ||
        after.body !== before.body ||
        after.title !== before.title
      )
        throw new Error("PR changed while reading facts");
      // GitHub's list-files cap is 3000. Never infer completeness from a last page alone.
      const diffText: unknown = diff.data;
      if (files.length !== before.changed_files || typeof diffText !== "string")
        throw new Error("Incomplete GitHub diff");
      // Missing patches include binary/truncated changes. Refuse rather than quietly omit evidence.
      if (files.some((f) => typeof f.patch !== "string"))
        throw new Error("A changed file has no complete text patch");
      const diffFiles = [...diffText.matchAll(/^diff --git /gm)].length;
      if (diffFiles !== files.length) throw new Error("Diff and file inventory disagree");
      const parsed = parseDiff(diffText);
      if (
        parsed.length !== files.length ||
        parsed.some((file, index) => {
          const expected = files[index];
          return (
            !expected ||
            file.additions !== expected.additions ||
            file.deletions !== expected.deletions ||
            file.chunks.some(
              (chunk) =>
                chunk.changes.filter((c) => c.type !== "add" && !c.content.startsWith("\\"))
                  .length !== chunk.oldLines ||
                chunk.changes.filter((c) => c.type !== "del" && !c.content.startsWith("\\"))
                  .length !== chunk.newLines,
            )
          );
        })
      )
        throw new Error("Diff hunks are incomplete");
      return factsSchema.parse({
        repository: r.repository,
        pr: r.pr,
        base: r.base,
        head: r.head,
        title: before.title,
        body: before.body ?? "",
        author: before.user.login,
        diff: diffText,
        complete: true,
        fileCount: before.changed_files,
        files: files.map((f) => ({
          path: f.filename,
          ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
        })),
        checks: checks.map((check) => ({
          name: check.name,
          actor: check.app?.slug ?? "unknown",
          head: check.head_sha,
          conclusion:
            check.status !== "completed"
              ? "pending"
              : check.conclusion === "success"
                ? "success"
                : check.conclusion === "skipped"
                  ? "skipped"
                  : "failure",
        })),
        history: {
          complete: true,
          priorLedger:
            !options.freshShadow && reviews.some((r) => r.body.includes("margot-ledger:")),
        },
        triage: null,
        autoMergeArmed: before.auto_merge !== null,
      });
    },
    async readFile(r: ReviewRequest, path: string, revision: "head" | "base", c: CallContext) {
      if (!path || path.startsWith("/") || path.split("/").some((p) => p === "." || p === ".."))
        throw new Error("Invalid repository path");
      const response = await client.rest.repos.getContent({
        ...params(r, c),
        path,
        ref: r[revision],
      });
      const blob = z
        .object({
          type: z.literal("file"),
          encoding: z.literal("base64"),
          content: z.string(),
          size: z.number(),
        })
        .parse(response.data);
      if (blob.size > 1024 * 1024 || (!blob.content && blob.size > 0))
        throw new Error("File exceeds evidence limit");
      return Buffer.from(blob.content, "base64").toString("utf8");
    },
    async tree(r: ReviewRequest, c: CallContext) {
      const tree = (
        await client.rest.git.getTree({ ...params(r, c), tree_sha: r.head, recursive: "1" })
      ).data;
      if (tree.truncated) throw new Error("Repository tree truncated");
      return tree.tree.map((item) => item.path).join("\n");
    },
  };
}
export function githubClient(options: { token?: string; gh?: string }) {
  return new Octokit({
    ...(options.token ? { auth: options.token } : {}),
    ...(options.gh ? { request: { fetch: ghFetch(options.gh) } } : {}),
    retry: { retries: 2 },
  });
}
