# Publication and tally break receipts

Generated 2026-09-30T19:44:01.981Z, Node v26.3.1. Baseline and restored suite: 237/237 passed. Each of 28 isolated breaks ran the complete suite and failed exactly its named assertion.

Publication uses the real Octokit client against a recorded HTTP transport. No live GitHub writes occur. The tally source mutation deliberately adds one to Closed; reconciliation must fail.

Most breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: d178761d59389fc56f276334dc793c6fd5f8fcb281e0128e43263e85e0e72b93. Reproduce: npm run test:publication-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| Clearance writes an SHA-bound approval before the final success | Change the result to a held decision | 1 failed; 236 passed |
| Held review disarms auto-merge and comments with neutral checks | Remove the hold | 1 failed; 236 passed |
| Authority hold remains neutral on the self-instrument check | Remove the authority hold | 1 failed; 236 passed |
| Calibration cannot satisfy the review check | Remove calibration hold | 1 failed; 236 passed |
| Triage exposes the estate classification JSON without approving | Change classification to functional | 1 failed; 236 passed |
| Closed PR cannot receive a publication | Reopen the PR | 1 failed; 236 passed |
| Fork PR cannot receive a publication | Restore same-repository head | 1 failed; 236 passed |
| Draft PR cannot receive a publication | Mark ready for review | 1 failed; 236 passed |
| Base movement cannot receive a publication | Restore requested base | 1 failed; 236 passed |
| Head movement before approval fails closed | Stop moving the head | 1 failed; 236 passed |
| Failure to create the pending gate stops evaluation | Allow the initial check write | 1 failed; 236 passed |
| Failed native review never completes a success check | Allow review write | 1 failed; 236 passed |
| Failed final check dismisses the posted approval | Allow the final check write | 1 failed; 236 passed |
| Unconfirmed auto-merge disable cannot publish a held verdict | Confirm the disable | 1 failed; 236 passed |
| Evaluation error withdraws earlier approval and closes the gate | Return the clean review | 1 failed; 236 passed |
| A wrong-App check receipt cannot approve | Return the configured App identity | 1 failed; 236 passed |
| A mismatched native review receipt is compensated | Return the requested commit | 1 failed; 236 passed |
| A prior same-head approval is withdrawn before evaluating again | Remove prior approval | 1 failed; 236 passed |
| Shadow services record publication without any write credential | Select none instead of recorded publication | 1 failed; 236 passed |
| New Open Closed reconcile with every listed finding including dismissals and advisories | Increment the displayed Closed tally | 1 failed; 236 passed |
| Closed entries and late attribution survive later rounds | Discard an earlier closed entry | 1 failed; 236 passed |
| The caller pending check is adopted without a stranded duplicate | Remove the dispatched check from the recorded target | 1 failed; 236 passed |
| A superseded run cannot close the newer run check or approve | Keep the original check ownership | 1 failed; 236 passed |
| Only explicitly configured skipped jobs satisfy required checks | Remove the skipped job from caller permission | 1 failed; 236 passed |
| An open advisory is recalled and can be closed with fix evidence | Omit the confirmed advisory resolution | 1 failed; 236 passed |
| A new workflow run keeps same-head review compatibility but a policy change does not | Change the App identity along with the operational run URL | 1 failed; 236 passed |
| The posted ledger is readable by unchanged Python and retains the exact TypeScript receipt | Replace the terminal legacy marker with an incompatible compressed marker | 1 failed; 236 passed |
| Recalling a late advisory cannot silently turn it into a blocker | Change its earlier fate from advisory to standing | 1 failed; 236 passed |
