import { expect, it } from "vitest";
import { instanceExitCode, runInstanceCommand } from "../../src/instance-cli.js";
import { captureError, closeCommandArgs, closeCommandClient } from "../helpers/instance.js";

it("maps the close-stranded-check command into the guarded closer", async () => {
  const { client, writes } = closeCommandClient();
  const result = await runInstanceCommand(
    closeCommandArgs({ published: "false" }),
    { GH_TOKEN: "write-token" },
    client,
  );
  expect(result).toMatchObject({ action: "closed" });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ conclusion: "action_required" });
});
it("maps a closer GitHub failure to exit 2", async () => {
  const { client } = closeCommandClient({ failPulls: true });
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs(), { GH_TOKEN: "write-token" }, client),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("could not read the pull requests");
  expect(instanceExitCode(error)).toBe(2);
});
it("rejects a run URL prefix without its trailing slash", async () => {
  const ownRuns = "https://github.com/example/control/actions/runs";
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs({ "own-runs": ownRuns }), {}),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("--own-runs must be a run URL prefix ending in /");
  expect(instanceExitCode(error)).toBe(1);
});
it("rejects a malformed closer repository before GitHub", async () => {
  const calls: string[] = [];
  const { client } = closeCommandClient({ calls });
  const repository = "example";
  const error = await captureError(() =>
    runInstanceCommand(closeCommandArgs({ repository }), { GH_TOKEN: "write-token" }, client),
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Repository must be owner/name");
  expect(instanceExitCode(error)).toBe(1);
  expect(calls).toHaveLength(0);
});
it("maps --blocking-checks into the floor stop's title", async () => {
  const { client, writes } = closeCommandClient();
  await runInstanceCommand(
    closeCommandArgs({ published: "false", "blocking-checks": "failing: ci / checks" }),
    { GH_TOKEN: "write-token" },
    client,
  );
  expect(writes[0]).toMatchObject({
    output: { title: "Margot: preflight — failing: ci / checks — waiting for the next push" },
  });
});
