import { expect, it, vi } from "vitest";
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

async function splitTriageClients(failPublication = false) {
  const f = await hostedFixture();
  if (!f.config.publisher) throw new Error("fixture");
  const readPull = vi.fn(f.clients.read.rest.pulls.get);
  const writePull = vi.fn(async () => {
    throw new Error("Check writer cannot read pull requests");
  });
  const read = {
    ...f.clients.read,
    rest: {
      ...f.clients.read.rest,
      pulls: { ...f.clients.read.rest.pulls, get: readPull },
    },
  } as typeof f.clients.read;
  const updateCheck = f.clients.write.rest.checks.update;
  const write = {
    ...f.clients.write,
    rest: {
      ...f.clients.write.rest,
      pulls: { ...f.clients.write.rest.pulls, get: writePull },
      checks: {
        ...f.clients.write.rest.checks,
        update: vi.fn(async (input: Parameters<typeof updateCheck>[0]) => {
          if (failPublication && input?.conclusion === "success")
            throw new Error("Terminal triage check denied");
          return updateCheck(input);
        }),
      },
    },
  } as unknown as typeof f.clients.write;
  const publisher = githubPublisher(write, f.config.publisher, {
    config: f.config,
    clients: { ...f.clients, read, write },
  });
  let evaluated = 0;
  const result = await publisher.run(f.request, async () => {
    evaluated++;
    return {
      kind: "classified",
      request: f.request,
      classification: "documentation",
      decision_source: "jev",
      mechanical_probability: null,
    };
  });
  return { ...f, result, evaluated, readPull, writePull };
}

it("uses the trusted PR reader with a checks-only triage writer", async () => {
  const f = await splitTriageClients();
  expect(f.result).toMatchObject({ kind: "classified", triage_check_id: 201 });
  expect(f.evaluated).toBe(1);
  expect(f.writePull).not.toHaveBeenCalled();
  expect(f.readPull).toHaveBeenCalledWith(
    expect.objectContaining({ owner: "example", repo: "project", pull_number: 7 }),
  );
  expect(f.writes.map(({ body }) => [body.name, body.status, body.conclusion ?? null])).toEqual([
    ["review / triage", "in_progress", null],
    ["review / triage", "completed", "success"],
  ]);
  expect(f.checks.get(201)).toMatchObject({
    head_sha: f.request.head,
    app: { id: 4862659 },
    conclusion: "success",
  });
});

it("uses the trusted PR reader during failed triage publication cleanup", async () => {
  const f = await splitTriageClients(true);
  expect(f.result).toMatchObject({
    kind: "error",
    stage: "publication",
    mergeEligible: false,
    diagnostic: "Terminal triage check denied",
  });
  expect(f.evaluated).toBe(1);
  expect(f.writePull).not.toHaveBeenCalled();
  expect(f.readPull).toHaveBeenCalled();
  expect(
    f.writes.map(({ id, body }) => [id, body.name, body.status, body.conclusion ?? null]),
  ).toEqual([
    [201, "review / triage", "in_progress", null],
    [201, "review / triage", "completed", "action_required"],
  ]);
  expect(f.checks.get(201)).toMatchObject({
    head_sha: f.request.head,
    app: { id: 4862659 },
    conclusion: "action_required",
  });
});
