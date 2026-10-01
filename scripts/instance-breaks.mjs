import { scenarioBreaks } from "./scenario-breaks.mjs";

scenarioBreaks(
  "instance-command",
  "Instance command break receipts",
  "Instance command cases exercise exact release references, enrolment, authority selection, GitHub outputs, request admission, trusted policy binding, CLI flag mapping, and bound-file writes.",
  { breakEnvironment: "MARGOT_INSTANCE_BREAK" },
);
