import { Octokit } from "octokit";
import parseDiff from "parse-diff";
import { z } from "zod";
import { diffIsComplete } from "../diff.js";
import { errorMessage } from "../errors.js";
import {
  checkConclusions,
  classNames,
  factsSchema,
  probability,
  requestSchema,
} from "../schemas.js";
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

export function githubAdapter(
  client: Octokit,
  options: {
    freshShadow?: boolean;
    shadowBeforeHead?: boolean;
    triageAppId?: number;
    triageCheckName?: string;
    ownedPathTier?: unknown;
  } = {},
) {
  const params = (r: ReviewRequest, c: CallContext) => {
    requestSchema.parse(r);
    const [owner = "", repo = ""] = r.repository.split("/");
    return { owner, repo, pull_number: r.pr, request: { signal: c.signal } };
  };
  const pull = async (r: ReviewRequest, c: CallContext) =>
    (await client.rest.pulls.get(params(r, c))).data;
  return {
    async compare(r: ReviewRequest, priorHead: string, c: CallContext) {
      const p = { ...params(r, c), basehead: `${priorHead}...${r.head}` };
      const [metadata, diff] = await Promise.all([
        client.rest.repos.compareCommitsWithBasehead(p),
        client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
          ...p,
          mediaType: { format: "diff" },
        }),
      ]);
      return {
        base: priorHead,
        head: r.head,
        status: metadata.data.status,
        diff: diff.data,
        complete: true,
      };
    },
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
      let historyComplete = true;
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
        client.paginate(client.rest.pulls.listReviews, { ...p, per_page: 100 }).catch((error) => {
          console.warn(
            `Margot: review history unreadable (${errorMessage(error)}); treating it as incomplete`,
          );
          historyComplete = false;
          return [];
        }),
      ]);
      const after = await pull(r, c);
      if (
        after.head.sha !== r.head ||
        after.base.sha !== r.base ||
        after.body !== before.body ||
        after.title !== before.title
      )
        throw new Error("PR changed while reading facts");
      const diffText: unknown = diff.data;
      if (typeof diffText !== "string") throw new Error("Incomplete GitHub diff");
      // The whole-PR diff is the source of truth: the compare endpoint caps its files array,
      // but the diff has no such cap. The file list comes from it, and it is complete when
      // every hunk is closed. GitHub's per-file listing is capped at 3,000,
      // lags the PR's own `changed_files` on a fresh push, and omits `patch` with zero counts
      // for large files; it is used only to enrich a file the diff already names, and its
      // counts are cross-checked only where it supplied the content.
      const parsed = parseDiff(diffText);
      if (!diffIsComplete(diffText, parsed)) throw new Error("Diff hunks are incomplete");
      // parse-diff names each section from its `---`/`+++`/`rename` lines, one path per line,
      // never by splitting the `diff --git a/X b/Y` header (a path can contain " b/").
      // Where GitHub's listing is as long as the diff it is complete, and every diff path
      // must appear in it; a shorter
      // listing is GitHub's cap, and the diff's names stand on their own.
      const listed = new Map(files.map((f) => [f.filename, f]));
      const listingComplete = files.length >= parsed.length;
      const diffFiles = parsed.map((file) => {
        const path = file.to && file.to !== "/dev/null" ? file.to : (file.from ?? "");
        const from = file.from && file.from !== "/dev/null" ? file.from : undefined;
        const entry = listed.get(path);
        if (!entry && listingComplete) throw new Error("Diff and file listing disagree");
        if (
          entry &&
          typeof entry.patch === "string" &&
          (file.additions !== entry.additions || file.deletions !== entry.deletions)
        )
          throw new Error("Diff hunks are incomplete");
        const previous = entry?.previous_filename ?? (from && from !== path ? from : undefined);
        return { path, ...(previous ? { previousPath: previous } : {}) };
      });
      if (diffFiles.some((f) => !f.path)) throw new Error("Diff hunks are incomplete");
      // Over-inclusion is the safe direction for the protected-path gate: a file GitHub lists
      // that the diff did not name is still a changed file.
      for (const f of files)
        if (!diffFiles.some((d) => d.path === f.filename))
          diffFiles.push({
            path: f.filename,
            ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
          });
      const historyReviews = options.shadowBeforeHead
        ? reviews.filter((v) => v.commit_id !== r.head)
        : reviews;
      let triage = null;
      const latest = checks
        .filter(
          (check) =>
            options.triageAppId !== undefined &&
            options.triageCheckName !== undefined &&
            check.name === options.triageCheckName &&
            check.status === "completed" &&
            check.head_sha === r.head &&
            check.app?.id === options.triageAppId,
        )
        .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "") || b.id - a.id)[0];
      if (latest?.started_at && Number.isInteger(latest.id)) {
        try {
          const machine = JSON.parse(latest.output?.text ?? "");
          const classification =
            "classification" in machine
              ? machine.classification
              : typeof machine.mechanical === "boolean"
                ? machine.mechanical
                  ? "mechanical"
                  : "functional"
                : null;
          if (
            machine.head_sha === r.head &&
            machine.decision_source === "jev" &&
            classNames.includes(classification)
          )
            triage = {
              actor: latest.app?.slug ?? "unknown",
              base: r.base,
              head: r.head,
              classification,
              ...(probability.safeParse(machine.mechanical_probability).success
                ? { mechanicalProbability: machine.mechanical_probability }
                : {}),
            };
        } catch (error) {
          // Unreadable triage conservatively requires functional review.
          console.warn(
            `Margot: triage check output unreadable (${errorMessage(error)}); requiring functional review`,
          );
        }
      }
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
        fileCount: diffFiles.length,
        files: diffFiles,
        checks: checks.map((check) => ({
          name: check.name,
          actor: check.app?.slug ?? "unknown",
          head: check.head_sha,
          ...(check.started_at ? { startedAt: check.started_at } : {}),
          id: check.id,
          // The conclusion GitHub recorded, never one claimed on the check's behalf.
          conclusion:
            check.status === "completed"
              ? (checkConclusions.find((c) => c === check.conclusion) ?? "pending")
              : "pending",
        })),
        history: {
          complete: historyComplete,
          priorLedger:
            !options.freshShadow && historyReviews.some((r) => r.body.includes("margot-ledger:")),
          ...(!options.freshShadow
            ? {
                reviews: historyReviews
                  .filter((r) => r.submitted_at)
                  .map((r) => ({
                    id: r.id,
                    actor: r.user?.login ?? "unknown",
                    actorType: r.user?.type ?? "unknown",
                    head: r.commit_id,
                    submittedAt: r.submitted_at,
                    body: r.body,
                  })),
              }
            : {}),
        },
        triage,
        ownedPathTier: options.ownedPathTier,
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
    /** The current run of one named check on the bound head, with its output. */
    async checkRun(r: ReviewRequest, name: string, c: CallContext) {
      const runs = await client.paginate(client.rest.checks.listForRef, {
        ...params(r, c),
        ref: r.head,
        per_page: 100,
        filter: "latest",
      });
      const run = runs
        .filter((check) => check.name === name && check.head_sha === r.head)
        .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "") || b.id - a.id)[0];
      if (!run) throw new Error("No check run of that name on the head");
      return {
        name: run.name,
        app: run.app?.slug ?? "unknown",
        conclusion:
          run.status === "completed"
            ? (checkConclusions.find((v) => v === run.conclusion) ?? "pending")
            : "pending",
        title: run.output.title ?? "",
        summary: run.output.summary ?? "",
        text: run.output.text ?? "",
      };
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
export function githubClient(options: { token?: string; gh?: string; retries?: number }) {
  return new Octokit({
    ...(options.token ? { auth: options.token } : {}),
    ...(options.gh ? { request: { fetch: ghFetch(options.gh) } } : {}),
    retry: { retries: options.retries ?? 2 },
  });
}
