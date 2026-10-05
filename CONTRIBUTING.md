# Contributing

Node 22 or later. After `npm ci`:

```sh
npm run build
npm run lint        # biome, zero warnings expected
npm run typecheck
npm test            # Vitest; no live network calls, no paid models
node scripts/package-smoke.mjs <tarball>   # installs a packed tarball and runs both executables
```

This repository uses pre-commit hooks (`pre-commit install`). Fix findings rather
than bypassing them.

## Maintainer tooling

`ruff.toml`, `.house-code.json`, `.prettierrc`, the `ollie-*` and
`self-instrument-alert` workflows, and the pull-request template are the
maintainer's repository tooling, provisioned centrally. You do not need them to
contribute, and they apply only to this repository's own pull requests.
