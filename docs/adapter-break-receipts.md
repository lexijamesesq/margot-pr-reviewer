# Live adapter break receipts

Generated 2026-09-30T05:05:42.534Z, Node v22.23.3. Baseline and restored suite: 134/134 passed. Each of 38 isolated breaks ran the complete suite and failed exactly its named assertion.

One declared source mutation grants Bash to the CLI; its invocation test catches it. The remaining breaks are controlled input/transport counterexamples in tests/adapters.test.ts, selected by MARGOT_ADAPTER_BREAK. Error cases repair the bad input; positive cases replace evidence with its opposite. Credential isolation inserts a forbidden credential into the filtered environment. They do not claim exhaustive source mutation coverage or independence: changing only one test's input guarantees other fixtures are unchanged. No live service or paid model call occurs in this harness. Live confinement and model quality are separate proofs.

Manifest SHA-256: 0496aba709d0430995fa6d8957675d811c3d62d55e5f88afea4b6002dc5aaa2a. Reproduce: npm run test:adapter-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| GitHub follows the second file page | omit the second page | 1 failed; 133 passed |
| GitHub refuses an incomplete file inventory | repair the file count | 1 failed; 133 passed |
| GitHub refuses a missing text patch | supply a usable patch | 1 failed; 133 passed |
| GitHub refuses a diff missing its file header | repair the diff header | 1 failed; 133 passed |
| GitHub refuses head movement during fact collection | keep the head fixed | 1 failed; 133 passed |
| GitHub refuses draft PRs | mark the PR ready | 1 failed; 133 passed |
| GitHub refuses fork PRs | use the base repository as head repository | 1 failed; 133 passed |
| Unreadable GitHub history cannot establish first round | restore the reviews endpoint | 1 failed; 133 passed |
| Existing ledgers are detected outside explicit fresh shadow | remove the ledger marker | 1 failed; 133 passed |
| The gh bridge rejects a write method before spawning | replace POST with GET | 1 failed; 133 passed |
| The gh bridge rejects an alternate API origin | use the GitHub API origin | 1 failed; 133 passed |
| Jev nouls become normalized classification probabilities | change the mechanical noul | 1 failed; 133 passed |
| Malformed Jev classification cannot pass validation | repair the malformed noul | 1 failed; 133 passed |
| Jev retries a transient response and recovers | remove the transient failure | 1 failed; 133 passed |
| Jev authentication failures are terminal | replace 401 with transient 503 | 1 failed; 133 passed |
| Jev transport outage cannot approve a review | restore Jev availability | 1 failed; 133 passed |
| Jev score distributions preserve their risk levels | move probability to a lower level | 1 failed; 133 passed |
| Jev exposure confidence preserves routing uncertainty | supply a confident exposure score | 1 failed; 133 passed |
| A moved head cannot approve with publication disabled | restore the requested head | 1 failed; 133 passed |
| Card prose preserves a real mandatory finding | remove the finding from the response | 1 failed; 133 passed |
| A card without its Checked block is not green | restore the Checked label | 1 failed; 133 passed |
| An incomplete card cannot become empty success | restore completed status | 1 failed; 133 passed |
| Malformed tagged findings cannot silently disappear | remove the malformed finding | 1 failed; 133 passed |
| Duplicate card completion labels are rejected | remove the duplicate label | 1 failed; 133 passed |
| Voice prose preserves finding IDs and dispositions | remove the established finding | 1 failed; 133 passed |
| Duplicate voice bands are rejected | remove the duplicate band | 1 failed; 133 passed |
| Claude inherits only its explicit credential allowlist | insert a GitHub credential into the filtered environment | 1 failed; 133 passed |
| A failed subprocess cannot return success | make the subprocess exit zero | 1 failed; 133 passed |
| A timed out subprocess cannot return success | let the child exit before its deadline | 1 failed; 133 passed |
| A mismatched bundle commit fails before loading cards | use the actual fixture commit | 1 failed; 133 passed |
| MCP evidence keeps caller-supplied repository and SHA out of routing | request the base revision instead of head | 1 failed; 133 passed |
| The evidence server exposes only repository read tools | register a write tool on the test server | 1 failed; 133 passed |
| Claude cannot invoke built-in tools or load PR settings | source mutation: grant Bash in the CLI built-in tool list | 1 failed; 133 passed |
| A partial final hunk cannot claim complete facts | restore the missing added line | 1 failed; 133 passed |
| Large evidence files can be read in bounded numbered ranges | request the first page instead of the requested later page | 1 failed; 133 passed |
| Evidence search locates literal text without executing it | search for absent text | 1 failed; 133 passed |
| A moved base cannot pass the final GitHub freshness check | restore the requested base SHA | 1 failed; 133 passed |
| A dirty card bundle cannot pass as the pinned instructions | restore the clean tracked bundle | 1 failed; 133 passed |
