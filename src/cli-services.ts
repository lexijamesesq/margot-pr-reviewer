import { liveServices } from "./adapters/live.js";

export function cliServices(
  config: Parameters<typeof liveServices>[0],
  environment: NodeJS.ProcessEnv,
  onResponse?: Parameters<typeof liveServices>[2],
) {
  const jevKey = environment.JEV_KEY;
  if (!jevKey) throw new Error("JEV_KEY is required");
  return liveServices(
    config,
    {
      jevKey,
      ...(environment.GH_TOKEN ? { githubToken: environment.GH_TOKEN } : {}),
      ...(environment.MARGOT_WRITE_TOKEN ? { writeToken: environment.MARGOT_WRITE_TOKEN } : {}),
      ...(environment.MARGOT_LINEAR_TOKEN ? { linearToken: environment.MARGOT_LINEAR_TOKEN } : {}),
    },
    onResponse,
  );
}
