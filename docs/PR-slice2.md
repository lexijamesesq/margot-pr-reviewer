<!-- pr-body:v1 -->
<!-- markdownlint-disable MD041 -->
## Intent

Run first-round Margot reviews on the operator's real PRs through live GitHub,
Jev and Claude Code adapters, with all publication recorded locally. Python
keeps production authority. Slice 2 acceptance is not yet complete: live
functional risk and voice scoring still need the requested credential read.

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

The local suite has 134 passing tests. Generated receipts cover the 96 inherited
scenario breaks, five additional core source mutations, and 38 new adapter breaks.
The installed tarball passes an independent consumer smoke; replacing its CLI
with an empty executable fails the entrypoint assertion and restoration passes.
See `docs/SLICE2.md` and the generated receipts for exact commands and limitations.

A recent mechanical PR completed APPROVED/LOW without Claude. A README PR
completed APPROVED/LOW after two live cards. Four functional cards confirmed
Python's real rollout, missing-test and stale-comment findings, but the final
live risk/voice result is still pending. Jev unreachable and a substituted moved
head both returned errors without approval. Eleven paid Claude invocations ran;
there were five Jev credential reads and no additional read without authorization.

## Risk and blast radius

The package is read-only shadow infrastructure. Python still posts. The model
has only repository evidence tools; it cannot run a shell, execute PR code or
write to GitHub. Recorded actions have no production authority. The final
exposure-Score routing translation has offline coverage but needs a live rerun.
Functional held-result proof, live voice proof, hosted Action execution and the
whole-port independent review remain incomplete. No estate workflow changed.

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
