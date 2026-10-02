# Live adapter break receipts

Generated 2026-10-02T21:31:09.678Z, Node v26.3.1. Baseline and restored suite: 348/348 passed. Each of 64 isolated breaks ran the complete suite and failed exactly its named assertion.

Adapter cases exercise CLI grants, version and envelope guards, prose mapping, hunk completeness, pagination, stdin prompts, round delta binding and subprocess redaction. Credential isolation inserts a forbidden credential into the filtered environment. Live confinement and model quality remain separate proofs.

Most breaks are controlled service/input counterexamples selected by MARGOT_ADAPTER_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 500e725c130b1da0e4333e9b8dbf0dab44936e1343c8b5b2c5d945a6aebda756. Reproduce: npm run test:adapter-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| GitHub follows the second file page | omit the second page | 1 failed; 347 passed |
| GitHub refuses an incomplete file inventory | repair the file count | 1 failed; 347 passed |
| GitHub refuses a missing text patch | supply a usable patch | 1 failed; 347 passed |
| GitHub refuses a diff missing its file header | repair the diff header | 1 failed; 347 passed |
| GitHub refuses head movement during fact collection | keep the head fixed | 1 failed; 347 passed |
| GitHub refuses draft PRs | mark the PR ready | 1 failed; 347 passed |
| GitHub refuses fork PRs | use the base repository as head repository | 1 failed; 347 passed |
| Unreadable GitHub history cannot establish first round | restore the reviews endpoint | 1 failed; 347 passed |
| Existing ledgers are detected outside explicit fresh shadow | remove the ledger marker | 1 failed; 347 passed |
| The gh bridge rejects a write method before spawning | replace POST with GET | 1 failed; 347 passed |
| The gh bridge rejects an alternate API origin | use the GitHub API origin | 1 failed; 347 passed |
| Jev nouls become normalized classification probabilities | change the mechanical noul | 1 failed; 347 passed |
| Malformed Jev classification cannot pass validation | repair the malformed noul | 1 failed; 347 passed |
| Jev retries a transient response and recovers | remove the transient failure | 1 failed; 347 passed |
| Jev authentication failures are terminal | replace 401 with transient 503 | 1 failed; 347 passed |
| Jev transport outage cannot approve a review | restore Jev availability | 1 failed; 347 passed |
| Jev score distributions preserve their risk levels | move probability to a lower level | 1 failed; 347 passed |
| Jev exposure confidence preserves routing uncertainty | supply a confident exposure score | 1 failed; 347 passed |
| A moved head cannot approve with publication disabled | restore the requested head | 1 failed; 347 passed |
| Card prose preserves a real mandatory finding | source mutation: drop the consequence label from the finding detail | 1 failed; 347 passed |
| A card without its block labels still yields its tagged findings | remove the tagged finding the label-free block carries | 1 failed; 347 passed |
| An incomplete card is recorded with its reason and summons the voice | restore completed status | 1 failed; 347 passed |
| Malformed tagged findings cannot silently disappear | remove the malformed finding | 1 failed; 347 passed |
| Repeated card labels take the first match | make the first completion label a skip | 1 failed; 347 passed |
| Tagged bullets tolerate emphasis, key order and unknown annotations | drop the brackets from the emphasised tag | 1 failed; 347 passed |
| Missing or repeated finding sub-fields are read, never refused | supply the consequence the expectation omits | 1 failed; 347 passed |
| Finding ids are Python's global F1…Fn in card order | assemble the council in reverse card order | 1 failed; 347 passed |
| Voice prose preserves finding IDs and dispositions | move an established finding into the dismissed section | 1 failed; 347 passed |
| Voice prose accepts Python's scalar, section, and disposition tolerance | source mutation: restore the strict disposition regex | 1 failed; 347 passed |
| Margot's ERROR is a parsed ruling, not an exception | replace the ERROR outcome with CHANGES_REQUESTED | 1 failed; 347 passed |
| Claude inherits only its explicit credential allowlist | insert a GitHub credential into the filtered environment | 1 failed; 347 passed |
| A failed subprocess cannot return success | make the subprocess exit zero | 1 failed; 347 passed |
| A timed out subprocess cannot return success | let the child exit before its deadline | 1 failed; 347 passed |
| A mismatched bundle commit fails before loading cards | use the actual fixture commit | 1 failed; 347 passed |
| MCP evidence keeps caller-supplied repository and SHA out of routing | request the base revision instead of head | 1 failed; 347 passed |
| The evidence server exposes only repository read tools | register a write tool on the test server | 1 failed; 347 passed |
| Claude cannot invoke built-in tools or load PR settings | source mutation: grant Bash in the CLI built-in tool list | 1 failed; 347 passed |
| Configured ticket evidence is granted only to card runs | attach the configured ticket server to the voice invocation | 1 failed; 347 passed |
| The CLI forwards exactly the configured environment variables | include the unrelated process credential in the inspected forwarding boundary | 1 failed; 347 passed |
| Ticket evidence stays detached without configuration | supply ticket configuration to the otherwise unconfigured invocation | 1 failed; 347 passed |
| Ticket evidence stays detached when a named environment variable is unset | supply the missing named environment variable | 1 failed; 347 passed |
| Ticket credentials stay out of the model prompt and parsed result | append a credential to the inspected model boundary | 1 failed; 347 passed |
| A partial final hunk cannot claim complete facts | Restore the truncated hunk line counts | 1 failed; 347 passed |
| Large evidence files can be read in bounded numbered ranges | request the first page instead of the requested later page | 1 failed; 347 passed |
| Evidence search locates literal text without executing it | search for absent text | 1 failed; 347 passed |
| A moved base cannot pass the final GitHub freshness check | restore the requested base SHA | 1 failed; 347 passed |
| A dirty card bundle cannot pass as the pinned instructions | restore the clean tracked bundle | 1 failed; 347 passed |
| Claude rejects an unexpected reported tool | source mutation: remove the tool-grant guard | 1 failed; 347 passed |
| Claude rejects a mismatched CLI version | source mutation: remove the version-pin guard | 1 failed; 347 passed |
| Claude rejects an unsuccessful result subtype | source mutation: accept any result subtype | 1 failed; 347 passed |
| Claude rejects an error-marked result | source mutation: accept an error flag | 1 failed; 347 passed |
| Claude rejects an empty result body | source mutation: accept empty result text | 1 failed; 347 passed |
| Failed subprocess diagnostics redact MCP credentials | source mutation: reject the original subprocess error | 1 failed; 347 passed |
| GitHub accepts a zero-change rename without a patch | omit the metadata-only file from the diff inventory | 1 failed; 347 passed |
| GitHub accepts an empty added file without a patch | omit the metadata-only file from the diff inventory | 1 failed; 347 passed |
| GitHub accepts a mode-only change without a patch | omit the metadata-only file from the diff inventory | 1 failed; 347 passed |
| GitHub refuses binary changes with zero line counts | remove the binary diff marker | 1 failed; 347 passed |
| GitHub refuses an encoded binary patch | remove the encoded binary patch | 1 failed; 347 passed |
| Claude receives its complete prompt on stdin and only the round delta through read_diff | source mutation: put the runtime prompt back in argv | 1 failed; 347 passed |
| Same-head Python publication cannot turn a before-head shadow into a retry | Include same-head reviews in the shadow facts | 1 failed; 347 passed |
| A shadow history selection cannot be granted GitHub write authority | Turn off the shadow history selection | 1 failed; 347 passed |
| Even the Claude version probe cannot inherit the publication credential | Pass the full process environment to the version probe | 1 failed; 347 passed |
| Jev classification sends the exact measured P1 questions | Delete the explicit workflow/config version-bump exception from the production definition | 1 failed; 347 passed |
| Jev classification keeps full code evidence and excludes author prose | Pass full PR facts, including release notes, to classification again | 1 failed; 347 passed |
