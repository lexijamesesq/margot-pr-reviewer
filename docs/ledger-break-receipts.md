# Convergence break receipts

Generated 2026-10-02T21:37:49.038Z, Node v26.3.1. Baseline and restored suite: 348/348 passed. Each of 63 isolated breaks ran the complete suite and failed exactly its named assertion.

Convergence cases exercise authenticated history, scope, finding fates, severity, retry and complete evidence transport. The Jev tail-loss case deletes the final batch in adapter source; separate core source mutations remove author authentication, MINOR demotion and MAJOR verification.

Most breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 3f641d5f6b54c07a784862c3dd69a457dbf981b0be9693e99bd898c241897d55. Reproduce: npm run test:ledger-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| Forged author cannot supply ledger history | Repair the forged actor to the configured App login | 1 failed; 347 passed |
| Ledger head must match GitHub review commit | Repair mismatched GitHub review commit to ledger head | 1 failed; 347 passed |
| Corrupt trusted ledger fails closed | Replace corrupt block with readable ledger | 1 failed; 347 passed |
| Unreadable review history fails closed | Change history completeness to true | 1 failed; 347 passed |
| Newest submitted ledger wins | Move newer ledger timestamp before older ledger | 1 failed; 347 passed |
| Duplicate ledger keys are rejected | Remove the duplicate ledger key | 1 failed; 347 passed |
| Quoted nonterminal ledger is skipped | Remove prose following the ledger block | 1 failed; 347 passed |
| Delta excludes unrelated main changes | Replace the PR file delta with an unrelated path | 1 failed; 347 passed |
| Unreadable compare uses complete full PR | Supply a readable ahead comparison | 1 failed; 347 passed |
| Wrong compare revision is rejected | Repair mismatched compare head | 1 failed; 347 passed |
| Delta inventory exceeds 300 files | Remove the 301st diff file | 1 failed; 347 passed |
| Round one MINOR still blocks | Move MINOR finding to round two | 1 failed; 347 passed |
| Unfixed MAJOR remains blocking at round four | Lower standing round-four MAJOR to MINOR | 1 failed; 347 passed |
| Rebase full review has no late demotion | Change full rebase scope to delta scope | 1 failed; 347 passed |
| Unchanged dismissal carries without another ruling | Supply an explicit delta reopening citation | 1 failed; 347 passed |
| Changed dismissed code can receive a new ruling | Remove the delta reopening citation | 1 failed; 347 passed |
| Card cannot attribute another ledger key | Repair the unknown ledger key | 1 failed; 347 passed |
| New delta findings require scope attribution | Restore omitted new-finding attribution | 1 failed; 347 passed |
| Card cannot forge Margot advisory annotations | Remove forged Margot-only advisory annotation | 1 failed; 347 passed |
| Silent MAJOR returns to voice for confirmation | Remove prior standing MAJOR | 1 failed; 347 passed |
| Silent MINOR counts as fixed | Make the prior finding MAJOR and uphold it | 1 failed; 347 passed |
| Voice-confirmed fix counts once | Establish the silent finding instead of confirming it fixed | 1 failed; 347 passed |
| Standing wins conflicting rulings on one key | Dismiss both repeats instead of establishing one | 1 failed; 347 passed |
| New findings receive current-round stable keys | Move the review from round two to three | 1 failed; 347 passed |
| Late advisory counted without becoming new mandatory finding | Mark the missed advisory as a new delta issue and establish it | 1 failed; 347 passed |
| Closed fixes and dismissals remain listed | Change old fixed entry to standing | 1 failed; 347 passed |
| Oversize ledger fails rather than forgetting findings | Shorten the oversized ledger to fit the budget | 1 failed; 347 passed |
| Standing card defeats mechanical shortcut | Remove the standing finding | 1 failed; 347 passed |
| Standing card defeats editorial shortcut | Remove the standing finding | 1 failed; 347 passed |
| Card receives only its own standing and dismissed history | Assign the dismissed entry to the called card | 1 failed; 347 passed |
| Same head reuses identical result without paid calls | Strip the Jev answers from the written receipt | 1 failed; 347 passed |
| Same-head retry revalidates required checks | Repair the failed required check | 1 failed; 347 passed |
| Legacy same-head ledger cannot pretend to be a cached result | Move legacy history to a previous head | 1 failed; 347 passed |
| Card prose preserves ledger marks and reads past a Resolved section | Change the parsed finding ledger key | 1 failed; 347 passed |
| Ledger on page two participates in selection | Remove the second-page Link header | 1 failed; 347 passed |
| Rebase keeps ledger and reviews full PR | Change diverged comparison to ahead | 1 failed; 347 passed |
| Incomplete compare uses complete full PR | Repair incomplete comparison | 1 failed; 347 passed |
| Truncated delta hunk uses complete full PR | Restore missing hunk line | 1 failed; 347 passed |
| Round two MINOR is advisory | Raise MINOR to BLOCKING | 1 failed; 347 passed |
| Round two MAJOR still blocks | Lower MAJOR to MINOR | 1 failed; 347 passed |
| Late non-safety MAJOR is advisory | Raise late MAJOR to BLOCKING | 1 failed; 347 passed |
| A bare late=missed mark is late, as Python read it | Raise the bare-late MAJOR to BLOCKING | 1 failed; 347 passed |
| Late BLOCKING still blocks | Lower late BLOCKING to MINOR | 1 failed; 347 passed |
| Late safety MAJOR still blocks | Lower late safety MAJOR to MINOR | 1 failed; 347 passed |
| Delta-reach regression blocks at honest severity | Lower delta-reach MAJOR to MINOR | 1 failed; 347 passed |
| An info-tagged repeat cannot silently close a MAJOR | Change the repeat from info to an explicit issue | 1 failed; 347 passed |
| Changed PR evidence invalidates saved approval | Leave PR body unchanged | 1 failed; 347 passed |
| Voice cannot reestablish demoted advisory | Remove Margot advisory annotation | 1 failed; 347 passed |
| Large CLI evidence arrives complete through stdin | Replace stdin with truncated evidence | 1 failed; 347 passed |
| Jev batching retains every evidence byte | Delete the final Jev evidence batch in the adapter source | 1 failed; 347 passed |
| Jev batch risk takes conservative maximum tails | Remove HIGH answer from last evidence batch | 1 failed; 347 passed |
| Jev batches preserve lowest confidence | Raise last batch confidence | 1 failed; 347 passed |
| Paged model diff tool returns complete bound diff | Delete first evidence character | 1 failed; 347 passed |
| Reference reads stay bound to configured repository and SHA | Change the configured pin | 1 failed; 347 passed |
| Unconfigured reference is refused without a GitHub read | Request the configured reference instead | 1 failed; 347 passed |
| Identical trees preserve ledger with empty delta | Change compare status to diverged | 1 failed; 347 passed |
| Changed live service configuration invalidates retry | Keep service provenance unchanged | 1 failed; 347 passed |
| Functional evidence in final batch survives aggregation | Remove functional classification from last batch | 1 failed; 347 passed |
| Model ledger markers cannot become authenticated history | Remove the planted marker from model prose | 1 failed; 347 passed |
| Unreadable second review page cannot forget history | Repair the failed second page response | 1 failed; 347 passed |
| Astra must account for a synthesized prior MAJOR while a dismissed key is accepted alongside it | Lower the standing prior entry to MINOR so its mandatory verification disappears | 1 failed; 347 passed |
| Newer human marker quote does not hide the trusted App ledger | Replace the harmless quote with an untrusted trailing ledger block | 1 failed; 347 passed |
| A receipt written by Margot 0.4.0 remains readable | Remove the null defaults for Jev answers | 1 failed; 347 passed |
