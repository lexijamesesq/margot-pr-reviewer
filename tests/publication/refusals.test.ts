import { expect, it } from "vitest";
import { runPublication } from "../helpers/publication.js";

const comments = (run: Awaited<ReturnType<typeof runPublication>>) =>
  run.writes.filter((w) => w.path.endsWith("/reviews"));
const title = (run: Awaited<ReturnType<typeof runPublication>>) =>
  ((run.final?.output ?? {}) as { title?: string }).title;

it("closes a review refused during publication as not reviewed, with no comment", async () => {
  const run = await runPublication("mid-draft");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    title: title(run),
    comments: comments(run),
  }).toEqual({
    kind: "error",
    conclusion: "neutral",
    title: "Margot: not reviewed: draft",
    comments: [],
  });
});
it("keeps a card failure as an error when a swallowed progress update was refused", async () => {
  const run = await runPublication("progress-refusal");
  expect({
    kind: run.result.kind,
    diagnostic: run.result.kind === "error" ? run.result.diagnostic : "",
    conclusion: run.final?.conclusion,
    title: title(run),
    comments: comments(run).map((w) => w.body.event),
  }).toMatchObject({
    kind: "error",
    diagnostic: expect.stringContaining("distinctive card failure"),
    conclusion: "action_required",
    title: "Margot: not reviewed (error)",
    comments: ["COMMENT"],
  });
});
