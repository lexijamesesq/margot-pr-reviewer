import { expect, it } from "vitest";
import { configuredTicketingEnvironment } from "../../src/cli-services.js";
import { facts, fakeClaude, ticketing } from "../helpers/adapters.js";

it("denies Claude built-in tools and pull request settings", async () => {
  const { args } = await fakeClaude();
  expect(
    args[args.indexOf("--tools") + 1] === "" &&
      args.includes("--strict-mcp-config") &&
      args.includes("--restricted") &&
      args[args.indexOf("--setting-sources") + 1] === "",
  ).toBe(true);
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
    forwardedKeys: ["TICKETING_TENANT", "TICKETING_TOKEN"],
    forwardedValues: {
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
  const agent = JSON.parse(invocation.args[invocation.args.indexOf("--agents") + 1] ?? "{}")[
    "margot-bound"
  ];
  expect({
    server: invocation.mcp.mcpServers.tickets ?? null,
    tools: agent.tools.filter((tool: string) => tool.startsWith("mcp__tickets__")),
  }).toMatchObject({ server: null, tools: [] });
});
it("keeps ticket evidence detached when a named environment variable is unset", async () => {
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
  await expect(fakeClaude({ tools: ["Bash"] })).rejects.toThrow("unexpected tool");
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
