<!-- pr-body:v1 -->
<!-- markdownlint-disable MD041 -->
## Intent

Run first-round Margot reviews on the operator's real PRs through live GitHub,
Jev and Claude Code adapters, with all publication recorded locally. Python
keeps production authority. The functional decision, completed held result and
corrected routing confidence now have live proof. A separate APPROVED-but-held
candidate failed closed on inaccessible cross-repository evidence.

## What changed

Added complete GitHub reads with pagination and revision checks, typed Jev
transport with retries, pinned publish-skills verification, and isolated Claude
card/voice calls. The runtime loads the pinned agent prose unchanged and binds it
to a read-only MCP server, which supplies SHA-bound evidence and paged file reads.
Malformed, incomplete or stale evidence cannot produce approval. The final head
check also applies when publication is disabled.

Added the installed CLI, a thin composite Action that calls it, and placeholder
sample configuration for provisioned self-hosted runners. There is no GitHub write
implementation. Cards and Margot's voice remain in publish-skills.

## Verification

A clean clone passed install, typecheck, all 134 tests and build under Node 22.
Generated receipts cover the 96 inherited
scenario breaks, five additional core source mutations, and 38 new adapter breaks.
The installed tarball passes an independent consumer smoke; replacing its CLI
with an empty executable fails the entrypoint assertion and restoration passes.
See `docs/SLICE2.md` and the generated receipts for exact commands and limitations.

| Live PR / exact head | Python | TypeScript | Comparison |
| --- | --- | --- | --- |
| margot-pr-reviewer #7 / `439feb449780eb0190187667e8dbe68d8dc35a57` | APPROVED / LOW; eligible | APPROVED / LOW; eligible | Agreement; zero Claude calls |
| margot-pr-reviewer #2 / `4fad52cd3652586829113741dfea318af36d0fe0` | APPROVED / LOW; eligible | APPROVED / LOW; eligible | Same decision; two documentation cards add scrutiny |
| dotty #402 / `11777c29b8405076acb315027a466967534b89fb` | CHANGES_REQUESTED / MEDIUM; ineligible | CHANGES_REQUESTED / HIGH; held for protected-path authority, risk and author action | Same rollout, missing-test and stale-comment defects. Python lowered HIGH for limited actual rollout; the live voice retained HIGH for shared provisioner reach. This supplies both the functional and completed held proof. |
| eve-plus #9 / `7198b9ead47ecc6f7fe08a6b61516d783e8eaad4` | APPROVED / LOW; operator hold | ERROR at works-and-proven; ineligible; no final risk/voice | External dotty implementation/eval unavailable to the repository-bound tools. Not counted as a completed held verdict. |

Dotty's four saved live cards were reused only after validating current facts,
revision, configuration and card inputs. Classification, route, risk, voice and
final head checks ran live. Corrected raw exposure Score confidence and translated
route confidence match: dotty **0.70**, eve-plus **0.71**. Python comparisons are
existing checks on those exact heads; eve-plus's Python result is round two while
this shadow is a fresh first round. Jev unreachable and a substituted moved head
also returned errors in earlier safety proofs.

Finish counts: **one vault read, five Jev HTTP requests (all 200, no retries),
two Claude CLI invocations** (dotty voice, eve-plus incomplete card; $0.2808068).
Whole-slice totals: **six vault reads and 13 paid Claude CLI invocations**.
Historical Jev HTTP attempts were not fully metered; no aggregate is claimed.
The credential stayed in memory for the whole process. No startup retry reread it.
See `docs/live/finish-proof.json` for raw answers, final verdict, failure and counts.
The unchanged implementation was rebuilt under Node 22; receipt assertions passed.

## Risk and blast radius

The package is read-only shadow infrastructure. Python still posts. The model
has only repository evidence tools; it cannot run a shell, execute PR code or
write to GitHub. Recorded actions have no production authority. The final
exposure-Score routing translation and dotty's held/voice result are proved live.
A separate APPROVED-but-held result, cross-repository evidence access, hosted
Action execution and the whole-port independent review remain unproved.
No estate workflow changed.

## Rollback

Stay on main or revert the local slice commits. No deployment, GitHub write or
production data change needs reversal.

## Ticket

None.

## Dependencies

Node 22+, git, the pinned Claude Code CLI and publish-skills bundle, a Jev key,
Claude authentication and a read-scoped GitHub identity. The package uses Octokit,
p-retry, the standard MCP TypeScript SDK, parse-diff, YAML, Zod and picomatch.
The runner supplies credentials and trusted configuration. Samples contain no
real values.
