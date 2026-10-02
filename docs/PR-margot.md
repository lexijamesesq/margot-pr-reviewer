<!-- pr-body:v1 -->
<!-- markdownlint-disable MD041 -->
## Intent

Let an instance publish Margot's single decision to GitHub, and replace the
old finding tally with New, Open, Closed that reconcile with the listed issues.

## What changed

Added an Octokit publisher that adopts the caller's pending check by App/name/head,
fences superseded runs, withdraws earlier App approvals, confirms hold disarming,
completes the check writes and posts the SHA-bound native approval last. Errors
attempt independent cleanup and remain errors if cleanup fails. Held reviews use
COMMENT plus neutral; only eligible results APPROVE plus success. No merge or
enable-auto-merge path exists. Check names and App identity are caller configuration.

The CLI supports explicit GitHub mode with a separate publication credential.
Models and their version probes never receive it. Shadows retain prior-head
history but can omit already posted current-head reviews; this option is refused
in GitHub mode. Named skipped CI jobs require explicit caller permission.

The renderer lists every ledger issue once. Advisory findings remain Open;
fixed and dismissed findings remain Closed across rounds, with fate and late
attribution on each entry. Open advisories can be recalled and fixed. Legacy
internal diagnostic counters remain readable but do not drive the visible tally.
Posted ledgers keep Python-readable entries and a compressed TypeScript receipt,
so reverting authority preserves the canary findings without modifying r32.
The release is 0.4.0, with a self-hosted sample and unchanged pinned skill loading.

## Verification

See `docs/slice4-verification.md` for current test and break receipts and the
earlier clean-clone and package proof. Recorded Octokit transport tests cover approval, hold/disarm, every
write-failure boundary, malformed receipts, stale admission, caller check adoption
and superseded ownership. The publication review fixes add transport cases for an
in-progress check readback, a push after approval, an immediate auto-merge and
three independent cleanup failures. The pre-approval head case now moves only
after the completed review-check write and asserts that approval was never
attempted, even if later cleanup would dismiss it.

The earlier head and confirmation receipts combined source removal with a harness
input flag; they did not establish the claimed independent source coverage.
The corrected harness runs source mutations with no input scenario selected.
All 32 publication/tally breaks now fail exactly their named assertion, with 242 passing;
baseline and restored suites pass all 243 tests. Seven publisher source mutations
cover check confirmation, the pre-approval head guard, dismissal after a push,
merged success, cleanup diagnostics, failed-disarm accounting and partial-approval
cleanup. One tally source mutation and 24 input/service counterexamples cover the
remaining scenarios. Every new scenario has a break receipt.

For this revision, `npm ci`, typecheck, `npm test`, build and
`npm run test:publication-breaks` pass. Staged-file hooks and the operator overlay
scan pass. No model or Jev calls were made; commits remain local, with no GitHub
writes. The clean-clone and installed-package receipts in the verification file
are historical and were not rerun for this revision.

Deliberately adding one to Closed fails tally reconciliation. The slice-three
corpus replays with the same decisions, new reconciled tallies and identical
no-model retries.

Read-only live shadows cover all three review classes and a HIGH hold at Python's
exact heads. A README review completes where Python's first attempt lost card
reports. Restoring the complete measured P1 classification wording and excluding
author prose fixes both missed hook bumps at the unchanged 0.60 threshold.
Mechanical scores: #7 0.59 → 0.92/0.92/0.93; core-skills #131 0.55 →
0.95/0.93/0.94; #3 0.64 → 0.94/0.94/0.94. The README remains documentation.
All three bumps finish LOW and eligible without Claude. The cause predates
Slice 3; these requests were unpaged. 29 three-run ablations isolate the wording
and release-note effects; full request reconstruction, provenance correction
(#131 golden versus saved P1 #132), and scores are in the Mechanical regression
section. Two new wire-contract tests have source-mutation break receipts; all
239 tests, typecheck and build passed at that earlier stage.
The held round-three result has Closed 11: nine fixes and two dismissals, all
listed. Full comparisons and limitations are in `docs/SLICE4.md`.

Total live use: three Jev credential reads, 19 Jev HTTP requests, ten completed
Claude review calls, reported cost $1.647863. Keys remained in memory. Nothing
was pushed, posted, dispatched or released by the builder. The regression
investigation separately used two credential reads, 100 Jev calls and one Claude
card call for the README; all bump shadows used zero Claude.

## Risk and blast radius

Production App publication, released installation on the Pi, actual estate
consumption, the live authority/rollback canary and Python retirement remain
unproven. GitHub has no transaction across review/check writes; failed cleanup can
leave pending/error state, and callers must serialize same-PR writers. Reconcile
all canary differences before authority. Keep adoption and retirement separate.

## Rollback

Before authority, Python continues publishing. The instance's authority commit
has one documented revert back to Python. Do not merge the retirement PR until
the live canary and full-estate rollout pass. Preserve the rollback image.

## Ticket

None.

## Dependencies

Existing Octokit, Zod and Node tooling; no npm dependency added. Consumer-provided
check names, App credentials, runner, policy and pinned publish-skills bundle.
Registry release 0.4.0 or an exact GitHub release tag must exist before instance
adoption. The instance hand-over contains the exact five-step canary procedure
and pass criteria.
