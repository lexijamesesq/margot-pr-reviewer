import { liveServices } from "./adapters/live.js";

export function configuredTicketingEnvironment(
  ticketing: Parameters<typeof liveServices>[0]["claude"]["ticketing"],
  environment: NodeJS.ProcessEnv,
) {
  return Object.fromEntries(
    (ticketing?.env ?? []).flatMap((name) => {
      const value = environment[name];
      return value ? [[name, value]] : [];
    }),
  );
}

export function cliServices(
  config: Parameters<typeof liveServices>[0],
  environment: NodeJS.ProcessEnv,
  onResponse?: Parameters<typeof liveServices>[2],
) {
  const ticketingEnvironment = configuredTicketingEnvironment(config.claude.ticketing, environment);
  return liveServices(
    config,
    {
      jevKey: environment.JEV_KEY ?? "",
      ownedPathTier: environment.MARGOT_OWNED_TIER?.trim() || "unknown",
      ...(environment.GH_TOKEN ? { githubToken: environment.GH_TOKEN } : {}),
      ...(environment.MARGOT_WRITE_TOKEN ? { writeToken: environment.MARGOT_WRITE_TOKEN } : {}),
      ...(Object.keys(ticketingEnvironment).length ? { ticketingEnvironment } : {}),
    },
    onResponse,
  );
}
