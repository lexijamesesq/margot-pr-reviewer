import { scenarioBreaks } from "./scenario-breaks.mjs";

scenarioBreaks(
  "publication",
  "Publication and tally break receipts",
  "Publication uses the real Octokit client against a recorded HTTP transport. No live GitHub writes occur. The tally source mutation deliberately adds one to Closed; reconciliation must fail.",
);
