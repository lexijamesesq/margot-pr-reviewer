# Slice 2: live services in read-only shadow mode

Acceptance is incomplete. Mechanical and documentation reviews completed live.
The functional review completed all four routed cards and found real defects, but
its live risk and voice steps have not completed. Five permitted Jev vault reads
were consumed during startup retries. No sixth read was made; one additional
read has been requested. This is a missing proof, not a successful held verdict.
Python remains the publisher. Nothing was pushed, posted or changed on GitHub.

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
| [dotty #402](https://github.com/lexijamesesq/dotty/pull/402), `11777c29b8405076acb315027a466967534b89fb` | functional | CHANGES_REQUESTED, MEDIUM; three established findings | Four cards completed; four mandatory findings; ERROR at risk because credential authorization is pending | Findings agree on the rollout defect, absent regression assertion and stale comment. Principal-engineer independently raised the rollout defect too. No final TypeScript risk band or held review has been proved. |

The real rollout defect is at `.github/scripts/pre-commit-suite-merge.py:314`:
existing hook IDs skip insertion of their extra lines. The claim that every
existing repo receives the new exclusion is false. Works-and-proven also searched
the large eval file and found no regression assertion; maintainable-no-slop
confirmed the stale description at line 79. House-style completed without findings.

Raw final card prose, normalized answers, facts and Python check outputs are in
[the live evidence directory](live). Operator runtime paths are replaced with
`/example/pinned-publish-skills` in committed evidence; original local receipts
remain in `../evidence-slice2/`. Tool transcripts retain tool calls/results and
omit unrelated session metadata. Repository identities and SHAs remain real
because these files are evidence, not sample configuration.

The recorded routing probabilities predate the final exposure-Score translation.
The original transport derived confidence from Noul distance; final code uses
Python's exposure Score instead. Card selection is unchanged by that correction,
but a final live run through the corrected route transport remains unproved.

## Cost and confinement

Eleven paid Claude CLI invocations were made: two unusable tool-grant attempts,
two successful standalone compatibility cards, two cards for the completed
README review, one incomplete functional card, and four completed functional
cards. No voice invocation has run. The mechanical review spent zero Claude.
Startup failures before these calls reported zero API usage. There were five
Jev credential reads, one per process; the key was never printed or written.

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

Clean-clone verification is recorded separately in `clean-clone-proof.md` after
local commit. The suite has 134 Vitest tests and the installed-package smoke.
No skipped tests or TODO placeholders were added.

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
repository's parent workspace. `run-live.mjs` reads the Jev credential once per
process and can run all requested PRs with that in-memory value. **Do not run it
again in this task without the requested additional-read authorization.**
`safety-proofs.mjs` needs no vault read and reproduces both fail-closed proofs.
`resume-functional.mjs` reuses already fetched classification/routing and live
facts only if title/body/diff are unchanged; it records the completed live cards
and deliberately stops before unauthorized risk scoring.

## Disagreements and remaining limits

I disagree with giving the model a general Bash/gh tool grant when the task only
requires repository reads. The standard MCP SDK supplies a smaller capability
surface without copying the review prompts. I also reject treating an incomplete
card as a clean review: the first large-file attempt failed closed and led to
paging/search, rather than a relaxed completion rule.

The final functional Jev risk result, Margot voice result and non-error held
result remain unproved. The final route confidence transport also needs its live
rerun. No production publication, hosted Action execution, canary, convergence or
Python retirement was attempted; those require later authorized slices. Ticket
MCP tools are not connected. Binary/unavailable/oversized evidence is an explicit
error, never a partial approval. The whole-port independent review has not run.
