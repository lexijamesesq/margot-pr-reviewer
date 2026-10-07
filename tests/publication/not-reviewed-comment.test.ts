import { expect, it } from "vitest";
import { notReviewedReason } from "../../src/adapters/publish.js";
import { cardStage, stages } from "../../src/stages.js";
import { runPublication } from "../helpers/publication.js";

const comments = (run: Awaited<ReturnType<typeof runPublication>>) =>
  run.writes.filter((w) => w.path.endsWith("/reviews"));

it("posts a fixed one-line comment and the check when the voice errors after the council began", async () => {
  const run = await runPublication("council-error");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    comments: comments(run).map((w) => ({ event: w.body.event, body: w.body.body })),
  }).toEqual({
    kind: "error",
    conclusion: "action_required",
    comments: [
      {
        event: "COMMENT",
        body: "Not reviewed: The verdict could not be written. The review run has the details. Held for the operator.",
      },
    ],
  });
});
it("names the council reviewer when a card errors", async () => {
  const run = await runPublication("token-error");
  expect(comments(run).map((w) => w.body.body)).toEqual([
    "Not reviewed: A council reviewer could not complete its review. The review run has the details. Held for the operator.",
  ]);
});
it("carries no text from the diagnostic in the comment", async () => {
  const run = await runPublication("token-error");
  const posted = JSON.stringify(comments(run));
  expect(posted).not.toMatch(/ghp_|distinctive-detail-canary|Card safety failed/u);
});
it("posts only the check when the error comes before the review began", async () => {
  const run = await runPublication("facts-error");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    comments: comments(run),
  }).toEqual({ kind: "error", conclusion: "action_required", comments: [] });
});
it.each([
  [cardStage("safety"), "A council reviewer could not complete its review"],
  [stages.cards, "A council reviewer could not complete its review"],
  [stages.risk, "The risk could not be scored"],
  [stages.voice, "The verdict could not be written"],
  [stages.render, "The review comment could not be rendered"],
  [stages.publication, "The review could not be published"],
])("says exactly what a %s error means", async (stage, reason) => {
  const run = await runPublication("stage-error", stage);
  expect(comments(run).map((w) => w.body.body)).toEqual([
    `Not reviewed: ${reason}. The review run has the details. Held for the operator.`,
  ]);
  expect(notReviewedReason(stage)).toBe(reason);
});
it.each([
  stages.input,
  stages.facts,
  stages.history,
  stages.triage,
  stages.classification,
  stages.checks,
  stages.compare,
  stages.bundle,
  stages.route,
  stages.holdHead,
  stages.publicationHead,
  stages.disableAutoMerge,
])("posts no comment for an error at the %s stage", async (stage) => {
  const run = await runPublication("stage-error", stage);
  expect({ conclusion: run.final?.conclusion, comments: comments(run) }).toEqual({
    conclusion: "action_required",
    comments: [],
  });
});
it("posts no comment when the head moved before the comment was written", async () => {
  const run = await runPublication("moved-error");
  expect({ kind: run.result.kind, comments: comments(run) }).toEqual({
    kind: "error",
    comments: [],
  });
});
it("records a skipped comment when the pull request cannot be confirmed as current", async () => {
  const run = await runPublication("unconfirmed-error");
  expect({ comments: comments(run), result: run.result }).toMatchObject({
    comments: [],
    result: {
      kind: "error",
      diagnostic: expect.stringMatching(/not-reviewed comment skipped: .*Recorded outage/u),
    },
  });
});
it("records nothing extra when the comment is skipped for a moved head", async () => {
  const run = await runPublication("moved-error");
  expect(run.result).toMatchObject({ kind: "error" });
  expect(run.result.kind === "error" && run.result.diagnostic).not.toMatch(/not-reviewed comment/u);
});
it("posts no not-reviewed comment under a review that was already posted", async () => {
  const run = await runPublication("published-then-error");
  expect(comments(run).map((w) => w.body.event)).toEqual(["APPROVE"]);
});
it("returns the error result, naming the failed comment write, when the comment is rejected", async () => {
  const run = await runPublication("comment-fail");
  expect(run.result).toMatchObject({
    kind: "error",
    stage: "publication",
    diagnostic: expect.stringMatching(
      /not-reviewed comment unconfirmed: .*Recorded write failure/u,
    ),
  });
  expect(run.final?.conclusion).toBe("action_required");
});
it("posts no comment and titles the check a poster error when the template gate holds the comment", async () => {
  const run = await runPublication("stage-error", stages.templateGate);
  const output = (run.final?.output ?? {}) as { title?: string; summary?: string };
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    title: output.title,
    summary: output.summary,
    comments: comments(run),
  }).toEqual({
    kind: "error",
    conclusion: "action_required",
    title: "not reviewed: poster error",
    summary: "Distinctive diagnostic detail.",
    comments: [],
  });
});
it("puts the reason a publication write failed in the check summary", async () => {
  const run = await runPublication("review-fail");
  const output = (run.final?.output ?? {}) as { title?: string; summary?: string };
  expect({ conclusion: run.final?.conclusion, title: output.title }).toEqual({
    conclusion: "action_required",
    title: "Margot: not reviewed (error)",
  });
  expect(output.summary).not.toContain("Publication or evaluation failed");
  expect(output.summary).toMatch(/Recorded write failure/u);
});
it("puts an error result's diagnostic in the check summary, capped at 900, keeping its title", async () => {
  const short = await runPublication("stage-error", "voice");
  const long = await runPublication("stage-error", "voice", undefined, "x".repeat(2000));
  const output = (run: typeof short) =>
    (run.final?.output ?? {}) as { title?: string; summary?: string };
  expect({
    conclusion: short.final?.conclusion,
    title: output(short).title,
    summary: output(short).summary,
    capped: Array.from(output(long).summary ?? "").length,
  }).toEqual({
    conclusion: "action_required",
    title: "Margot: not reviewed (error)",
    summary: "Distinctive diagnostic detail.",
    capped: 900,
  });
});
