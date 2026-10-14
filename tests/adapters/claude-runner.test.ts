import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configuredTicketingEnvironment } from "../../src/cli-services.js";
import { liveConfigSchema } from "../../src/schemas.js";
import { facts, fakeClaude, image, ticketing } from "../helpers/adapters.js";

const value = (args: string[], flag: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
/** The arguments a variadic flag takes, up to the next flag. */
const values = (args: string[], flag: string) => {
  if (!args.includes(flag)) return [];
  const rest = args.slice(args.indexOf(flag) + 1);
  const end = rest.findIndex((arg) => arg.startsWith("--"));
  return end === -1 ? rest : rest.slice(0, end);
};
it("runs every Claude invocation in a confined, read-only container of the configured image", async () => {
  const card = await fakeClaude();
  const voice = await fakeClaude({ role: "voice" });
  for (const { docker, bundle, work } of [card, voice])
    expect({
      command: docker.slice(0, 2),
      flags: ["--rm", "-i", "--read-only", "--init"].filter((flag) => docker.includes(flag)),
      user: value(docker, "--user"),
      capDrop: value(docker, "--cap-drop"),
      securityOpt: value(docker, "--security-opt"),
      mounts: docker.flatMap((arg, i) => (docker[i - 1] === "--mount" ? [arg] : [])),
      tmpfs: docker.flatMap((arg, i) => (docker[i - 1] === "--tmpfs" ? [arg] : [])),
      env: docker.flatMap((arg, i) => (docker[i - 1] === "-e" ? [arg] : [])),
    }).toEqual({
      command: ["run", "--rm"],
      flags: ["--rm", "-i", "--read-only"],
      user: "1000:1000",
      capDrop: "ALL",
      securityOpt: "no-new-privileges",
      mounts: [
        `type=bind,source=${work},target=/work,readonly`,
        `type=bind,source=${bundle},target=/opt/margot/bundle,readonly`,
      ],
      tmpfs: ["/run/margot:rw,mode=1777,size=1g", "/tmp:rw,mode=1777,size=256m"],
      env: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GH_TOKEN", "MARGOT_MCP_CONFIG"],
    });
  expect(
    [card, voice].map(({ docker, program, args }) => [docker.at(-1), program, args[0]]),
  ).toEqual([
    [image, "claude", "-p"],
    [image, "claude", "-p"],
  ]);
});
it("loads the card reviewer natively from the mounted bundle with the previous reviewer's grants", async () => {
  const { args } = await fakeClaude();
  expect({
    agent: value(args, "--agent"),
    model: value(args, "--model"),
    pluginDir: value(args, "--plugin-dir"),
    settings: JSON.parse(value(args, "--settings") ?? "{}"),
    tools: value(args, "--tools"),
    addDir: value(args, "--add-dir"),
    mcpConfig: value(args, "--mcp-config"),
    allowed: values(args, "--allowedTools"),
    disallowed: values(args, "--disallowedTools").sort(),
    agentFlags: args.filter((arg) => arg.startsWith("--agent")),
    restricted:
      args.includes("--strict-mcp-config") &&
      args.includes("--restricted") &&
      value(args, "--setting-sources") === "" &&
      value(args, "--permission-mode") === "dontAsk",
  }).toEqual({
    agent: "publish:pr-reviewer",
    model: "example-model",
    pluginDir: "/opt/margot/bundle",
    settings: {
      enabledPlugins: { "publish@inline": true },
      disableAllHooks: true,
      autoMemoryEnabled: false,
      claudeMdExcludes: ["**"],
    },
    tools: "Skill,Bash,Read,Grep,Glob",
    addDir: "/opt/margot/bundle/skills/pr-council",
    mcpConfig: "/run/margot/mcp.json",
    // `//` makes a permission path absolute; a single slash would anchor it at /work.
    // Grep and Glob have no allow entry: dontAsk permits them only in the working directory
    // (/work) and the added pr-council directory, and Read denies apply to them.
    allowed: [
      "Bash(gh pr view:*)",
      "Bash(gh pr diff:*)",
      "Bash(gh pr checks:*)",
      "Bash(gh api:*)",
      "Bash(gh run view:*)",
      "Read(//work/**)",
      "Read(//opt/margot/bundle/skills/pr-council/**)",
    ],
    disallowed: [
      "Agent",
      "Bash(gh alias:*)",
      "Bash(gh auth:*)",
      "Bash(gh config:*)",
      "Bash(gh extension:*)",
      "Edit",
      "Read(//proc/**)",
      "Read(//run/margot/mcp.json)",
      "Skill(publish:github-readme)",
      "Skill(publish:smoke)",
      "Write",
    ],
    agentFlags: ["--agent"],
    restricted: true,
  });
});
it("loads the voice natively with only read-only gh", async () => {
  const { args } = await fakeClaude({ role: "voice" });
  expect({
    agent: value(args, "--agent"),
    model: value(args, "--model") ?? null,
    pluginDir: value(args, "--plugin-dir"),
    enabled: JSON.parse(value(args, "--settings") ?? "{}").enabledPlugins,
    tools: value(args, "--tools"),
    addDir: args.includes("--add-dir"),
    mcpConfig: args.includes("--mcp-config"),
    strictMcp: args.includes("--strict-mcp-config"),
    allowed: values(args, "--allowedTools"),
    disallowed: values(args, "--disallowedTools"),
    agentFlags: args.filter((arg) => arg.startsWith("--agent")),
  }).toEqual({
    agent: "publish:margot",
    model: null,
    pluginDir: "/opt/margot/bundle",
    enabled: { "publish@inline": true },
    tools: "Bash",
    addDir: false,
    mcpConfig: false,
    strictMcp: true,
    allowed: ["Bash(gh api:*)", "Bash(gh pr diff:*)"],
    disallowed: [
      "Bash(gh alias:*)",
      "Bash(gh extension:*)",
      "Bash(gh auth:*)",
      "Bash(gh config:*)",
    ],
    agentFlags: ["--agent"],
  });
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
  expect({
    cardTicketingServers: Object.keys(card.mcp.mcpServers).sort(),
    cardServer: card.mcp.mcpServers.tickets,
    cardTicketingTools: values(card.args, "--allowedTools").filter((tool) =>
      tool.startsWith("mcp__tickets__"),
    ),
    voiceTicketingServers: Object.keys(voice.mcp.mcpServers).sort(),
    voiceTicketingTools: voice.args.filter((tool) => tool.startsWith("mcp__tickets__")),
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
        reviewerTools: ["Skill", "Read", "Grep", "Glob", "Bash", "mcp__tickets__get_issue"],
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
it("keeps every credential off the docker command line and hands it over by environment", async () => {
  const secrets = {
    TICKETING_TOKEN: "test-only-argv-ticket-token",
    TICKETING_TENANT: "test-only-argv-tenant",
  };
  const githubToken = "test-only-argv-github-token";
  const previous = process.env.MARGOT_WRITE_TOKEN;
  process.env.MARGOT_WRITE_TOKEN = "test-only-publication-credential";
  try {
    const invocation = await fakeClaude({ ticketing, ticketingEnvironment: secrets, githubToken });
    expect({
      argvLeaks: [githubToken, ...Object.values(secrets)].filter((secret) =>
        [...invocation.docker, ...invocation.args].some((arg) => arg.includes(secret)),
      ),
      githubToken: invocation.env.GH_TOKEN,
      modelCredentials: [invocation.env.ANTHROPIC_API_KEY, invocation.env.CLAUDE_CODE_OAUTH_TOKEN],
      mcpHolds: Object.values(secrets).every((secret) =>
        invocation.env.MARGOT_MCP_CONFIG?.includes(secret),
      ),
      publication: invocation.env.MARGOT_WRITE_TOKEN ?? null,
    }).toEqual({
      argvLeaks: [],
      githubToken,
      modelCredentials: ["test-only-model-key", "test-only-model-token"],
      mcpHolds: true,
      publication: null,
    });
  } finally {
    if (previous === undefined) delete process.env.MARGOT_WRITE_TOKEN;
    else process.env.MARGOT_WRITE_TOKEN = previous;
  }
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
    dockerEnvironment: [invocation.env.JEV_KEY, invocation.env.UNRELATED_SECRET],
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
    dockerEnvironment: [undefined, undefined],
  });
});
it("keeps ticket evidence detached without configuration or complete credentials", async () => {
  for (const options of [
    {
      ticketingEnvironment: {
        TICKETING_TOKEN: "test-only-ticket-token",
        TICKETING_TENANT: "test-only-tenant",
      },
    },
    { ticketing, ticketingEnvironment: { TICKETING_TOKEN: "test-only-ticket-token" } },
  ]) {
    const invocation = await fakeClaude(options);
    expect(invocation.mcp.mcpServers.tickets).toBeUndefined();
    expect(invocation.args.filter((arg) => arg.startsWith("mcp__tickets__"))).toEqual([]);
  }
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
it("sends complete scoped evidence on stdin and reports provider metadata", async () => {
  const responses: unknown[] = [];
  const inputFacts = { ...facts, body: "Review context. ".repeat(2000) };
  const { args, docker, stdin, base } = await fakeClaude({
    facts: inputFacts,
    delta: "+delta\n",
    envelope: { duration_ms: 1234, num_turns: 7, modelUsage: { "claude-haiku-4-5": {} } },
    onResponse: (response) => responses.push(response),
  });
  const supplied = JSON.parse(stdin.split("\n").at(-1) ?? "{}");
  expect(stdin).toContain(inputFacts.body);
  expect([...docker, ...args].some((argument) => argument.includes("Review context."))).toBe(false);
  const { diff: _diff, ...expectedFacts } = facts;
  expect(supplied.facts).toMatchObject({ ...expectedFacts, base, body: inputFacts.body });
  expect(supplied.round).toMatchObject({
    round: 2,
    priorHead: "b".repeat(40),
    full: false,
    files: facts.files,
    entries: [],
  });
  expect(stdin).toContain(facts.head);
  expect(stdin).not.toContain("+delta");
  expect(responses).toMatchObject([
    { role: "safety", durationMs: 1234, numTurns: 7, models: ["claude-haiku-4-5"] },
  ]);
});
it("rejects missing, additional and same-length swapped reported tools", async () => {
  const tools = ["Skill", "Bash", "Read", "Grep", "Glob"];
  await expect(fakeClaude({ tools: tools.filter((tool) => tool !== "Bash") })).rejects.toThrow(
    "exactly the requested tools",
  );
  await expect(fakeClaude({ tools: [...tools, "Write"] })).rejects.toThrow(
    "exactly the requested tools",
  );
  await expect(fakeClaude({ replaceFirstTool: "Write" })).rejects.toThrow(
    "exactly the requested tools",
  );
});
it("rejects an MCP server that did not connect", async () => {
  await expect(
    fakeClaude({
      ticketing,
      ticketingEnvironment: { TICKETING_TOKEN: "t", TICKETING_TENANT: "x" },
      mcpServers: [{ name: "tickets", status: "failed" }],
    }),
  ).rejects.toThrow("did not connect: tickets");
});
it("rejects unsuccessful or error-marked provider results", async () => {
  await expect(fakeClaude({ envelope: { subtype: "error_during_execution" } })).rejects.toThrow();
  await expect(fakeClaude({ envelope: { is_error: true } })).rejects.toThrow();
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
  const ownChecks = ["review / margot", "review / triage"];
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
it("accepts a pinned runtime and rejects a mutable image at configuration", () => {
  expect(
    liveConfigSchema.shape.claude.shape.container.safeParse({ image, work: "/base" }).success,
  ).toBe(true);
  expect(
    liveConfigSchema.shape.claude.shape.container.safeParse({
      image: "registry.example/margot-runtime:latest",
      work: "/base",
    }).success,
  ).toBe(false);
});
it("cancels the subprocess and kills only its uniquely named container", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margot-docker-log-"));
  const dockerLog = join(dir, "docker");
  try {
    await fakeClaude({ dockerLog });
    await expect(fakeClaude({ dockerLog, hang: true, timeoutMs: 500 })).rejects.toThrow();
    const calls = (await readFile(dockerLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const names = calls.filter((call) => call[0] === "run").map((call) => value(call, "--name"));
    expect(names).toHaveLength(2);
    expect(names.every((name) => typeof name === "string" && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(calls.filter((call) => call[0] === "kill")).toEqual([["kill", names[1]]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("refuses a base checkout at another commit, of another repository, or dirty", async () => {
  await expect(fakeClaude({ checkout: { base: "c".repeat(40) } })).rejects.toThrow(
    /^Base checkout mismatch: HEAD [0-9a-f]{40} is not /,
  );
  await expect(
    fakeClaude({ checkout: { remote: "https://github.com/someone/else.git" } }),
  ).rejects.toThrow("Base checkout mismatch: origin https://github.com/someone/else.git is not");
  await expect(fakeClaude({ checkout: { dirty: true } })).rejects.toThrow(
    "Base checkout mismatch: uncommitted changes",
  );
  await expect(
    fakeClaude({ checkout: { remote: `git@github.com:${facts.repository}.git` } }),
  ).resolves.toBeDefined();
});
it("binds delta evidence to the two reviewed heads and its file scope", async () => {
  const { stdin } = await fakeClaude({ delta: "+round delta\n" });
  const supplied = JSON.parse(stdin.split("\n").at(-1) ?? "{}");
  expect(supplied.round).toMatchObject({
    priorHead: "b".repeat(40),
    full: false,
    files: facts.files,
  });
  expect(supplied.round.diff).toContain(
    `repos/${facts.repository}/compare/${"b".repeat(40)}...${facts.head}`,
  );
  expect(supplied.round.diff).toContain("round.files");
  expect(stdin).not.toContain("+round delta");
});
