# Margot PR reviewer

An ESM TypeScript engine for first-round PR reviews. Slice 1 runs recorded services:
classification, selected review cards, risk, Margot's voice when needed, a rendered
decision, and recorded publication. It does not call GitHub, Jev or Claude, and it
never merges. Prior-ledger reviews return an error until slice 3.

## Install and run the recorded review

Use Node 22 or later and npm. From a clone:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm pack
```

Install the resulting tarball in a separate project with `npm install /path/to/margot-pr-reviewer-0.1.0-slice1.tgz`.
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
There is no live adapter or Action in this slice.

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
have exactly one disposition. A held review disarms already armed auto-merge before
publication; a failure after facts are available also attempts to disarm it.
Publication errors return an error even if a service performed a partial write.
Live adapters will need idempotent recovery for such partial writes.

## Live consumer setup for slice 2

This is the required installation contract, not a claim that live review is shipped.
A consumer supplies Node 22, npm, git, `gh`, Claude Code **2.1.283**, a Claude OAuth
token, a TypeSafe API key for Jev **jev-1.13.0**, and GitHub credentials. Reviewer
tools receive only a read-scoped GitHub identity; the publisher's write credential
must never enter a model process. OAuth comes from `claude setup-token` and is
supplied as `CLAUDE_CODE_OAUTH_TOKEN`; the live Jev adapter will read `JEV_KEY`.
Keep credential values outside repository configuration.

Install the pinned CLI and the pinned local marketplace in a dedicated runtime:

```sh
npm install --global @anthropic-ai/claude-code@2.1.283
mkdir -p runtime/claude
export CLAUDE_CONFIG_DIR="$PWD/runtime/claude"
git clone https://github.com/lexijamesesq/publish-skills.git runtime/publish-src
git -C runtime/publish-src checkout dc82ec72eea97ae6b0e161dd2ec909cb75033045
claude plugin marketplace add "$PWD/runtime/publish-src"
claude plugin install publish@publish
claude plugin enable publish
claude plugin list
```

Enable is required because the plugin defaults to disabled. Verify both agents,
`skills/pr-council/SKILL.md`, and all six playbooks at the pinned installation before
review. The bundle resolver must verify these files and inject their resolved
paths. Cards may need `Bash(gh:*)` for read-only evidence; a command-name permission
alone does not make an overpowered GitHub token safe.

Create a credential-free `empty-mcp.json` containing `{"mcpServers":{}}`. Every
model process must use `--strict-mcp-config --mcp-config /absolute/path/empty-mcp.json`
to exclude agent-declared MCP servers, including `linear-tactic`. Load no PR
instructions or hooks, execute no PR code, and keep the base checkout read-only.
Confinement and optional read-only ticket tools need live verification in slice 2.

The authenticated pinned CLI probe accepted the flags but returned no
`structured_output` and violated the requested schema. The tested combination is
not suitable as the live adapter contract. Slice 1 validates normalized service
responses independently of CLI format. Slice 2 will translate the bundle's existing
output convention and preserve raw diagnostics; switching to CLI schema mode needs
a successful production-shaped probe. See [the exact receipt](docs/cli-compatibility.md),
[Anthropic's CLI documentation](https://code.claude.com/docs/en/headless)
for the interface and [Zod's documentation](https://zod.dev/basics) for runtime validation.

## Development

- `npm run build`: ESM and declarations into `dist`.
- `npm run typecheck`: strict checks of source and tests.
- `npm test`: 84 named behavior tests, with no TODOs.
- `npm run test:breaks`: baseline, one changed response/input at a time, full-suite
  single-failure verification, restore, final baseline; writes the receipts.
- `pre-commit install`: install the repository's commit hooks. Fix findings;
  do not bypass them.

The inherited CI floor remains unchanged. Package checks are reproducible locally;
adding a live Action and deciding its workflow integration belong to slice 2.
