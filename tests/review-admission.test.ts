import { expect, it } from "vitest";
import { boundIdentity, checkMetadataText, reviewRequestId } from "../src/check-identity.js";
import { recordFor, reviewAdmission } from "../src/trusted-checks.js";
import { hostedFixture } from "./helpers/trusted-checks.js";

async function fixture() {
  const f = await hostedFixture();
  if (!f.config.publisher) throw new Error("fixture publisher missing");
  return {
    ...f,
    request: { ...f.request, phase: "review" as const, triageCheckId: 101 },
    config: {
      ...f.config,
      publisher: {
        ...f.config.publisher,
        runUrl: "https://github.com/example/margot/actions/runs/10/attempts/1",
      },
    },
  };
}
it("admits a replacement and transfers an active check instead of skipping cancelled work", async () => {
  const f = await fixture();
  const first = await reviewAdmission(f.request, f.config, f.clients);
  const next = {
    ...f.config,
    publisher: {
      ...f.config.publisher,
      runUrl: "https://github.com/example/margot/actions/runs/11/attempts/1",
    },
  };
  const second = await reviewAdmission(f.request, next, f.clients);
  expect(second.disposition).toBe("admitted");
  expect(second.review_check_id).toBe(first.review_check_id);
  expect(f.checks.get(first.review_check_id)?.details_url).toBe(next.publisher.runUrl);
});
it("refuses a forged dispatch lookup hash before creating a waiting check", async () => {
  const f = await fixture();
  await expect(reviewAdmission(f.request, f.config, f.clients, "f".repeat(64))).rejects.toThrow(
    "request ID mismatch",
  );
  expect(f.writes).toHaveLength(0);
});
it("recovers a deliberate native hold and subsequent delivery does not create another check", async () => {
  const f = await fixture();
  const marker = {
    ...recordFor(f.request, f.config, "review", "waiting"),
    review_state: "COMMENTED" as const,
    retryable: false,
  };
  f.reviews.set(90, {
    id: 90,
    commit_id: f.request.head,
    state: "COMMENTED",
    user: { login: "margot[bot]", type: "Bot" },
    body: checkMetadataText(marker, "Held for the operator."),
  });
  const result = await reviewAdmission(
    f.request,
    f.config,
    f.clients,
    reviewRequestId(boundIdentity(f.request, "v0.10.0")),
  );
  expect(result).toMatchObject({ disposition: "completed", native_review_id: 90 });
  const before = f.writes.length;
  expect(await reviewAdmission(f.request, f.config, f.clients)).toEqual(result);
  expect(f.writes).toHaveLength(before);
});
it("never treats a retryable native error as completed publication", async () => {
  const f = await fixture();
  f.reviews.set(90, {
    id: 90,
    commit_id: f.request.head,
    state: "COMMENTED",
    user: { login: "margot[bot]", type: "Bot" },
    body: checkMetadataText({
      ...recordFor(f.request, f.config, "review", "waiting"),
      review_state: "COMMENTED",
      retryable: true,
    }),
  });
  expect((await reviewAdmission(f.request, f.config, f.clients)).disposition).toBe("admitted");
});

it("refuses a published check whose conclusion disagrees with its native held review", async () => {
  const f = await fixture();
  f.reviews.set(90, {
    id: 90,
    commit_id: f.request.head,
    state: "COMMENTED",
    user: { login: "margot[bot]", type: "Bot" },
    body: checkMetadataText({
      ...recordFor(f.request, f.config, "review", "waiting"),
      review_state: "COMMENTED",
      retryable: false,
    }),
  });
  const first = await reviewAdmission(f.request, f.config, f.clients);
  const saved = f.checks.get(first.review_check_id);
  if (!saved) throw new Error("missing check");
  saved.conclusion = "success";
  await expect(reviewAdmission(f.request, f.config, f.clients)).rejects.toThrow(
    "Published review state mismatch",
  );
});
