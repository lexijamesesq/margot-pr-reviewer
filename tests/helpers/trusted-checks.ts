import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "octokit";
import { boundIdentity, readCheckRecord, reviewRequestId } from "../../src/check-identity.js";
import { liveConfigSchema, requestSchema } from "../../src/schemas.js";
import { type TrustedOperationInput, trustedChecks } from "../../src/trusted-checks.js";
export async function hostedFixture() {
  const envelope = JSON.parse(
    readFileSync(new URL("../fixtures/trusted-checks-envelope.json", import.meta.url), "utf8"),
  );
  const config = liveConfigSchema.parse(envelope.config),
    request = requestSchema.parse({
      ...envelope.request,
      phase: "triage",
      triageCheckId: undefined,
    });
  const directory = await mkdtemp(join(tmpdir(), "margot-hosted-"));
  const checks = new Map<number, Record<string, unknown>>([[101, envelope.triage]]);
  const reviews = new Map<number, Record<string, unknown>>();
  const pull = structuredClone(envelope.pull);
  let sequence = 200,
    dispatches = 0,
    now = 0;
  const writes: { id: number; body: Record<string, unknown> }[] = [];
  const state = {
    dispatchError: undefined as Error | undefined,
    loseNativeResponse: false,
    failPublishedWrite: false,
    failAfterTextPassed: false,
    hangCodeRead: false,
    abortedReads: 0,
    nativeSha: "c".repeat(40),
    nativeStatus: "queued",
    nativeConclusion: null as string | null,
    nativeActor: "margot[bot]",
    nativeVisible: true,
    attempt: 1,
    failTextCreate: false,
    onSleep: undefined as (() => Promise<void>) | undefined,
  };
  const native = (repo: string, id: number) => ({
    id,
    repository: { full_name: repo },
    run_attempt: state.attempt,
    status: repo === "example/project" ? "in_progress" : state.nativeStatus,
    conclusion: state.nativeConclusion,
    workflow_id: 12,
    event: "workflow_dispatch",
    head_branch: "v0.10.0",
    head_sha: state.nativeSha,
    display_title: `Margot example/project#7 ${reviewRequestId(boundIdentity({ ...request, triageCheckId: 101 }, "v0.10.0"))}`,
    actor: { login: state.nativeActor, type: "Bot" },
  });
  const checksApi = {
    get: async ({ check_run_id }: { check_run_id: number }) => {
      const c = checks.get(check_run_id);
      if (!c) throw new Error("missing check");
      return { data: structuredClone(c) };
    },
    create: async (body: Record<string, unknown>) => {
      if (state.failTextCreate && body.name === "trusted-scan / trusted-scan")
        throw new Error("text create failed");
      const id = ++sequence;
      const c = { conclusion: null, ...body, id, app: { id: 4862659, slug: "margot" } };
      checks.set(id, c);
      writes.push({ id, body });
      return { data: structuredClone(c) };
    },
    update: async (body: Record<string, unknown>) => {
      if (
        state.failPublishedWrite &&
        body.name === "review / margot" &&
        body.conclusion === "success"
      ) {
        state.failPublishedWrite = false;
        throw new Error("published check failed");
      }
      const id = body.check_run_id as number;
      const c = { ...checks.get(id), ...body };
      checks.set(id, c);
      writes.push({ id, body });
      if (
        state.failAfterTextPassed &&
        body.name === "trusted-scan / trusted-scan" &&
        readCheckRecord((body.output as { text: string }).text).phase === "text_passed"
      )
        throw new Error("interrupted after text write");
      return { data: structuredClone(c) };
    },
    listForRef: async () => ({ data: { check_runs: [...checks.values()] } }),
  };
  const pullsApi = {
    createReview: async (body: Record<string, unknown>) => {
      const id = 90 + reviews.size;
      const native = {
        id,
        commit_id: body.commit_id,
        state: body.event === "APPROVE" ? "APPROVED" : "COMMENTED",
        body: body.body,
        user: { login: "margot[bot]", type: "Bot" },
      };
      reviews.set(id, native);
      if (state.loseNativeResponse) throw new Error("lost native response");
      return { data: native };
    },
    get: async () => ({ data: structuredClone(pull) }),
    listReviews: async () => ({ data: [...reviews.values()] }),
    getReview: async ({ review_id }: { review_id: number }) => ({ data: reviews.get(review_id) }),
  };
  const client = {
    rest: {
      git: { getRef: async () => ({ data: { object: { type: "commit", sha: "c".repeat(40) } } }) },
      checks: checksApi,
      pulls: pullsApi,
      actions: {
        getWorkflow: async () => ({ data: { id: 12 } }),
        getWorkflowRun: async ({
          owner,
          repo,
          run_id,
        }: {
          owner: string;
          repo: string;
          run_id: number;
        }) => ({ data: native(`${owner}/${repo}`, run_id) }),
        listWorkflowRuns: async () => ({
          data: { workflow_runs: state.nativeVisible ? [native("example/margot", 10)] : [] },
        }),
        createWorkflowDispatch: async () => {
          dispatches++;
          if (state.dispatchError) throw state.dispatchError;
          return { status: 204 };
        },
      },
    },
    paginate: async (method: unknown, args?: { request?: { signal?: AbortSignal } }) => {
      if (state.hangCodeRead && args?.request?.signal) {
        const signal = args.request.signal;
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              state.abortedReads++;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      }
      return method === checksApi.listForRef ? [...checks.values()] : [...reviews.values()];
    },
  } as unknown as Octokit;
  const noActions = new Proxy(
    {},
    {
      get() {
        throw new Error("Target token cannot read private Actions");
      },
    },
  );
  const target = {
    ...client,
    rest: { ...client.rest, actions: noActions, git: noActions },
  } as Octokit;
  const clients = { read: target, write: target, dispatch: client, actions: client, runs: client };
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      await state.onSleep?.();
    },
  };
  const operate = (
    kind: "code" | "text",
    operation: TrustedOperationInput["operation"],
    extra: Partial<TrustedOperationInput> = {},
  ) =>
    trustedChecks(
      {
        kind,
        operation,
        request,
        config:
          kind === "code"
            ? config
            : {
                ...config,
                publisher: {
                  ...config.publisher,
                  runUrl: "https://github.com/example/project/actions/runs/2/attempts/1",
                },
              },
        contextFile: join(directory, `${kind}.json`),
        ...extra,
      },
      clients,
      clock,
    );
  const classify = { kind: "classified", request, triage_check_id: 101 };
  return {
    config,
    request,
    directory,
    checks,
    reviews,
    pull,
    state,
    writes,
    clients,
    clock,
    operate,
    classify,
    get dispatches() {
      return dispatches;
    },
    get elapsed() {
      return now;
    },
  };
}
