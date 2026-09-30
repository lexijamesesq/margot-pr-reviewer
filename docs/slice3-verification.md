# Slice 3 verification

The detailed live decisions, limitations and call counts are in `SLICE3.md`.
The compressed replay corpus includes complete normalized inputs; it is not a
fixture of expected verdicts alone. Replaying it makes no network or paid calls.

| Check | Result |
| --- | --- |
| Node 22 strict typecheck and build | Passed |
| Vitest | 204 passed; zero skipped or TODO |
| Core break receipts | 96 isolated counterexamples and 13 source mutations caught; restored 204/204 |
| Adapter break receipts | 49 isolated breaks caught; restored 204/204 |
| Convergence break receipts | 59 isolated breaks caught; restored 204/204 |
| Live result replays | Both sequences match every typed field and visible report; stock zlib encoding may differ across Node versions |
| Same-head retries | Ten identical results; only facts and final-head reads |
| Rebase and unreadable compare | Full review; all six previous #9 findings retained and fixed |
| Forged or unreadable history | ERROR at history; no approval or publication |
| Recording audit | All seven retained recordings passed |

The break tests use service/input counterexamples except where their manifests
specify an implementation mutation. This is not a claim of exhaustive source
mutation coverage. The saved real-world body text is today's edited PR body;
only code heads and diffs are historical. Full caveats are in `SLICE3.md`.

Runtime/test implementation commit: `4a9c6ac291ffca8127acf1334565a11a6f915361`.
The follow-up changes only this verification record, the hand-over explanation,
and cross-Node replay comparison of the hidden compression encoding. Every typed
field and all visible report text remain strict comparisons; the full same-runtime
retry result still uses deep equality.

Node **22.23.3** clean local clone (`git clone --no-local --branch
slice3-convergence`) installed 213 packages with `npm ci`; audit reported zero
vulnerabilities. Build, typecheck, all 204 tests and the seven-recording audit
passed. The branch is intentionally unpublished, so this is a clean local clone,
not a claim that a remote slice-3 branch exists. The complete break harness also
ran on Node 22, with 204/204 restored after every group.

The installed tarball smoke passed public API import, approval-to-change-request
behavior, CLI execution, its deliberate empty-CLI failure, and restoration. The
artifact contains 50 files, 215.9 kB unpacked, and excludes proof corpora and tests.
Tarball SHA-256:
`a8d179ad866d69451042d745efc1fcf29f81a8d1124f5a66fbbcbc3b59c386ca`.
Replay corpus SHA-256:
`a81cff7ceab14df14d8ebc38af6efeda910ece482f086b27ad605fa58dbcc5f5`.

The all-files hook run formatted the new replay script; that change was staged
and the commit hooks then passed. No hook was bypassed. No estate workflow differs
from main. All GitHub interaction was read-only; live model tools had no GitHub
write capability. Local credentials and uncompressed working logs are not part of
the package or commit.
