import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { review } from "../../src/review.js";
import { factsSchema } from "../../src/schemas.js";
import type { RoundScope } from "../../src/types.js";
import { entry, facts, history, margot, posted, prior } from "../helpers/ledger.js";
import { present } from "../present.js";

it("reviews a mechanical change fully when a card is standing", async () => {
  const { result } = await margot();
  expect(result).toMatchObject({
    kind: "reviewed",
    decision: { outcome: "CHANGES_REQUESTED" },
    cards: [{ name: "safety" }],
    provenance: { summonedByLedger: ["safety"] },
    ledger: { receipt: { review: { provenance: { summonedByLedger: ["safety"] } } } },
  });
});
it("reviews an editorial change fully when a card is standing", async () => {
  const { result } = await margot("documentation", true);
  expect(result).toMatchObject({
    kind: "reviewed",
    decision: { outcome: "CHANGES_REQUESTED" },
    cards: [{ name: "safety" }],
  });
});
it("gives each card only its own standing and dismissed history", async () => {
  const { r } = await margot();
  const f = history(
    prior([entry(), { ...entry("MAJOR", "dismissed"), key: "R1-F2", card: "house-style" }]),
  );
  r.facts = f;
  const s = recordedServices(r);
  await review(r.request, r.config, s);
  const input = present(s.calls.find((c) => c.name === "card:safety")).input as {
    round: RoundScope;
    facts: typeof facts;
  };
  expect({
    keys: input.round.entries.map((e) => e.key),
    rawHistory: input.facts.history.reviews ?? [],
  }).toMatchObject({ keys: ["R1-F1"], rawHistory: [] });
});
it("rechecks classification and reuses the council result on the same head", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  r.facts = f;
  const s = recordedServices(r);
  const retry = await review(r.request, r.config, s);
  expect({
    equal: JSON.stringify(result) === JSON.stringify(retry),
    calls: s.calls.map((c) => c.name),
  }).toMatchObject({ equal: true, calls: ["facts", "classification", "head"] });
});
it("reviews afresh in the same round when the PR body changed on the same head", async () => {
  // A same-head re-run is reviewed as the same round; a body edit between runs changes the
  // evidence, so the saved result is stale and the council runs again.
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  f.body = `${f.body}\n\nEdited after the first review.`;
  r.facts = f;
  const s = recordedServices(r);
  const retry = await review(r.request, r.config, s);
  expect(retry).toMatchObject({
    kind: "reviewed",
    convergence: { round: result.convergence.round },
  });
  // The council saw the whole PR, not the empty delta from the head to itself.
  const route = s.calls.find((c) => c.name === "route") as
    | { input: { facts: { diff: string; files: unknown[] } } }
    | undefined;
  expect(route).toBeDefined();
  expect(route?.input.facts.diff).toBe(f.diff);
  expect(route?.input.facts.files).toEqual(f.files);
});
it("reads a receipt written by Margot 0.4.0", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed" || !result.ledger.receipt) throw new Error("baseline");
  const {
    routeAnswer: _routeAnswer,
    riskAnswer: _riskAnswer,
    ...review040
  } = result.ledger.receipt.review;
  const { receipt, ...ledger040 } = result.ledger;
  const receipt040 = { ...receipt, review: review040 };
  const transport040 = {
    ...ledger040,
    v: 1,
    receipt_v2: deflateSync(Buffer.from(JSON.stringify(receipt040)), { level: 9 }).toString(
      "base64",
    ),
  };
  const review040Body = `review\n<!-- margot-ledger:v1 ${Buffer.from(JSON.stringify(transport040)).toString("base64")} -->`;
  const f = factsSchema.parse(r.facts);
  f.history = {
    complete: true,
    priorLedger: true,
    reviews: [{ ...posted(result.ledger), body: review040Body }],
  };
  r.facts = f;
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "reviewed",
    routeAnswer: null,
    riskAnswer: null,
    convergence: { round: 2 },
  });
});
it("revalidates required checks on a same-head retry", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  present(f.checks[0]).conclusion = "failure";
  r.facts = f;
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "error",
    stage: "checks",
  });
});
it("retries fresh when a same-head round one ledger has no receipt", async () => {
  const { r } = await margot();
  r.facts = history({ ...prior(), head: facts.head });
  expect(await review(r.request, r.config, recordedServices(r))).toMatchObject({
    kind: "reviewed",
    convergence: { round: 1 },
  });
});
it("runs the council again when PR evidence changed since the saved approval", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  f.body = "New authorization request";
  r.facts = f;
  const s = recordedServices(r);
  expect(await review(r.request, r.config, s)).toMatchObject({ kind: "reviewed" });
  expect(s.calls.map((c) => c.name)).toContain("route");
});
it("runs the council again when live service configuration changed", async () => {
  const { result, r } = await margot();
  if (result.kind !== "reviewed") throw new Error("baseline");
  const f = factsSchema.parse(r.facts);
  f.history = { complete: true, priorLedger: true, reviews: [posted(result.ledger)] };
  r.facts = f;
  r.provenance = "different-model-or-reference-configuration";
  const s = recordedServices(r);
  expect(await review(r.request, r.config, s)).toMatchObject({ kind: "reviewed" });
  expect(s.calls.map((c) => c.name)).toContain("route");
});
