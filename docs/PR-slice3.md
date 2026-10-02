<!-- pr-body:v1 -->
<!-- markdownlint-disable MD041 -->
## Intent

When an author fixes a PR, Margot reviews the delta and confirms her earlier
findings. This slice carries authenticated history, standing-card recall,
dismissals, severity rules and convergence counts into the TypeScript Margot.
Python remains the production reviewer. Nothing was pushed or posted.

## What changed

Added one convergence module and runtime-validated ledger records. Later rounds
read the newest trusted App ledger, compare reviewed heads, and give each card
its own standing and dismissed entries. A rebase or unreadable compare keeps the
ledger and falls back to complete full-PR evidence. Unknown or forged history
fails closed. MINOR becomes advisory after round one; missed findings block only
at BLOCKING, or MAJOR for safety. No rule relaxes after round three.

The report carries the counts and a bounded, compressed saved result. An exact-head
retry reuses that result without model calls after rechecking evidence,
configuration, required checks and the head. Python v1 prior-round ledgers remain
readable. The new v2 result supports deterministic retries without double-counting.

The real #9 proof exposed large-input limits. Prompts now travel over stdin, the
model reads the complete diff through a paged MCP tool, and Jev receives all
oversized evidence in conservative batches. Optional reference repositories are
explicitly configured at immutable SHAs; no arbitrary external reads are granted.
Cards and Margot's own prose remain in publish-skills. Estate workflows are untouched.

## Verification

204 named tests pass with no TODOs: 96 core, 49 adapter and 59 convergence cases.
Each has a failing break receipt. Thirteen additional implementation mutations
exercise the existing decision rules and the new history/severity/verification
guards. The seven retained recordings all run, including the second-round MINOR
fix case. Most isolated breaks are controlled service/input counterexamples;
the receipts do not claim exhaustive source mutation coverage.

Complete compressed live inputs and raw final model prose are retained as an
offline proof corpus outside the repository. Given that corpus's path,
`scripts/replay-slice3.mjs` reproduces both live sequences and identical retries,
then checks rebase fallback and refusal of forged or unreadable history. Package
installation, public import and the installed CLI are checked outside the source
tree, including an intentional CLI break.

Counts below are standing / fixed / new / late / unconfirmed. These are the
TypeScript sequence's own carried findings; every result remains held at HIGH.

| PR / round / exact head | Python | TypeScript |
| --- | --- | --- |
| #9 R1 `c16b59512640c7f8a0db57779a8e04e5ba4a2285` | CHANGES_REQUESTED / MEDIUM; 6/0/6/0/0 | CHANGES_REQUESTED / HIGH; 7/0/7/0/0 |
| #9 R2 `79787d37d4e03cebe533e46bd07a2ebc2392e77d` | APPROVED / MEDIUM; 0/6/0/0/3 | CHANGES_REQUESTED / HIGH; 1/4/0/0/3 |
| dotty #403 R1 `54b94b1799c02e9bd28251e7e9ce08aeeadbe773` | CHANGES_REQUESTED / HIGH; 9/0/9/0/0 | CHANGES_REQUESTED / HIGH; 7/0/7/0/0 |
| dotty #403 R2 `51e6692d62ffc35087e04fc09bc69f1895b49acc` | CHANGES_REQUESTED / HIGH; 2/7/2/0/1 | CHANGES_REQUESTED / HIGH; 2/5/2/0/2 |
| dotty #403 R3 `cd0a110f193af376577af6a7f92e79e0af3ffbfb` | APPROVED / HIGH; 0/2/0/0/2 | APPROVED / HIGH; 0/2/0/0/2 |

The #9 disagreement is a real defect still present at that historical head:
passing the full diff as one CLI argument exceeds the OS limit. It remains standing
while four other findings are fixed and two become MINOR advisories. Slice 3 fixes
that transport. Fresh routing, model judgments and use of today's edited PR bodies
explain the first-round count differences. Conservative batching and the voice's
judgment explain HIGH instead of Python's MEDIUM. Dotty round two fixes five entries,
leaves two minor advisories and raises two permission-startup defects; round three
fixes both. `docs/SLICE3.md` accounts for every difference.

A separate live sequence uses actual Python App-authored ledgers. It closes all
six #9 findings and both dotty round-three findings with counts identical to
Python; dotty round two raises four mandatory entries instead of two because
additional cards raise the permission defect and the contradictory current PR prose.

Total live use: five vault reads; 583 Jev HTTP requests (581 successful, two initial
size-limit rejections); 53 Claude invocation attempts, of which 47 returned model
responses and six failed at process startup. One model response was incomplete
before pinned reference evidence was supplied. Reported Claude spend: $19.3855266.
No secret was printed or written. GitHub reads were not separately metered.

## Risk and blast radius

This remains a read-only shadow package. Historical code heads are exact, but PR
bodies reflect current edits, so this is not identical-context model parity.
Historical required-check enforcement was explicitly disabled and the final probe
checks commit existence; production freshness/check rules remain independently
tested. The TypeScript chain supplies its local prior report as a would-be App
review; the separate migration run reads actual App reviews. No new App review
was posted. Rebase, late findings and hostile-history cases have recorded/test
proofs rather than live mutations. Cross-batch model reasoning is not formally
proved. Production adoption, publishing, canary and Python retirement remain later
work.

## Rollback

Keep main, or revert the local slice commits. No deployment or GitHub data needs
reversal.

## Ticket

None.

## Dependencies

Node 22+, the existing Octokit, Zod, parse-diff, MCP SDK and p-retry packages,
Claude Code 2.1.283, publish-skills at
`dc82ec72eea97ae6b0e161dd2ec909cb75033045`, Jev and caller-provided credentials.
No npm dependency was added. Reference repository access is optional and SHA-pinned.
