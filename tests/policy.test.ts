import { describe, expect, it } from "vitest";
import { parseCard } from "../src/adapters/prose.js";
import { assignFindingIds, decide, mandatory, needsVoice, rate } from "../src/policy.js";
import { configSchema, factsSchema, requestSchema } from "../src/schemas.js";
import { readRecording } from "./helpers/recordings.js";

const recording = readRecording("mechanical-bump");
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
  const recording = () => readRecording("mechanical-bump");
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  it("allows merge only when the ownership tier is recognized", () => {
    for (const [tier, eligible] of [
      [undefined, false],
      ["garbage", false],
      ["none", true],
      ["owned", true],
      ["required_owned", true],
    ] as const) {
      const decision = decide(
        "mechanical",
        { ...facts, ownedPathTier: tier },
        config,
        rate(null, true, config),
        null,
      );
      expect(decision.mergeEligible).toBe(eligible);
    }
  });
});

it("rejects the retired size-cap setting instead of silently ignoring it", () => {
  expect(() => configSchema.parse({ ...config, mechanicalDiffLineCap: 1 })).toThrow();
  for (const field of ["classification", "triage"])
    expect(() =>
      requestSchema.parse({ ...(recording.request as object), [field]: "mechanical" }),
    ).toThrow();
});
