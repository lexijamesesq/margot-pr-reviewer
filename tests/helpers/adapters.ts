import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import { claudeAdapter } from "../../src/adapters/claude.js";
import { githubAdapter } from "../../src/adapters/github.js";
import { cliServices } from "../../src/cli-services.js";
import { factsSchema, requestSchema } from "../../src/schemas.js";
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
/** Runs the Claude adapter against a scripted CLI and returns what the CLI captured plus the parsed result. */
export async function fakeClaude(
  options: {
    version?: string;
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
    /** Replaces the tools the fixture reviewer's frontmatter grants. */
    reviewerTools?: string[];
    /** A file the fake CLI appends each invocation's arguments to. */
    spawnLog?: string;
    role?: "card" | "voice";
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-test-"));
  try {
    await mkdir(join(root, "agents"));
    await mkdir(join(root, ".claude-plugin"));
    for (const skill of ["pr-council", "github-readme", "smoke"])
      await mkdir(join(root, "skills", skill), { recursive: true });
    await writeFile(join(root, "skills/README.md"), "Not a skill.");
    await writeFile(join(root, ".claude-plugin/plugin.json"), '{"name":"publish"}');
    const reviewerTools = options.reviewerTools ?? [
      "Skill",
      "Read",
      ...["read_diff", "read_file", "search_file", "list_files", "read_reference"].map(
        (name) => `mcp__evidence__${name}`,
      ),
      ...ticketing.tools,
    ];
    await writeFile(
      join(root, "agents/pr-reviewer.md"),
      `---\ndescription: Test reviewer\nmodel: inherit\ntools:\n${reviewerTools.map((t) => `  - ${t}\n`).join("")}---\nPinned test law.\n`,
    );
    await writeFile(
      join(root, "agents/margot.md"),
      "---\ndescription: Test voice\nmodel: inherit\ntools:\n  - mcp__evidence__read_file\n  - mcp__evidence__read_diff\n---\nPinned test voice.\n",
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
${options.spawnLog ? `fs.appendFileSync(${JSON.stringify(options.spawnLog)}, process.argv.slice(2).join(" ") + "\\n");\n` : ""}if (process.argv.includes("--version")) {
  if (process.env.MARGOT_WRITE_TOKEN) process.exit(19);
  console.log(${JSON.stringify(options.version ?? "0.0.1 test")});
} else {
  const args = process.argv.slice(2);
  const mcpPath = args[args.indexOf("--mcp-config") + 1];
  const mcpText = fs.readFileSync(mcpPath, "utf8");
  const mcp = JSON.parse(mcpText);
  const evidence = JSON.parse(mcp.mcpServers.evidence.env.MARGOT_EVIDENCE);
  // Like Claude Code: the agent's frontmatter grants, --tools narrows the built-ins, and an
  // MCP tool survives only when its server is configured and serves it.
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const agentPath = value("--plugin-dir") + "/agents/" + String(value("--agent")).split(":")[1] + ".md";
  const listed = fs.existsSync(agentPath)
    ? [...fs.readFileSync(agentPath, "utf8").matchAll(/^  - (.+)$/gm)].map((m) => m[1])
    : [];
  const builtIns = (value("--tools") ?? "").split(",");
  const granted = listed.filter((tool) =>
    !tool.startsWith("mcp__")
      ? builtIns.includes(tool)
      : tool === "mcp__evidence__read_reference"
        ? !!evidence.references
        : !!mcp.mcpServers[tool.split("__")[1]],
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
    args,
    mcp,
    mcpMode: fs.statSync(mcpPath).mode & 0o777,
    mcpPath,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    diffPath: evidence.diffPath,
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
              classification: options.classification ?? "functional",
              agent: "publish:pr-reviewer",
              round,
            },
            context(),
          );
    return {
      ...(JSON.parse(await readFile(capture, "utf8")) as {
        args: string[];
        mcpMode: number;
        mcpPath: string;
        cwd: string;
        cwdEntries: string[];
        diffPath: string;
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
        diff: string;
      }),
      result,
      root,
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

/** Connects an evidence server to an in-memory client; `close` shuts both down. */
export async function connectEvidence(
  server: ReturnType<typeof import("../../src/adapters/evidence-server.js").createEvidenceServer>,
) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
