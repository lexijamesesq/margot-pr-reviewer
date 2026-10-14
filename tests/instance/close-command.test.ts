import { expect, it } from "vitest";
import { instanceExitCode, runInstanceCommand } from "../../src/instance-cli.js";
import { captureError, closeCommandArgs, closeCommandClient } from "../helpers/instance.js";

it("maps the close-stranded-check command into the guarded closer", async () => {
  const { client, writes } = closeCommandClient();
  const result = await runInstanceCommand(
    closeCommandArgs({ published: "false", "blocking-checks": "failing: ci / checks" }),
    { GH_TOKEN: "write-token" },
    client,
  );
  expect(result).toMatchObject({ action: "closed" });
  expect(writes[0]).toMatchObject({
    check_run_id: 88,
    conclusion: "action_required",
    output: { title: expect.stringContaining("failing: ci / checks") },
  });
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
  expect((error as Error).message).toMatch(/own-runs.*ending in \//);
  expect(instanceExitCode(error)).toBe(1);
});
