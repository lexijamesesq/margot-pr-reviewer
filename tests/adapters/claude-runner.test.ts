import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configuredTicketingEnvironment } from "../../src/cli-services.js";
import { facts, fakeClaude, ticketing } from "../helpers/adapters.js";

const evidenceTools = (...names: string[]) => names.map((name) => `mcp__evidence__${name}`);
const value = (args: string[], flag: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
it("loads the card reviewer natively from the pinned plugin", async () => {
  const { args, root } = await fakeClaude();
  expect({
    agent: value(args, "--agent"),
    model: value(args, "--model"),
    pluginDir: value(args, "--plugin-dir"),
    settings: JSON.parse(value(args, "--settings") ?? "{}"),
    tools: value(args, "--tools"),
    addDir: value(args, "--add-dir"),
    allowed: value(args, "--allowedTools"),
    agentFlags: args.filter((arg) => arg.startsWith("--agent")),
    slashCommands: args.includes("--disable-slash-commands"),
    restricted:
      args.includes("--strict-mcp-config") &&
      args.includes("--restricted") &&
      value(args, "--setting-sources") === "" &&
      value(args, "--permission-mode") === "dontAsk",
  }).toEqual({
    agent: "publish:pr-reviewer",
    model: "example-model",
    pluginDir: root,
    settings: {
      enabledPlugins: { "publish@inline": true },
      disableAllHooks: true,
      autoMemoryEnabled: false,
      claudeMdExcludes: ["**"],
    },
    tools: "Skill,Read",
    addDir: `${root}/skills/pr-council`,
    allowed: "mcp__evidence",
    agentFlags: ["--agent"],
    slashCommands: false,
    restricted: true,
  });
});
it("loads the voice natively with no built-in tools or card directory", async () => {
  const { args, root } = await fakeClaude({ role: "voice" });
  expect({
    agent: value(args, "--agent"),
    model: value(args, "--model") ?? null,
    pluginDir: value(args, "--plugin-dir"),
    enabled: JSON.parse(value(args, "--settings") ?? "{}").enabledPlugins,
    tools: value(args, "--tools"),
    addDir: args.includes("--add-dir"),
    allowed: value(args, "--allowedTools"),
    agentFlags: args.filter((arg) => arg.startsWith("--agent")),
    slashCommands: args.includes("--disable-slash-commands"),
  }).toEqual({
    agent: "publish:margot",
    model: null,
    pluginDir: root,
    enabled: { "publish@inline": true },
    tools: "",
    addDir: false,
    allowed: "mcp__evidence",
    agentFlags: ["--agent"],
    slashCommands: false,
  });
});
it("denies the card every sibling skill in the plugin but pr-council", async () => {
  const card = await fakeClaude();
  const voice = await fakeClaude({ role: "voice" });
  const denied = card.args.slice(
    card.args.indexOf("--disallowedTools") + 1,
    card.args.indexOf("--allowedTools"),
  );
  expect({
    denied: denied.sort(),
    allowed: card.args
      .slice(card.args.indexOf("--allowedTools") + 1)
      .filter((arg) => arg.startsWith("Skill")),
    voiceDenies: voice.args.includes("--disallowedTools"),
  }).toEqual({
    denied: ["Skill(publish:github-readme)", "Skill(publish:smoke)"],
    allowed: [],
    voiceDenies: false,
  });
});
it("runs Claude in an empty working directory away from the diff and MCP configuration", async () => {
  const { cwd, cwdEntries, mcpPath, diffPath } = await fakeClaude();
  expect({
    cwdEntries,
    mcpInCwd: mcpPath.startsWith(cwd),
    diffInCwd: diffPath.startsWith(cwd),
  }).toEqual({ cwdEntries: [], mcpInCwd: false, diffInCwd: false });
});
it("names the card in the prompt, leaves the finding conventions to the bundle and tools to the agent", async () => {
  const { stdin } = await fakeClaude();
  const instructions = stdin.split("\n").slice(0, -1).join("\n");
  expect({
    card: stdin.includes("Your card is safety."),
    // The bundle's pr-council skill states `ledger=` and `late=`; a new finding needs no mark.
    conventions: ["late=", "reopens=", "attribution", "ledger="].filter((rule) =>
      instructions.includes(rule),
    ),
    previouslyDismissed: instructions.includes(
      "keep it dismissed unless the new changes altered it",
    ),
    advisory: instructions.includes("must not establish an advisory finding"),
    path: stdin.includes("playbooks"),
    toolProse: /\bread_|\btools?\b|\bruntime\b/i.test(instructions),
  }).toEqual({
    card: true,
    conventions: [],
    previouslyDismissed: true,
    advisory: true,
    path: false,
    toolProse: false,
  });
});
it("accepts exactly Skill, Read and the served evidence tools for a card", async () => {
  const card = [
    "Skill",
    "Read",
    ...evidenceTools("read_diff", "read_file", "search_file", "list_files"),
  ];
  await expect(fakeClaude({ tools: card })).resolves.toBeDefined();
  await expect(
    fakeClaude({
      tools: [...card, "mcp__evidence__read_reference"],
      references: { pinned: { repository: "example/reference", head: "c".repeat(40) } },
    }),
  ).resolves.toBeDefined();
  await expect(fakeClaude({ tools: card.filter((tool) => tool !== "Skill") })).rejects.toThrow(
    "exactly the requested tools",
  );
  await expect(fakeClaude({ tools: [...card, "mcp__evidence__read_reference"] })).rejects.toThrow(
    "exactly the requested tools",
  );
});
it("accepts exactly the voice's listed evidence tools", async () => {
  const voice = evidenceTools("read_file", "read_diff");
  await expect(fakeClaude({ role: "voice", tools: voice })).resolves.toBeDefined();
  await expect(fakeClaude({ role: "voice", tools: [...voice, "Read"] })).rejects.toThrow(
    "exactly the requested tools",
  );
  await expect(
    fakeClaude({ role: "voice", tools: [...voice, "mcp__evidence__list_files"] }),
  ).rejects.toThrow("exactly the requested tools");
});
it("grants configured ticket evidence only to card runs", async () => {
  const configured = {
    ticketing,
    ticketingEnvironment: {
      TICKETING_TOKEN: "test-only-ticket-token",
      TICKETING_TENANT: "test-only-tenant",
    },
  };
  const card = await fakeClaude(configured);
  const voice = await fakeClaude({ ...configured, role: "voice" });
  const allowed = (args: string[]) => args.slice(args.indexOf("--allowedTools") + 1, -2);
  const cardServer = card.mcp.mcpServers.tickets;
  expect({
    cardTicketingServers: Object.keys(card.mcp.mcpServers)
      .filter((server) => server !== "evidence")
      .sort(),
    cardServer,
    cardTicketingTools: allowed(card.args).filter((tool) => tool.startsWith("mcp__tickets__")),
    voiceTicketingServers: Object.keys(voice.mcp.mcpServers)
      .filter((server) => server !== "evidence")
      .sort(),
    voiceServer: voice.mcp.mcpServers.tickets ?? null,
    voiceTicketingTools: allowed(voice.args).filter((tool) => tool.startsWith("mcp__tickets__")),
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
it("refuses ticketing tools the pinned reviewer does not grant, before spawning Claude", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margot-spawn-log-"));
  const spawnLog = join(dir, "spawns");
  try {
    const configured = {
      ticketing,
      ticketingEnvironment: { TICKETING_TOKEN: "t", TICKETING_TENANT: "x" },
      spawnLog,
    };
    await expect(
      fakeClaude({
        ...configured,
        reviewerTools: ["Skill", "Read", "mcp__evidence__read_diff", "mcp__tickets__get_issue"],
      }),
    ).rejects.toThrow(
      "The card bundle's agents/pr-reviewer.md does not grant the configured ticketing tools: mcp__tickets__get_comments",
    );
    await expect(access(spawnLog)).rejects.toThrow();
    await expect(fakeClaude(configured)).resolves.toBeDefined();
    await expect(access(spawnLog)).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("keeps every credential off the Claude command line and in a private file", async () => {
  const secrets = {
    TICKETING_TOKEN: "test-only-argv-ticket-token",
    TICKETING_TENANT: "test-only-argv-tenant",
  };
  const githubToken = "test-only-argv-github-token";
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: secrets,
    githubToken,
  });
  const file = JSON.stringify(invocation.mcp);
  expect({
    argvLeaks: [githubToken, ...Object.values(secrets)].filter((secret) =>
      invocation.args.some((arg) => arg.includes(secret)),
    ),
    fileHolds: [githubToken, ...Object.values(secrets)].every((secret) => file.includes(secret)),
    mode: invocation.mcpMode,
    pathPassed: invocation.args[invocation.args.indexOf("--mcp-config") + 1] === invocation.mcpPath,
  }).toEqual({ argvLeaks: [], fileHolds: true, mode: 0o600, pathPassed: true });
  await expect(access(invocation.mcpPath)).rejects.toThrow();
});
it("forwards exactly the configured environment variables from the CLI", async () => {
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
    forwardedKeys: [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "TICKETING_TENANT",
      "TICKETING_TOKEN",
    ],
    forwardedValues: {
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      TICKETING_TOKEN: "test-only-cli-token",
      TICKETING_TENANT: "test-only-cli-tenant",
    },
  });
});
it("keeps ticket evidence detached without configuration", async () => {
  const invocation = await fakeClaude({
    ticketingEnvironment: {
      TICKETING_TOKEN: "test-only-ticket-token",
      TICKETING_TENANT: "test-only-tenant",
    },
  });
  expect({
    server: invocation.mcp.mcpServers.tickets ?? null,
    tools: invocation.args.filter((arg) => arg.startsWith("mcp__tickets__")),
  }).toMatchObject({ server: null, tools: [] });
});
it("keeps ticket evidence detached when a named environment variable is unset", async () => {
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: {
      TICKETING_TOKEN: "test-only-ticket-token",
    },
  });
  expect({
    server: invocation.mcp.mcpServers.tickets ?? null,
    tools: invocation.args.filter((arg) => arg.startsWith("mcp__tickets__")),
  }).toMatchObject({ server: null, tools: [] });
});
it("keeps ticket credentials out of the model prompt and parsed result", async () => {
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
it("sends Claude its complete prompt on stdin and only the round delta through read_diff", async () => {
  const fullDiff = `diff --git a/a.ts b/a.ts\n@@ -1 +1,20000 @@\n-old\n${"+full PR evidence\n".repeat(20000)}`;
  const delta = `diff --git a/a.ts b/a.ts\n@@ -1 +1,2000 @@\n-old\n${"+round delta\n".repeat(1999)}+delta tail\n`;
  const inputFacts = { ...facts, body: "Review context. ".repeat(2000), diff: fullDiff };
  const { args, stdin, diff } = await fakeClaude({ facts: inputFacts, delta });
  const supplied = JSON.parse(stdin.split("\n").at(-1) ?? "");
  expect({
    stdinPrompt:
      stdin.startsWith("Perform review round 2.") &&
      stdin.includes("Review only the supplied delta plus standing entries."),
    argvPrompt: args.some((arg) => arg.includes("Perform review round")),
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
it("rejects an unexpected reported tool", async () => {
  await expect(fakeClaude({ tools: ["Bash"] })).rejects.toThrow("exactly the requested tools");
});
it("rejects a requested tool Claude did not report", async () => {
  await expect(fakeClaude({ tools: ["mcp__evidence__read_file"] })).rejects.toThrow(
    "exactly the requested tools",
  );
});
it("rejects a reported tool list of the right length with one tool swapped", async () => {
  await expect(fakeClaude({ replaceFirstTool: "Bash" })).rejects.toThrow(
    "exactly the requested tools",
  );
});
it("rejects an MCP server that did not connect", async () => {
  await expect(
    fakeClaude({ mcpServers: [{ name: "evidence", status: "failed" }] }),
  ).rejects.toThrow("did not connect: evidence");
});
it("blanks the model credentials in every MCP server's environment", async () => {
  const invocation = await fakeClaude({
    ticketing,
    ticketingEnvironment: { TICKETING_TOKEN: "t", TICKETING_TENANT: "x" },
  });
  expect(
    Object.fromEntries(
      Object.entries(invocation.mcp.mcpServers).map(([name, server]) => [
        name,
        [server.env?.ANTHROPIC_API_KEY, server.env?.CLAUDE_CODE_OAUTH_TOKEN],
      ]),
    ),
  ).toEqual({ evidence: ["", ""], tickets: ["", ""] });
});
it("rejects a mismatched CLI version", async () => {
  await expect(fakeClaude({ version: "0.0.2 test" })).rejects.toThrow("pin mismatch");
});
it("rejects an unsuccessful result subtype", async () => {
  await expect(fakeClaude({ envelope: { subtype: "error_during_execution" } })).rejects.toThrow(
    "success",
  );
});
it("rejects an error-marked result", async () => {
  await expect(fakeClaude({ envelope: { is_error: true } })).rejects.toThrow("is_error");
});
it("rejects an empty result body", async () => {
  await expect(fakeClaude({ envelope: { result: "" } })).rejects.toThrow("result");
});
it("keeps the publication credential out of the Claude version probe", async () => {
  const previous = process.env.MARGOT_WRITE_TOKEN;
  process.env.MARGOT_WRITE_TOKEN = "test-only-publication-credential";
  try {
    await expect(fakeClaude()).resolves.toBeDefined();
  } finally {
    if (previous === undefined) delete process.env.MARGOT_WRITE_TOKEN;
    else process.env.MARGOT_WRITE_TOKEN = previous;
  }
});
it("keeps Margot's own checks out of the evidence a card and the voice receive", async () => {
  const withChecks = {
    ...facts,
    checks: ["ci", "review / margot", "review / triage"].map((name, id) => ({
      name,
      actor: "example-app",
      head: facts.head,
      conclusion: "neutral" as const,
      id,
    })),
  };
  const names = (stdin: string) =>
    (
      JSON.parse(stdin.split("\n").at(-1) ?? "{}") as { facts: { checks: { name: string }[] } }
    ).facts.checks.map((check) => `${check.name}`);
  const ownChecks = ["review / margot", "review / triage", "review / self-instrument"];
  const card = await fakeClaude({ facts: withChecks, ownChecks });
  const voice = await fakeClaude({ facts: withChecks, ownChecks, role: "voice" });
  // The configured publisher's check names are Margot's own.
  const configured = await fakeClaude({ facts: withChecks, cliEnvironment: { JEV_KEY: "unused" } });
  expect({
    card: names(card.stdin),
    voice: names(voice.stdin),
    configured: names(configured.stdin),
  }).toEqual({ card: ["ci"], voice: ["ci"], configured: ["ci"] });
});
