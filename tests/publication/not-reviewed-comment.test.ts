import { expect, it } from "vitest";
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
        body: "Not reviewed: The verdict could not be written. The review check has the details. Held for the operator.",
      },
    ],
  });
});
it("names the council reviewer when a card errors", async () => {
  const run = await runPublication("token-error");
  expect(comments(run).map((w) => w.body.body)).toEqual([
    "Not reviewed: A council reviewer could not complete its review. The review check has the details. Held for the operator.",
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
