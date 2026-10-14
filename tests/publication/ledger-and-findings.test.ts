import { expect, it } from "vitest";
import { selectLedger } from "../../src/ledger.js";
import { findingTally, render } from "../../src/render.js";
import { configSchema, factsSchema } from "../../src/schemas.js";
import {
  mechanicalBump,
  mechanicalRequest,
  mechanicalReview,
  publisherOptions,
  tallyReview,
} from "../helpers/publication.js";

it("reconciles New, Open and Closed with every listed finding, including dismissals and advisories", () => {
  const value = tallyReview();
  const report = render(value);
  const tally = findingTally(value);
  expect({
    tally,
    visible: report.includes(`New: ${tally.new} · Open: ${tally.open} · Closed: ${tally.closed}`),
  }).toMatchObject({
    tally: { new: 2, open: 2, closed: 2 },
    visible: true,
  });
});
it("counts findings from earlier rounds as open or closed, without calling them new", () => {
  const value = tallyReview();
  value.convergence.round = 3;
  expect(findingTally(value)).toEqual({ new: 0, open: 2, closed: 2 });
});
it("keeps the posted ledger readable in its version 1 format with the receipt in its compressed field", () => {
  const body = render(mechanicalReview);
  const block = body.match(/<!-- margot-ledger:v1 ([A-Za-z0-9+/=]+) -->$/);
  const plainLedger = block
    ? JSON.parse(Buffer.from(block[1] ?? "", "base64").toString("utf8"))
    : null;
  const config = configSchema.parse({
    ...(mechanicalBump.config as object),
    trustedLedgerActors: [publisherOptions.actor],
  });
  let restored: ReturnType<typeof selectLedger> = null;
  try {
    restored = selectLedger(
      {
        ...factsSchema.parse(mechanicalBump.facts),
        history: {
          complete: true,
          priorLedger: true,
          reviews: [
            {
              id: 1,
              actor: publisherOptions.actor,
              actorType: "Bot",
              head: mechanicalRequest.head,
              submittedAt: "2026-09-30T20:00:00Z",
              body,
            },
          ],
        },
      },
      config,
    );
  } catch {
    restored = null;
  }
  expect({
    version1Readable:
      plainLedger?.v === 1 &&
      plainLedger?.head === mechanicalRequest.head &&
      Array.isArray(plainLedger?.entries),
    restored,
  }).toMatchObject({ version1Readable: true, restored: mechanicalReview.ledger });
});
