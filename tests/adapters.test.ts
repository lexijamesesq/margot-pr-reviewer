import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Octokit } from "octokit";
import { describe, expect, it } from "vitest";
import { resolveBundle } from "../src/adapters/bundle.js";
import { claudeAdapter, claudeEnvironment } from "../src/adapters/claude.js";
import { ghFetch, githubAdapter } from "../src/adapters/github.js";
import { liveServices } from "../src/adapters/live.js";
import { execute } from "../src/adapters/process.js";
import { cliServices, configuredTicketingEnvironment } from "../src/cli-services.js";
import { changedLineCount } from "../src/diff.js";
import type { Recording } from "../src/index.js";
import { cardNames, factsSchema, requestSchema } from "../src/schemas.js";

const recording = JSON.parse(
  readFileSync(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
) as Recording;
const request = requestSchema.parse(recording.request);
const facts = factsSchema.parse(recording.facts);
const context = () => ({ signal: AbortSignal.timeout(3000) });
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
it("GitHub follows the second file page", async () => {
  const { adapter, calls } = github({ pageTwo: true, count: 2 });
  const facts = await adapter.facts(request, context());
  expect(facts.files.length === 2 && calls.some((c) => c.includes("page=2"))).toBe(true);
});
it("GitHub refuses an incomplete file inventory", async () => {
  await expect(github({ count: 2 }).adapter.facts(request, context())).rejects.toThrow();
});
it("GitHub refuses a missing text patch", async () => {
  await expect(github({ patch: null }).adapter.facts(request, context())).rejects.toThrow();
});
it("GitHub refuses a diff missing its file header", async () => {
  await expect(
    github({
      diff: "not a diff",
    }).adapter.facts(request, context()),
  ).rejects.toThrow();
});
it("GitHub refuses head movement during fact collection", async () => {
  await expect(github({ moved: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("GitHub refuses draft PRs", async () => {
  await expect(github({ draft: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("GitHub refuses fork PRs", async () => {
  await expect(github({ fork: true }).adapter.facts(request, context())).rejects.toThrow();
});
it("Unreadable GitHub history degrades to unavailable", async () => {
  expect(
    !(await github({ historyFailure: true }).adapter.facts(request, context())).history.complete,
  ).toBe(true);
});
it("Existing ledgers are detected outside explicit fresh shadow", async () => {
  expect(
    (await github({ ledger: true }).adapter.facts(request, context())).history.priorLedger,
  ).toBe(true);
});
it("The gh bridge rejects a write method before spawning", async () => {
  await expect(
    ghFetch("not-a-real-command")("https://api.github.com/repos/example/project", {
      method: "POST",
    }).catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ).rejects.toThrow();
});
it("The gh bridge rejects an alternate API origin", async () => {
  await expect(
    ghFetch("not-a-real-command")("https://other.invalid/x").catch((e) => {
      if (String(e).includes("GET only")) throw e;
      return new Response("{}");
    }),
  ).rejects.toThrow();
});
it("Claude inherits only its explicit credential allowlist", () => {
  const env = claudeEnvironment({
    PATH: "/bin",
    JEV_KEY: "jev-canary",
    GH_TOKEN: "write-canary",
    UNRELATED_SECRET: "other",
  });
  expect(!env.JEV_KEY && !env.GH_TOKEN && !env.UNRELATED_SECRET && env.PATH === "/bin").toBe(true);
});
it("A failed subprocess cannot return success", async () => {
  await expect(execute(process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow();
});
it("A timed out subprocess cannot return success", async () => {
  await expect(
    execute(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      signal: AbortSignal.timeout(100),
    }),
  ).rejects.toThrow();
});
it("A mismatched bundle commit fails before loading cards", async () => {
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
    await expect(resolveBundle(root, "f".repeat(40), context())).rejects.toThrow("pin mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("MCP evidence keeps caller-supplied repository and SHA out of routing", async () => {
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
        revision: "head",
        repository: "attacker/repo",
        head: "f".repeat(40),
      },
    });
    return expect(
      JSON.stringify(calls) === JSON.stringify([{ r: request, path: "a.ts", revision: "head" }]),
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
it("The evidence server exposes only repository read tools", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
  const server = createEvidenceServer({ request }, github().adapter);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  try {
    await server.connect(a);
    await client.connect(b);
    return expect(
      JSON.stringify((await client.listTools()).tools.map((t) => t.name).sort()) ===
        JSON.stringify(["list_files", "read_file", "search_file"]),
    ).toBe(true);
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
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("Claude cannot invoke built-in tools or load PR settings", async () => {
  const { args } = await fakeClaude();
  expect(
    args[args.indexOf("--tools") + 1] === "" &&
      args.includes("--strict-mcp-config") &&
      args.includes("--restricted") &&
      args[args.indexOf("--setting-sources") + 1] === "",
  ).toBe(true);
});
const ticketing = {
  server: "tickets",
  command: "/opt/margot/bin/ticket-reader",
  args: ["--read-only", "--tenant", "example"],
  env: ["TICKETING_TOKEN", "TICKETING_TENANT"],
  tools: ["mcp__tickets__get_issue", "mcp__tickets__get_comments"],
};
it("Configured ticket evidence is granted only to card runs", async () => {
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
  expect({
    cardTicketingServers: Object.keys(card.mcp.mcpServers)
      .filter((server) => server !== "evidence")
      .sort(),
    cardServer,
    cardTicketingTools: cardAgent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
    voiceTicketingServers: Object.keys(voice.mcp.mcpServers)
      .filter((server) => server !== "evidence")
      .sort(),
    voiceServer: voice.mcp.mcpServers.tickets ?? null,
    voiceTicketingTools: voiceAgent.tools.filter((tool: string) =>
      tool.startsWith("mcp__tickets__"),
    ),
  }).toMatchObject({
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
  });
});
it("The CLI forwards exactly the configured environment variables", async () => {
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
  const selected = configuredTicketingEnvironment(ticketing, environment);
  const forwarded = invocation.mcp.mcpServers.tickets?.env ?? {};
  expect({
    selectedKeys: Object.keys(selected).sort(),
    selectedValues: selected,
    forwardedKeys: Object.keys(forwarded).sort(),
    forwardedValues: forwarded,
  }).toMatchObject({
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
  });
});
it("Ticket evidence stays detached without configuration", async () => {
  const invocation = await fakeClaude({
    ticketingEnvironment: {
      TICKETING_TOKEN: "test-only-ticket-token",
      TICKETING_TENANT: "test-only-tenant",
    },
  });
  const agent = JSON.parse(invocation.args[invocation.args.indexOf("--agents") + 1] ?? "{}")[
    "margot-bound"
  ];
  expect({
    server: invocation.mcp.mcpServers.tickets ?? null,
    tools: agent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
  }).toMatchObject({ server: null, tools: [] });
});
it("Ticket evidence stays detached when a named environment variable is unset", async () => {
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: {
      TICKETING_TOKEN: "test-only-ticket-token",
    },
  });
  const agent = JSON.parse(invocation.args[invocation.args.indexOf("--agents") + 1] ?? "{}")[
    "margot-bound"
  ];
  expect({
    server: invocation.mcp.mcpServers.tickets ?? null,
    tools: agent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
  }).toMatchObject({ server: null, tools: [] });
});
it("Ticket credentials stay out of the model prompt and parsed result", async () => {
  const secrets = ["test-only-ticket-secret", "test-only-tenant-secret"] as const;
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: {
      TICKETING_TOKEN: secrets[0],
      TICKETING_TENANT: secrets[1],
    },
  });
  const exposed = `${JSON.stringify(invocation.result)}\n${invocation.stdin}`;
  return expect(secrets.every((secret) => !exposed.includes(secret))).toBe(true);
});
it("Claude receives its complete prompt on stdin and only the round delta through read_diff", async () => {
  const fullDiff = `diff --git a/a.ts b/a.ts\n@@ -1 +1,20000 @@\n-old\n${"+full PR evidence\n".repeat(20000)}`;
  const delta = `diff --git a/a.ts b/a.ts\n@@ -1 +1,2000 @@\n-old\n${"+round delta\n".repeat(1999)}+delta tail\n`;
  const inputFacts = { ...facts, body: "Review context. ".repeat(2000), diff: fullDiff };
  const { args, stdin, diff } = await fakeClaude({ facts: inputFacts, delta });
  const supplied = JSON.parse(stdin.split("\n").at(-1) ?? "");
  expect({
    stdinPrompt:
      stdin.startsWith("Perform shadow review round 2.") &&
      stdin.includes("Review only the supplied delta plus standing entries."),
    argvPrompt: args.some((arg) => arg.includes("Perform shadow review round")),
    facts: supplied.facts,
    round: supplied.round,
    diff,
    inlineDiff: stdin.includes("full PR evidence") || stdin.includes("delta tail"),
  }).toMatchObject({
    stdinPrompt: true,
    argvPrompt: false,
    facts: {
      ...facts,
      body: "Review context. ".repeat(2000),
      diff: "Available through read_diff",
    },
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
  });
});
it("Claude rejects an unexpected reported tool", async () => {
  await expect(fakeClaude({ tools: ["Bash"] })).rejects.toThrow("unexpected tool");
});
it("Claude rejects a mismatched CLI version", async () => {
  await expect(fakeClaude({ version: "0.0.2 test" })).rejects.toThrow("pin mismatch");
});
it("Claude rejects an unsuccessful result subtype", async () => {
  await expect(fakeClaude({ envelope: { subtype: "error_during_execution" } })).rejects.toThrow(
    "success",
  );
});
it("Claude rejects an error-marked result", async () => {
  await expect(fakeClaude({ envelope: { is_error: true } })).rejects.toThrow("is_error");
});
it("Claude rejects an empty result body", async () => {
  await expect(fakeClaude({ envelope: { result: "" } })).rejects.toThrow("result");
});
it("A partial final hunk cannot claim complete facts", async () => {
  await expect(
    github({
      diff: "diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new",
    }).adapter.facts(request, context()),
  ).rejects.toThrow("Diff hunks are incomplete");
});
it("Failed subprocess diagnostics redact MCP credentials", async () => {
  const canary = "test-only-mcp-token-canary";
  try {
    await execute(process.execPath, [
      "-e",
      "process.stderr.write(process.argv[2]);process.exit(1)",
      "--",
      "--mcp-config",
      JSON.stringify({ mcpServers: { evidence: { env: { GH_TOKEN: canary } } } }),
    ]);
    return expect(false).toBe(true);
  } catch (error) {
    const saved = JSON.stringify({
      message: String(error),
      stack: error instanceof Error ? error.stack : "",
    });
    return expect(
      String(error).includes("Process failed:") &&
        !saved.includes(canary) &&
        !saved.includes("GH_TOKEN") &&
        !saved.includes("--mcp-config"),
    ).toBe(true);
  }
});
const modeOnlyDiff = "diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n";
for (const [name, id, diff] of [
  [
    "GitHub accepts a zero-change rename without a patch",
    "zero-rename",
    "diff --git a/old.ts b/a.ts\nsimilarity index 100%\nrename from old.ts\nrename to a.ts\n",
  ],
  [
    "GitHub accepts an empty added file without a patch",
    "empty-added",
    "diff --git a/a.ts b/a.ts\nnew file mode 100644\nindex 0000000..e69de29\n",
  ],
  [
    "GitHub accepts a mode-only change without a patch",
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
  ["GitHub refuses binary changes with zero line counts", "Binary files a/a.ts and b/a.ts differ"],
  ["GitHub refuses an encoded binary patch", "GIT binary patch\nliteral 1\nIc${Nk000310RR91"],
] as const) {
  it(name, async () => {
    await expect(
      github({
        patch: null,
        additions: 0,
        deletions: 0,
        diff: `${modeOnlyDiff}${marker}\n`,
      }).adapter.facts(request, context()),
    ).rejects.toThrow("Diff hunks are incomplete");
  });
}
it("Large evidence files can be read in bounded numbered ranges", async () => {
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
      arguments: { path: "large.ts", start_line: 601, max_lines: 2 },
    });
    return expect(
      JSON.stringify(result).includes("601: line-601") &&
        JSON.stringify(result).includes("602: line-602") &&
        !JSON.stringify(result).includes("603: line-603"),
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
it("Evidence search locates literal text without executing it", async () => {
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
      arguments: { path: "test.ts", text: "check-yaml" },
    });
    return expect(JSON.stringify(result).includes("2: check-yaml")).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
it("A moved base cannot pass the final GitHub freshness check", async () => {
  await expect(github({ base: "f".repeat(40) }).adapter.head(request, context())).rejects.toThrow();
});
it("A dirty card bundle cannot pass as the pinned instructions", async () => {
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
    await writeFile(join(root, "agents/margot.md"), "changed instructions");
    return await expect(resolveBundle(root, sha, context())).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("starts a before-head shadow fresh despite same-head publication", async () => {
  const facts = await github({ ledger: true, shadowBeforeHead: true }).adapter.facts(
    request,
    context(),
  );
  expect({ priorLedger: facts.history.priorLedger }).toMatchObject({ priorLedger: false });
});
it("A shadow history selection cannot be granted GitHub write authority", async () => {
  const config = JSON.parse(
    await readFile(new URL("../samples/config.sample.json", import.meta.url), "utf8"),
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
it("Even the Claude version probe cannot inherit the publication credential", async () => {
  const previous = process.env.MARGOT_WRITE_TOKEN;
  process.env.MARGOT_WRITE_TOKEN = "test-only-publication-credential";
  try {
    await expect(fakeClaude()).resolves.toBeDefined();
  } finally {
    if (previous === undefined) delete process.env.MARGOT_WRITE_TOKEN;
    else process.env.MARGOT_WRITE_TOKEN = previous;
  }
});
describe("bound evidence", () => {
  const source = JSON.parse(
    readFileSync(new URL("../recordings/council-clear.json", import.meta.url), "utf8"),
  ) as Recording;
  const oldHead = "b".repeat(40);
  it("Large CLI evidence arrives complete through stdin", async () => {
    const { execute } = await import("../src/adapters/process.js");
    const input = "evidence".repeat(100000);
    const out = await execute(
      process.execPath,
      ["-e", "process.stdin.on('data',d=>process.stdout.write(d))"],
      { input: input },
    );
    expect({ complete: out === input }).toMatchObject({ complete: true });
  });
  it("Paged model diff tool returns complete bound diff", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
    const directory = await mkdtemp(`${tmpdir()}/margot-diff-`);
    const path = `${directory}/diff`;
    const input = "abcdef".repeat(6000);
    await writeFile(path, input);
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
        const content = response.content as {
          text: string;
        }[];
        const chunk = JSON.parse(content[0]!.text);
        out += chunk.text;
        offset = chunk.end;
        if (offset === chunk.total) break;
      } while (offset < input.length);
      return expect(out === input).toBe(true);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("Reference reads stay bound to configured repository and SHA", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createEvidenceServer } = await import("../src/adapters/evidence-server.js");
    let observed: unknown;
    const server = createEvidenceServer(
      {
        request: source.request,
        references: { hooks: { repository: "reference/hooks", head: oldHead } },
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
      return expect(await observed).toMatchObject({
        repository: "reference/hooks",
        head: oldHead,
        path: "hook.ts",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("Unconfigured reference is refused without a GitHub read", async () => {
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
        arguments: { reference: "unconfigured", path: "hook.ts" },
      });
      return expect({ error: result.isError === true, calls }).toMatchObject({
        error: true,
        calls: 0,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
describe("GitHub triage and diff size", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const request = requestSchema.parse(seed.request);
  const context = () => ({ signal: AbortSignal.timeout(3000) });
  it("uses the newest triage check from the trusted App", async () => {
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
                check(2, 4862659, "documentation"),
                check(3, 123, "mechanical"),
              ]
            : [],
    } as unknown as Octokit;
    const result = await githubAdapter(client).facts(request, context());
    expect({ triage: result.triage }).toMatchObject({
      triage: { actor: "triage-app", head: request.head, classification: "documentation" },
    });
  });
  it("counts diff headers and context toward the review size limit", () => {
    expect({
      lines: changedLineCount(
        "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n context\n+a\n-b\nlast",
      ),
    }).toMatchObject({ lines: 7 });
  });
});
