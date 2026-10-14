import { expect, it, vi } from "vitest";
import { liveServices } from "../../src/adapters/live.js";
import { cliServices } from "../../src/cli-services.js";

vi.mock("../../src/adapters/live.js", () => ({ liveServices: vi.fn() }));
it("keeps missing ownership distinct from an explicit none assessment", () => {
  const config = { claude: {} } as Parameters<typeof cliServices>[0];
  cliServices(config, { JEV_KEY: "test-key" });
  expect(vi.mocked(liveServices).mock.lastCall?.[1].ownedPathTier).toBe("unknown");
  cliServices(config, { JEV_KEY: "test-key", MARGOT_OWNED_TIER: "none" });
  expect(vi.mocked(liveServices).mock.lastCall?.[1].ownedPathTier).toBe("none");
});
