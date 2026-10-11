import { expect, it } from "vitest";
import {
  mechanicalRequest,
  parseVerdictText,
  publisherOptions,
  runPublication,
} from "../helpers/publication.js";

it("posts the head-bound approval before completing the check on clearance", async () => {
  const run = await runPublication("clear");
  const approve = run.writes.findIndex((w) => w.body.event === "APPROVE");
  const success = run.writes.findIndex(
    (w) => w.body.name === publisherOptions.checks.review && w.body.conclusion === "success",
  );
  expect({
    kind: run.result.kind,
    successAfterApprove: approve >= 0 && success > approve,
    head: run.writes.find((w) => w.body.event === "APPROVE")?.body.commit_id,
    finalStatus: run.final?.status,
    merged: run.writes.some(
      (w) =>
        w.path.endsWith("/merge") || JSON.stringify(w.body).includes("enablePullRequestAutoMerge"),
    ),
  }).toMatchObject({
    kind: "reviewed",
    successAfterApprove: true,
    head: mechanicalRequest.head,
    finalStatus: "completed",
    merged: false,
  });
});
it("carries the lines merge automation parses to request the operator when the review is held", async () => {
  const run = await runPublication("hold");
  const output = (run.final?.output ?? {}) as {
    text?: string;
    title?: string;
  };
  const parsed = parseVerdictText(output.text);
  expect({ ...parsed, title: output.title }).toMatchObject({
    outcome: "APPROVED",
    band: "HIGH",
    source: "jev",
    title: "held for the operator: risk is HIGH",
  });
});
it("overwrites the verdict check text after a later failure so merge automation never reads a stale approval", async () => {
  const run = await runPublication("review-fail");
  const output = (run.final?.output ?? {}) as {
    text?: string;
  };
  expect({
    kind: run.result.kind,
    staleApproval: parseVerdictText(output.text).outcome,
    hasText: typeof output.text === "string" && output.text.length > 0,
  }).toMatchObject({ kind: "error", staleApproval: "", hasText: true });
});
it("never lets calibration satisfy the review check", async () => {
  expect({ conclusion: (await runPublication("calibration")).final?.conclusion }).toMatchObject({
    conclusion: "action_required",
  });
});
it("exposes the classification JSON without approving on a triage run", async () => {
  const run = await runPublication("triage");
  expect({
    text: JSON.parse(
      (
        run.final?.output as
          | {
              text?: string;
            }
          | undefined
      )?.text ?? "{}",
    ),
    reviews: run.reviews.length,
  }).toMatchObject({
    text: {
      head_sha: mechanicalRequest.head,
      classification: "documentation",
      decision_source: "jev",
      mechanical_probability: 0.12,
    },
    reviews: 0,
  });
});
it("updates the check title as each review phase begins", async () => {
  const run = await runPublication("phase-titles");
  expect({
    titles: run.writes
      .filter(
        (write) =>
          write.body.name === publisherOptions.checks.review && write.body.status === "in_progress",
      )
      .map(
        (write) =>
          (
            write.body.output as {
              title?: string;
            }
          ).title,
      ),
  }).toMatchObject({
    titles: [
      "Margot: preflight complete — setting up the review runner",
      "Margot: council is reviewing the changes",
      "Margot: posting the verdict",
    ],
  });
});
for (const [name, mode] of [
  ["reports a closed PR as not reviewed", "closed"],
  ["reports a fork PR as not reviewed", "fork"],
  ["reports a draft PR as not reviewed", "draft"],
  ["reports a stale request as not reviewed", "base"],
] as const)
  it(name, async () => {
    const run = await runPublication(mode);
    expect({
      kind: run.result.kind,
      evaluated: run.evaluated,
      writes: run.writes.length,
      title: (
        (run.final?.output ?? {}) as {
          title?: string;
        }
      ).title,
    }).toMatchObject({
      kind: "error",
      evaluated: false,
      writes: 0,
      title: undefined,
    });
  });
it("never writes the triage check from a review run", async () => {
  // Rewriting `review / triage` from the review run replaced Jev's answer with the review's
  // merged class; readers accept only a Jev-sourced triage, so a mechanical PR read as
  // functional. The review run never writes it.
  const run = await runPublication("clear");
  const triageWrites = run.writes.filter(
    (w) => (w.body as { name?: string } | undefined)?.name === publisherOptions.checks.triage,
  );
  expect(triageWrites).toEqual([]);
});
it("summarizes the verdict check with the risk label's first sentence", async () => {
  const run = await runPublication("hold");
  expect(((run.final?.output ?? {}) as { summary?: string }).summary).toBe(
    "APPROVED, HIGH: mechanical change — no functional change.",
  );
});
