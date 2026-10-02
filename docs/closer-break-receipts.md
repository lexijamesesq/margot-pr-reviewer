# Stranded-check closer break receipts

Generated 2026-10-02T18:20:43.293Z, Node v26.3.1. Baseline and restored suite: 332/332 passed. Each of 22 isolated breaks ran the complete suite and failed exactly its named assertion.

The closer cases use Octokit against a recorded GitHub transport. They cover the no-op decision, ordered commit and shared-head guards, both check names, open-state and run-ownership guards, all conclusions and titles, and fail-safe read/write errors.

Most breaks are controlled service/input counterexamples selected by MARGOT_CLOSER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 5213b1fea5c863d27880f78a7dc68b7a89c53aed7536f34b497b03ed6077983c. Reproduce: npm run test:closer-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| An unselected package with successful jobs has nothing to close | Claim that the unselected package failed to publish | 1 failed; 331 passed |
| A published package has nothing to close | Replace the publication receipt with a failure | 1 failed; 331 passed |
| An unreadable commit-to-PR binding touches nothing | Restore the commit-to-PR response | 1 failed; 331 passed |
| A SHA outside the requested PR is left alone | Bind the SHA to the requested PR | 1 failed; 331 passed |
| A stale claim cannot close the requested PR's still-live head | Move the requested PR head so the stale close is allowed | 1 failed; 331 passed |
| A SHA that is another open PR's live head is left to that review | Remove the other open PR | 1 failed; 331 passed |
| The open review slash margot check closes without passing | Change the recorded conclusion to success | 1 failed; 331 passed |
| The pre-rename margot check is the fallback | Return the renamed check first | 1 failed; 331 passed |
| An unreadable check list touches nothing | Restore the check-list response | 1 failed; 331 passed |
| Completed checks are left alone | Return an open check | 1 failed; 331 passed |
| A check adopted by another run is left to that run | Return this run's ownership URL | 1 failed; 331 passed |
| A caller check with no run owner can be closed | Discard the recorded close write | 1 failed; 331 passed |
| A superseded head closes skipped with the hosted wording | Replace the superseded title | 1 failed; 331 passed |
| A cancelled route closes cancelled | Replace cancellation with failure | 1 failed; 331 passed |
| The first stopped job determines a non-stale conclusion | Hide the failed route behind the later cancelled review | 1 failed; 331 passed |
| A cancelled review closes cancelled | Replace cancellation with failure | 1 failed; 331 passed |
| A failed review names the stopped job | Replace the stopped-job title | 1 failed; 331 passed |
| A selected package that did not publish is closed | Claim the package published | 1 failed; 331 passed |
| A cancelled package stop closes cancelled | Replace the cancellation stop reason | 1 failed; 331 passed |
| A floor stop uses the preflight title | Remove the floor stop reason | 1 failed; 331 passed |
| Other failures say Margot stopped before a verdict | Replace the stopped title with the floor title | 1 failed; 331 passed |
| A failed close is an error rather than a false receipt | Restore the check write | 1 failed; 331 passed |
