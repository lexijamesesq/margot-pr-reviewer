import { z } from "zod";
import { checkIdSchema, triageFactsSchema, triagePayloadSchema } from "./schemas.js";
import type { ReviewRequest } from "./types.js";

/** Scope even an in-progress check before its terminal machine output exists. */
export function checkExternalId(
  r: Pick<ReviewRequest, "repository" | "pr" | "base" | "head">,
): string {
  return `margot:v1:${JSON.stringify([r.repository, r.pr, r.base, r.head])}`;
}
const triageCheckSchema = z.object({
  id: checkIdSchema,
  name: z.string(),
  head_sha: z.string(),
  external_id: z.string(),
  status: z.literal("completed"),
  conclusion: z.literal("success"),
  app: z.object({ id: checkIdSchema, slug: z.string().min(1) }),
  output: z.object({ text: z.string() }),
});
/** Authenticate API fields separately from the untrusted machine payload and dispatched ID. */
export function authenticateTriageCheck(
  input: unknown,
  r: ReviewRequest,
  expected: { appId: number; name: string },
) {
  const check = triageCheckSchema.parse(input);
  if (
    check.id !== r.triageCheckId ||
    check.name !== expected.name ||
    check.app.id !== expected.appId ||
    check.head_sha !== r.head ||
    check.external_id !== checkExternalId(r)
  )
    throw new Error("Triage check identity mismatch");
  const payload = triagePayloadSchema.parse(JSON.parse(check.output.text));
  if (
    payload.repository !== r.repository ||
    payload.pr !== r.pr ||
    payload.base_sha !== r.base ||
    payload.head_sha !== r.head
  )
    throw new Error("Triage payload revision mismatch");
  const facts = authenticateTriageFacts(
    {
      version: payload.version,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      externalId: check.external_id,
      actor: check.app.slug,
      checkId: check.id,
      appId: check.app.id,
      repository: payload.repository,
      pr: payload.pr,
      base: payload.base_sha,
      head: payload.head_sha,
      classification: payload.classification,
      decisionSource: payload.decision_source,
      ...(payload.mechanical_probability === undefined
        ? {}
        : { mechanicalProbability: payload.mechanical_probability }),
    },
    r,
    expected,
  );
  return { check, payload, facts };
}

/** Apply the same identity checks to normalized external recordings and live API facts. */
export function authenticateTriageFacts(
  input: unknown,
  r: ReviewRequest,
  expected: { appId: number; name: string },
) {
  const v = triageFactsSchema.parse(input);
  if (
    v.checkId !== r.triageCheckId ||
    v.appId !== expected.appId ||
    v.name !== expected.name ||
    v.externalId !== checkExternalId(r) ||
    v.repository !== r.repository ||
    v.pr !== r.pr ||
    v.base !== r.base ||
    v.head !== r.head
  )
    throw new Error("Triage facts identity mismatch");
  return v;
}
