import { scenarioBreaks } from "./scenario-breaks.mjs";

scenarioBreaks(
  "closer",
  "Stranded-check closer break receipts",
  "The closer cases use Octokit against a recorded GitHub transport. They cover the no-op decision, ordered commit and shared-head guards, both check names, open-state and run-ownership guards, all conclusions and titles, and fail-safe read/write errors.",
  { breakEnvironment: "MARGOT_CLOSER_BREAK" },
);
