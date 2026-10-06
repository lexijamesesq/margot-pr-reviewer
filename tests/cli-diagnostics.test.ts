import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { diagnostics, writeDiagnostics } from "../src/cli-run.js";

const secret = "test-only-diagnostics-token";
const responses = [
  {
    role: "safety",
    raw: "card: safety\nFindings:\n",
    cost: 0.5,
    models: ["claude-opus-5-5"],
    tools: ["Bash"],
    evidence: [{ type: "user", message: `GH_TOKEN=${secret}` }],
    durationMs: 1200,
    numTurns: 9,
  },
  {
    role: "voice",
    raw: "outcome: APPROVED\n",
    cost: 0.25,
    models: ["claude-opus-5-5"],
    tools: ["Bash"],
    evidence: [],
    durationMs: 800,
    numTurns: 2,
  },
];
it("keeps each card's raw block, duration, turns and model and the voice's prose", () => {
  expect(diagnostics(responses)).toEqual({
    cards: [
      {
        card: "safety",
        raw: "card: safety\nFindings:\n",
        durationMs: 1200,
        numTurns: 9,
        models: ["claude-opus-5-5"],
        costUsd: 0.5,
      },
    ],
    voice: {
      prose: "outcome: APPROVED\n",
      durationMs: 800,
      numTurns: 2,
      models: ["claude-opus-5-5"],
      costUsd: 0.25,
    },
  });
});
it("writes diagnostics.json privately next to the result, with no tool output or token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margot-diagnostics-"));
  try {
    await writeDiagnostics(join(dir, "result.json"), responses);
    const text = await readFile(join(dir, "diagnostics.json"), "utf8");
    expect({
      parsed: JSON.parse(text),
      leaks: [secret, "GH_TOKEN", "evidence"].filter((value) => text.includes(value)),
      mode: (await stat(join(dir, "diagnostics.json"))).mode & 0o777,
    }).toEqual({ parsed: diagnostics(responses), leaks: [], mode: 0o600 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
