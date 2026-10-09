import { createHash } from "node:crypto";
import { z } from "zod";
import {
  checkIdSchema,
  checkRecordSchema,
  reviewIdentitySchema,
  triageFactsSchema,
  triagePayloadSchema,
} from "./schemas.js";
import type { ReviewRequest } from "./types.js";

const digest = (values: unknown[]) =>
  createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
/** A lookup key, not authentication. Syntax cannot prove tag immutability: callers must select workflow_ref from trusted immutable-tag configuration. */
export function reviewRequestId(input: z.infer<typeof reviewIdentitySchema>): string {
  const v = reviewIdentitySchema.parse(input);
  return digest([v.repository, v.pr, v.base_sha, v.head_sha, v.triage_check_id, v.workflow_ref]);
}
export function textIdentity(
  title: string,
  body: string | null,
  headRefName: string,
  baseRefName: string,
): string {
  return digest(
    z
      .tuple([z.string(), z.string(), z.string(), z.string()])
      .parse([title, body ?? "", headRefName, baseRefName]),
  );
}
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

export const checkMarker = "margot-check:v1";
/** Reserve the complete machine record before bounding human text. */
export function checkMetadataText(record: CheckRecord, human = ""): string {
  const machine = `<!-- ${checkMarker} ${Buffer.from(JSON.stringify(checkRecordSchema.parse(record))).toString("base64")} -->`;
  if (Array.from(machine).length > 60000)
    throw new Error("Check metadata exceeds publication limit");
  return `${Array.from(human)
    .slice(0, Math.max(0, 60000 - Array.from(machine).length - 1))
    .join("")}\n${machine}`.trimStart();
}
export type CheckRecord = z.infer<typeof checkRecordSchema>;
export function readCheckRecord(text: string | null | undefined): CheckRecord {
  const matches = [...(text ?? "").matchAll(/<!-- margot-check:v1 ([A-Za-z0-9+/=]+) -->/g)];
  if (matches.length !== 1) throw new Error("Missing or ambiguous check metadata");
  const raw = matches[0]?.[1] ?? "";
  const data = Buffer.from(raw, "base64");
  if (data.toString("base64") !== raw) throw new Error("Invalid metadata encoding");
  return checkRecordSchema.parse(JSON.parse(data.toString("utf8")));
}
export function boundIdentity(r: ReviewRequest, workflowRef: string) {
  if (r.workflowRef !== workflowRef)
    throw new Error("Workflow reference differs from trusted configuration");
  return reviewIdentitySchema.parse({
    repository: r.repository,
    pr: r.pr,
    base_sha: r.base,
    head_sha: r.head,
    triage_check_id: r.triageCheckId,
    workflow_ref: workflowRef,
  });
}
export function authenticateCheckRecord(
  input: unknown,
  r: ReviewRequest,
  expected: {
    appId: number;
    name: string;
    workflowRef: string;
    kind: CheckRecord["kind"];
    bound?: boolean;
  },
) {
  const check = apiCheckSchema.parse(input);
  if (
    check.name !== expected.name ||
    check.app.id !== expected.appId ||
    check.head_sha !== r.head ||
    check.external_id !== checkExternalId(r)
  )
    throw new Error("Control check API identity mismatch");
  const record = readCheckRecord(check.output.text);
  if (
    record.kind !== expected.kind ||
    record.repository !== r.repository ||
    record.pr !== r.pr ||
    record.base_sha !== r.base ||
    record.head_sha !== r.head ||
    record.workflow_ref !== expected.workflowRef ||
    record.owner_run_url !== check.details_url
  )
    throw new Error("Control check payload identity mismatch");
  if (record.triage_check_id !== undefined) {
    const identity = boundIdentity(
      { ...r, triageCheckId: r.triageCheckId ?? record.triage_check_id },
      expected.workflowRef,
    );
    if (
      record.triage_check_id !== identity.triage_check_id ||
      record.request_id !== reviewRequestId(identity)
    )
      throw new Error("Control request identity mismatch");
  } else if (expected.bound !== false) throw new Error("Unbound control check");
  return { check, record };
}
export const apiCheckSchema = z.object({
  id: checkIdSchema,
  name: z.string(),
  head_sha: z.string(),
  external_id: z.string().nullable(),
  details_url: z.string().nullable(),
  status: z.enum(["queued", "in_progress", "completed"]),
  conclusion: z.string().nullable(),
  app: z.object({ id: checkIdSchema, slug: z.string().optional() }),
  started_at: z.string().nullable().optional(),
  output: z.object({ text: z.string().nullable().optional() }),
});

/** Native publication authentication is shared by publisher recovery and final cleanup. */
export function authenticateNativeReview(
  input: unknown,
  r: ReviewRequest,
  actor: string,
  workflowRef: string,
) {
  const native = z
    .object({
      id: checkIdSchema,
      commit_id: z.string(),
      state: z.enum(["APPROVED", "COMMENTED"]),
      body: z.string(),
      user: z.object({ login: z.string(), type: z.literal("Bot") }),
    })
    .parse(input);
  const marker = readCheckRecord(native.body),
    identity = boundIdentity(r, workflowRef);
  if (
    native.commit_id !== r.head ||
    native.user.login !== actor ||
    marker.kind !== "review" ||
    marker.repository !== r.repository ||
    marker.pr !== r.pr ||
    marker.base_sha !== r.base ||
    marker.head_sha !== r.head ||
    marker.workflow_ref !== workflowRef ||
    marker.triage_check_id !== r.triageCheckId ||
    marker.request_id !== reviewRequestId(identity) ||
    marker.review_state !== native.state ||
    marker.retryable
  )
    throw new Error("Native publication identity or marker mismatch");
  return { native, marker };
}
