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
  { id: Number.MAX_SAFE_INTEGER + 1 },
  { name: "other" },
  { app: { id: 15368, slug: "triage-app" } },
  { status: "in_progress" },
  { conclusion: "failure" },
  { conclusion: "skipped" },
  { conclusion: "neutral" },
  { head_sha: "c".repeat(40) },
  { external_id: checkExternalId({ ...request, pr: 999 }) },
  { output: { text: "not JSON" } },
])("refuses foreign or unsuccessful API receipt %j", (patch) => {
  expect(() =>
    authenticateTriageCheck({ ...receipt, ...patch }, request, {
      appId: 4862659,
      name: "review / triage",
    }),
  ).toThrow();
});
it.each([
  { version: 2 },
  { repository: "other/project" },
  { pr: 999 },
  { base_sha: "c".repeat(40) },
  { head_sha: "c".repeat(40) },
  { classification: "unknown" },
  { decision_source: "unknown" },
  { mechanical: false },
  { mechanical_probability: 2 },
  { extra: true },
])("refuses malformed or foreign machine payload %j", (patch) => {
  expect(() =>
    authenticateTriageCheck(
      { ...receipt, output: { text: JSON.stringify({ ...payload, ...patch }) } },
      request,
      { appId: 4862659, name: "review / triage" },
    ),
  ).toThrow();
});
it("requires the explicit ID and complete versioned evidence", () => {
  expect(() =>
    authenticateTriageCheck(
      receipt,
      { ...request, triageCheckId: undefined },
      { appId: 4862659, name: "review / triage" },
    ),
  ).toThrow();
  const { version: _version, ...incomplete } = payload;
  expect(() =>
    authenticateTriageCheck({ ...receipt, output: { text: JSON.stringify(incomplete) } }, request, {
      appId: 4862659,
      name: "review / triage",
    }),
  ).toThrow();
});
