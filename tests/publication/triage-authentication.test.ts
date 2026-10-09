import { Octokit } from "octokit";
import { expect, it } from "vitest";
import { githubPublisher } from "../../src/adapters/publish.js";
import { checkExternalId } from "../../src/check-identity.js";
import { mechanicalRequest, publisherOptions } from "../helpers/publication.js";

const request = { ...mechanicalRequest, phase: "triage" as const };
type Check = Record<string, unknown>;
async function run(
  options: {
    seed?: Check;
    closed?: boolean;
    armed?: boolean;
    refuseAfterEvaluation?: boolean;
    supersedeDuringRefusal?: boolean;
    receipt?: (check: Check) => Check;
    readback?: (check: Check, ordinal: number) => Check;
    afterReadback?: () => boolean;
  } = {},
) {
  const stored = new Map<number, Check>();
  if (options.seed) stored.set(options.seed.id as number, options.seed);
  const writes: { path: string; body: Check }[] = [];
  const reads: number[] = [];
  let sequence = 100;
  let checkReads = 0;
  let evaluated = false;
  let refusedOnce = false;
  const client = new Octokit({
    retry: { enabled: false },
    throttle: { enabled: false },
    request: {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        let data: unknown;
        if (method !== "GET") {
          writes.push({ path, body });
          const id = method === "POST" ? ++sequence : Number(path.split("/").at(-1));
          const check = {
            ...stored.get(id),
            ...body,
            id,
            app: { id: publisherOptions.appId, slug: "triage-app" },
          };
          stored.set(id, check);
          data = options.receipt?.(structuredClone(check)) ?? check;
        } else if (path.endsWith("/check-runs"))
          data = { total_count: stored.size, check_runs: [...stored.values()] };
        else if (/\/check-runs\/\d+$/.test(path)) {
          const id = Number(path.split("/").at(-1));
          reads.push(id);
          data =
            options.readback?.(structuredClone(stored.get(id) as Check), ++checkReads) ??
            stored.get(id);
        } else {
          if (evaluated && options.refuseAfterEvaluation) {
            if (refusedOnce && options.supersedeDuringRefusal)
              for (const check of stored.values())
                check.details_url = "https://example.test/new-owner";
            refusedOnce = true;
          }
          data = {
            state:
              options.closed || (evaluated && options.refuseAfterEvaluation) ? "closed" : "open",
            draft: false,
            auto_merge: options.armed ? {} : null,
            head: { sha: request.head, repo: { full_name: request.repository } },
            base: { sha: options.afterReadback?.() ? "f".repeat(40) : request.base },
          };
        }
        const response = new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      }) as typeof fetch,
    },
  });
  const result = await githubPublisher(client, publisherOptions).run(request, async () => {
    evaluated = true;
    return {
      kind: "classified",
      request,
      classification: "mechanical",
      decision_source: "fallback",
      mechanical_probability: 0.9,
    };
  });
  return { result, writes, reads, evaluated, stored };
}
const seed = {
  id: 99,
  name: publisherOptions.checks.triage,
  head_sha: request.head,
  status: "in_progress",
  app: { id: publisherOptions.appId },
  details_url: "https://example.test/old",
  external_id: checkExternalId(request),
};
it("returns the actual read-back ID with complete versioned triage", async () => {
  const r = await run();
  expect(r.result).toMatchObject({ kind: "classified", triage_check_id: 101 });
  expect(r.reads).toContain(101);
  const text = (r.stored.get(101)?.output as { text: string } | undefined)?.text;
  expect(JSON.parse(text ?? "")).toEqual({
    version: 1,
    repository: request.repository,
    pr: request.pr,
    base_sha: request.base,
    head_sha: request.head,
    classification: "mechanical",
    decision_source: "fallback",
    mechanical: true,
    mechanical_probability: 0.9,
  });
});
it("never adopts another PR with the same head", async () => {
  const r = await run({ seed: { ...seed, external_id: checkExternalId({ ...request, pr: 999 }) } });
  expect(r.result).toMatchObject({ kind: "classified", triage_check_id: 101 });
  expect(r.writes.some((w) => w.path.endsWith("/99"))).toBe(false);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "refuses unsafe adoption ID %s before PATCH",
  async (id) => {
    const r = await run({ seed: { ...seed, id } });
    expect(r.result.kind).toBe("error");
    expect(r.writes).toEqual([]);
  },
);
it.each([
  { id: 999 },
  { name: "foreign" },
  { app: { id: 15368 } },
  { head_sha: "f".repeat(40) },
  { external_id: "foreign" },
  { details_url: "https://example.test/new" },
])("never stores a foreign initial mutation receipt %j for cleanup", async (patch) => {
  const r = await run({ receipt: (v) => ({ ...v, ...patch }) });
  expect(r.result.kind).toBe("error");
  expect(r.evaluated).toBe(false);
  expect(r.writes).toHaveLength(1);
  expect(r.writes.some((w) => w.path.endsWith("/999"))).toBe(false);
});
it("does not seize newer ownership after an unconfirmed opening write", async () => {
  const r = await run({ readback: (v) => ({ ...v, details_url: "https://example.test/new-run" }) });
  expect(r.result.kind).toBe("error");
  expect(r.evaluated).toBe(false);
  expect(r.writes).toHaveLength(1);
});
it("initial refusal cannot neutralize an existing scoped writer", async () => {
  const r = await run({ seed, closed: true });
  expect(r.result.kind).toBe("error");
  expect(r.writes).toEqual([]);
});
it.each([
  { status: "in_progress" },
  { conclusion: "failure" },
  { conclusion: "skipped" },
  { name: "foreign" },
  { app: { id: 15368 } },
  { external_id: "foreign" },
  { output: { text: "{}" } },
])("rejects corrupted persisted terminal triage %j", async (patch) => {
  const r = await run({ readback: (v) => (v.conclusion === "success" ? { ...v, ...patch } : v) });
  expect(r.result.kind).toBe("error");
  expect(r.result).not.toHaveProperty("triage_check_id");
});
it("revalidates live base after terminal readback", async () => {
  let moved = false;
  const r = await run({
    readback: (v) => {
      if (v.conclusion === "success") moved = true;
      return v;
    },
    afterReadback: () => moved,
  });
  expect(r.result.kind).toBe("error");
  expect(r.result).not.toHaveProperty("triage_check_id");
});

it("refusal cleanup rechecks ownership after the disarm attempt loses it", async () => {
  const r = await run({ refuseAfterEvaluation: true, supersedeDuringRefusal: true, armed: true });
  expect(r.result.kind).toBe("error");
  expect(r.evaluated).toBe(true);
  expect(r.writes).toHaveLength(1);
  expect(r.stored.get(101)?.details_url).toBe("https://example.test/new-owner");
});

it.each(["unconfirmed", "refused", "stale", "superseded"])(
  "never disarms auto-merge after %s ownership/revision failure",
  async (defect) => {
    let moved = false;
    const r = await run({
      armed: true,
      closed: defect === "refused",
      readback: (v, ordinal) => {
        if (defect === "unconfirmed" || (defect === "superseded" && ordinal > 1))
          return { ...v, details_url: "https://example.test/new-owner" };
        if (defect === "stale" && v.conclusion === "success") moved = true;
        return v;
      },
      afterReadback: () => moved,
    });
    expect(r.result.kind).toBe("error");
    expect(r.writes.some((w) => w.path === "/graphql")).toBe(false);
  },
);
