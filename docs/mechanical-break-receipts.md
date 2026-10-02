# Mechanical regression break receipts

2026-10-02T22:43:45.367Z, Node v26.3.1. Baseline and restored suite: 369/369 passed. Each mutation ran the complete suite and produced assertion failures in exactly the declared tests. No model or credential calls. Reproduce: npm run test:mechanical-breaks.

The two old prompt-rule breaks now also fail the independent full P1 wire contract. Their declarations retain that overlap explicitly. The new state break passes facts, including release notes, directly to classification again. The new wording break deletes the external-release exception from the production definition.

| Test | Source mutation | Result |
| --- | --- | --- |
| Jev classification sends the exact measured P1 questions | Delete the explicit workflow/config version-bump exception from the production definition | 1 failed; 368 passed |
| Jev classification keeps full code evidence and excludes author prose | Pass full PR facts, including release notes, to classification again | 1 failed; 368 passed |
| classification question tells Jev to judge human formatting by behavior | Remove the relevant classification rule from the question sent to Jev. | 2 failed; 367 passed |
| classification question tells Jev agent instructions are functional | Remove the relevant classification rule from the question sent to Jev. | 2 failed; 367 passed |
