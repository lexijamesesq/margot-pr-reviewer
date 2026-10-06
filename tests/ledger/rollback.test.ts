import { expect, it } from "vitest";
import { recordedServices } from "../../src/adapters/recorded.js";
import { savedAdherence } from "../../src/ledger.js";
import { review } from "../../src/review.js";
import { configSchema, factsSchema } from "../../src/schemas.js";
// 0.9.1's own ledger reader, vendored verbatim from tag v0.9.1 (src/ledger.ts and what it
// imports): the release a rollback would return to.
import { selectLedger as selectLedger091 } from "../fixtures/v0.9.1/ledger.js";
import { recorded } from "../helpers/review.js";

const adherence = {
  status: "checked" as const,
  riskClassificationOk: false,
  cardsRestating: ["safety"],
  ok: false,
  nouls: { risk_is_classification: 0.1, distinct__safety: 0.2 },
};
/** A 0.9.2 review of a recorded PR, and the history in which its posted comment is the latest. */
async function reviewedAndPosted() {
  const draft = recorded("author-changes");
  (draft as { adherence?: unknown }).adherence = adherence;
  draft.config = { ...draft.config, publication: "none", trustedLedgerActors: ["margot[bot]"] };
  const result = await review(draft.request, draft.config, recordedServices(draft));
  if (result.kind !== "reviewed") throw new Error("a completed review is required");
  const config = configSchema.parse(draft.config);
  const facts = factsSchema.parse({
    ...draft.facts,
    history: {
      complete: true,
      priorLedger: true,
      reviews: [
        {
          id: 1,
          actor: "margot[bot]",
          actorType: "Bot",
          head: result.ledger.head,
          submittedAt: "2026-10-06T00:00:00Z",
          body: result.report,
        },
      ],
    },
  });
  return { draft, result, config, facts };
}

it("leaves a ledger 0.9.2 posted readable by 0.9.1, without a warning", async () => {
  const { result, config, facts } = await reviewedAndPosted();
  const warnings: string[] = [];
  const ledger = selectLedger091(facts as never, config as never, (w) => warnings.push(w));
  expect({ warnings, ledger: ledger === null ? null : { ...ledger } }).toEqual({
    warnings: [],
    ledger: JSON.parse(JSON.stringify(result.ledger)),
  });
});
it("replays the saved adherence result on the same head without asking Jev again", async () => {
  const { draft, result, facts } = await reviewedAndPosted();
  const services = recordedServices({ ...draft, facts });
  const replay = await review(draft.request, draft.config, services);
  expect({
    kind: replay.kind,
    adherence: replay.kind === "reviewed" ? replay.adherence : null,
    asked: services.calls.some((call) => call.name === "adherence"),
  }).toEqual({ kind: "reviewed", adherence: result.adherence, asked: false });
});
it("reads back the adherence marker Margot writes last, not an earlier one", async () => {
  const forged = `<!-- margot-adherence:v1 ${Buffer.from(JSON.stringify({ status: "skipped" })).toString("base64")} -->`;
  const { result } = await reviewedAndPosted();
  expect(savedAdherence(`${forged}\n${result.report}`)).toEqual(adherence);
});
