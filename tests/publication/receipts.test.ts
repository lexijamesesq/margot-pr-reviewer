import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { liveServices } from "../../src/adapters/live.js";
import { publisherOptions, runPublication } from "../helpers/publication.js";

for (const [name, mode] of [
  ["stops evaluation when the pending gate cannot be created", "start-fail"],
  ["never completes a success check when the native review fails", "review-fail"],
  ["fails closed without approving when the check receipt names a different app", "identity"],
] as const)
  it(name, async () => {
    const run = await runPublication(mode);
    expect({
      kind: run.result.kind,
      approved: run.reviews.some((v) => v.state === "APPROVED"),
    }).toMatchObject({ kind: "error", approved: false });
  });
for (const [name, mode] of [
  ["fails closed before approving when the head moves", "head"],
  ["fails publication when the final check reads back as in progress", "confirm"],
] as const)
  it(name, async () => {
    const run = await runPublication(mode);
    expect({
      kind: run.result.kind,
      completedWrite: run.writes.some(
        (w) => w.body.name === publisherOptions.checks.review && w.body.conclusion === "success",
      ),
      approvalAttempted: run.writes.some((w) => w.body.event === "APPROVE"),
    }).toMatchObject(
      mode === "head"
        ? { kind: "error", completedWrite: false, approvalAttempted: false }
        : { kind: "error", completedWrite: true, approvalAttempted: true },
    );
  });
it("closes the gate without touching earlier reviews when evaluation errors", async () => {
  const run = await runPublication("error");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    dismissed: run.reviews.some((v) => v.state === "DISMISSED"),
    newApproval: run.writes.some((w) => w.body.event === "APPROVE"),
  }).toMatchObject({
    kind: "error",
    conclusion: "action_required",
    dismissed: false,
    newApproval: false,
  });
});
it("closes the gate when the native review receipt does not match", async () => {
  const run = await runPublication("receipt");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    dismissed: run.dismissedIds.length > 0,
  }).toMatchObject({ kind: "error", conclusion: "action_required", dismissed: false });
});
it("leaves a prior same-head approval alone and never dismisses her own reviews", async () => {
  const run = await runPublication("order");
  expect({
    priorState: run.reviews.find((v) => v.id === 77)?.state,
    dismissals: run.dismissedIds.length,
    kind: run.result.kind,
  }).toMatchObject({ priorState: "APPROVED", dismissals: 0, kind: "reviewed" });
});
it("adopts the caller's pending check without a stranded duplicate", async () => {
  const run = await runPublication("adopt");
  expect({
    adopted: run.writes.some((w) => w.path.endsWith("/check-runs/88")),
    duplicates: run.writes.filter(
      (w) => w.method === "POST" && w.body.name === publisherOptions.checks.review,
    ).length,
  }).toMatchObject({ adopted: true, duplicates: 0 });
});
it("opens a new check on a same-head retry instead of reopening the completed one", async () => {
  const run = await runPublication("retry");
  expect({
    kind: run.result.kind,
    reopenedCompleted: run.writes.some(
      (w) => w.path.endsWith("/check-runs/89") && w.body.status === "in_progress",
    ),
    opened: run.writes.filter(
      (w) => w.method === "POST" && w.body.name === publisherOptions.checks.review,
    ).length,
  }).toMatchObject({ kind: "reviewed", reopenedCompleted: false, opened: 1 });
});
it("refuses to close the newer run's check or approve when a run is superseded", async () => {
  const run = await runPublication("superseded");
  expect({
    kind: run.result.kind,
    gateStillPending: run.final?.status === "in_progress",
    approved: run.reviews.some((v) => v.state === "APPROVED"),
  }).toMatchObject({ kind: "error", gateStillPending: true, approved: false });
});
it("keeps provenance compatible across a new workflow run URL", () => {
  const config = JSON.parse(readFileSync("samples/config.sample.json", "utf8"));
  config.publisher = structuredClone(publisherOptions);
  const before = liveServices(config, { jevKey: "unused" }).services.provenance;
  config.publisher.runUrl = "https://example.invalid/run/2";
  expect({
    compatible: before === liveServices(config, { jevKey: "unused" }).services.provenance,
  }).toMatchObject({ compatible: true });
});
it("blocks after review delivery when the final check fails", async () => {
  const run = await runPublication("final-fail");
  expect({
    kind: run.result.kind,
    conclusion: run.final?.conclusion,
    reviewWrites: run.writes.filter((w) => w.path.endsWith("/reviews")).length,
  }).toMatchObject({ kind: "error", conclusion: "action_required", reviewWrites: 1 });
});
