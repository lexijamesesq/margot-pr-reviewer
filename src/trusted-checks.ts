import { readFile, writeFile } from "node:fs/promises";
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  apiCheckSchema,
  authenticateCheckRecord,
  authenticateNativeReview,
  authenticateTriageCheck,
  boundIdentity,
  type CheckRecord,
  checkExternalId,
  checkMetadataText,
  readCheckRecord,
  reviewRequestId,
  textIdentity,
} from "./check-identity.js";
import { checkIdSchema, checkRecordSchema, liveConfigSchema, requestSchema } from "./schemas.js";
import type { ReviewConfig, ReviewRequest } from "./types.js";

export const pullIdentitySchema = z.object({
  state: z.literal("open"),
  draft: z.literal(false),
  title: z.string(),
  body: z.string().nullable(),
  head: z.object({ sha: z.string(), ref: z.string(), repo: z.object({ full_name: z.string() }) }),
  base: z.object({ sha: z.string(), ref: z.string() }),
});
export function livePull(input: unknown, request: ReviewRequest) {
  const pull = pullIdentitySchema.parse(input);
  if (
    pull.head.sha !== request.head ||
    pull.base.sha !== request.base ||
    pull.head.repo.full_name !== request.repository
  )
    throw new Error("PR admission or revision changed");
  return pull;
}
export function pullTextDigest(pull: z.infer<typeof pullIdentitySchema>) {
  return textIdentity(pull.title, pull.body, pull.head.ref, pull.base.ref);
}
const checkHeaderSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    head_sha: z.string(),
    app: z.object({ id: z.number().int().positive() }).passthrough(),
    external_id: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
  })
  .passthrough();
export type CheckPolicy = Pick<
  ReviewConfig,
  "requiredChecks" | "requiredCheckReporters" | "allowedSkippedChecks" | "trustedCheckActors"
> & {
  codeName?: string;
  textName?: string;
  workflowRef?: string;
  controlAppId?: number;
};
/** Reporter filtering precedes recency. The floor and reviewer use this same evaluator. */
export function evaluateRequiredChecks(
  request: ReviewRequest,
  policy: CheckPolicy,
  rawChecks: unknown[],
  textDigest?: string,
) {
  const result = { green: false, pending: [] as string[], failing: [] as string[] };
  if (
    request.workflowRef &&
    (!policy.codeName ||
      !policy.textName ||
      !policy.controlAppId ||
      !policy.requiredChecks.includes(policy.codeName) ||
      !policy.requiredChecks.includes(policy.textName) ||
      policy.requiredCheckReporters?.[policy.codeName] !== policy.controlAppId ||
      policy.requiredCheckReporters?.[policy.textName] !== policy.controlAppId)
  ) {
    result.failing.push(
      policy.codeName ?? "ci / checks",
      policy.textName ?? "trusted-scan / trusted-scan",
    );
    return result;
  }
  for (const name of policy.requiredChecks) {
    const reporter = policy.requiredCheckReporters?.[name];
    if (!reporter) {
      result.failing.push(name);
      continue;
    }
    const codeName = policy.codeName ?? "ci / checks",
      textName = policy.textName ?? "trusted-scan / trusted-scan";
    const mandatory = name === codeName || name === textName;
    if (
      mandatory &&
      (!policy.codeName ||
        !policy.textName ||
        !policy.controlAppId ||
        reporter !== policy.controlAppId ||
        !policy.requiredChecks.includes(codeName) ||
        !policy.requiredChecks.includes(textName))
    ) {
      result.failing.push(name);
      continue;
    }
    const checks = rawChecks
      .flatMap((raw) => {
        const p = checkHeaderSchema.safeParse(raw);
        return p.success ? [p.data] : [];
      })
      .filter(
        (c) =>
          c.name === name &&
          c.app.id === reporter &&
          c.head_sha === request.head &&
          (!mandatory || c.external_id === checkExternalId(request)),
      )
      .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "") || b.id - a.id);
    const candidate = checks[0];
    if (!candidate) {
      result.pending.push(name);
      continue;
    }
    const parsed = apiCheckSchema.safeParse(candidate);
    if (!parsed.success) {
      result.failing.push(name);
      continue;
    }
    const check = parsed.data;
    if (check.status !== "completed") {
      result.pending.push(name);
      continue;
    }
    if (
      !policy.trustedCheckActors.includes(check.app.slug ?? "") ||
      (check.conclusion !== "success" &&
        !(
          check.conclusion === "skipped" &&
          !mandatory &&
          policy.allowedSkippedChecks.includes(name)
        ))
    ) {
      result.failing.push(name);
      continue;
    }
    if (mandatory) {
      try {
        if (!policy.workflowRef) throw new Error("Trusted workflow reference required");
        const { record } = authenticateCheckRecord(check, request, {
          appId: reporter,
          name,
          workflowRef: policy.workflowRef,
          kind: name === policy.codeName ? "code" : "text",
        });
        if (
          record.phase !== "complete" ||
          (record.kind === "text" &&
            (record.text_digest !== textDigest || record.handoff !== "accepted"))
        )
          throw new Error("Incomplete mandatory work");
      } catch {
        result.failing.push(name);
      }
    }
  }
  result.green = result.pending.length === 0 && result.failing.length === 0;
  return result;
}
export function evaluateChecks(input: unknown) {
  const envelope = z
    .object({
      request: requestSchema,
      config: liveConfigSchema,
      pull: z.unknown(),
      checks: z.array(z.unknown()),
      triage: z.unknown(),
    })
    .parse(input);
  const { request, config } = envelope;
  const publisher = config.publisher;
  if (!publisher?.checks.code || !publisher.checks.text || !config.handoff)
    throw new Error("Trusted check configuration required");
  boundIdentity(request, config.handoff.ref);
  authenticateTriageCheck(envelope.triage, request, {
    appId: publisher.appId,
    name: publisher.checks.triage,
  });
  const pull = livePull(envelope.pull, request);
  for (const name of [publisher.checks.code, publisher.checks.text])
    if (
      !config.review.requiredChecks.includes(name) ||
      config.review.requiredCheckReporters?.[name] !== publisher.appId
    )
      throw new Error("Mandatory App reporter policy required");
  return evaluateRequiredChecks(
    request,
    {
      ...config.review,
      requiredChecks: config.review.requiredChecks.filter(
        (name) => ![publisher.checks.review, publisher.checks.triage].includes(name),
      ),
      controlAppId: publisher.appId,
      codeName: publisher.checks.code,
      textName: publisher.checks.text,
      workflowRef: config.handoff.ref,
    },
    envelope.checks,
    pullTextDigest(pull),
  );
}

export type HostedContext = {
  version: 1;
  kind: "code" | "text";
  request: ReviewRequest;
  runUrl: string;
  codeCheckId?: number | undefined;
  textCheckId?: number | undefined;
  textFile: string;
  textDigest: string;
};
type LiveConfig = z.infer<typeof liveConfigSchema>;
export type TrustedClients = {
  read: Octokit;
  write: Octokit;
  runs: Octokit;
  actions: Octokit;
  dispatch?: Octokit;
};
function configured(config: LiveConfig) {
  const p = config.publisher,
    h = config.handoff;
  if (!p?.checks.code || !p.checks.text || !h)
    throw new Error("Trusted check configuration required");
  return { ...p, checks: { ...p.checks, code: p.checks.code, text: p.checks.text }, handoff: h };
}
const parameters = (r: ReviewRequest) => {
  const [owner = "", repo = ""] = r.repository.split("/");
  return { owner, repo };
};
async function currentPull(client: Octokit, r: ReviewRequest, signal?: AbortSignal) {
  return livePull(
    (
      await client.rest.pulls.get({
        ...parameters(r),
        pull_number: r.pr,
        ...(signal ? { request: { signal } } : {}),
      })
    ).data,
    r,
  );
}
async function listed(client: Octokit, r: ReviewRequest, signal?: AbortSignal) {
  return client.paginate(client.rest.checks.listForRef, {
    ...parameters(r),
    ref: r.head,
    filter: "all",
    per_page: 100,
    ...(signal ? { request: { signal } } : {}),
  });
}
function expected(config: LiveConfig, kind: CheckRecord["kind"], bound = false) {
  const p = configured(config);
  return { appId: p.appId, name: p.checks[kind], workflowRef: p.handoff.ref, kind, bound };
}
export function recordFor(
  r: ReviewRequest,
  config: LiveConfig,
  kind: CheckRecord["kind"],
  phase: CheckRecord["phase"],
  textDigest?: string,
): CheckRecord {
  const p = configured(config);
  if (r.workflowRef !== p.handoff.ref) throw new Error("Untrusted workflow reference");
  return {
    version: 1,
    kind,
    repository: r.repository,
    pr: r.pr,
    base_sha: r.base,
    head_sha: r.head,
    workflow_ref: p.handoff.ref,
    ...(r.triageCheckId === undefined
      ? {}
      : {
          triage_check_id: r.triageCheckId,
          request_id: reviewRequestId(boundIdentity(r, p.handoff.ref)),
        }),
    phase,
    owner_run_url: p.runUrl,
    ...(textDigest === undefined ? {} : { text_digest: textDigest }),
  };
}
async function ownCheck(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
  id: number,
  kind: CheckRecord["kind"],
) {
  const result = authenticateCheckRecord(
    (await clients.read.rest.checks.get({ ...parameters(r), check_run_id: id })).data,
    r,
    expected(config, kind),
  );
  if (result.check.id !== id || result.record.owner_run_url !== configured(config).runUrl)
    throw new Error("Check ownership superseded");
  return result;
}
/** One exact check write, followed by authenticated persisted-field confirmation. */
export async function assertInvocation(
  client: Octokit,
  request: ReviewRequest,
  config: LiveConfig,
  kind: CheckRecord["kind"],
) {
  const p = configured(config),
    repository = kind === "review" ? p.handoff.repository : request.repository;
  const prefix = `https://github.com/${repository}/actions/runs/`;
  const suffix = p.runUrl.startsWith(prefix) ? p.runUrl.slice(prefix.length) : "";
  const match = suffix.match(/^(\d+)\/attempts\/(\d+)$/);
  if (!match) throw new Error("Attempt-qualified native owner URL required");
  const [owner = "", repo = ""] = repository.split("/");
  const run = (await client.rest.actions.getWorkflowRun({ owner, repo, run_id: Number(match[1]) }))
    .data;
  if (
    run.repository.full_name !== repository ||
    run.id !== Number(match[1]) ||
    run.run_attempt !== Number(match[2]) ||
    !["queued", "in_progress"].includes(run.status ?? "")
  )
    throw new Error("Native invocation was superseded or stopped");
  return run.run_attempt;
}
export async function writeControl(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
  record: CheckRecord,
  conclusion: "success" | "failure" | "cancelled" | "neutral" | "action_required" | null,
  id?: number,
) {
  const p = configured(config);
  await currentPull(clients.read, r);
  await assertInvocation(clients.runs, r, config, record.kind);
  if (id !== undefined) {
    const prior = await ownCheck(clients, r, config, id, record.kind);
    if (prior.check.status === "completed") throw new Error("Owned check is already terminal");
  }
  const payload = {
    ...parameters(r),
    name: p.checks[record.kind],
    head_sha: r.head,
    external_id: checkExternalId(r),
    details_url: p.runUrl,
    status: conclusion ? ("completed" as const) : ("in_progress" as const),
    ...(conclusion ? { conclusion } : {}),
    output: {
      title: `Margot: ${record.kind} ${record.phase}`,
      summary: "Bound trusted work; machine evidence below.",
      text: checkMetadataText(record),
    },
  };
  const receipt = (
    await (id === undefined
      ? clients.write.rest.checks.create(payload)
      : clients.write.rest.checks.update({ ...payload, check_run_id: id }))
  ).data;
  if (
    !Number.isSafeInteger(receipt.id) ||
    receipt.id <= 0 ||
    (id !== undefined && receipt.id !== id)
  )
    throw new Error("Invalid control write receipt ID");
  authenticateCheckRecord(receipt, r, expected(config, record.kind));
  const fetched = (
    await clients.read.rest.checks.get({ ...parameters(r), check_run_id: receipt.id })
  ).data;
  const confirmed = authenticateCheckRecord(fetched, r, expected(config, record.kind));
  if (
    confirmed.check.id !== receipt.id ||
    confirmed.check.status !== payload.status ||
    (conclusion && confirmed.check.conclusion !== conclusion) ||
    JSON.stringify(confirmed.record) !== JSON.stringify(checkRecordSchema.parse(record))
  )
    throw new Error("Control write not confirmed");
  await currentPull(clients.read, r);
  return receipt.id;
}
async function scanSnapshot(client: Octokit, r: ReviewRequest, file: string) {
  const pull = await currentPull(client, r);
  await writeFile(file, [pull.title, pull.body ?? "", pull.head.ref, pull.base.ref].join("\n"), {
    mode: 0o600,
  });
  return pullTextDigest(pull);
}
async function exactTriage(clients: TrustedClients, r: ReviewRequest, config: LiveConfig) {
  if (r.triageCheckId === undefined) throw new Error("Triage check ID required");
  const p = configured(config);
  return authenticateTriageCheck(
    (await clients.read.rest.checks.get({ ...parameters(r), check_run_id: r.triageCheckId })).data,
    r,
    { appId: p.appId, name: p.checks.triage },
  );
}
async function codeEvidence(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
  signal?: AbortSignal,
) {
  const p = configured(config);
  const checks = (await listed(clients.read, r, signal))
    .filter(
      (c) =>
        c.name === p.checks.code &&
        c.app?.id === p.appId &&
        c.head_sha === r.head &&
        c.external_id === checkExternalId(r),
    )
    .sort((a, b) => b.id - a.id);
  const candidate = checks[0];
  if (!candidate) return null;
  return authenticateCheckRecord(
    (
      await clients.read.rest.checks.get({
        ...parameters(r),
        check_run_id: candidate.id,
        ...(signal ? { request: { signal } } : {}),
      })
    ).data,
    r,
    expected(config, "code"),
  );
}
export type TrustedOperationInput = {
  operation: "begin" | "code-passed" | "finish" | "fail";
  kind: "code" | "text";
  request: unknown;
  config: unknown;
  contextFile: string;
  result?: unknown;
  textOutcome?: "success" | "failure" | "cancelled";
  failure?: "failure" | "cancelled";
};
export async function trustedChecks(
  input: TrustedOperationInput,
  clients: TrustedClients,
  clock = {
    now: Date.now,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  },
) {
  const config = liveConfigSchema.parse(input.config);
  const p = configured(config);
  let request = requestSchema.parse(input.request);
  if (request.workflowRef !== p.handoff.ref) throw new Error("Untrusted workflow reference");
  await currentPull(clients.read, request);
  let context: HostedContext;
  if (input.operation === "begin") {
    const textFile = `${input.contextFile}.text`;
    const digest = await scanSnapshot(clients.read, request, textFile);
    const codeCheckId =
      input.kind === "code"
        ? await writeControl(
            clients,
            request,
            config,
            recordFor(request, config, "code", "checking"),
            null,
          )
        : undefined;
    context = {
      version: 1,
      kind: input.kind,
      request,
      runUrl: p.runUrl,
      ...(codeCheckId === undefined ? {} : { codeCheckId }),
      textFile,
      textDigest: digest,
    };
    await writeFile(input.contextFile, `${JSON.stringify(context)}\n`, { mode: 0o600 });
    context.textCheckId = await writeControl(
      clients,
      request,
      config,
      recordFor(request, config, "text", "checking", digest),
      null,
    );
  } else {
    context = hostedContextSchema.parse(JSON.parse(await readFile(input.contextFile, "utf8")));
    if (
      context.kind !== input.kind ||
      context.runUrl !== p.runUrl ||
      context.request.repository !== request.repository ||
      context.request.pr !== request.pr ||
      context.request.base !== request.base ||
      context.request.head !== request.head ||
      context.request.workflowRef !== p.handoff.ref
    )
      throw new Error("Invocation context mismatch");
    request = context.request;
    if (context.textCheckId !== undefined)
      await ownCheck(clients, request, config, context.textCheckId, "text");
    else if (input.operation !== "fail") throw new Error("Owned text check required");
    if (input.kind === "code") {
      if (context.codeCheckId === undefined) throw new Error("Owned code check required");
      await ownCheck(clients, request, config, context.codeCheckId, "code");
    }
    if (input.operation === "code-passed") {
      if (input.kind !== "code") throw new Error("Only the code invocation can pass code");
      const result = z
        .object({
          kind: z.literal("classified"),
          request: requestSchema,
          triage_check_id: checkIdSchema,
        })
        .parse(input.result);
      if (
        result.request.repository !== request.repository ||
        result.request.pr !== request.pr ||
        result.request.base !== request.base ||
        result.request.head !== request.head
      )
        throw new Error("Classification result revision mismatch");
      request = { ...request, triageCheckId: result.triage_check_id };
      await exactTriage(clients, request, config);
      context.request = request;
      context.textDigest = await scanSnapshot(clients.read, request, context.textFile);
      await writeControl(
        clients,
        request,
        config,
        recordFor(request, config, "code", "code_passed"),
        null,
        context.codeCheckId,
      );
      await writeControl(
        clients,
        request,
        config,
        recordFor(request, config, "text", "checking", context.textDigest),
        null,
        context.textCheckId,
      );
    } else if (input.operation === "fail") {
      const conclusion = input.failure ?? "failure";
      if (context.textCheckId !== undefined) {
        const text = await ownCheck(clients, request, config, context.textCheckId, "text");
        if (text.check.status !== "completed")
          await writeControl(
            clients,
            request,
            config,
            {
              ...recordFor(request, config, "text", "failed", context.textDigest),
              ...(text.record.handoff ? { handoff: text.record.handoff } : {}),
              retryable: true,
            },
            conclusion,
            context.textCheckId,
          );
      }
      if (input.kind === "code") {
        const code = await ownCheck(
          clients,
          request,
          config,
          context.codeCheckId as number,
          "code",
        );
        if (code.check.status !== "completed") {
          if (code.record.phase === "code_passed" && code.record.triage_check_id) {
            request = { ...request, triageCheckId: code.record.triage_check_id };
            await exactTriage(clients, request, config);
            await writeControl(
              clients,
              request,
              config,
              {
                ...recordFor(request, config, "code", "complete"),
                handoff: code.record.handoff ?? "not_sent_text_failed",
              },
              "success",
              context.codeCheckId,
            );
          } else
            await writeControl(
              clients,
              request,
              config,
              { ...recordFor(request, config, "code", "failed"), retryable: true },
              conclusion,
              context.codeCheckId,
            );
        }
      }
    } else if (input.operation === "finish") {
      const result = await finishTrusted(context, config, input.textOutcome, clients, clock);
      await writeFile(input.contextFile, `${JSON.stringify(context)}\n`, { mode: 0o600 });
      return { ...contextOutput(context), ...result };
    }
  }
  await writeFile(input.contextFile, `${JSON.stringify(context)}\n`, { mode: 0o600 });
  return contextOutput(context);
}
const hostedContextSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["code", "text"]),
  request: requestSchema,
  runUrl: z.url(),
  codeCheckId: checkIdSchema.optional(),
  textCheckId: checkIdSchema.optional(),
  textFile: z.string(),
  textDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
function contextOutput(c: HostedContext) {
  return {
    text_file: c.textFile,
    text_digest: c.textDigest,
    text_check_id: c.textCheckId,
    ...(c.codeCheckId === undefined ? {} : { code_check_id: c.codeCheckId }),
    base_sha: c.request.base,
    head_sha: c.request.head,
    workflow_ref: c.request.workflowRef,
    ...(c.request.triageCheckId === undefined
      ? {}
      : {
          triage_check_id: c.request.triageCheckId,
          request_id: reviewRequestId(boundIdentity(c.request, c.request.workflowRef ?? "")),
        }),
  };
}

function identityMatches(record: CheckRecord, r: ReviewRequest, config: LiveConfig) {
  const p = configured(config);
  const identity = boundIdentity(r, p.handoff.ref);
  return (
    record.repository === r.repository &&
    record.pr === r.pr &&
    record.base_sha === r.base &&
    record.head_sha === r.head &&
    record.workflow_ref === p.handoff.ref &&
    record.triage_check_id === r.triageCheckId &&
    record.request_id === reviewRequestId(identity)
  );
}
export async function nativePublication(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
  id: number,
) {
  const p = configured(config);
  const native = (
    await clients.read.rest.pulls.getReview({ ...parameters(r), pull_number: r.pr, review_id: id })
  ).data;
  if (native.id !== id) throw new Error("Native publication ID mismatch");
  const { marker } = authenticateNativeReview(native, r, p.actor, p.handoff.ref);
  await currentPull(clients.read, r);
  return { native, marker };
}
/** Completed publications are authenticated against both the App check and native review. */
export async function completedPublication(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
) {
  const p = configured(config);
  boundIdentity(r, p.handoff.ref);
  const checks = (await listed(clients.read, r))
    .filter(
      (c) =>
        c.name === p.checks.review && c.app?.id === p.appId && c.external_id === checkExternalId(r),
    )
    .sort((a, b) => b.id - a.id);
  for (const candidate of checks) {
    const record = readCheckRecord(candidate.output.text);
    if (!identityMatches(record, r, config)) continue;
    const { check, record: confirmed } = authenticateCheckRecord(
      (await clients.read.rest.checks.get({ ...parameters(r), check_run_id: candidate.id })).data,
      r,
      expected(config, "review", true),
    );
    if (confirmed.phase !== "published" || confirmed.retryable || check.status !== "completed")
      continue;
    if (
      !["success", "neutral", "action_required"].includes(check.conclusion ?? "") ||
      !confirmed.native_review_id
    )
      throw new Error("Invalid completed publication");
    const { native } = await nativePublication(clients, r, config, confirmed.native_review_id);
    if (
      native.state !== confirmed.review_state ||
      check.conclusion !== (native.state === "APPROVED" ? "success" : "neutral")
    )
      throw new Error("Published review state mismatch");
    return { review_check_id: check.id, native_review_id: native.id };
  }
  return null;
}
/** Recover only a native review with the intended bot, head and complete request marker. */
export async function recoverNativePublication(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
) {
  const p = configured(config);
  const reviews = await clients.read.paginate(clients.read.rest.pulls.listReviews, {
    ...parameters(r),
    pull_number: r.pr,
    per_page: 100,
  });
  for (const candidate of [...reviews].reverse()) {
    if (
      candidate.user?.login !== p.actor ||
      candidate.user.type !== "Bot" ||
      candidate.commit_id !== r.head
    )
      continue;
    let marker: CheckRecord;
    try {
      marker = readCheckRecord(candidate.body);
    } catch {
      continue;
    }
    if (marker.kind !== "review" || !identityMatches(marker, r, config) || marker.retryable)
      continue;
    const { native } = await nativePublication(clients, r, config, candidate.id);
    if (native.state === "COMMENTED") {
      const pull = await currentPull(clients.read, r);
      // A native hold may have been posted immediately before a crash in its disarm step.
      const actual = (await clients.read.rest.pulls.get({ ...parameters(r), pull_number: r.pr }))
        .data;
      if (actual.auto_merge) {
        await assertInvocation(clients.runs, r, config, "review");
        await clients.write.graphql(
          "mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { pullRequest { id } } }",
          { id: actual.node_id },
        );
        const confirmed = (
          await clients.read.rest.pulls.get({ ...parameters(r), pull_number: r.pr })
        ).data;
        livePull(confirmed, r);
        if (confirmed.auto_merge !== null) throw new Error("Recovered hold disarm unconfirmed");
      }
      livePull(pull, r);
    }
    const record = {
      ...recordFor(r, config, "review", "published"),
      native_review_id: native.id,
      review_state: native.state as "APPROVED" | "COMMENTED",
      retryable: false,
    };
    const review_check_id = await writeControl(
      clients,
      r,
      config,
      record,
      native.state === "APPROVED" ? "success" : "neutral",
    );
    return { review_check_id, native_review_id: native.id };
  }
  return null;
}
type HandoffObservation = "handled" | "retryable" | "uncertain" | "missing" | "none";
async function nativeRunState(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
  runId?: number,
): Promise<HandoffObservation> {
  const p = configured(config),
    target = p.handoff;
  const [owner = "", repo = ""] = target.repository.split("/");
  const title = `Margot ${r.repository}#${r.pr} ${reviewRequestId(boundIdentity(r, target.ref))}`;
  try {
    const tag = (await clients.actions.rest.git.getRef({ owner, repo, ref: `tags/${target.ref}` }))
      .data;
    let object = tag.object;
    for (let depth = 0; object.type === "tag" && depth < 8; depth++)
      object = (await clients.actions.rest.git.getTag({ owner, repo, tag_sha: object.sha })).data
        .object;
    if (object.type !== "commit") return "uncertain";
    const workflow = (
      await clients.actions.rest.actions.getWorkflow({ owner, repo, workflow_id: target.workflow })
    ).data;
    if (runId === undefined) {
      const runs = (
        await clients.actions.rest.actions.listWorkflowRuns({
          owner,
          repo,
          workflow_id: workflow.id,
          event: "workflow_dispatch",
          per_page: 100,
        })
      ).data.workflow_runs;
      const candidate = runs
        .filter((v) => v.display_title === title && v.head_branch === target.ref)
        .sort((a, b) => b.id - a.id)[0];
      if (!candidate) return runs.some((v) => v.display_title === title) ? "uncertain" : "missing";
      runId = candidate.id;
    }
    const run = (await clients.actions.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }))
      .data;
    if (
      run.id !== runId ||
      run.repository.full_name !== target.repository ||
      run.workflow_id !== workflow.id ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== target.ref ||
      run.head_sha !== object.sha ||
      run.display_title !== title ||
      run.actor?.login !== p.actor ||
      run.actor.type !== "Bot"
    )
      return "uncertain";
    await currentPull(clients.read, r);
    if (["queued", "in_progress", "waiting", "pending", "requested"].includes(run.status ?? ""))
      return "handled";
    if (run.status === "completed" && run.conclusion !== null) return "retryable";
  } catch {
    return "uncertain";
  }
  return "uncertain";
}
async function handledHandoff(
  clients: TrustedClients,
  r: ReviewRequest,
  config: LiveConfig,
): Promise<HandoffObservation> {
  const p = configured(config);
  if (await completedPublication(clients, r, config)) return "handled";
  const checks = await listed(clients.read, r);
  for (const check of checks
    .filter(
      (c) =>
        c.name === p.checks.review && c.app?.id === p.appId && c.external_id === checkExternalId(r),
    )
    .sort((a, b) => b.id - a.id)) {
    const record = readCheckRecord(check.output.text);
    if (!identityMatches(record, r, config)) continue;
    const current = authenticateCheckRecord(
      (await clients.read.rest.checks.get({ ...parameters(r), check_run_id: check.id })).data,
      r,
      expected(config, "review", true),
    );
    const prefix = `https://github.com/${p.handoff.repository}/actions/runs/`;
    const url = current.record.owner_run_url;
    if (!url.startsWith(prefix) || !/^\d+\/attempts\/\d+$/.test(url.slice(prefix.length)))
      return "uncertain";
    return nativeRunState(clients, r, config, Number(url.slice(prefix.length).split("/")[0]));
  }
  for (const c of checks) {
    const kind = c.name === p.checks.code ? "code" : c.name === p.checks.text ? "text" : null;
    if (!kind || c.app?.id !== p.appId || c.external_id !== checkExternalId(r)) continue;
    const record = readCheckRecord(c.output.text);
    if (!identityMatches(record, r, config)) continue;
    const current = authenticateCheckRecord(
      (await clients.read.rest.checks.get({ ...parameters(r), check_run_id: c.id })).data,
      r,
      expected(config, kind, true),
    );
    if (current.record.handoff === "accepted" || current.record.handoff === "uncertain")
      return nativeRunState(clients, r, config);
  }
  return "none";
}
async function finishTrusted(
  context: HostedContext,
  config: LiveConfig,
  outcome: TrustedOperationInput["textOutcome"],
  clients: TrustedClients,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
) {
  if (!outcome) throw new Error("Text scanner outcome required");
  if (context.textCheckId === undefined) throw new Error("Owned text check required");
  let r = context.request;
  let code: Awaited<ReturnType<typeof codeEvidence>> = null;
  if (context.kind === "text") {
    const deadline = clock.now() + 30000,
      controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Metadata reread deadline exceeded")),
      30000,
    );
    try {
      code = await codeEvidence(clients, r, config, controller.signal);
      controller.signal.throwIfAborted();
      while (code?.check.status !== "completed" && clock.now() < deadline) {
        await clock.sleep(Math.min(1000, deadline - clock.now()));
        controller.signal.throwIfAborted();
        await currentPull(clients.read, r, controller.signal);
        code = await codeEvidence(clients, r, config, controller.signal);
        controller.signal.throwIfAborted();
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      code = null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (
      code?.check.status !== "completed" ||
      code.check.conclusion !== "success" ||
      code.record.phase !== "complete" ||
      !code.record.triage_check_id
    ) {
      await writeControl(
        clients,
        r,
        config,
        { ...recordFor(r, config, "text", "failed", context.textDigest), retryable: true },
        "action_required",
        context.textCheckId,
      );
      return { disposition: "failed", retryable: true };
    }
    r = { ...r, triageCheckId: code.record.triage_check_id };
    context.request = r;
  } else {
    code = await codeEvidence(clients, r, config);
    if (
      !code ||
      code.check.id !== context.codeCheckId ||
      code.record.phase !== "code_passed" ||
      code.record.owner_run_url !== configured(config).runUrl
    )
      throw new Error("Code invocation no longer owns passed work");
  }
  await exactTriage(clients, r, config);
  const currentDigest = pullTextDigest(await currentPull(clients.read, r));
  const textPass = outcome === "success" && currentDigest === context.textDigest;
  let handoff: NonNullable<CheckRecord["handoff"]> = "not_sent_text_failed";
  if (textPass) {
    const priorText = await ownCheck(clients, r, config, context.textCheckId, "text");
    if (priorText.record.text_digest !== context.textDigest)
      throw new Error("Scan context is not authenticated by its text check");
    await writeControl(
      clients,
      r,
      config,
      {
        ...recordFor(r, config, "text", "text_passed", context.textDigest),
        ...(priorText.record.handoff ? { handoff: priorText.record.handoff } : {}),
      },
      null,
      context.textCheckId,
    );
    const observation = await handledHandoff(clients, r, config);
    const deliberateRecovery =
      observation === "missing" &&
      (await assertInvocation(clients.runs, r, config, context.kind)) > 1;
    const ownIntent =
      priorText.record.handoff === "uncertain" ||
      (context.kind === "code" && code.record.handoff === "uncertain");
    if (observation === "handled") handoff = "accepted";
    else if (
      observation === "uncertain" ||
      (observation === "missing" && !deliberateRecovery) ||
      (observation !== "retryable" &&
        !deliberateRecovery &&
        code?.record.handoff === "uncertain") ||
      ownIntent
    )
      handoff = "uncertain";
    else {
      const intent = {
        ...recordFor(
          r,
          config,
          context.kind,
          context.kind === "code" ? "code_passed" : "text_passed",
          context.kind === "text" ? context.textDigest : undefined,
        ),
        handoff: "uncertain" as const,
      };
      await writeControl(
        clients,
        r,
        config,
        intent,
        null,
        context.kind === "code" ? context.codeCheckId : context.textCheckId,
      );
      if (pullTextDigest(await currentPull(clients.read, r)) !== context.textDigest)
        handoff = "not_sent_text_failed";
      else {
        const target = configured(config).handoff;
        const [owner = "", repo = ""] = target.repository.split("/");
        if (!clients.dispatch) throw new Error("Dispatch credential required");
        try {
          // The dedicated client is created with retries:0. Never retry this non-idempotent call.
          const response = await clients.dispatch.rest.actions.createWorkflowDispatch({
            owner,
            repo,
            workflow_id: target.workflow,
            ref: target.ref,
            inputs: {
              repo: r.repository,
              request_id: reviewRequestId(boundIdentity(r, target.ref)),
              pr: String(r.pr),
              sha: r.head,
              base_sha: r.base,
              triage_check_id: String(r.triageCheckId),
              workflow_ref: target.ref,
            },
          });
          handoff = response.status === 204 ? "accepted" : "uncertain";
        } catch (error) {
          const status = (error as { status?: number }).status;
          handoff = status !== undefined && status >= 400 && status < 500 ? "failed" : "uncertain";
        }
      }
    }
  }
  if (context.kind === "code")
    await writeControl(
      clients,
      r,
      config,
      { ...recordFor(r, config, "code", "complete"), handoff },
      "success",
      context.codeCheckId,
    );
  const unchanged = pullTextDigest(await currentPull(clients.read, r)) === context.textDigest;
  await writeControl(
    clients,
    r,
    config,
    {
      ...recordFor(
        r,
        config,
        "text",
        textPass && unchanged && handoff === "accepted" ? "complete" : "failed",
        context.textDigest,
      ),
      handoff,
      ...(textPass && unchanged && handoff === "accepted" ? {} : { retryable: true }),
    },
    textPass && unchanged && handoff === "accepted"
      ? "success"
      : outcome === "cancelled"
        ? "cancelled"
        : "action_required",
    context.textCheckId,
  );
  return { disposition: handoff, retryable: !(textPass && unchanged && handoff === "accepted") };
}

/** Replacement deliveries claim waiting work; only a completed publication is a no-op. */
export async function reviewAdmission(
  requestInput: unknown,
  configInput: unknown,
  clients: TrustedClients,
  expectedRequestId?: string,
) {
  const request = requestSchema.parse(requestInput),
    config = liveConfigSchema.parse(configInput),
    p = configured(config);
  const requestId = reviewRequestId(boundIdentity(request, p.handoff.ref));
  if (expectedRequestId !== undefined && expectedRequestId !== requestId)
    throw new Error("Dispatched request ID mismatch");
  await currentPull(clients.read, request);
  await exactTriage(clients, request, config);
  const completed =
    (await completedPublication(clients, request, config)) ??
    (await recoverNativePublication(clients, request, config));
  const identityOutput = {
    base_sha: request.base,
    head_sha: request.head,
    triage_check_id: request.triageCheckId,
    workflow_ref: p.handoff.ref,
    request_id: reviewRequestId(boundIdentity(request, p.handoff.ref)),
  };
  if (completed) return { disposition: "completed" as const, ...identityOutput, ...completed };
  const matching = (await listed(clients.read, request))
    .filter(
      (c) =>
        c.app?.id === p.appId &&
        c.name === p.checks.review &&
        c.external_id === checkExternalId(request),
    )
    .sort((a, b) => b.id - a.id);
  for (const candidate of matching) {
    const record = readCheckRecord(candidate.output.text);
    if (!identityMatches(record, request, config)) continue;
    const current = authenticateCheckRecord(
      (await clients.read.rest.checks.get({ ...parameters(request), check_run_id: candidate.id }))
        .data,
      request,
      expected(config, "review", true),
    );
    if (current.check.status === "completed") break;
    const next = recordFor(request, config, "review", "waiting");
    // Receiver concurrency has replaced the older run. Transfer this exact authenticated check,
    // so every old writer's GET fence observes the new owner before another write.
    await currentPull(clients.read, request);
    await assertInvocation(clients.runs, request, config, "review");
    const data = (
      await clients.write.rest.checks.update({
        ...parameters(request),
        check_run_id: current.check.id,
        details_url: p.runUrl,
        status: "in_progress",
        output: {
          title: "Margot: waiting for required checks",
          summary: "Replacement run owns this bound review.",
          text: checkMetadataText(next),
        },
      })
    ).data;
    const confirmed = authenticateCheckRecord(
      (
        await clients.read.rest.checks.get({
          ...parameters(request),
          check_run_id: current.check.id,
        })
      ).data,
      request,
      expected(config, "review", true),
    );
    if (
      data.id !== current.check.id ||
      confirmed.record.owner_run_url !== p.runUrl ||
      confirmed.record.phase !== "waiting" ||
      confirmed.check.status !== "in_progress"
    )
      throw new Error("Review claim not confirmed");
    await currentPull(clients.read, request);
    return {
      disposition: "admitted" as const,
      ...identityOutput,
      review_check_id: current.check.id,
    };
  }
  const review_check_id = await writeControl(
    clients,
    request,
    config,
    recordFor(request, config, "review", "waiting"),
    null,
  );
  return { disposition: "admitted" as const, ...identityOutput, review_check_id };
}
