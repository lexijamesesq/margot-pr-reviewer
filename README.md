# Margot PR reviewer

Margot, the PR reviewer, as an ESM TypeScript package: first-round review and later-round verification, with live GitHub, Jev and
Claude Code adapters. Live operation defaults to shadow mode: it records proposed publication
and auto-merge disarming locally. Explicit GitHub mode posts checks and native
reviews, and disarms holds. Later rounds read authenticated review ledgers.

## Install and run the recorded review

Use Node 22 or later and npm. From a clone:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm pack
```

Install the resulting tarball in a separate project with `npm install /path/to/margot-pr-reviewer-0.5.0.tgz`.
Then run this as an `.mjs` file:

```js
import { readFile } from "node:fs/promises";
import { review, recordedServices } from "margot-pr-reviewer";

const recording = JSON.parse(await readFile(
  new URL(import.meta.resolve("margot-pr-reviewer/recordings/author-changes.json")),
  "utf8",
));
const services = recordedServices(recording);
const result = await review(recording.request, recording.config, services);
if (result.kind === "reviewed") {
  console.log(result.report);
  console.log(services.publications);
} else {
  console.log(result);
}
```

The seven recordings preserve historical review behavior under neutral names.
Five exact historical diffs were retrieved from public GitHub. Classifier answers,
check receipts and publication are reconstructed where the original harness lacked
compatible evidence; each file labels that limitation. These prove recorded
wiring, not current live model quality.
See [recording provenance](docs/recordings.md). Change a card finding and its voice
disposition to see clearance disappear; `scripts/consumer-smoke.mjs` demonstrates
this against an installed package.

## API and configuration

`review(request, config, services)` returns a `classified`, `reviewed` or `error`
result. Types are exported from the package. Request and service values are
validated at runtime with Zod. Errors cannot approve and carry a diagnostic stage,
without inventing a risk rating.

The request identifies repository, PR number, exact base/head SHAs, and phase
(`triage` or `review`). Services fetch facts; a caller cannot supply a pre-cleared
result. The service adapter is trusted infrastructure: it must authenticate actors,
fetch complete evidence, bind facts to both SHAs, honor abort signals, and prevent
writes if the head changes. Recorded services implement that boundary in memory.
The live adapter and thin composite Action support shadow and explicitly configured GitHub publication.

Configuration has no implicit authority defaults. An explicitly empty protection
list is allowed; missing configuration is rejected. The recordings show every key:

- `protectedPaths`: picomatch globs for review-authority paths, including dotfiles.
  Functional edits hold. Documentation and mechanical edits do not hold solely
  for a protected path; renames touching either protected endpoint always hold.
- `requiredChecks`, `trustedCheckActors`, `trustedTriageActors`: caller-owned policy.
  Required checks need one trusted successful receipt on the reviewed head.
  `allowedSkippedChecks` explicitly permits named skipped jobs; its default is empty.
- `trustedLedgerActors`: logins of the GitHub Apps allowed to supply review history.
  The default empty list trusts nobody. `github.freshShadow: true` explicitly selects
  an independent first-round experiment; leave it false for convergence.
  `github.shadowBeforeHead: true` instead omits only reviews on the requested head,
  preserving earlier-round history for side-by-side shadows. Both options are
  refused with GitHub publication.
- `cardBundle.commit`: the exact publish-skills revision. The resolver supplies
  both agents and an absolute path to every card. Each reviewer receives its own
  explicit card path; it never guesses a skill/cache location.
- `classificationThreshold`, `routeThreshold`, `riskTailThreshold`,
  `confidenceThreshold`, `noCouncilConfidenceFloor`: positive probabilities.
  The carried settings are 0.6, 0.35, 0.3, 0.3 and 0.3, respectively.
- `timeoutMs`: deadline for each service call; a failed or timed-out call is an error.
- `publication`: `record`, `none`, or `github`. `calibration: true` always prevents clearance.

The fresh Jev class selects the path; a trusted earlier triage can only raise the
test profile. Functional outranks documentation, which outranks mechanical.
Mechanical reviews without standing findings spend no Claude. Substantive documentation defaults to
`works-and-proven`, stays LOW, and sends defects/questions to the author. Jev's
questions live in `src/questions.ts`. Playbooks and the voice stay in publish-skills.
The voice model belongs to the bundle's `agents/margot.md`, not ReviewConfig.

The final rating drives both display and eligibility. Every mandatory finding must
have exactly one disposition. Shadow records a proposed auto-merge disable;
GitHub publication confirms the real disable on holds. A moved head fails even with publication
set to `none`. A shadow result is not an authorization for an external publisher.

## Live shadow review on a self-hosted runner

Provision Node 22+, git, Claude Code **2.1.283**, and a clean publish-skills clone
at **dc82ec72eea97ae6b0e161dd2ec909cb75033045**. Supply `JEV_KEY` for Jev
**jev-1.13.0**, `CLAUDE_CODE_OAUTH_TOKEN` for Claude, and a read-scoped `GH_TOKEN`.
Local CLI login is also supported. Alternatively, configure an absolute `github.gh`
path to a credential broker's gh executable. The bridge only permits GitHub GETs.
Credentials are environment values, never configuration file values. The package
contains no vault paths, estate identity, enrolment rules or publisher credentials.

```sh
npm install --global /absolute/path/margot-pr-reviewer-0.5.0.tgz
npm install --global @anthropic-ai/claude-code@2.1.283
git clone https://github.com/lexijamesesq/publish-skills.git /absolute/runtime/publish-skills
git -C /absolute/runtime/publish-skills checkout dc82ec72eea97ae6b0e161dd2ec909cb75033045
cp samples/config.sample.json /absolute/runtime/config.json
cp samples/request.sample.json /absolute/runtime/request.json
# Replace sample values with trusted runner paths, pins, policy and exact PR SHAs.
margot-review /absolute/runtime/request.json /absolute/runtime/config.json /absolute/runtime/result.json
```

All sample files use `*.sample.*` and contain placeholders. Only self-hosted runner
setup is supplied. The composite `action.yml` calls the same installed
`margot-review` executable. Provision its exact tarball version on the runner first;
the Action does not install software, check out a PR or mint credentials. The sample
workflow uses a placeholder action reference that must be pinned to a real commit.
Store request/config outside the PR checkout. Do not use the shadow job as a merge gate.
The output includes Margot's result, proposed local actions and raw model responses.
It exits nonzero for infrastructure/validation errors; a reviewed hold remains a valid result.

The GitHub adapter paginates files, checks and reviews; rejects draft/fork PRs,
missing text patches, truncated hunks and moving revisions; and checks head freshness
again before recording. Closed PRs are allowed for retrospective comparisons.
`github.freshShadow` defaults to false, so complete authenticated history participates
in later rounds. Nothing is posted or overwritten.
Binary changes and files outside GitHub's complete text evidence limits fail closed.

## Instance commands

Margot ships `margot-instance` so a consumer does not need a parallel JavaScript
implementation of routing and request admission. The commands are strict: malformed
JSON, incomplete pins, invalid policy inputs, or uncertain GitHub facts fail nonzero.

`validate-deployment` checks a trusted deployment file's `version`, exact GitHub
release asset URL, npm SHA-512 integrity, and bootstrap SHA-256. It also checks the
target against caller-supplied enrolled repositories, limits authority to a supplied
authority subset, and appends `authority` plus `repositoryName` to `GITHUB_OUTPUT`
when that variable is present:

```sh
margot-instance validate-deployment \
  --deployment /trusted/deployment.json \
  --release-repository YOUR_ORG/margot-pr-reviewer \
  --repository YOUR_ORG/YOUR_REPOSITORY \
  --enrolled-repositories '["YOUR_ORG/YOUR_REPOSITORY"]' \
  --authority-repositories '[]'
```

`bind-request` reads the PR through Octokit using `GH_TOKEN`. It rejects a closed,
draft, forked, or moved request, then writes mode-0600 `request.json` and `config.json`
under the absolute engine root. Required checks, protected paths, permitted skipped
checks, and authority are explicit inputs. Authority selects GitHub publication;
otherwise the configuration is a before-head shadow. `${ENGINE_ROOT}` in the Claude
executable, plugin directory, and ticketing command is replaced with the trusted root.

```sh
margot-instance bind-request \
  --repository YOUR_ORG/YOUR_REPOSITORY --pr 1 --head "$HEAD_SHA" \
  --phase review --authority false --engine-root "$ENGINE_ROOT" \
  --config /trusted/config.json --required-checks '["ci / checks"]' \
  --protected-paths '[".github/**"]' --allowed-skipped-checks '[]' \
  --run-url "$RUN_URL"
```

The consumer still owns estate policy derivation, token minting, package download,
and exact-byte verification. Before Margot is installed, use stock shell tools to
read `packageReference` and `packageSha256`, download the asset, run
`sha256sum --check`, and install that tarball with `npm install --ignore-scripts`; see
`samples/self-hosted.sample.yml`.

The runner verifies the bundle's Git commit, clean tree, both agents, common law
and all six playbooks. Agent prose, voice model and effort come from that pin.
The original plugin agents' tool lists override CLI `--tools`; the live probe showed
that they hid the replacement MCP tools. Therefore the runner loads the unchanged
agent prose through the CLI's standard `--agents` mechanism and replaces only the
runtime tool grant. It neither copies nor rewrites prompts into this package.
Cards read their exact pinned playbook and common law through `read_card`.

Each card has a new Claude process, its own isolated working directory, no built-in
tools, no project settings/instructions/hooks, and a strict MCP configuration.
The standard MCP SDK exposes only `read_file`, `search_file`, `read_diff` and `list_files` bound to this
repository's base/head SHAs, plus `read_card` for the selected card. The voice sees
only the repository read tools. Optional `claude.references` maps a reference name
to `{ repository, head }`, where `head` is an immutable 40-character SHA; it enables
`read_reference` only for those configured pins. No shell, PR code execution, GitHub mutation, local
arbitrary filesystem read or arbitrary URL fetch is available to the model. A runner must
keep its trusted package and bundle immutable during a review. Optional
`claude.ticketing` configuration gives card runs, but never the voice, a named
MCP server and an exact tool allowlist. The consumer's own MCP server for their
ticketing system goes here.

Jev uses native fetch and bounded p-retry backoff. Terminal authentication errors
fail immediately; exhausted transient failures cannot approve. Its Noul responses
contain no confidence field: routing confidence comes from the exposure Score,
as in Python. Risk confidence comes directly from Jev's five Score answers. No Claude fallback
can substitute for failed Jev evidence.

The runner retains prose and validates completion, Checked blocks, finding fields,
unique verdict fields and complete finding accounting. It does not depend on
`--json-schema`; see [the earlier probe](docs/cli-compatibility.md) and
[the slice 2 proof](docs/SLICE2.md). Transport references:
[Claude CLI](https://code.claude.com/docs/en/cli-reference),
[TypeSafe API](https://docs.typesafe.ai/api),
[Octokit](https://github.com/octokit/octokit.js),
[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Development

- `npm run build`: ESM and declarations into `dist`.
- `npm run typecheck`: strict checks of source and tests.
- `npm test`: named behavior tests, with no TODOs.
- `npm run test:breaks`: baseline, one changed response/input at a time, full-suite
  single-failure verification, restore, final baseline; writes the receipts.
- `pre-commit install`: install the repository's commit hooks. Fix findings;
  do not bypass them.

The estate-owned workflows remain unchanged. Package checks and break receipts
are reproducible locally; no live network or paid models run in the test suite.

## Later rounds

A reviewed result contains `ledger` and `convergence`. The rendered report ends
with a versioned ledger block. GitHub review author, author type, submitted time
and commit ID authenticate selection; a malformed or untrusted ledger stops the
review. The adapter reads every review page. Python v1 ledgers are accepted as
prior-round inputs. The typed v2 ledger is posted in a v1-compatible JSON envelope with plain entries
and a compressed `receipt_v2` extension. Unchanged Python reads the same entries;
TypeScript restores the exact saved receipt. Earlier compressed v2 blocks remain
readable. Decoding has a one-MiB limit. Oversized
results fail rather than silently dropping open findings or dismissals.

### 0.4.1 receipt compatibility

Margot 0.4.1 reads receipts written by 0.4.0; Margot 0.4.0 does not read receipts
written by 0.4.1. This boundary is acceptable because 0.4.0 has never published
a receipt (shadow only, publication none) and will not; the rollback target during
the canary is the Python runtime, not 0.4.0.

Cards review the complete unified delta, restricted to the PR's files, plus their
own standing, advisory and dismissed entries. The compare JSON file list is not used as an
inventory. A rebase, unreadable compare or incomplete diff keeps the ledger and
uses the already validated full PR evidence. Every card with an open finding
is recalled, including on mechanical and editorial paths. Matching, fix evidence,
dismissal reopening and late attribution remain model judgments. Margot does
not infer finding identity or fixes from line-number arithmetic.

From round two, MINOR findings become advisory. A missed finding blocks only at
BLOCKING, or MAJOR for safety; a delta-reach regression keeps its honest severity.
Nothing escalates or relaxes after round three. A silent MINOR counts as fixed;
a silent MAJOR or BLOCKING requires Margot's confirmation. Dismissals retain their
reasons until the delta changes the cited code. A new delta finding must state
whether it is new, missed, or caused through delta reach; missing attribution fails
closed. The displayed counts are New, Open, Closed, with each finding listed below.

An exact-head retry reuses the authenticated v2 result and counts without model
calls, after checking configuration, evidence, required checks and current head.
A changed base, body, evidence or configuration invalidates the cached result.
An old Python same-head ledger has no saved result and fails closed; a new head
can still build on it normally.

Large Jev requests are split into complete evidence batches. Classification and
routing take maximum probabilities across batches; risk takes maximum tail
probabilities and minimum confidence. The live model reads the complete scoped
diff through a paged, read-only tool; prompts travel through stdin. These transport
limits never authorize dropping the tail of the evidence. Cross-batch reasoning
is a model-quality limitation; the live comparison records its observed effects.

Run `npm run test:breaks` for all recorded, adapter and convergence break receipts.
See [slice 3 proof](docs/SLICE3.md) for exact live heads, differences and limitations.

## GitHub publication

Set `review.publication` to `github`, leave `github.freshShadow` false and supply
`publisher` with three check names (`triage`, `review`, `authority`), the App's
`actor` login, numeric `appId`, and this invocation's unique `runUrl`. Supply a
read-only `GH_TOKEN` and a separate `MARGOT_WRITE_TOKEN`. The latter needs checks
and pull-request write access, plus the permission needed to disable auto-merge.
It is never forwarded to the model environment or read-only evidence server.
The CLI calls `liveServices(...).run(request)`; API consumers using publication
must use that lifecycle too. Calling its publisher outside the lifecycle fails.

The optional `claude.ticketing` block specifies `server`, `command`, `args`,
`env`, and `tools`. `env` contains environment-variable names, never values;
Margot forwards only those named values to the ticketing server. If the block is
absent or any named value is empty or unset, Margot attaches neither the server
nor its tools.

The publisher adopts the caller's check by App, name and head, records run
ownership and refuses to let a superseded invocation close the newer run's check.
It withdraws earlier App approvals before reevaluation, keeps the required check
pending, then publishes classification, authority status and the SHA-bound native
review. Every check write must succeed before the eligible native approval is posted.
Reviewed holds use COMMENT and neutral; errors use action_required. It never
requests changes at GitHub's review gate, enables auto-merge, or merges.
Every write rechecks head/base and admission. Partial failures attempt to disarm,
withdraw approvals and close the gate. A failed cleanup remains an error; an API
outage can leave the check pending. GitHub has no transaction spanning these
writes, so same-head writers must share the caller's PR concurrency group.

New counts issues first raised this round. Open counts standing and advisory
issues. Closed counts retained fixed and dismissed issues. Every ledger issue
appears exactly once below the tally, with its fate, first-round marker and late
attribution. Closed history remains visible in later rounds; notes are separate
and are not issues. These are the operator's three labels, not Python arithmetic.
The saved receipt retains old diagnostic counters for compatibility; the
visible tally is derived from the listed entries. Oversize history fails closed.

The self-hosted sample workflow installs the exact release asset and verifies its
SHA-256 before installing. No hosted-runner
sample is supplied. Publication remains subject to a consumer's reversible live
canary; see `docs/SLICE4.md` for the local proof and its limits.
