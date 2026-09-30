# Slice 4: publication, instance adoption and retirement preparation

The engine can publish the estate's existing check contract and a SHA-bound native
review. Its tally is New, Open, Closed, derived from the findings listed below it.
The instance adopts exact package 0.4.0 through a reversible shadow/authority
switch. A separate local retirement branch removes Python only after the operator
passes the canary. Nothing was pushed, posted or dispatched. Release 0.4.0 and
production adoption remain operator actions, not completed production proofs.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/adapters/publish.ts` | Own the check lifecycle, native review, disarm, compensation and run ownership. |
| `src/adapters/live.ts`, `src/cli.ts` | Select shadow or real publication; keep the write credential out of model adapters. |
| `src/adapters/github.ts` | Read complete GitHub evidence and configure bounded transport retries. |
| `src/schemas.ts`, `src/review.ts` | Validate publication settings and caller permission for skipped CI checks. |
| `src/ledger.ts` | Retain closed findings and open advisories, including later fix evidence. |
| `src/render.ts` | Derive New/Open/Closed from the exact listed ledger entries and display each fate. |
| Instance `.github/instance/` | Supply estate policy, release pins, enrolment and the authority switch. |
| Instance `margot-engine.yml` | Install the exact artifact on the Pi and run it with `margot-ops`. |

## Publication contract

The check names and App identity are supplied by the instance. The publisher takes
over the caller's pending check by name, App and head, marks run ownership, and
rejects a superseded writer. Earlier App approvals are withdrawn before evaluating
again. The native review carries `commit_id`; every write rechecks head, base,
fork, draft and open status. The native approval is the last publication
write, after every check write is confirmed. Held decisions use COMMENT and neutral;
errors use action_required. Self-instrument holds are neutral; triage JSON retains
`decision_source`, `head_sha`, `classification` and `mechanical` for estate readers.

A hold confirms that armed auto-merge was disabled. A partial failure attempts
independent disarm, approval withdrawal and error-check completion, and returns
ERROR even if cleanup also fails. No merge or enable-auto-merge call exists.
GitHub has no transaction spanning checks and reviews: callers must serialize
same-PR writers, and an unavailable API can leave a pending check. These limits
remain visible errors, never an affirmative completion. The implementation follows
GitHub's [check-run API](https://docs.github.com/en/rest/checks/runs) and
[native review API](https://docs.github.com/en/rest/pulls/reviews).

The invocation URL fences check ownership but is excluded from the review
fingerprint, so a new workflow invocation can reuse a compatible same-head result.

## Tally

New is the number of issue entries first raised in this round. Open includes
standing issues and advisory issues. Closed includes retained fixed and dismissed
issues. Every issue appears once, labeled Open or Closed, with its exact fate;
New and late are attributes of those same entries. Non-issue notes are separate.
Thus New overlaps Open/Closed and is not a third mutually exclusive bucket.
Open plus Closed equals the number of issue entries beneath the tally. Closed
history remains visible across rounds; oversized history fails closed rather
than silently deleting evidence. Legacy diagnostic counters remain in the ledger
for migration compatibility, but do not drive the displayed tally.

## Rollback ledger transport

The posted block uses the legacy v1 marker and plain JSON entries, plus a
compressed `receipt_v2` extension. Python ignores the extension and sees the same
round, head and findings. TypeScript reconstructs its exact typed v2 saved result.
Old compressed v2 blocks remain readable. This keeps rollback from losing canary
findings without changing or rebuilding r32. The local rehearsal checks the actual
unchanged Python decoder and standing-card recall against emitted package reports.

## Live shadow comparison

The proof re-reads real GitHub PRs and invokes live Jev/Claude at Python's exact
reviewed code heads. All publication is disabled. Current PR text is available;
historical edited titles/bodies are not. Required checks are retained as evidence
but not enforced retrospectively, and the final historical probe checks commit
existence. The production adapter's freshness and check guards are tested
separately. This is retrospective shadow evidence, not a production canary.

| PR and head | Python | TypeScript | New / Open / Closed |
| --- | --- | --- | --- |
| margot-pr-reviewer 3, `1e9efd604d67a7e5395d892a01320c9bf2a6b33c` | mechanical; APPROVED LOW | mechanical; APPROVED LOW; eligible; zero Claude | 0 / 0 / 0 |
| margot-pr-reviewer 2, `4fad52cd3652586829113741dfea318af36d0fe0`, first review | ERROR MEDIUM; reports missing | documentation; APPROVED LOW; completed card | 0 / 0 / 0 |
| dotty 403 round 3, `cd0a110f193af376577af6a7f92e79e0af3ffbfb` | APPROVED HIGH; held | functional; APPROVED HIGH; held | 0 / 0 / 11 |
| margot-pr-reviewer 7, `439feb449780eb0190187667e8dbe68d8dc35a57` | mechanical; APPROVED LOW | functional; APPROVED LOW; eligible | 0 / 0 / 0 |
| core-skills 131, `582f517acbd978e08621197517a66ed830b8448f` | mechanical; APPROVED LOW | functional; APPROVED MEDIUM; held | 0 / 0 / 0 |
| margot-pr-reviewer 2, same head, latest review context | APPROVED LOW | ERROR: same-head legacy result has no compatible saved receipt | — |

Every observed difference is retained. The README's first Python review failed
because no completed card reports reached its voice. TypeScript completed its
selected card and found no issue; documentation policy keeps LOW. Python later
approved that same code head too. Replaying with those later same-head legacy
reviews exposes the deliberate incompatible-cache refusal, not a clean approval.
The separate first-review comparison uses only history that existed before that
first review; it does not discard history in an authoritative run. The instance
now uses `github.shadowBeforeHead` for side-by-side operation: it omits same-head
reviews but retains earlier heads. GitHub authority explicitly rejects this option.

The two ambiguous bumps received mechanical probabilities 0.59 and 0.55, below
the 0.6 threshold, so classification conservatively became functional. Both had
no findings. The first remained LOW after two cards; the second received MEDIUM
and a risk hold after one card and the voice. That is a model/classification
difference, not claimed parity or a reason to lower the threshold. The other
hook-update PR received mechanical 0.64 and needed no Claude.

The held dotty result agrees on outcome and HIGH. Its Closed 11 comprises nine
fixed entries (seven from round two, two this round) and two dismissals. Python's
visible round-three tally showed only two fixed entries. Retaining and listing
all closed entries is the intended new arithmetic. The paired complete Python
and TypeScript comments and service recordings remain outside git under
`proof/slice4/`; they can contain operator-sensitive topics. No raw live corpus
is included in these commits or the npm package.

Across all attempts: **3 Jev credential reads**, one per process; **19 Jev HTTP
requests**; **10 Claude review calls**, all returned responses; reported Claude
cost **$1.647863**. The keys stayed in memory and were not printed or saved. These
counts exclude local recorded replays and CLI version probes, which make no model
calls. No other production secret was read. A read-only package-version lookup
could not resolve the rollback image digest; the original r32 manifest remains.

## Local verification

Detailed counts and final receipts are in `slice4-verification.md`. New publication
cases use the real Octokit client with recorded HTTP responses, never a live PR
write. Deliberate failure cases cover admission, head/base movement, write errors,
failed disarm, malformed receipts, prior approval withdrawal, check adoption and
superseded writers. The tally source mutation adds one to displayed Closed; the
reconciliation assertion must fail. Every new named test has a break receipt.

The instance's adoption and authority branches retain Python. The reverse patch
of the authority commit is applied locally, the original engine/runtime/poster
are compared byte for byte, and the Python suite is run before restoring the
switch. Five instance routing tests each have a failing counterexample. Estate
caller files and the three estate reader workflows are unchanged.

## Canary and remaining proof

1. Merge/release the verified engine artifact, then merge shadow-only adoption;
   watch no-write artifacts beside Python on every class and a hold.
2. Merge the separate authority switch for only the controlled probe repository.
3. Verify SHA-bound checks, approval, hold/disarm, tally, a fixing round, retry,
   denied writes and supersession through the actual estate readers.
4. Merge a revert of the authority switch and observe Python/r32 publishing again;
   restore TypeScript only after that live rollback passes.
5. After an explained canary and successful rollout to every enrolled repository,
   merge retirement separately; retain the immutable rollback image.

The instance hand-over contains the exact PR setup and pass criteria. Unproven:
the release in the registry, Pi installation/scheduling, production App permissions,
real GitHub publication, live estate consumption, live rollback, full-estate
adoption and actual Python retirement. The rollback image digest must be resolved
and retained on the Pi before retirement. Do not interpret local branch existence
as production completion of charter done-when 2, 6 or 8.
