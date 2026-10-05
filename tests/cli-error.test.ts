import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readRecording } from "./helpers/recordings.js";

vi.mock("../src/cli-services.js", () => ({
  cliServices: () => ({
    actions: [],
    run: async () => ({
      kind: "error",
      stage: "card:safety",
      diagnostic: "Card safety did not complete: model timeout",
      mergeEligible: false,
    }),
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
