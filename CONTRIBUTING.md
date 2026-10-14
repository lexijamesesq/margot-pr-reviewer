# Contributing

Node 22 or later. After `npm ci`:

```sh
npm run build
npm run lint        # biome, zero warnings expected
npm run typecheck
npm test            # Vitest; no live network calls, no paid models
node scripts/package-smoke.mjs <tarball>   # installs a packed tarball and runs both executables
```

Existing estate Git templates install native hooks in new agent clones. For an
existing checkout missing hooks, install them once from the repository root:

```sh
pre-commit validate-config .pre-commit-config.yaml
pre-commit install --hook-type pre-commit --hook-type pre-push \
  --hook-type commit-msg --hook-type prepare-commit-msg
```

After `npm ci`, native pre-push hooks run typecheck, behavior tests and build for
changes under `src/`, `tests/`, `recordings/`, `runtime/`, `samples/` and `scripts/`,
or to package manifests, TypeScript configuration and the hook configuration.
Ordinary prose-only pushes skip these package commands. Native file filtering can
omit deletion-only changes; run the commands above manually for relevant removals.
Fix findings rather than bypassing hooks. Keep existing custom hooks and
`core.hooksPath`; coordinate with their owner before integrating native hooks.

## Maintainer tooling

`ruff.toml`, `.house-code.json`, `.prettierrc`, the `ollie-*` workflows,
and the pull-request template are the
maintainer's repository tooling, provisioned centrally. You do not need them to
contribute, and they apply only to this repository's own pull requests.
