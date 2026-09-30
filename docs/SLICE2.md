# Slice 2: live services in read-only shadow mode

The functional decision, a completed held result and the corrected routing
confidence are now proved live against implementation head `0dc9636`. Dotty #402
supplies both the functional and held proof: CHANGES_REQUESTED/HIGH, with
`review-authority`, `risk` and `author-action` holds. A separate APPROVED-but-held
comparison on eve-plus #9 remains unproved: its first card could not access the
cross-repository evidence it needed and the run returned ERROR. That error is
not counted as a held verdict. Python remains the publisher. Nothing was pushed,
posted or changed on GitHub.

## What exists

Branch: `slice2-live-services`, based on `main` at `85e796d` (merged slice 1).
The pre-existing slice 1 receipt timestamp edit was saved outside the repository
as `../slice1-existing-receipt.patch` before main was pulled.

- `adapters/github.ts`: Octokit pagination, complete diff checks, admission and revision checks; optional GET-only gh broker transport.
- `adapters/jev.ts`: native Jev transport, bounded retries and typed answer translation.
- `adapters/bundle.ts`: exact Git pin, clean tree and required regular-file verification.
- `adapters/claude.ts`: pinned CLI, pinned agent prose/model, isolated calls, actual tool-grant validation, raw responses and evidence transcripts.
- `adapters/evidence-server.ts`: standard MCP SDK server for SHA-bound file/tree reads, bounded line ranges, literal search and the selected pinned card.
- `adapters/prose.ts`: completion, finding and verdict parsing that rejects missing or ambiguous evidence.
- `adapters/process.ts`: bounded subprocess output, abort propagation, closed stdin and redacted failures.
- `adapters/live.ts`: trusted instance configuration and composition; records proposed publication/disarming in memory.
- `cli.ts`: installed executable; writes one local JSON result. `action.yml` invokes that same executable on a provisioned runner.
- `review.ts`: the final head check also applies when publication is disabled. GitHub checks base/admission freshness too.
- `questions.ts`: the additional exposure Score supplies route confidence, matching Python. All prompts still belong to this module or publish-skills.

Samples are `samples/config.sample.json`, `samples/request.sample.json` and
`samples/self-hosted.sample.yml`. They contain placeholders, no estate values.
The scaffold declaration has one exact-filename exemption for an external settings filename appearing only in recorded repository-tree evidence; it is not a runtime configuration dependency. No estate-owned workflow was edited. Runtime is Node 22+, Claude Code 2.1.283,
Jev 1.13.0 and publish-skills `dc82ec72eea97ae6b0e161dd2ec909cb75033045`.

## Live comparisons

All GitHub reads used the operator's gh broker through the adapter. Earlier
Python decisions were fetched from `review / margot` check runs on the same head.
Live services use explicit fresh-first-round shadow mode: history is fully read,
but prior ledgers are not supplied to the cards or overwritten. The comparisons
are against existing Python check results, not newly commissioned Python reviews.

| PR and exact head | Class | Python on this head | TypeScript observation | Assessment |
| --- | --- | --- | --- | --- |
| [margot-pr-reviewer #7](https://github.com/lexijamesesq/margot-pr-reviewer/pull/7), `439feb449780eb0190187667e8dbe68d8dc35a57` | mechanical | APPROVED, LOW; merge eligible; no council | APPROVED, LOW; eligible; zero Claude calls; publication recorded | Agreement. A dependency pin bump has no contained functional change. |
| [margot-pr-reviewer #2](https://github.com/lexijamesesq/margot-pr-reviewer/pull/2), `4fad52cd3652586829113741dfea318af36d0fe0` | documentation | APPROVED, LOW; functional fast path, no council | APPROVED, LOW; works-and-proven and maintainable-no-slop completed; publication recorded | Same decision. The newer three-class policy deliberately reviews human-facing accuracy while keeping LOW. |
| [dotty #402](https://github.com/lexijamesesq/dotty/pull/402), `11777c29b8405076acb315027a466967534b89fb` | functional; completed held result | CHANGES_REQUESTED, MEDIUM; ineligible; three established findings | CHANGES_REQUESTED, HIGH; ineligible; four established findings; `review-authority`, `risk`, `author-action`; publication recorded locally | Same adequacy outcome and underlying defects. Python lowered HIGH to MEDIUM for limited actual rollout; the live voice retained HIGH for the shared provisioner's reach. |
| [eve-plus #9](https://github.com/lexijamesesq/eve-plus/pull/9), `7198b9ead47ecc6f7fe08a6b61516d783e8eaad4` | functional; separate held candidate | APPROVED, LOW; held for operator authority | ERROR at `card:works-and-proven`; ineligible; no final risk, voice or publication | Required proof lives in dotty, outside the SHA-bound repository evidence grant. This is an incomplete review, not a completed held decision. |

The real rollout defect is at `.github/scripts/pre-commit-suite-merge.py:314`:
existing hook IDs skip insertion of their extra lines. The claim that every
existing repo receives the new exclusion is false. Works-and-proven also searched
the large eval file and found no regression assertion; maintainable-no-slop
confirmed the stale description at line 79. House-style completed without findings.

The finish reused those four live cards only after freshly validating the same
repository, PR, base/head, title, body, author, diff and file inventory, the pinned
configuration and each card's name/classification/path/agent. Classification,
routing, risk and voice ran live, followed by fresh head/admission checks and
local publication recording. The rerun selected the same four cards. Python's
five-card council included safety; TypeScript's fresh safety probability was
0.18, below the 0.35 threshold. Neither result merges this change.

The risk disagreement is visible in both original verdicts. Jev assigned dotty's
blast radius probabilities 0.46 at level 2 and 0.47 at level 3, with confidence
0.39. The live voice retained HIGH because the shared suite can affect the estate,
even though the defect limits this exclusion's actual rollout. Python had lowered
HIGH to MEDIUM because existing hook entries are untouched, the change only
excludes a lockfile from YAML parsing, reversal is easy and there is no security
exposure. These are different judgments about potential versus actual reach,
not identical risk results. Principal-engineer's duplicate rollout finding stays
a separate ID, as the pinned voice instructions require; all four IDs were
established and none was dropped.

Eve-plus is a first-round shadow comparison against Python's existing round-two
result on the same head, not a ledger/convergence replay. Its reviewer verified
the bare marker and passing local checks, but could not verify the external
caller-merge implementation or eval. The MCP server only permits the request's
repository and SHAs. Python's recorded verdict treated the corrected marker as
fixed and approved it, while retaining the operator hold. The shadow attempt
failed closed on missing evidence; no further card or voice was commissioned.

[The finish receipt](live/finish-proof.json) contains the final decision, live Jev
questions and raw answers, translated values, saved-card reuse checks, voice
prose, candidate failure, tool evidence and counters. The unchanged
[Python functional result](live/functional-python.json) and
[Python held-candidate result](live/held-candidate-python.json) were re-fetched
from their exact heads during the finish.

Raw final card prose, normalized answers, facts and Python check outputs are in
[the live evidence directory](live). Operator runtime paths are replaced with
`/example/pinned-publish-skills` in committed evidence; original local receipts
remain in `../evidence-slice2/`. Tool transcripts retain tool calls/results and
omit unrelated session metadata. Repository identities and SHAs remain real
because these files are evidence, not sample configuration.

The older card receipts predate the corrected exposure-Score translation. The
finish reran the corrected transport live: dotty's raw exposure Score confidence
was **0.70**, and the translated route confidence was **0.70**; eve-plus returned
**0.71**, translated to **0.71**. These values came from Score confidence, not Noul
distance. Both live routing receipts are retained. Dotty's card selection was
unchanged; no saved route or risk answer was substituted.

## Cost and confinement

The finish used **one Jev vault read**, retained in one process for both PRs,
after local pins and both GitHub revision/check preflights passed. The key stayed
in memory and was never printed or written. **Five live Jev HTTP requests** ran:
dotty classification, routing and risk; eve-plus classification and routing.
All five returned HTTP 200; zero retries. There are **six vault reads for the
whole slice** (five earlier, one newly authorized). Earlier Jev HTTP attempts
were not fully metered, so no whole-slice HTTP total is claimed.

The finish made **two paid Claude CLI invocations**: dotty's final voice and
eve-plus's incomplete works-and-proven card, costing $0.2808068 in their receipts.
There were no repeated card or voice invocations. The whole slice totals
**13 paid Claude invocations**: the earlier 11 (two unusable tool-grant attempts,
two successful standalone compatibility cards, two README cards, one incomplete
functional card and four completed functional cards), plus these two. Four saved
dotty cards were reused, not billed again. The mechanical review spent zero
Claude. Counts are CLI invocations, not each internal model turn or tool call.

The first `--plugin-dir` attempt failed to load the disabled inline plugin.
Enabling the inline plugin loaded its pinned agents, but their frontmatter tool
lists overrode the CLI grant and hid MCP tools. The safe correction loads the
unchanged pinned agent prose, model and effort through standard `--agents`,
replacing only the runtime tool list. Cards/common law remain in publish-skills.
The voice's model comes from its pinned frontmatter, not instance configuration.

[The CLI receipt](live/cli-confinement.json) records the actual available tools
and successful card/file/tree reads. Completed functional receipts also show
bounded large-file reads and literal search. There is no shell, builtin filesystem
tool, write tool, arbitrary URL tool, project instruction loading or PR-code
execution grant. Strict MCP configuration excludes agent-declared servers.
The MCP server ignores caller-supplied repository/SHA fields and binds the server
instance to the validated request. GitHub/Jev credentials are not inherited by
Claude; an explicitly supplied read-only GitHub token belongs only to MCP's
configured environment. Trusted package/bundle files must remain immutable on the
runner. This is a capability proof, not a claim that prompts are injection-proof.

## Safety and test receipts

- [Safety receipts](live/safety-proofs.json): real GitHub facts plus a real HTTP connection to a closed local port exhausted Jev retries and returned ERROR at classification. A real head read with a deliberately substituted SHA returned ERROR at publication-head with publication disabled. The real PR was not moved. Both were ineligible and recorded only proposed disarming.
- [Core receipts](test-break-receipts.md): 96 named scenario breaks and five separate source mutations, generated by the harness.
- [Adapter receipts](adapter-break-receipts.md): 38 new named cases, each with one deliberate break and one failing assertion in a full-suite run. One source mutation grants Bash to the CLI; the rest are controlled input/transport counterexamples.
- [Installed package receipt](package-smoke-receipt.md): independent tarball import and installed CLI entrypoint. Emptying the installed CLI made its argument-validation assertion fail; restoration passed.

Controlled fixture changes cannot demonstrate test independence or exhaustive
mutation coverage: other fixtures are unchanged by construction. Error tests
repair the bad evidence to prove they distinguish it from usable evidence. The
receipts say this explicitly. The harness caught an overlapping question/adapter
assertion during development; the adapter case now tests only route confidence.
No test runs a live service or spends model budget.

A clean Git clone of implementation commit `00adb09` passed install, typecheck,
all 134 Vitest tests, build and the installed-package smoke under Node 22.
[The clean-clone proof](clean-clone-proof.md) records the exact commands and tarball hash.
No skipped tests or TODO placeholders were added.

The finish changed evidence and documentation only. The unchanged implementation
was rebuilt under Node 22 before the run. Receipt assertions verified the
completed held decision, all four reused cards against committed evidence, both
raw-to-translated routing confidence values, the failed candidate's lack of
publication and exact call counts. Local commit hooks validate the new files.

## Reproduction

With Node 22 and npm, from a clean clone of the local branch:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:breaks
npm pack
node scripts/package-smoke.mjs ./margot-pr-reviewer-0.2.0-slice2.tgz
```

For an actual live run, provision the pinned CLI/bundle and copy the sample
configuration, replacing placeholders with trusted instance values. Set the
three credentials outside the repository. GitHub needs read scopes only.
Then run:

```sh
margot-review /absolute/runtime/request.json /absolute/runtime/config.json /absolute/runtime/result.json
```

The local exact setup and captured requests are in `../evidence-slice2/` from this
repository's parent workspace. The finish command, from that parent, was:

```sh
PATH=/private/tmp/margot-node22/node_modules/.bin:$PATH node evidence-slice2/complete-live-proof.mjs
```

That local harness validates both PRs and the pinned bundle before its single
vault read, keeps the key in memory for both runs, records each Jev HTTP attempt,
and refuses duplicate Claude calls for a role within a PR. It resumes saved cards
only after validating their inputs. `finish-proof.json` is the full local receipt;
`docs/live/finish-proof.json` removes duplicate payloads, operator paths and
unrelated session metadata while preserving raw Jev answers and final prose.
The receipt records the source hash and implementation SHA. Reproduction spends
live budget and can produce different model judgments; the captured result is
not a promise of deterministic model output. `safety-proofs.mjs` needs no vault
read and reproduces both earlier fail-closed proofs.

## Disagreements and remaining limits

I disagree with giving the model a general Bash/gh tool grant when the task only
requires repository reads. The standard MCP SDK supplies a smaller capability
surface without copying the review prompts. I also reject treating an incomplete
card as a clean review: the first large-file attempt failed closed and led to
paging/search, rather than a relaxed completion rule.

The functional Jev risk, Margot voice, non-error held result and corrected route
confidence are proved by dotty's completed review. A separate APPROVED-but-held
TypeScript result is still unproved: eve-plus stopped on unavailable
cross-repository evidence before risk/voice, and its ERROR is not a hold proof.
The evidence grant was not widened to make the example pass. No production
publication, hosted Action execution, canary, convergence or Python retirement
was attempted; those require later authorized slices. Ticket MCP tools are not
connected. Binary/unavailable/oversized evidence is an explicit error, never a
partial approval. The whole-port independent review has not run.
