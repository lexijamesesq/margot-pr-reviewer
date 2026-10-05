import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCard } from "../src/adapters/prose.js";
import { type Recording, recordedServices, review } from "../src/index.js";
import { assignFindingIds, mandatory, needsVoice, rate } from "../src/policy.js";
import { configSchema, factsSchema } from "../src/schemas.js";

const recording = JSON.parse(
  readFileSync(new URL("../recordings/mechanical-bump.json", import.meta.url), "utf8"),
) as Recording;
const config = configSchema.parse(recording.config);
function cardText() {
  return "card: safety\ncompletion: completed\nChecked:\n- Inspected changed permission grants; would catch write access.\nNot covered:\n- Runtime execution; outside the change.\nFindings:\n";
}
it("records an incomplete card with its reason and summons the voice", () => {
  const card = parseCard(
    cardText().replace(
      "completion: completed",
      "completion: incomplete: the eval fixture is in another repository",
    ),
    "safety",
  );
  expect({
    completion: card.completion,
    completionReason: card.completionReason ?? null,
    voice: needsVoice([card], rate(null, false, config), 1, config),
  }).toMatchObject({
    completion: "incomplete",
    completionReason: "the eval fixture is in another repository",
    voice: true,
  });
});
// `[issue]` findings are F1…Fn across the council in card order, assigned once
// every card has parsed; an `[info]` carries none.
it("assigns finding IDs across the council in card order", () => {
  const first = parseCard(
    "card: safety\ncompletion: completed\nFindings:\n- [issue] a.ts:1 · severity=MAJOR · confidence=HIGH\n    what: One.\n- [info] a.ts:2 · severity=MINOR · confidence=LOW\n    what: Note.\n",
    "safety",
  );
  const second = parseCard(
    "card: works-and-proven\ncompletion: completed\nFindings:\n- [issue] b.ts:1 · severity=MAJOR · confidence=HIGH\n    what: Two.\n",
    "works-and-proven",
  );
  const cards = [first, second];
  assignFindingIds(cards);
  expect({
    ids: [first, second].map((card) => card.findings.map((f) => f.id ?? null)),
    mandatory: mandatory(cards),
  }).toMatchObject({ ids: [["F1", null], ["F2"]], mandatory: ["F1", "F2"] });
});
describe("ownership clearance", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  it("allows merge only when the ownership tier is recognized", async () => {
    const results = [];
    for (const tier of [
      undefined,
      "garbage",
      false,
      {},
      ["none"],
      "none",
      "owned",
      "required_owned",
    ]) {
      const r = recording();
      r.facts = { ...facts, ownedPathTier: tier };
      const result = await review(r.request, r.config, recordedServices(r));
      results.push(result.kind === "reviewed" && result.decision.mergeEligible);
    }
    expect({ results }).toMatchObject({
      results: [false, false, false, false, false, true, true, true],
    });
  });
});
