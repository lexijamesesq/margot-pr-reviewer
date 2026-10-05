import { expect, it, vi } from "vitest";
import { liveServices } from "../../src/adapters/live.js";
import { cliServices } from "../../src/cli-services.js";

vi.mock("../../src/adapters/live.js", () => ({ liveServices: vi.fn() }));
it.each([
  [undefined, "unknown"],
  ["", "unknown"],
  ["  ", "unknown"],
  ["none", "none"],
  [" owned ", "owned"],
])("passes ownership input %j without treating missing computation as none", (value, expected) => {
  cliServices({ claude: {} } as Parameters<typeof cliServices>[0], {
    JEV_KEY: "test-key",
    ...(value === undefined ? {} : { MARGOT_OWNED_TIER: value }),
  });
  expect(vi.mocked(liveServices).mock.lastCall?.[1].ownedPathTier).toBe(expected);
});
