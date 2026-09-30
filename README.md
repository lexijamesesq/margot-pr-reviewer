# Margot PR reviewer

An ESM TypeScript engine for first-round PR reviews, with live GitHub, Jev and
Claude Code adapters. Slice 2 runs in shadow mode: it records proposed publication
and auto-merge disarming locally and has no GitHub write implementation. Python
remains authoritative. Prior-ledger reviews remain unsupported; the live adapter
explicitly runs fresh first-round comparisons without modifying their history.

## Install and run the recorded review

Use Node 22 or later and npm. From a clone:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm pack
```

Install the resulting tarball in a separate project with `npm install /path/to/margot-pr-reviewer-0.2.0-slice2.tgz`.
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
compatible evidence; each file labels that limitation. These prove recorded engine
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
The live adapter and thin composite Action expose only shadow operation.

Configuration has no implicit authority defaults. An explicitly empty protection
list is allowed; missing configuration is rejected. The recordings show every key:

- `protectedPaths`: picomatch globs for review-authority paths, including dotfiles.
  Functional edits hold. Documentation and mechanical edits do not hold solely
  for a protected path; renames touching either protected endpoint always hold.
- `requiredChecks`, `trustedCheckActors`, `trustedTriageActors`: caller-owned policy.
  Required checks need one trusted successful receipt on the reviewed head.
- `cardBundle.commit`: the exact publish-skills revision. The resolver supplies
  both agents and an absolute path to every card. Each reviewer receives its own
  explicit card path; it never guesses a skill/cache location.
- `classificationThreshold`, `routeThreshold`, `riskTailThreshold`,
  `confidenceThreshold`, `noCouncilConfidenceFloor`: positive probabilities.
  The carried settings are 0.6, 0.35, 0.3, 0.3 and 0.3, respectively.
- `timeoutMs`: deadline for each service call; a failed or timed-out call is an error.
- `publication`: `record` or `none`. `calibration: true` always prevents clearance.

The fresh Jev class selects the path; a trusted earlier triage can only raise the
test profile. Functional outranks documentation, which outranks mechanical.
Mechanical reviews spend no Claude. Substantive documentation defaults to
`works-and-proven`, stays LOW, and sends defects/questions to the author. Jev's
questions live in `src/questions.ts`. Playbooks and the voice stay in publish-skills.
The voice model belongs to the bundle's `agents/margot.md`, not ReviewConfig.

The final rating drives both display and eligibility. Every mandatory finding must
have exactly one disposition. A held review records a proposed auto-merge disable;
it does not actually disarm anything. A moved head fails even with publication
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
npm install --global /absolute/path/margot-pr-reviewer-0.2.0-slice2.tgz
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
The output includes the engine result, proposed local actions and raw model responses.
It exits nonzero for infrastructure/validation errors; a reviewed hold remains a valid result.

The GitHub adapter paginates files, checks and reviews; rejects draft/fork PRs,
missing text patches, truncated hunks and moving revisions; and checks head freshness
again before recording. Closed PRs are allowed for retrospective comparisons.
`github.freshShadow: true` is mandatory: complete history is read, but earlier
ledgers are deliberately not used as prior findings. Nothing is posted or overwritten.
Binary changes and files outside GitHub's complete text evidence limits fail closed.

The runner verifies the bundle's Git commit, clean tree, both agents, common law
and all six playbooks. Agent prose, voice model and effort come from that pin.
The original plugin agents' tool lists override CLI `--tools`; the live probe showed
that they hid the replacement MCP tools. Therefore the runner loads the unchanged
agent prose through the CLI's standard `--agents` mechanism and replaces only the
runtime tool grant. It neither copies nor rewrites prompts into this package.
Cards read their exact pinned playbook and common law through `read_card`.

Each card has a new Claude process, its own empty working directory, no built-in
tools, no project settings/instructions/hooks, and a strict MCP configuration.
The standard MCP SDK exposes only `read_file`, `search_file` and `list_files` bound to this
repository's base/head SHAs, plus `read_card` for the selected card. The voice sees
only the repository read tools. No shell, PR code execution, GitHub mutation, local
filesystem read or arbitrary URL fetch is available to the model. A runner must
keep its trusted package and bundle immutable during a review. Ticket tools are
not connected in this slice; a card must report unavailable evidence.

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
- `npm test`: 134 named behavior tests, with no TODOs.
- `npm run test:breaks`: baseline, one changed response/input at a time, full-suite
  single-failure verification, restore, final baseline; writes the receipts.
- `pre-commit install`: install the repository's commit hooks. Fix findings;
  do not bypass them.

The estate-owned workflows remain unchanged. Package checks and break receipts
are reproducible locally; no live network or paid models run in the test suite.
