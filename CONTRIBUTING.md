# Contributing

Node 22 or later. After `npm ci`:

```sh
npm run lint        # biome, zero warnings expected
npm run typecheck
npm test
```

## Maintainer tooling

`ruff.toml`, `.house-code.json`, `.prettierrc`, the `ollie-*` and
`self-instrument-alert` workflows, and the pull-request template are the
maintainer's repository tooling, provisioned centrally. You do not need them to
contribute, and they apply only to this repository's own pull requests.
