# Margot PR reviewer

This package owns review and convergence decisions. It provides live read-only
GitHub, Jev and Claude adapters. Publication and auto-merge actions are recorded
locally; production authority remains outside this package.

## Setup and checks

Use Node 22 or later. Run `npm ci`, `npm run build`, `npm run typecheck` and
`npm test`. Run `npm run test:breaks` to reproduce every deliberate-break receipt.
The README explains package installation, API configuration and live prerequisites.

## Boundaries

- `src/review.ts` orchestrates validation, service deadlines and publication.
- `src/policy.ts` owns classification, routing, rating and clearance decisions.
- `src/ledger.ts` owns authenticated memory, scope, finding fates and counts.
- `src/questions.ts` owns Jev questions. Cards and voice stay in publish-skills.
- `src/schemas.ts` is the source of runtime schemas and inferred data types.
- `src/adapters/recorded.ts` records calls and publication without network access.

Do not turn a missing or failed response into empty success. Never enable merging.
Ledger history must be authenticated and complete. Treat recordings
as external inputs, including those with reconstructed evidence. No live service
calls belong in tests. Install hooks with `pre-commit install`; fix all findings.
