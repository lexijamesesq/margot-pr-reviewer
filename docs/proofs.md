# Slice 1 proof receipts

Verified on 2026-09-30 UTC. Runtime/test source commit:
`cad09506cf4144eb18a199b4459e8a4205319a09`. The later handover commit changes only
Markdown documentation. Toolchain: Node 22.23.3, npm 10.9.9, TypeScript 5.9.3,
Vitest 4.1.11. The branch is local and unpublished, so the clean clone is a
`git clone --no-local` of the local branch, not a remote branch that does not exist.

| Proof | Observed result |
| --- | --- |
| Clean-clone `npm ci` | 52 packages installed; 0 vulnerabilities |
| `npm run build` | Exit 0; ESM JavaScript and declarations emitted |
| `npm run typecheck` | Exit 0; strict source and test checks |
| `npm test` | 84 passed, 0 failed, 0 TODO/skipped |
| `npm run test:breaks` on the same runtime/test tree | Baseline 84 passed; all 84 breaks failed only their named test; restored 84 passed |
| `npm run audit:recordings` | All seven recordings pass identity/credential/host/path scan |
| `npm audit` | 0 vulnerabilities |
| `pre-commit run --all-files` and commits | All applicable hooks pass; none bypassed |
| `npm pack --json` | 26 files; 23,075 bytes packed; 104,188 bytes unpacked |
| Empty external project installs tarball | 3 packages installed; 0 vulnerabilities |
| `node review.mjs` in external project | APPROVED, then CHANGES_REQUESTED after a finding; two matching recorded publications |
| Remove installed `dist/index.js`, run consumer smoke | Exit 1; `ERR_MODULE_NOT_FOUND`; only the standalone consumer smoke was invoked |
| Restore installed `dist/index.js`, rerun | Exit 0; APPROVED then CHANGES_REQUESTED; two publications |
| Git status of clean proof clone | Empty |
| Reference repository status | Both unchanged and clean |
| Remote publication | No push and no GitHub writes performed |

Tarball: `margot-pr-reviewer-0.1.0-slice1.tgz`.
SHA-256: `b668b1a05d631498bc67fa98beb706061499e19fdba2b82be6bd158996f766e4`.
The package contains compiled code, declarations, seven recordings, README and
LICENSE. It does not include tests, source, tools, raw captures or credentials.

## Reproduction

The table above records the clean-clone and consumer results. [Test receipts](test-break-receipts.md)
enumerate each named behavior and exact failing-test count. Exact patch values and
declared source mutations are in `tests/scenarios.json`. The CLI probe and its
negative outcome are separately recorded in [CLI compatibility](cli-compatibility.md).

For the separate packaging control, in the external consumer directory after a
passing smoke run:

```sh
mv node_modules/margot-pr-reviewer/dist/index.js ./saved-entry.js
if node review.mjs > broken-output.txt 2>&1; then
  mv ./saved-entry.js node_modules/margot-pr-reviewer/dist/index.js
  exit 1
fi
rg ERR_MODULE_NOT_FOUND broken-output.txt
mv ./saved-entry.js node_modules/margot-pr-reviewer/dist/index.js
node review.mjs
```

This exercises a missing packaged runtime entry point without changing tests or
source. The actual run used a `finally` block to restore that file even on a
failed assertion. The consumer smoke is separate from the 84 Vitest behaviors.
