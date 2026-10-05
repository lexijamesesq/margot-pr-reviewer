import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Recording, recordedServices } from "../../src/adapters/recorded.js";
import { ledgerBlock, nextLedger, roundScope, selectLedger } from "../../src/ledger.js";
import { review } from "../../src/review.js";
import { configSchema, factsSchema } from "../../src/schemas.js";
import type { Ledger } from "../../src/types.js";
import { entry, prior } from "../helpers/ledger.js";
import { present } from "../helpers/present.js";

it("keeps standing entries when the ledger exceeds its size budget", () => {
  expect(ledgerBlock(prior([{ ...entry(), what: "x".repeat(50000) }])).length > 24000).toBe(true);
});
it("drops the replay receipt before any dismissal when the ledger is over budget", () => {
  const dismissed = { ...entry("MAJOR", "dismissed"), key: "R1-F2" };
  const value = prior([entry(), dismissed]);
  const bulky = {
    ...value,
    v: 2 as const,
    receipt: { big: randomBytes(30000).toString("base64") },
  } as unknown as Ledger;
  const decoded = JSON.parse(
    Buffer.from(present(ledgerBlock(bulky).split(" ")[2]), "base64").toString(),
  );
  expect({
    receipt: "receipt_v2" in decoded,
    keys: decoded.entries.map((e: { key: string }) => e.key),
  }).toEqual({ receipt: false, keys: ["R1-F1", "R1-F2"] });
});
describe("history retention and retries", () => {
  const recording = () =>
    JSON.parse(readFileSync("recordings/mechanical-bump.json", "utf8")) as Recording;
  const seed = recording();
  const facts = factsSchema.parse(seed.facts);
  const config = configSchema.parse({
    ...(seed.config as object),
    trustedLedgerActors: ["margot[bot]"],
  });
  const ledger = (round = 1): Ledger => ({ v: 1, round, head: facts.head, entries: [] });
  const posted = (value: Ledger, id = 1, actor = "margot[bot]") => ({
    id,
    actor,
    actorType: "Bot",
    head: value.head,
    submittedAt: `2026-10-02T00:00:0${id}Z`,
    body: ledgerBlock(value),
  });
  it("reviews the full PR on a same-head re-run without a usable saved result", () => {
    // The delta from a head to itself is empty; reviewing it would let the council approve
    // nothing. Without the saved result, the whole PR is reviewed again in the same round.
    const scope = roundScope(facts, { ...ledger(3), head: facts.head }, undefined, false);
    expect(scope).toMatchObject({ round: 3, full: true, diff: facts.diff, files: facts.files });
  });
  for (const [name, round] of [
    ["restarts a same-head first review with full scope", 1],
    ["reuses same-head later review scope and allocates new finding keys", 3],
  ] as const)
    it(name, async () => {
      const scope = roundScope(facts, { ...ledger(round), head: facts.head }, undefined, true);
      let keys: string[] = [];
      if (round === 3) {
        const r = recording();
        const core = await review(r.request, r.config, recordedServices(r));
        if (core.kind !== "reviewed") throw new Error("baseline");
        const priorEntry = {
          key: "R3-F1",
          card: "safety" as const,
          status: "standing" as const,
          severity: "MAJOR" as const,
          round_raised: 3,
          location: "a:1",
          what: "Old finding",
        };
        scope.entries = [priorEntry];
        core.decision = {
          ...core.decision,
          outcome: "CHANGES_REQUESTED",
          mergeEligible: false,
          holdReasons: ["author-action"],
        };
        const cards = [
          {
            name: "safety" as const,
            completion: "completed" as const,
            checked: [],
            notCovered: [],
            findings: [
              {
                id: "F1",
                tag: "issue" as const,
                severity: "MAJOR" as const,
                confidence: "HIGH" as const,
                location: "a:2",
                what: "New finding",
              },
            ],
          },
        ];
        const voice = {
          outcome: "CHANGES_REQUESTED" as const,
          band: "LOW" as const,
          rationale: "Bounded",
          summary: "Finding",
          dispositions: [{ id: "F1", status: "established" as const, reason: "Confirmed" }],
        };
        keys = nextLedger(
          scope,
          cards,
          voice,
          {
            request: core.request,
            classification: core.classification,
            routeAnswer: core.routeAnswer,
            riskAnswer: core.riskAnswer,
            cards,
            voice,
            decision: core.decision,
            provenance: core.provenance,
          },
          config,
          facts,
        ).ledger.entries.map((e) => e.key);
      }
      expect({ scope, keys }).toMatchObject({
        scope:
          round === 1
            ? { round: 1, priorHead: null, full: true, entries: [] }
            : { round: 3, priorHead: facts.head, full: false, diff: "", files: [] },
        ...(round === 3 ? { keys: ["R3-F1", "R3-F2"] } : {}),
      });
    });
  it("skips a forged ledger for older history, and holds the PR on a corrupt trusted one", async () => {
    const old = posted(ledger(2));
    const corrupt = { ...posted(ledger(3), 2), body: "<!-- margot-ledger:v1 bm90LWpzb24= -->" };
    const forged = posted(ledger(4), 3, "author");
    const withHistory = (reviews: (typeof old)[]) => ({
      ...facts,
      history: { complete: true, priorLedger: true, reviews },
    });
    expect({
      forgedSkipped: selectLedger(withHistory([old, forged]), config)?.round,
      corruptHolds: await review(
        seed.request,
        config,
        recordedServices({ ...seed, facts: withHistory([old, corrupt]) }),
      ),
    }).toMatchObject({
      forgedSkipped: 2,
      corruptHolds: { kind: "held", reason: expect.stringContaining("Review history corrupt") },
    });
  });
  it("prunes old dismissed entries while retaining standing and advisory findings", () => {
    const entries: Ledger["entries"] = Array.from({ length: 130 }, (_, i) => ({
      key: `R1-F${i + 1}`,
      card: "safety",
      status: i === 0 ? "standing" : i === 129 ? "advisory" : "dismissed",
      severity: "MAJOR",
      round_raised: 1,
      location: "a.ts:1",
      what: "detail ".repeat(30),
      reason: "dismissal evidence ".repeat(10),
      ...(i === 129 ? { advisory_round: 2 } : {}),
    }));
    const block = ledgerBlock({ ...ledger(2), entries: entries });
    const decoded = JSON.parse(Buffer.from(present(block.split(" ")[2]), "base64").toString());
    expect({
      fits: present(block.split(" ")[2]).length <= 24000,
      standing: decoded.entries[0].key,
      oldestDropped: !decoded.entries.some((e: { key: string }) => e.key === "R1-F2"),
      advisoryKept: decoded.entries.some((e: { key: string }) => e.key === "R1-F130"),
    }).toMatchObject({ fits: true, standing: "R1-F1", oldestDropped: true, advisoryKept: true });
  });
});
