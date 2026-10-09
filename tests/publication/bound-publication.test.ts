import { expect, it } from "vitest";
import { githubPublisher } from "../../src/adapters/publish.js";
import { readCheckRecord } from "../../src/check-identity.js";
import { publicationSchema } from "../../src/schemas.js";
import { mechanicalReview } from "../helpers/publication.js";
import { hostedFixture } from "../helpers/trusted-checks.js";

async function fixture(report = "Approved.") {
  const f = await hostedFixture();
  if (!f.config.publisher) throw new Error("fixture");
  const config = {
    ...f.config,
    publisher: {
      ...f.config.publisher,
      runUrl: "https://github.com/example/margot/actions/runs/10/attempts/1",
    },
  };
  const request = { ...f.request, phase: "review" as const, triageCheckId: 101 };
  let evaluated = 0;
  const run = () => {
    const publisher = githubPublisher(f.clients.write, config.publisher, {
      config,
      clients: f.clients,
    });
    return publisher.run(request, async () => {
      evaluated++;
      const review = { ...mechanicalReview, request };
      try {
        const publication = await publisher.publish(
          { expectedHead: request.head, review, report },
          { signal: AbortSignal.timeout(1000) },
        );
        return {
          ...review,
          kind: "reviewed" as const,
          report,
          publication: publicationSchema.parse(publication),
        };
      } catch (error) {
        return {
          kind: "error" as const,
          stage: "publication",
          diagnostic: String(error),
          mergeEligible: false as const,
        };
      }
    });
  };
  return {
    ...f,
    run,
    get evaluated() {
      return evaluated;
    },
  };
}
it("authenticates completed publication before another model or native review", async () => {
  const f = await fixture();
  const result = await f.run();
  if (result.kind === "error") throw new Error(result.diagnostic);
  expect(result.kind).toBe("reviewed");
  const posted = [...f.reviews.values()][0];
  expect(readCheckRecord(posted?.body as string).request_id).toMatch(/^[a-f0-9]{64}$/);
  expect(await f.run()).toMatchObject({ kind: "already_published", native_review_id: 90 });
  expect(f.evaluated).toBe(1);
  expect(f.reviews.size).toBe(1);
});
for (const failure of ["loseNativeResponse", "failPublishedWrite"] as const)
  it(`recovers ${failure} without posting the same native review twice`, async () => {
    const f = await fixture();
    f.state[failure] = true;
    expect((await f.run()).kind).toBe("error");
    expect(f.reviews.size).toBe(1);
    f.state[failure] = false;
    expect(await f.run()).toMatchObject({ kind: "already_published", native_review_id: 90 });
    expect(f.evaluated).toBe(1);
    expect(f.reviews.size).toBe(1);
  });

it("reserves check metadata without truncating the native report or its ledger tail", async () => {
  const report = "x".repeat(61000) + "LEDGER-END";
  const f = await fixture(report);
  expect((await f.run()).kind).toBe("reviewed");
  expect(f.reviews.get(90)?.body).toContain(report);
  expect(readCheckRecord(f.reviews.get(90)?.body as string).kind).toBe("review");
});
