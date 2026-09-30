# Clean-clone proof

Verified implementation commit `00adb09d5db4b4c5140592954fb77de9745c48f2`
on branch `slice2-live-services`. The clone used Git objects, not the working
copy or its node_modules. Node v22.23.3, npm 10.9.9.

| Check | Result |
| --- | --- |
| npm ci | Passed; 213 packages installed, audit reported zero vulnerabilities |
| npm run typecheck | Passed |
| npm test | 134 tests passed in two files |
| npm run build | Passed |
| npm pack | Passed, including prepack build; 48 packaged files |
| Installed package smoke | Public API and npm-created executable passed |
| Installed CLI break | Empty executable failed its argument-validation assertion; restoration passed |

The tarball SHA-1 reported by npm was
`5d958fd9eeef21859ac7052dd86a464562fb1d5e`. Its size was 36.7 kB compressed,
149.8 kB unpacked. The consumer was a new directory outside either source tree.
See [the generated smoke receipt](package-smoke-receipt.md).
The follow-up commit records proof documents only; implementation and package
inputs remain the verified tree above.

## Exact commands used

From the task workspace, with the Node 22 installation already provisioned:

```sh
git clone --no-local --branch slice2-live-services "$PWD/margot-pr-reviewer" /private/tmp/margot-slice2-clean-00adb09
cd /private/tmp/margot-slice2-clean-00adb09
export PATH=/private/tmp/margot-node22/node_modules/.bin:$PATH
export npm_config_cache=/private/tmp/margot-npm-cache
node --version
npm --version
git rev-parse HEAD
npm ci
npm run typecheck
npm test
npm run build
npm pack --pack-destination /private/tmp/margot-slice2-artifacts
node scripts/package-smoke.mjs /private/tmp/margot-slice2-artifacts/margot-pr-reviewer-0.2.0-slice2.tgz
```

The local full command log is `/private/tmp/margot-slice2-clean.log`.
The mutation harness ran separately before this clone and generated
[test-break-receipts.md](test-break-receipts.md) and
[adapter-break-receipts.md](adapter-break-receipts.md). This clean-clone check
reran the restored baseline, not every mutation. It used no live credentials
and made no model calls or GitHub writes.
