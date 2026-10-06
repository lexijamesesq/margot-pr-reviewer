import type { z } from "zod";
import type { liveConfigSchema } from "../schemas.js";

/** Where the container sees the read-only base checkout, the bundle, and its private MCP config. */
export const inContainer = {
  work: "/work",
  bundle: "/opt/margot/bundle",
  mcp: "/run/margot/mcp.json",
};
/** The docker client's environment: how to reach the daemon, and the values `-e NAME` hands in. */
export function dockerEnvironment(source: NodeJS.ProcessEnv, handed: Record<string, string>) {
  return {
    ...Object.fromEntries(
      [
        "PATH",
        "HOME",
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
        "DOCKER_CONFIG",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
      ].flatMap((key) => (source[key] ? [[key, source[key]]] : [])),
    ),
    ...handed,
  };
}
/**
 * The previous reviewer's container: read-only root, no capabilities, bounded, with only the
 * base checkout and the card bundle mounted, both read-only. Credentials go in by name only.
 */
export function containerArgv(
  container: z.infer<typeof liveConfigSchema>["claude"]["container"],
  pluginDirectory: string,
) {
  return [
    "run",
    "--rm",
    "-i",
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--memory=3g",
    "--memory-swap=3g",
    "--pids-limit=512",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=bind,source=${container.work},target=${inContainer.work},readonly`,
    "--mount",
    `type=bind,source=${pluginDirectory},target=${inContainer.bundle},readonly`,
    "--tmpfs",
    "/run/margot:rw,mode=1777,size=1g",
    "--tmpfs",
    "/tmp:rw,mode=1777,size=256m",
    ...["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GH_TOKEN", "MARGOT_MCP_CONFIG"].flatMap(
      (name) => ["-e", name],
    ),
    container.image,
  ];
}
