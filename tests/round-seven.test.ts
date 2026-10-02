import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { liveServices } from "../src/adapters/live.js";
import { type Recording, recordedServices } from "../src/adapters/recorded.js";
import { cliServices } from "../src/cli-services.js";
import { ledgerBlock } from "../src/ledger.js";
import { checkText } from "../src/render.js";
import { review } from "../src/review.js";
import { configSchema, factsSchema } from "../src/schemas.js";

vi.mock("../src/adapters/live.js", () => ({ liveServices: vi.fn() }));

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

it.each(["corrupt", "revision"])(
  "warns in the console and check details when a %s ledger precedes valid history",
  async (defect) => {
    const recording = JSON.parse(
      readFileSync("recordings/mechanical-bump.json", "utf8"),
    ) as Recording;
    const facts = factsSchema.parse(recording.facts);
    const config = configSchema.parse({
      ...(recording.config as object),
      trustedLedgerActors: ["margot[bot]"],
    });
    const old = {
      id: 41,
      actor: "margot[bot]",
      actorType: "Bot",
      head: facts.head,
      submittedAt: "2026-10-02T00:00:01Z",
      body: ledgerBlock({ v: 1, round: 2, head: facts.head, entries: [] }),
    };
    const bad = {
      ...old,
      id: 42,
      submittedAt: "2026-10-02T00:00:02Z",
      ...(defect === "corrupt"
        ? { body: "<!-- margot-ledger:v1 bm90LWpzb24= -->" }
        : { head: "b".repeat(40) }),
    };
    recording.facts = {
      ...facts,
      history: { complete: true, priorLedger: true, reviews: [old, bad] },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await review(recording.request, config, recordedServices(recording));
      expect(result.kind).toBe("reviewed");
      if (result.kind !== "reviewed") throw new Error("Expected review");
      expect(result.convergence.round).toBe(2);
      const warning = result.ledgerWarnings?.[0];
      expect(warning).toMatch(/^Skipped ledger from review 42: .+/);
      expect(warning).toMatch(defect === "corrupt" ? /JSON/i : /revision mismatch/);
      expect(warn).toHaveBeenCalledExactlyOnceWith(warning);
      expect(checkText(result)).toContain(`warning: ${warning}`);
    } finally {
      warn.mockRestore();
    }
  },
);
