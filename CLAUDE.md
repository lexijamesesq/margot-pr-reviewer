# Margot PR reviewer

This package owns review and convergence decisions. It provides live read-only
GitHub, Jev and Claude adapters. In the default mode it records publication and
auto-merge actions locally. With `publication: "github"` in the configuration and
a write token supplied, it publishes check runs and reviews to GitHub.
Production authority remains outside this package.

## Setup and checks

Use Node 22 or later. Existing estate Git templates install native hooks in new
agent clones; retrofit an existing unprepared checkout once with
`pre-commit install --hook-type pre-commit --hook-type pre-push --hook-type commit-msg --hook-type prepare-commit-msg`.
After `npm ci`, direct native pre-push hooks run typecheck, behavior tests and build
for package source, tests, data, runtime, scripts, dependencies and configuration.
Prose-only pushes skip these package commands.
Native file filters can omit deletion-only changes; run the relevant commands
manually for removals. Fix findings.

During the transition, `.github/workflows/acceptance.yml` still runs hosted lint,
typecheck, tests and build under the required `ci / test` check, plus its separate
`ci / package` job. `.github/workflows/ci.yml` preserves the shared `@v1` universal
scan and Margot handoff and defines a distinct `ci / package validation` job on
Ubuntu/Node22. This new job becomes active after this PR merges:
`pull_request_target` reads the default branch's workflow. Its distinct
concurrency group keeps it independent of legacy acceptance. The new package job
runs only
for the authenticated functional class; mechanical and documentation classes
still skip it. It packs once through `prepack` and validates the same archive
with publint, ATTW and one installed smoke.

After this PR merges normally, prepare one follow-up PR whose only file change
is deletion of `.github/workflows/acceptance.yml`. First prove the new
`ci / package validation` job succeeds on that exact functional follow-up head.
The old `ci / test` gate remains required; hold the follow-up until the separately
approved gate migration.
With that approval, rename the existing required
context from `ci / test` to `ci / package validation` in both Dotty's existing
rulesets registry, released through `@v1`, and the live GitHub checks rule.
Preserve the GitHub Actions App ID 15368 and every other check, review, tag and
update gate. Obtain normal
Margot review and merge that one-file deletion PR. The new named job must pass
before the gate migration, and the legacy workflow leaves main only after the
migration and normal reviewed merge.

For focused diagnostics, use `npm run build`, `npm run lint`,
`npm run typecheck` and `npm test`. The README explains package installation,
API configuration and live prerequisites.

## Boundaries

- `src/review.ts` orchestrates validation, service deadlines and publication.
- `src/policy.ts` owns classification, routing, rating and clearance decisions.
- `src/ledger.ts` owns authenticated memory, scope, finding fates and counts.
- `src/questions.ts` owns Jev questions. Cards and voice stay in publish-skills
  (<https://github.com/lexijamesesq/publish-skills>).
- `src/schemas.ts` is the source of runtime schemas and inferred data types.
- `src/adapters/recorded.ts` records calls and publication without network access.

Do not turn a missing or failed response into empty success. Never enable merging.
Ledger history must be authenticated and complete. Treat recordings
as external inputs, including those with reconstructed evidence. No live service
calls belong in tests. Install hooks with `pre-commit install`; fix all findings.

Before creating or editing a PR, validate the exact body file with Dotty's
`.github/scripts/pr-body-check.py --template .github/pull_request_template.md --body-file <body-file>`.
Publish that same file with `gh pr create --body-file` or `gh pr edit --body-file`
through the enrolled author identity. Do not bypass native hooks.
