import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readRecording } from "./helpers/recordings.js";

// The scripted review reports one card response, then ends in an error result or throws.
const ending = vi.hoisted(() => ({ throws: false }));
vi.mock("../src/cli-services.js", () => ({
  cliServices: (_config: unknown, _environment: unknown, onResponse?: (r: unknown) => void) => ({
    actions: [],
    run: async () => {
      onResponse?.({
        role: "safety",
        raw: "safety raw",
        cost: 0.1,
        models: ["example-model"],
        tools: [],
        evidence: [],
        durationMs: 10,
        numTurns: 2,
      });
      if (ending.throws) throw new Error("model transport failed");
      return {
        kind: "error",
        stage: "card:safety",
        diagnostic: "Card safety did not complete: model timeout",
        mergeEligible: false,
      };
    },
  }),
}));

const { runCli } = await import("../src/cli-run.js");
const recording = readRecording("mechanical-bump");
const sampleConfig = JSON.parse(
  await readFile(new URL("../samples/config.sample.json", import.meta.url), "utf8"),
);

it("prints the failed stage and diagnostic when the review ends in an error", async () => {
  const root = await mkdtemp(join(tmpdir(), "margot-cli-error-"));
  const request = join(root, "request.json");
  const config = join(root, "config.json");
  await writeFile(request, JSON.stringify(recording.request));
  await writeFile(config, JSON.stringify(sampleConfig));
  const stderr: string[] = [];
  const code = await runCli(
    [request, config, join(root, "output.json")],
    { JEV_KEY: "test-only" },
    {
      stdout: () => {},
      stderr: (text) => stderr.push(text),
    },
  );
  expect({ code, stderr: stderr.join("") }).toEqual({
    code: 1,
    stderr:
      "Review ended in an error at card:safety: Card safety did not complete: model timeout\n",
  });
});
it.each([
  ["an error result", false, 1],
  ["a thrown review", true, 1],
])("writes diagnostics.json beside the output after %s", async (_name, throws, code) => {
  ending.throws = throws;
  try {
    const root = await mkdtemp(join(tmpdir(), "margot-cli-error-"));
    const request = join(root, "request.json");
    const config = join(root, "config.json");
    await writeFile(request, JSON.stringify(recording.request));
    await writeFile(config, JSON.stringify(sampleConfig));
    const exit = await runCli(
      [request, config, join(root, "output.json")],
      { JEV_KEY: "test-only" },
      { stdout: () => {}, stderr: () => {} },
    );
    expect({
      exit,
      written: JSON.parse(await readFile(join(root, "diagnostics.json"), "utf8")),
    }).toEqual({
      exit: code,
      written: {
        cards: [
          {
            card: "safety",
            raw: "safety raw",
            durationMs: 10,
            numTurns: 2,
            models: ["example-model"],
            costUsd: 0.1,
          },
        ],
        voice: null,
        jevRetries: [],
      },
    });
  } finally {
    ending.throws = false;
  }
});
