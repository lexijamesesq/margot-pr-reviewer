import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import { claudeAdapter } from "../../src/adapters/claude.js";
import { githubAdapter } from "../../src/adapters/github.js";
import { cliServices } from "../../src/cli-services.js";
import { factsSchema, requestSchema } from "../../src/schemas.js";
import type { Card } from "../../src/types.js";
import { readRecording } from "./recordings.js";

export const recording = readRecording("mechanical-bump");
export const request = requestSchema.parse(recording.request);
export const facts = factsSchema.parse(recording.facts);
export const context = () => ({ signal: AbortSignal.timeout(3000) });
function cardText() {
  return "card: safety\ncompletion: completed\nChecked:\n- Inspected changed permission grants; would catch write access.\nNot covered:\n- Runtime execution; outside the change.\nFindings:\n";
}
function voiceText() {
  return "outcome: APPROVED\nband: LOW\nband_reason: Bounded.\nsummary: Clear.\nestablished:\ndismissed:\n";
}
/** A GitHub adapter over a scripted transport; each override changes one thing the transport reports. */
export function github(
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
    checkRuns?: unknown[];
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
    } else if (url.pathname.endsWith("/check-runs")) {
      const runs = overrides.checkRuns ?? [];
      data = { total_count: runs.length, check_runs: runs };
    } else if (url.pathname.endsWith("/reviews")) {
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
export const image = `example.invalid/margot-runtime@sha256:${"a".repeat(64)}`;
/** Runs the Claude adapter against a scripted docker and returns what it captured plus the parsed result. */
export async function fakeClaude(
  options: {
    tools?: string[];
    /** Report the requested tools with the first one replaced by this name. */
    replaceFirstTool?: string;
    mcpServers?: { name: string; status: string }[];
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
    githubToken?: string;
    cliEnvironment?: NodeJS.ProcessEnv;
    references?: Record<string, { repository: string; head: string }>;
    ownChecks?: string[];
    classification?: "functional" | "documentation" | "mechanical";
    /** The council the voice rules on. */
    cards?: Card[];
    /** Replaces the tools the fixture reviewer's frontmatter grants. */
    reviewerTools?: string[];
    /** A file the fake docker appends each Claude invocation's arguments to. */
    spawnLog?: string;
    role?: "card" | "voice";
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-test-"));
  try {
    const bundle = join(root, "bundle"),
      work = join(root, "base");
    await mkdir(work);
    await mkdir(join(bundle, "agents"), { recursive: true });
    await mkdir(join(bundle, ".claude-plugin"));
    for (const skill of ["pr-council", "github-readme", "smoke"])
      await mkdir(join(bundle, "skills", skill), { recursive: true });
    await writeFile(join(bundle, "skills/README.md"), "Not a skill.");
    await writeFile(join(bundle, ".claude-plugin/plugin.json"), '{"name":"publish"}');
    const reviewerTools = options.reviewerTools ?? [
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "Bash",
      ...ticketing.tools,
    ];
    await writeFile(
      join(bundle, "agents/pr-reviewer.md"),
      `---\ndescription: Test reviewer\nmodel: inherit\ntools:\n${reviewerTools.map((t) => `  - ${t}\n`).join("")}---\nPinned test law.\n`,
    );
    await writeFile(
      join(bundle, "agents/margot.md"),
      "---\ndescription: Test voice\nmodel: inherit\ntools:\n  - Bash\n---\nPinned test voice.\n",
    );
    const executable = join(root, "docker.cjs"),
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
const argv = process.argv.slice(2);
const at = argv.indexOf(${JSON.stringify(image)});
const docker = argv.slice(0, at + 1);
const args = argv.slice(at + 2);
${options.spawnLog ? `fs.appendFileSync(${JSON.stringify(options.spawnLog)}, args.join(" ") + "\\n");\n` : ""}{
  const mcp = process.env.MARGOT_MCP_CONFIG ? JSON.parse(process.env.MARGOT_MCP_CONFIG) : { mcpServers: {} };
  // Like docker: the bundle is the host directory mounted at the container's plugin directory.
  const mounts = docker.flatMap((arg, i) => (docker[i - 1] === "--mount" ? [Object.fromEntries(arg.split(",").map((kv) => kv.split("=")))] : []));
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const bundle = mounts.find((mount) => mount.target === value("--plugin-dir"))?.source;
  // Like Claude Code: the agent's frontmatter grants, --tools narrows the built-ins, and an
  // MCP tool survives only when its server is configured.
  const agentPath = bundle + "/agents/" + String(value("--agent")).split(":")[1] + ".md";
  const listed = fs.existsSync(agentPath)
    ? [...fs.readFileSync(agentPath, "utf8").matchAll(/^  - (.+)$/gm)].map((m) => m[1])
    : [];
  const builtIns = (value("--tools") ?? "").split(",");
  const granted = listed.filter((tool) =>
    !tool.startsWith("mcp__") ? builtIns.includes(tool) : !!mcp.mcpServers[tool.split("__")[1]],
  );
  console.log(JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ${JSON.stringify(options.tools ?? null)} ??
      granted.map((tool, index) => (index === 0 ? ${JSON.stringify(options.replaceFirstTool ?? null)} ?? tool : tool)),
    mcp_servers: ${JSON.stringify(options.mcpServers ?? null)} ??
      Object.keys(mcp.mcpServers).map((name) => ({ name, status: "connected" })),
  }));
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
    docker,
    program: argv[at + 1],
    args,
    mounts,
    env: process.env,
    mcp,
    stdin: fs.readFileSync(0, "utf8"),
  }));
  console.log(JSON.stringify(${JSON.stringify(envelope)}));
}`,
      { mode: 0o700 },
    );
    const claude = {
      executable: "claude",
      ...(options.ticketing ? { ticketing: options.ticketing } : {}),
      version: "0.0.1",
      pluginDirectory: bundle,
      reviewerModel: "example-model",
      container: { docker: executable, image, work },
      ...(options.references ? { references: options.references } : {}),
    };
    const adapter = options.cliEnvironment
      ? cliServices(
          {
            ...JSON.parse(
              await readFile(new URL("../../samples/config.sample.json", import.meta.url), "utf8"),
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
          ...(options.githubToken ? { githubToken: options.githubToken } : {}),
          ...(options.ownChecks ? { ownChecks: options.ownChecks } : {}),
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
              classification: options.classification ?? "functional",
              cards: options.cards ?? [],
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
              classification: options.classification ?? "functional",
              agent: "publish:pr-reviewer",
              round,
            },
            context(),
          );
    return {
      ...(JSON.parse(await readFile(capture, "utf8")) as {
        docker: string[];
        program: string;
        args: string[];
        mounts: Record<string, string>[];
        env: Record<string, string>;
        mcp: {
          mcpServers: Record<
            string,
            {
              command: string;
              env?: Record<string, string>;
            }
          >;
        };
        stdin: string;
      }),
      result,
      bundle,
      work,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
export const ticketing = {
  server: "tickets",
  command: "/opt/margot/bin/ticket-reader",
  args: ["--read-only", "--tenant", "example"],
  env: ["TICKETING_TOKEN", "TICKETING_TENANT"],
  tools: ["mcp__tickets__get_issue", "mcp__tickets__get_comments"],
};
