# Publication and tally break receipts

Generated 2026-10-01T23:34:14.712Z, Node v26.3.1. Baseline and restored suite: 292/292 passed. Each of 36 isolated breaks ran the complete suite and failed exactly its named assertion.

Publication uses the real Octokit client against a recorded HTTP transport. No live GitHub writes occur. The tally source mutation deliberately adds one to Closed; reconciliation must fail.

Most breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 840c8182b240ff439f92b08a58f6b55f7bd3d0290efc3fb4cef41b8c57e08cc3. Reproduce: npm run test:publication-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| Clearance confirms all checks before the SHA-bound approval | Replace the completed review check with an in-progress readback | 1 failed; 291 passed |
| Held review disarms auto-merge and comments with neutral checks | Remove the hold | 1 failed; 291 passed |
| The verdict check's text carries the lines Ollie parses to request the operator on a hold | Post the verdict check without its text | 1 failed; 291 passed |
| A held title names the reason the PR is held, not the band | Title every hold with the band | 1 failed; 291 passed |
| A failure after the verdict check overwrites its text so Ollie never reads a stale approval | Leave the verdict text in place on error | 1 failed; 291 passed |
| Authority hold remains neutral on the self-instrument check | Remove the authority hold | 1 failed; 291 passed |
| Calibration cannot satisfy the review check | Remove calibration hold | 1 failed; 291 passed |
| Triage exposes the estate classification JSON without approving | Change classification to functional | 1 failed; 291 passed |
| Closed PR cannot receive a publication | Reopen the PR | 1 failed; 291 passed |
| Fork PR cannot receive a publication | Restore same-repository head | 1 failed; 291 passed |
| Draft PR cannot receive a publication | Mark ready for review | 1 failed; 291 passed |
| Base movement cannot receive a publication | Restore requested base | 1 failed; 291 passed |
| Head movement before approval fails closed | Remove the final head recheck immediately before publication | 1 failed; 291 passed |
| Failure to create the pending gate stops evaluation | Allow the initial check write | 1 failed; 291 passed |
| Failed native review never completes a success check | Allow review write | 1 failed; 291 passed |
| A failed final check cannot leave an approving review | Allow the final check write | 1 failed; 291 passed |
| Unconfirmed auto-merge disable cannot publish a held verdict | Stop counting an unconfirmed cleanup disarm as a cleanup failure | 1 failed; 291 passed |
| Evaluation error withdraws earlier approval and closes the gate | Return the clean review | 1 failed; 291 passed |
| A wrong-App check receipt cannot approve | Return the configured App identity | 1 failed; 291 passed |
| A mismatched native review receipt is compensated | Remove cleanup of an approval whose response is not yet list-visible | 1 failed; 291 passed |
| A prior same-head approval is withdrawn before evaluating again | Remove prior approval | 1 failed; 291 passed |
| Shadow services record publication without any write credential | Select none instead of recorded publication | 1 failed; 291 passed |
| New Open Closed reconcile with every listed finding including dismissals and advisories | Increment the displayed Closed tally | 1 failed; 291 passed |
| Closed entries and late attribution survive later rounds | Discard an earlier closed entry | 1 failed; 291 passed |
| The caller pending check is adopted without a stranded duplicate | Remove the dispatched check from the recorded target | 1 failed; 291 passed |
| A same-head retry opens a new check instead of reopening the completed one | Reopen the completed check | 1 failed; 291 passed |
| A superseded run cannot close the newer run check or approve | Keep the original check ownership | 1 failed; 291 passed |
| Only explicitly configured skipped jobs satisfy required checks | Remove the skipped job from caller permission | 1 failed; 291 passed |
| An open advisory is recalled and can be closed with fix evidence | Omit the confirmed advisory resolution | 1 failed; 291 passed |
| A new workflow run keeps same-head review compatibility but a policy change does not | Change the App identity along with the operational run URL | 1 failed; 291 passed |
| The posted ledger is readable by unchanged Python and retains the exact TypeScript receipt | Replace the terminal legacy marker with an incompatible compressed marker | 1 failed; 291 passed |
| Recalling a late advisory cannot silently turn it into a blocker | Change its earlier fate from advisory to standing | 1 failed; 291 passed |
| An in-progress review check readback prevents approval | Remove the completed review check confirmation | 1 failed; 291 passed |
| Head movement after approval still dismisses approval and disarms auto-merge | Restore the admission guard before dismissing approvals | 1 failed; 291 passed |
| A confirmed approval followed by auto-merge succeeds | Require the PR to remain open after the confirmed approval | 1 failed; 291 passed |
| Cleanup diagnostics identify every failed operation and its cause | Discard cleanup labels and error messages | 1 failed; 291 passed |
