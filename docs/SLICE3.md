# Slice 3: the author fixes and Margot reviews again

The Margot now reviews later rounds, carries authenticated finding history, and
keeps the same decision and counts when the same head is retried. All work is on
`slice3-convergence`, with local commits only. Python remains the production
reviewer. No GitHub object was created, edited or posted; no branch was pushed.

The live proof includes both rounds of margot-pr-reviewer #9 and all three rounds
of dotty #403 at Python's exact reviewed heads. It includes two sequences:
actual Python App history into TypeScript, and TypeScript's own locally emitted
ledger into its next shadow round. The latter exposes a real disagreement:
TypeScript still requests changes on #9 round two because the old CLI passes the
whole diff in argv. That defect remains at the historical head and caused E2BIG
in this proof. Slice 3 fixes it with stdin and a paged diff evidence tool.

## What shipped

| Module | Responsibility |
| --- | --- |
| `src/ledger.ts` | Select authenticated history; choose delta or full scope; recall standing cards; apply finding fates, severity and counts; serialize bounded history. |
| `src/review.ts` | Orchestrate convergence, isolated card scopes, concurrent cards, cached retries, current checks and final head validation. |
| `src/schemas.ts`, `src/types.ts` | Validate the ledger, finding marks, resolution citations, saved result and comparison; infer public types. |
| `src/policy.ts` | Keep advisory findings out of mandatory verdict accounting. |
| `src/render.ts` | Display convergence counts and append one genuine ledger after escaping model-supplied markers. |
| `src/adapters/github.ts` | Read all review pages and complete unified comparisons through Octokit. |
| `src/adapters/prose.ts` | Preserve finding ledger keys, late/reach explanations, reopening evidence and resolution citations. |
| `src/adapters/claude.ts`, `process.ts` | Send prompts through stdin, preserve pinned agents and isolate each model's evidence and credentials. |
| `src/adapters/evidence-server.ts` | Page the complete scoped diff; optionally read explicitly configured reference repositories at immutable SHAs. |
| `src/adapters/jev.ts` | Batch oversized evidence without discarding bytes; conservatively combine every answer. |
| `src/adapters/live.ts`, `recorded.ts` | Bind live configuration to service provenance and replay normalized comparisons. |
| `scripts/scenario-breaks.mjs` | Share adapter and convergence break execution and receipt accounting. |

The ledger is the custom policy the charter authorized. There is no database,
line-number matching algorithm or new review framework. Zod, Octokit, parse-diff,
Node compression, MCP and the existing Claude CLI supply the surrounding work.
Cards and Margot's voice remain in the pinned publish-skills bundle.

## Behavior and authority

- History must be complete. Only configured Bot logins and a terminal versioned
  ledger bound to the GitHub review's commit are accepted. Unknown, corrupt or
  forged ledger history cannot approve or replace the previous record.
- A delta is the complete unified diff between reviewed heads, intersected with
  the PR's file inventory. It is not GitHub's capped compare file list. Rebased
  history, unreadable comparisons and incomplete hunks carry the ledger into a
  full review using the already validated PR evidence.
- Each card sees its own standing and dismissed entries. A standing card is
  recalled even on mechanical or editorial paths. A silent MAJOR or BLOCKING goes
  to Margot for confirmation. A silent MINOR from round two counts as fixed.
- MINOR is advisory after round one. A missed finding blocks only at BLOCKING,
  or at MAJOR for safety. Delta-reach regressions retain their honest severity.
  Unfixed serious findings still block at round four and beyond.
- Dismissals retain their reason. Reopening requires a model-supplied delta
  citation, which Margot judges. Matching and fix evidence remain judgment;
  the reducer owns persistence, severity, summoning and counts.
- An exact-head retry reuses the authenticated saved result, after validating
  configuration, evidence, service provenance, required checks and the head.
  There are no new findings, count increments or paid calls on that path.
- Python v1 prior-round ledgers remain readable. New v2 ledgers contain a saved
  result and use deflated base64 JSON. Size limits refuse the result rather than
  dropping standing findings or dismissals. An old Python same-head ledger lacks
  a compatible saved result and fails closed; a different head can build on it.

These are deliberate differences from Python: unreadable/malformed history fails
closed; the same-head result is reused rather than rerun; new delta findings must
state new/missed/delta-reach attribution; oversized history is refused instead of
forgetting dismissals. Nothing relaxes the approval bar to hit a round count.

## Live proof: TypeScript carries its own findings

Counts are **standing / fixed / new / late / unconfirmed**. Decisions below are
review outcomes, not merge permission: every live result was held at HIGH risk.

| PR / round / exact head | Python outcome, band; counts | TypeScript outcome, band; counts |
| --- | --- | --- |
| margot-pr-reviewer #9 R1 — `c16b59512640c7f8a0db57779a8e04e5ba4a2285` | CHANGES_REQUESTED, MEDIUM; 6 / 0 / 6 / 0 / 0 | CHANGES_REQUESTED, HIGH; 7 / 0 / 7 / 0 / 0 |
| margot-pr-reviewer #9 R2 — `79787d37d4e03cebe533e46bd07a2ebc2392e77d` | APPROVED, MEDIUM; 0 / 6 / 0 / 0 / 3 | CHANGES_REQUESTED, HIGH; 1 / 4 / 0 / 0 / 3 |
| dotty #403 R1 — `54b94b1799c02e9bd28251e7e9ce08aeeadbe773` | CHANGES_REQUESTED, HIGH; 9 / 0 / 9 / 0 / 0 | CHANGES_REQUESTED, HIGH; 7 / 0 / 7 / 0 / 0 |
| dotty #403 R2 — `51e6692d62ffc35087e04fc09bc69f1895b49acc` | CHANGES_REQUESTED, HIGH; 2 / 7 / 2 / 0 / 1 | CHANGES_REQUESTED, HIGH; 2 / 5 / 2 / 0 / 2 |
| dotty #403 R3 — `cd0a110f193af376577af6a7f92e79e0af3ffbfb` | APPROVED, HIGH; 0 / 2 / 0 / 0 / 2 | APPROVED, HIGH; 0 / 2 / 0 / 0 / 2 |

Reasons for differences:

- **#9 R1:** fresh routing and model judgments produce seven mandatory entries,
  including the argv-size defect. Some additional findings compare the current,
  edited PR description with earlier code. The risk reducer takes conservative
  maxima and minimum confidence across evidence batches; Margot retains HIGH.
  Python's original MEDIUM judgment is not substituted to force agreement.
- **#9 R2:** the real argv-size defect remains standing. Four findings are fixed;
  two continuing documentation/proof discrepancies become advisory at MINOR.
  That accounts for all seven earlier entries. There are no new mandatory
  findings. The original Python sequence did not raise the argv defect.
- **dotty R1:** fresh routing omits safety and objective, and the other cards raise
  a different set of seven issues. Legacy answer compatibility, duplicate light
  conditions and permission declarations recur. Current PR prose also describes
  later fixes that are absent from this early head. This is not finding parity.
- **dotty R2:** five earlier entries are fixed and two become MINOR advisories;
  two new MAJOR findings identify the caller-permission startup failure.
  Different first-round entries explain the different fixed/unconfirmed counts.
- **dotty R3:** both standing permission findings are confirmed fixed. Outcome and
  every count match Python. HIGH remains an operator hold.

## Live proof: actual Python history into TypeScript

Each later round in this sequence reads the previous real GitHub App review,
including its v1 ledger. This proves the authentication and migration boundary
without posting any new review.

| Round | Python counts | TypeScript counts | TypeScript outcome |
| --- | --- | --- | --- |
| #9 R1 | 6 / 0 / 6 / 0 / 0 | 7 / 0 / 7 / 0 / 0 | CHANGES_REQUESTED / HIGH |
| #9 R2 | 0 / 6 / 0 / 0 / 3 | 0 / 6 / 0 / 0 / 3 | APPROVED / HIGH |
| #403 R1 | 9 / 0 / 9 / 0 / 0 | 7 / 0 / 7 / 0 / 0 | CHANGES_REQUESTED / HIGH |
| #403 R2 | 2 / 7 / 2 / 0 / 1 | 4 / 7 / 4 / 0 / 1 | CHANGES_REQUESTED / HIGH |
| #403 R3 | 0 / 2 / 0 / 0 / 2 | 0 / 2 / 0 / 0 / 2 | APPROVED / HIGH |

The additional two new entries in #403 R2 come from separate cards raising the
permission failure and the edited PR description's contrary claim. Both original
serious fixes and all minor fixes are accounted for. First-round and band
comparisons have the same limitations described above. In particular, importing
Python's earlier ledger does not pretend Margot itself raised those findings.

## Recorded proof and tests

The suite has **204 passing named tests, no TODOs**: 96 core cases, 49 adapter
cases and 59 convergence/transport cases. All seven retained recordings run; the
second-round metrics recording now fixes two earlier MINOR findings and approves.
The previous refusal-only case is gone. Actor and SHA identifiers in the public
recording remain neutral reconstructions and are labeled as such.

Every named test has a deliberately failing break receipt, plus 13 additional
source mutations. The source mutations include removal of author authentication,
MINOR demotion and silent-MAJOR verification. The evidence-tail test deletes the
last Jev batch in implementation source. Most other per-test receipts are
controlled input/service counterexamples, not exhaustive source mutation testing.
The receipts state that limit; they do not claim independence merely because one
test failed. Each run executes the complete suite and restores its mutation.

The live replay corpus is proof from a live run, not a suite fixture, so it is
kept outside the repository at
`/private/tmp/claude-501/-Users-lexi-Vaults-Notes-System/1189c544-52cf-4130-aea4-2c469b3f9866/scratchpad/ts-port/proof/slice3-cases.json.gz`.
It contains complete normalized boundary inputs, exact historical diffs,
authenticated prior reviews, raw final model prose and expected results for both
live sequences. Compression only reduces artifact size. Run
`npm run build && node scripts/replay-slice3.mjs /private/tmp/claude-501/-Users-lexi-Vaults-Notes-System/1189c544-52cf-4130-aea4-2c469b3f9866/scratchpad/ts-port/proof/slice3-cases.json.gz`
to reproduce ten exact typed-result and visible-report
comparisons and ten identical retries without paid calls, then exercises rebase,
unreadable-compare recovery, forged history and unreadable history. The four
failure/rebase probes are recorded-service perturbations of real evidence, not
claims that a live PR was rebased or forged. Their output is in
`docs/live/slice3-replay.json`. Stock compressed bytes can differ between Node
versions; only that hidden encoding is excluded from cross-version comparisons.
Same-runtime retries still compare the complete result byte for byte.

The rebase probe carries all six prior findings into a full review and records
six fixes. Forged and unreadable histories return ERROR at history, with no
approval or publication. Unreadable compare falls back only because the complete
full PR evidence is available. The adapter tests separately protect pagination,
page-two failure, incomplete full evidence and production head freshness.

## Calls and cost

Across all attempts and both sequences:

- **5 vault reads**, one per live process, below the limit of six. Keys remained
  in memory, were never printed or written, and were excluded from child environs.
- **583 Jev HTTP requests:** 581 successful responses and two initial HTTP 400
  `max_tokens_exceeded` responses. The full #9 diff is about 0.9 MB; the bounded
  batch path accounts for most requests. No content was truncated to get a pass.
- **53 Claude review invocation attempts:** 47 returned model responses and six
  failed before starting because the old argv transport hit E2BIG. Of the 47,
  one house-style response was incomplete for missing reference evidence and
  was rerun after explicitly configuring the pinned hook repository.
- Reported Claude spend: **$19.3855266**. Version probes are not review calls.
  Exact-input response reuse and same-head retries make no additional model calls.

Jev used `jev-1.13.0`; Claude Code was pinned at `2.1.283`, review cards used
`claude-opus-5-5`, and the voice model came from the unchanged publish-skills agent.
The bundle is `dc82ec72eea97ae6b0e161dd2ec909cb75033045`. The optional hook reference
was dotty at `7679fd71bd313fcf5912d5a53a1358df1c2fa83a`, resolved read-only from the
PR's `v2026.09.30-2` tag. Arbitrary cross-repository model reads are still refused.

## Limits and what remains unproven

- These are retrospective read-only shadows, not publication, adoption or canary
  proofs. Required-check enforcement was explicitly disabled in the historical
  runner; Python's original checks were read separately. The final historical
  head probe confirms the immutable commit exists, rather than pretending an old
  head is still the current PR tip. The production adapter's freshness and check
  rules are covered by tests and remain unchanged.
- Code heads are exact. Historical edited PR bodies are not available through the
  review API, so the current title and body were supplied. This caused some
  body-versus-code findings and prevents a claim of identical historical context.
- The chained shadow uses the locally emitted previous ledger as the would-be
  trusted App review. The separate migration sequence uses actual App-authored
  GitHub reviews. No new App review was posted to prove that last lifecycle step.
- Conservative Jev batching preserves evidence and errs toward holds, but does
  not prove the model reasons identically across chunks. Matching, reopening,
  late attribution and fix citations remain model judgments, not formal proofs.
- The live series had no missed-late finding, actual rebase, forged review or
  unreadable history. Those rules have recorded perturbations and test receipts.
- Python retirement, production writes, reversible canary, hosted Action execution
  and the whole-port independent reviews remain for the later agreed slice.

## Reproduce and review

Use Node 22+, then `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:breaks`, `npm run audit:recordings`, `npm pack`,
`node scripts/package-smoke.mjs`, and
`node scripts/replay-slice3.mjs /private/tmp/claude-501/-Users-lexi-Vaults-Notes-System/1189c544-52cf-4130-aea4-2c469b3f9866/scratchpad/ts-port/proof/slice3-cases.json.gz`.
The package smoke installs the tarball in a
separate directory, exercises a real import and finding-to-hold transition, and
breaks/restores the installed CLI. The Node 22.23.3 clean clone installed 213 packages with zero audit findings,
then passed build, typecheck, all 204 tests and the recording audit. Detailed
clean-install, tarball hashes and hook receipts are in `docs/slice3-verification.md`. Estate-owned workflows are untouched.

The root `PR-slice3.md` is the proposed PR body. Both hand-over documents are also
included under the repository's `docs/` directory. No PR has been opened.
