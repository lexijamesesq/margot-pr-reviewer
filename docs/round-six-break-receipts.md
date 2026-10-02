# Round six Python parity break receipts

Generated 2026-10-02T22:52:17.227Z, Node v26.3.1. Baseline and restored suite: 369/369 passed. Each of 21 isolated breaks ran the complete suite and failed exactly its named assertion.

Each case exercises production code with isolated evidence or transport counterexamples. Publication order is additionally covered by the publication harness (pub-clear and pub-hold). Python references and deliberate omissions are recorded in the PR package.

Most breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 04649b7cf9760e59f3a1699744cfb8159b4f298c1a105462f4f2e816138d0616. Reproduce: npm run test:round-six-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| Round six: dispatch | Replace functional dispatch with mechanical | 1 failed; 368 passed |
| Round six: triage-absent | Restore a trusted mechanical triage receipt | 1 failed; 368 passed |
| Round six: dispatch-absent | Replace invalid dispatch with mechanical | 1 failed; 368 passed |
| Round six: triage-wire | Remove the trusted App identity from the newer documentation check | 1 failed; 368 passed |
| Round six: diff-lines | Replace headers and context with two changed-content lines | 1 failed; 368 passed |
| Round six: older-ledger | Give the newer forged block the trusted App identity | 1 failed; 368 passed |
| Round six: progress | Move the publication head while phase updates still fail | 1 failed; 368 passed |
| Round six: prune | Shorten the ledger so no pruning or advisory retention is required | 1 failed; 368 passed |
| Round six: history | Mark the history complete, allowing a posted ledger and editorial shortcut | 1 failed; 368 passed |
| Round six: check-cap | Shorten check text below the truncation boundary | 1 failed; 368 passed |
| Round six: classify-outage | Replace the HTTP outage with a valid mechanical Jev answer | 1 failed; 368 passed |
| Round six: route-fallback | Use documentation routing, which never calls the fallback | 1 failed; 368 passed |
| Round six: doc-outage | Use functional routing, which calls the fallback | 1 failed; 368 passed |
| Round six: risk-fallback | Replace fallback provenance with Jev provenance on the risk response | 1 failed; 368 passed |
| Round six: total-outage | Use the documentation outage path, which proceeds without fallback | 1 failed; 368 passed |
| Round six: owned-tier | Replace every missing or invalid ownership tier with none | 1 failed; 368 passed |
| Round six: retry-1 | Move the prior round-one ledger to a different head | 1 failed; 368 passed |
| Round six: retry-3 | Move the prior round-three ledger to a different head | 1 failed; 368 passed |
| Round six: haiku-wire | Lower the fallback exposure score from two to zero | 1 failed; 368 passed |
| Round six: haiku-envelope | Replace the error envelope with a successful envelope | 1 failed; 368 passed |
| Round six: doc-outage-clearance | Change documentation to functional classification with fallback routing | 1 failed; 368 passed |
