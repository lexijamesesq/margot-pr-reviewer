# Slice 4 verification

Verified engine branch head is recorded in the workspace hand-over. Verification
documents are excluded from the npm package. Nothing was pushed, posted,
dispatched or published. All GitHub publication tests use recorded HTTP targets.

## Clean clone and installed package

A new local clone without shared Git objects installed on Node 22.23.3 and ran:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run audit:recordings
npm pack --json
node scripts/package-smoke.mjs ./margot-pr-reviewer-0.4.0.tgz
```

All commands passed. Four suites, 239 named tests: 96 core, 55 adapter, 60 ledger,
28 publication/tally. npm reported zero vulnerabilities; seven bundled recordings
passed the identity/credential/host/path audit. The tarball is 55,067 bytes,
238,353 bytes unpacked. SHA-256:

```text
486b8a72863eb3b483676a5b29910d3a4b04a9e4f88b270244cc211bb64d0f81
```

An empty external consumer installed that tarball and imported the public API.
A recorded approval changed to CHANGES_REQUESTED when a mandatory finding was
introduced. The installed CLI executed argument validation. Replacing the CLI
with an empty executable failed its assertion; restoration passed. See
`package-smoke-receipt.md`. The pinned Claude Code 2.1.283 also installed and
returned its version after its targeted platform rebuild. That local host proof
does not establish ARM64 Linux installation on the Pi.

## Every new test has a break receipt

There are 31 new Vitest tests: 28 publication/tally and three adapter cases.
`publication-break-receipts.md` records all 28 isolated breaks against the final
239-test suite: exactly one named assertion failed for each, 238 passed, then
239 passed after restoration. Four publisher source removals cover approval-last
ordering, failed-disarm accounting, the final head recheck and partial-approval
cleanup. A fifth source mutation adds one to displayed Closed; the reconciliation
test detects the deliberate miscount. The remaining 23 breaks are controlled
service/input counterexamples covering hold/disarm, write failures, malformed
receipts, admission, check adoption, ownership and no-write shadows.

`adapter-break-receipts.md` records 53 isolated breaks at the 234-test stage,
including all three new adapter tests: shadow history selection, refusal to
publish with that selection, and credential filtering during the CLI version
probe. Each failed exactly one assertion with 233 passing; the restored suite
passed. `ledger-break-receipts.md` records 60 isolated breaks at the 231-test
stage, including retained closed findings. Each failed one with 230 passing.
These are declared input/service counterexamples and selected source mutations,
not a claim of exhaustive mutation coverage or an independent review.

## Recorded convergence and real shadows

The uncommitted slice-three corpus replayed ten cases through the final package:
same decisions, reconciled new tallies, and ten identical same-head retries with
no model calls. Sanitized metadata: `live/slice4-replay.json`.
Five completed live shadow results replay unchanged through the final build;
the sixth observation retains the incompatible same-head legacy refusal.
`SLICE4.md` explains every difference and retrospective-history limitation.
Publication was disabled throughout. Paired full comments and raw service
responses stay outside git because they contain operator-sensitive material.

Three Jev key reads (one per process), 19 Jev HTTP requests, ten completed Claude
review calls, reported cost $1.647863. Recorded replays and CLI version probes
make no model calls. No production publication credential was read.

## Rollback and instance

The single authority commit's reverse patch was applied locally, restoring
Python routing. The original Python runtime, scripts and tests matched main;
489 Python tests passed. Five instance routing tests passed, each of their five
counterexamples failed exactly one test, and all five passed after restoration.
The reverse patch was then removed and the prepared branches retained.

The actual unchanged r32 Python decoder read all 45 ledger entries from five
emitted TypeScript reports with identical standing-card recall. Sanitized metadata:
`live/slice4-rollback.json`. Deliberately changing the emitted v1 marker to v9
failed that proof; restoring it passed. This tests ledger compatibility as well
as source/routing reversibility. It does not prove a live registry pull or run.

The three instance workflows and changed CI workflow pass actionlint. The estate
CI floor job matches main structurally, and the other estate-owned caller files
are unchanged. Dotty has no edits; its active readers and rollback floor helper
remain available. The separate retirement branch removes the instance Python
engine, glue, image build and harness while retaining the original r32 manifest.

## Security scans and remaining proof

Every prepared branch must pass the operator overlay command after its final
commit; the workspace hand-over records the final branch heads and scan results:

```sh
gitleaks git . --log-opts origin/main..HEAD --config ~/.config/gitleaks/operator-rules.toml
```

Hooks ran on every local commit, with named staging and no bypass. No raw live PR
corpus is tracked or packed. Release publication, installation on the Pi,
production App write permissions, actual estate consumption, live approval and
hold/disarm, live switch-back, full-estate rollout and production deletion remain
unproven until the operator performs the five-step canary in the instance hand-over.
The immutable rollback image digest remains unresolved; retain the image and
resolve the digest on the Pi before retirement. The planned whole-port independent
attack-kitty and Margot reviews have not been run by this local proof.
