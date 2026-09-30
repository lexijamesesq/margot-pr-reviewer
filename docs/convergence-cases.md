# Retained convergence cases

The seven original captures still run. `prior-ledger` now executes the retained
second round instead of proving an unsupported-history refusal. Its normalized
previous MINOR entries come from the captured first round; the public fixture
labels reconstructed identities. No case is marked TODO.

| Python behavior/case | Executable TypeScript proof |
| --- | --- |
| Ledger selection at round three | Newest submitted ledger wins; live dotty round three |
| Same-head round-one and later retries | Ten live-result replay retries; no model calls or new keys |
| Compare identical | Identical trees preserve ledger with empty delta |
| Compare unreadable / rebase | Full-scope fallback tests and real-input perturbations in replay-slice3 |
| Reviews unreadable / second page unreadable | Both failures stop approval; old Python fresh-approval recovery is deliberately rejected |
| Paginated reviews / capped compare files | Page-two ledger selection and 301-file unified-diff inventory |
| Forged review author / planted marker | Author and revision authentication; terminal-marker validation; escaped model prose |
| Standing-card recall | Mechanical and editorial recall tests; isolated per-card history; live later rounds |
| Silent MAJOR / silent MINOR | Synthesized verification for serious findings; fixed count for silent MINOR |
| Dismissal carry-forward | Retained reason, explicit delta reopening, old fixes pruned, dismissals preserved |
| Stable keys / conflicting rulings | Round-qualified keys; a standing ruling wins over a dismissal on the same key |
| Round-two MINOR / late / safety / delta-reach | Separate severity tests, each with its own failing break |
| No escalation after three | Round-four MAJOR remains mandatory |
| Counts and hidden ledger rendering | Live counts, exact result replay, schema validation and model-marker isolation |
| Ledger budget | Fail closed without forgetting standing or dismissed entries; compressed saved-result round trip |
| Existing failure, classification, risk and publication cases | All 96 core and 49 adapter cases retained |

The TypeScript implementation intentionally does not preserve Python's fallback
from unreadable history to a fresh approval, same-head model reruns, accepting
unknown ledger keys, or dropping dismissals to satisfy a byte budget. It also
requires new delta findings to declare their scope. These changes are disclosed
in the slice hand-over; they are stricter failure behavior, not postponed cases.

The suite does not copy Python's subprocess transcripts, prompt-byte assertions,
exception names or estate identities. `tests/ledger-scenarios.json` and the two
other scenario manifests name each protected behavior and its break. Generated
receipts record actual failures; `docs/live/slice3-replay.json` records the
real-input convergence proofs.
