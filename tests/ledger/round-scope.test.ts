import { expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { roundScope } from "../../src/ledger.js";
import { review } from "../../src/review.js";
import type { Ledger } from "../../src/types.js";
import {
  comparison,
  config,
  diff,
  entry,
  facts,
  history,
  prior,
  source,
} from "../helpers/ledger.js";

it("excludes unrelated main changes from the delta", () => {
  expect({
    files: roundScope(
      { ...facts, files: [{ path: "a.ts" }] },
      prior(),
      comparison(diff("a.ts") + diff("main.ts")),
    ).files,
  }).toMatchObject({ files: [{ path: "a.ts" }] });
});
for (const [name, change] of [
  ["keeps the ledger and reviews the full PR after a rebase", { status: "diverged" }],
  ["reviews the full PR when the comparison is incomplete", { complete: false }],
  ["reviews the full PR when a delta hunk is truncated", { diff: diff().replace("+new\n", "") }],
] as const) {
  it(name, () => {
    expect({ full: roundScope(facts, prior(), { ...comparison(), ...change }).full }).toMatchObject(
      { full: true },
    );
  });
}
it("reviews the full PR when the comparison is unreadable", () => {
  expect({ full: roundScope(facts, prior(), null).full }).toMatchObject({ full: true });
});
it("rejects a comparison for the wrong revision", () => {
  expect(() => roundScope(facts, prior(), { ...comparison(), head: "f".repeat(40) })).toThrow();
});
it("retains every file when the delta exceeds 300 files", () => {
  const files = Array.from({ length: 301 }, (_, i) => ({ path: `f${i}.ts` }));
  const s = roundScope(
    { ...facts, files },
    prior(),
    comparison(
      files
        .slice(0, 301)
        .map((f) => diff(f.path))
        .join(""),
    ),
  );
  expect({ count: s.files.length }).toMatchObject({ count: 301 });
});
it("preserves the ledger with an empty delta when the trees are identical", () => {
  const result = roundScope(facts, prior(), {
    ...comparison(""),
    status: "identical",
  });
  expect({ full: result.full, files: result.files, entries: result.entries }).toMatchObject({
    full: false,
    files: [],
    entries: [entry()],
  });
});
it("summons cards for standing entries only and shows cards standing and dismissed entries", async () => {
  const advisory: Ledger["entries"][number] = {
    ...entry("MINOR"),
    key: "R1-F2",
    card: "house-style",
    status: "advisory",
    advisory_round: 1,
  };
  const dismissed = { ...entry("MAJOR", "dismissed"), key: "R1-F3" };
  const services = recordedServices({
    ...source,
    config: { ...config, publication: "none" },
    facts: history(prior([entry(), advisory, dismissed])),
  });
  await review(source.request, { ...config, publication: "none" }, services);
  const safety = services.calls.find((call) => call.name === "card:safety")?.input as {
    round: { entries: { key: string }[] };
  };
  expect({
    houseStyle: services.calls.some((call) => call.name === "card:house-style"),
    safetyEntries: safety.round.entries.map((e) => e.key),
  }).toEqual({ houseStyle: false, safetyEntries: ["R1-F1", "R1-F3"] });
});
