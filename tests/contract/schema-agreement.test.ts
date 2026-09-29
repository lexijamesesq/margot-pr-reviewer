import { describe, expect, test } from "vitest";
import { parseContractJson } from "../../src/contract/validate.js";

const provenance = { value: null, provenance: "constructed" };

function caseDocument(overrides: Record<string, unknown> = {}) {
  return {
    schema: "contract/1",
    id: "agreement-case",
    description: "minimal agreement case",
    branch_class: "test",
    provenance: "constructed",
    source: { constructed: true },
    scrub: { ticket_ids: 0, roster_names: 0, vault_paths: 0 },
    pr: {
      repo: provenance,
      number: provenance,
      head_sha: provenance,
      base_sha: provenance,
      author: provenance,
      title: provenance,
      body: provenance,
      changed_files: provenance,
      triage: provenance,
      self_instrument_match: provenance,
      floor_receipt: provenance,
    },
    github: { reads: [], write_responses: [] },
    models: {},
    jev: {},
    seams: ["triage"],
    ...overrides,
  };
}

function expectedDocument(overrides: Record<string, unknown> = {}) {
  return {
    schema: "contract/1",
    id: "agreement-expected",
    github: { writes: [] },
    ...overrides,
  };
}

function read(fields: Record<string, unknown>) {
  return {
    method: "GET",
    path: "/test",
    params: {},
    provenance: "constructed",
    ...fields,
  };
}

function writeResponse(fields: Record<string, unknown>) {
  return {
    method: "POST",
    path: "/test",
    params: {},
    body: null,
    provenance: "constructed",
    ...fields,
  };
}

function accept(document: unknown) {
  expect(() => parseContractJson(JSON.stringify(document), "agreement test")).not.toThrow();
}

function reject(document: unknown) {
  expect(() => parseContractJson(JSON.stringify(document), "agreement test")).toThrow();
}

describe("schema agreement at the loader boundary", () => {
  test("read rejects both response and status", () => {
    reject(
      caseDocument({
        github: {
          reads: [read({ response: "ok", status: { reason: "bad" } })],
          write_responses: [],
        },
      }),
    );
  });

  test("read rejects neither response nor status", () => {
    reject(caseDocument({ github: { reads: [read({})], write_responses: [] } }));
  });

  test("read accepts exactly one of response and status", () => {
    accept(
      caseDocument({
        github: {
          reads: [read({ response: "ok" })],
          write_responses: [],
        },
      }),
    );
  });

  test("writeResponse rejects both response and status", () => {
    reject(
      caseDocument({
        github: {
          reads: [],
          write_responses: [writeResponse({ response: "ok", status: { reason: "bad" } })],
        },
      }),
    );
  });

  test("writeResponse rejects neither response nor status", () => {
    reject(caseDocument({ github: { reads: [], write_responses: [writeResponse({})] } }));
  });

  test("writeResponse accepts exactly one of response and status", () => {
    accept(
      caseDocument({
        github: {
          reads: [],
          write_responses: [writeResponse({ response: "ok" })],
        },
      }),
    );
  });

  test("source accepts constructed", () => {
    accept(caseDocument({ source: { constructed: true } }));
  });

  test("source accepts repo and repo_visibility", () => {
    accept(caseDocument({ source: { repo: "owner/repo", repo_visibility: "public" } }));
  });

  test("source accepts constructed with a partial repo set (schema has no `not` clause here)", () => {
    // Unlike read/writeResponse, source's oneOf branches carry no `not`, so only
    // BOTH branches being fully satisfied at once is invalid -- a lone `repo` key
    // alongside `constructed` doesn't complete the repo/repo_visibility branch,
    // so this is genuinely valid per the schema, and the loader must accept it.
    accept(caseDocument({ source: { constructed: true, repo: "owner/repo" } }));
  });

  test("source rejects constructed with repo and repo_visibility", () => {
    reject(
      caseDocument({
        source: { constructed: true, repo: "owner/repo", repo_visibility: "public" },
      }),
    );
  });

  test("expected rejects none of the three field sets", () => {
    reject(expectedDocument());
  });

  test("expected accepts the driver-only field set", () => {
    accept(
      expectedDocument({
        driver: { raised: null },
        emit: null,
        model_requests: [],
        jev_requests: [],
      }),
    );
  });

  test("expected accepts the poster-only field set", () => {
    accept(
      expectedDocument({
        poster: { raised: null, exit: { code: 0, uncaught: false } },
        model_requests: [],
        jev_requests: [],
      }),
    );
  });

  test("expected accepts a driver and poster chain", () => {
    accept(
      expectedDocument({
        driver: { raised: null },
        emit: null,
        poster: { raised: null, exit: { code: 0, uncaught: false } },
        model_requests: [],
        jev_requests: [],
      }),
    );
  });
});
