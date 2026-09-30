import { createHash } from "node:crypto";
import type { z } from "zod";
import { liveConfigSchema, requestSchema } from "../schemas.js";
import type { Services } from "../types.js";
import { resolveBundle } from "./bundle.js";
import { type ClaudeOptions, claudeAdapter } from "./claude.js";
import { githubAdapter, githubClient } from "./github.js";
import { jevAdapter } from "./jev.js";

export { liveConfigSchema } from "../schemas.js";
export type LiveConfig = z.infer<typeof liveConfigSchema>;
/** Live reads and model calls; every would-be GitHub mutation stays in memory. */
export function liveServices(
  configInput: LiveConfig,
  credentials: { jevKey: string; githubToken?: string },
  onResponse?: ClaudeOptions["onResponse"],
) {
  const config = liveConfigSchema.parse(configInput);
  const github = githubAdapter(
    githubClient({
      ...(config.github.gh ? { gh: config.github.gh } : {}),
      ...(credentials.githubToken ? { token: credentials.githubToken } : {}),
    }),
    config.github,
  );
  const actions: unknown[] = [];
  const services: Services = {
    provenance: `live-read-only/shadow:${createHash("sha256").update(JSON.stringify(config)).digest("hex")}`,
    ...github,
    ...jevAdapter({ key: credentials.jevKey, model: config.jev.model }),
    ...claudeAdapter({
      ...config.claude,
      ...(config.github.gh ? { gh: config.github.gh } : {}),
      ...(credentials.githubToken ? { githubToken: credentials.githubToken } : {}),
      ...(onResponse ? { onResponse } : {}),
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
  return { services, actions };
}
