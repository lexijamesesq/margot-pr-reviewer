import { expect, it } from "vitest";
import { authenticateTriageCheck, checkExternalId } from "../src/check-identity.js";
import { requestSchema } from "../src/schemas.js";
import { readRecording } from "./helpers/recordings.js";

const request = requestSchema.parse(readRecording("mechanical-bump").request);
const payload = {
  version: 1,
  repository: request.repository,
  pr: request.pr,
  base_sha: request.base,
  head_sha: request.head,
  classification: "mechanical",
  decision_source: "fallback",
  mechanical: true,
  mechanical_probability: 0.9,
};
const receipt = {
  id: request.triageCheckId,
  name: "review / triage",
  app: { id: 4862659, slug: "triage-app" },
  status: "completed",
  conclusion: "success",
  head_sha: request.head,
  external_id: checkExternalId(request),
  output: { text: JSON.stringify(payload) },
};
it("authenticates exact API identity and keeps fallback provenance", () => {
  expect(
    authenticateTriageCheck(receipt, request, { appId: 4862659, name: "review / triage" }).facts,
  ).toMatchObject({
    checkId: 101,
    appId: 4862659,
    decisionSource: "fallback",
    mechanicalProbability: 0.9,
  });
});
it.each([
  { id: 102 },
  { name: "other" },
  { app: { id: 15368, slug: "triage-app" } },
  { head_sha: "c".repeat(40) },
  { external_id: checkExternalId({ ...request, pr: 999 }) },
])("rejects foreign API check identity %j", (patch) => {
  expect(() =>
    authenticateTriageCheck({ ...receipt, ...patch }, request, {
      appId: 4862659,
      name: "review / triage",
    }),
  ).toThrow();
});
it("rejects pending or unsuccessful API checks", () => {
  for (const patch of [{ status: "in_progress" }, { conclusion: "failure" }])
    expect(() =>
      authenticateTriageCheck({ ...receipt, ...patch }, request, {
        appId: 4862659,
        name: "review / triage",
      }),
    ).toThrow();
});
it.each([
  { repository: "other/project" },
  { pr: 999 },
  { base_sha: "c".repeat(40) },
  { head_sha: "c".repeat(40) },
])("rejects foreign machine payload revision %j", (patch) => {
  expect(() =>
    authenticateTriageCheck(
      { ...receipt, output: { text: JSON.stringify({ ...payload, ...patch }) } },
      request,
      { appId: 4862659, name: "review / triage" },
    ),
  ).toThrow();
});
it("rejects a mechanical compatibility field that contradicts classification", () => {
  expect(() =>
    authenticateTriageCheck(
      { ...receipt, output: { text: JSON.stringify({ ...payload, mechanical: false }) } },
      request,
      { appId: 4862659, name: "review / triage" },
    ),
  ).toThrow();
});
it("requires the dispatched ID and readable complete versioned output", () => {
  expect(() =>
    authenticateTriageCheck(
      receipt,
      { ...request, triageCheckId: undefined },
      { appId: 4862659, name: "review / triage" },
    ),
  ).toThrow();
  const { version: _version, ...incomplete } = payload;
  for (const text of [
    "not JSON",
    JSON.stringify(incomplete),
    JSON.stringify({ ...payload, version: 2 }),
  ])
    expect(() =>
      authenticateTriageCheck({ ...receipt, output: { text } }, request, {
        appId: 4862659,
        name: "review / triage",
      }),
    ).toThrow();
});
