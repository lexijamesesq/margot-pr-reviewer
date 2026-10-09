import { createHash } from "node:crypto";
import type { z } from "zod";
import { ConfigurationError } from "../errors.js";
import { review } from "../review.js";
import { liveConfigSchema, requestSchema } from "../schemas.js";
import type { ReviewRequest, Services } from "../types.js";
import { resolveBundle } from "./bundle.js";
import { type ClaudeOptions, claudeAdapter } from "./claude.js";
import { githubAdapter, githubClient } from "./github.js";
import { jevAdapter } from "./jev.js";
import { githubPublisher } from "./publish.js";

export { liveConfigSchema } from "../schemas.js";
export type LiveConfig = z.infer<typeof liveConfigSchema>;
/** Shadow by default; explicit GitHub mode owns publication through run(). */
export function liveServices(
  configInput: LiveConfig,
  credentials: {
    jevKey: string;
    ownedPathTier?: unknown;
    githubToken?: string;
    writeToken?: string;
    actionsToken?: string;
    runToken?: string;
    ticketingEnvironment?: Record<string, string>;
  },
  onResponse?: ClaudeOptions["onResponse"],
  onJevRetry?: Parameters<typeof jevAdapter>[0]["onJevRetry"],
) {
  const config = liveConfigSchema.parse(configInput);
  let costUsd = 0;
  const authority = config.review.publication === "github";
  if (authority) {
    const missing = [
      ...(config.publisher ? [] : ["the `publisher` configuration"]),
      ...(credentials.writeToken ? [] : ["the MARGOT_WRITE_TOKEN environment variable"]),
      ...(config.handoff &&
      (!credentials.actionsToken || !credentials.runToken || !credentials.githubToken)
        ? ["MARGOT_ACTIONS_TOKEN, MARGOT_RUN_TOKEN and GH_TOKEN"]
        : []),
      ...(config.github.freshShadow ? ["`github.freshShadow` must be false"] : []),
      ...(config.github.shadowBeforeHead ? ["`github.shadowBeforeHead` must be false"] : []),
    ];
    if (missing.length)
      throw new ConfigurationError(
        `GitHub publication (review.publication "github") needs: ${missing.join("; ")}`,
      );
  }
  const publisher =
    authority && config.publisher
      ? githubPublisher(
          githubClient(credentials.writeToken ? { token: credentials.writeToken, retries: 0 } : {}),
          config.publisher,
          config.handoff
            ? {
                config,
                clients: {
                  read: githubClient({ token: credentials.githubToken ?? "", retries: 0 }),
                  write: githubClient({ token: credentials.writeToken ?? "", retries: 0 }),
                  actions: githubClient({ token: credentials.actionsToken ?? "", retries: 0 }),
                  runs: githubClient({ token: credentials.runToken ?? "", retries: 0 }),
                },
              }
            : undefined,
        )
      : undefined;
  const github = githubAdapter(
    githubClient({
      ...(config.github.gh ? { gh: config.github.gh } : {}),
      ...(credentials.githubToken ? { token: credentials.githubToken } : {}),
    }),
    {
      ...config.github,
      ...(config.publisher
        ? {
            triageAppId: config.publisher.appId,
            triageCheckName: config.publisher.checks.triage,
          }
        : {}),
      ownedPathTier: credentials.ownedPathTier,
    },
  );
  const provenanceConfig = structuredClone(config);
  // A workflow invocation owns checks, but does not change the review policy.
  if (provenanceConfig.publisher) provenanceConfig.publisher.runUrl = "";
  const actions: unknown[] = [];
  const services: Services = {
    provenance: `live:${authority ? "github" : "shadow"}:${createHash("sha256").update(JSON.stringify(provenanceConfig)).digest("hex")}`,
    ...github,
    ...jevAdapter({
      key: credentials.jevKey,
      model: config.jev.model,
      ...(config.jev.url ? { url: config.jev.url } : {}),
      fallbackClaude: config.claude,
      ...(onJevRetry ? { onJevRetry } : {}),
    }),
    ...claudeAdapter({
      ...config.claude,
      ...(config.publisher
        ? {
            ownChecks: Object.values(config.publisher.checks).filter(
              (name): name is string => name !== undefined,
            ),
          }
        : {}),
      ...(credentials.githubToken ? { githubToken: credentials.githubToken } : {}),
      ...(credentials.ticketingEnvironment
        ? { ticketingEnvironment: credentials.ticketingEnvironment }
        : {}),
      onResponse(response) {
        costUsd += response.cost;
        onResponse?.(response);
      },
    }),
    reviewMetadata: () => ({
      costUsd,
      ...(config.publisher?.runUrl ? { runUrl: config.publisher.runUrl } : {}),
    }),
    bundle: (commit, context) => resolveBundle(config.claude.pluginDirectory, commit, context),
    async disableAutoMerge(request) {
      actions.push({ action: "would-disable-auto-merge", request });
      return true;
    },
    async publish(input, context) {
      requestSchema.parse(input.review.request);
      if ((await github.head(input.review.request, context)) !== input.expectedHead)
        throw new Error("Head moved before recording");
      actions.push({ action: "would-publish", ...input });
      return { recorded: true, head: input.expectedHead, id: `shadow-${actions.length}` };
    },
  };
  if (publisher) {
    services.publish = publisher.publish;
    services.disableAutoMerge = publisher.disableAutoMerge;
    services.progress = publisher.progress;
  }
  return {
    services,
    actions,
    run: (request: ReviewRequest) => {
      const evaluate = () =>
        review(
          request,
          {
            ...config.review,
            ...(config.publisher
              ? {
                  trustedTriageAppId: config.publisher.appId,
                  trustedTriageCheckName: config.publisher.checks.triage,
                  trustedCodeCheckName: config.publisher.checks.code,
                  trustedTextCheckName: config.publisher.checks.text,
                  trustedWorkflowRef: config.handoff?.ref,
                  ownCheckNames: [config.publisher.checks.review, config.publisher.checks.triage],
                }
              : {}),
          },
          services,
        );
      return publisher ? publisher.run(request, evaluate) : evaluate();
    },
  };
}
