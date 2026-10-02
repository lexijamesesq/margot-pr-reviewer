# Instance command break receipts

Generated 2026-10-02T22:42:22.738Z, Node v26.3.1. Baseline and restored suite: 369/369 passed. Each of 44 isolated breaks ran the complete suite and failed exactly its named assertion.

Instance command cases exercise exact release references, enrolment, authority selection, GitHub outputs, request admission, trusted policy binding, CLI flag mapping, and bound-file writes.

Most breaks are controlled service/input counterexamples selected by MARGOT_INSTANCE_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: 241d2d547b632d57413db76d41d2b2d906783b4c80296b94150e10b6ce79afca. Reproduce: npm run test:instance-command-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| accepts the exact configured release and records authority | Replace the exact release reference with an invalid value | 1 failed; 368 passed |
| release-repository: rejects a release asset from a different repository | Restore the configured release repository | 1 failed; 368 passed |
| release-version: rejects disagreement among deployment and asset versions | Restore agreement between the declared and asset versions | 1 failed; 368 passed |
| release-integrity: requires npm integrity | Restore the valid npm integrity value | 1 failed; 368 passed |
| release-sha256: requires the bootstrap SHA-256 | Restore the valid bootstrap SHA-256 | 1 failed; 368 passed |
| enrolment: rejects an unenrolled target | Restore the enrolled target | 1 failed; 368 passed |
| authority-enrolment: rejects authority outside enrolment | Restore authority to the enrolled subset | 1 failed; 368 passed |
| release-protocol: rejects a non-HTTPS release asset | Restore the HTTPS release reference | 1 failed; 368 passed |
| release-host: rejects a release asset from another host | Restore the GitHub release host | 1 failed; 368 passed |
| release-port: rejects a release asset with an explicit port | Remove the explicit release-reference port | 1 failed; 368 passed |
| release-credentials: rejects a release asset with credentials | Remove credentials from the release reference | 1 failed; 368 passed |
| release-query: rejects a release asset with a query | Remove the query from the release reference | 1 failed; 368 passed |
| release-fragment: rejects a release asset with a fragment | Remove the fragment from the release reference | 1 failed; 368 passed |
| duplicate-enrolled: rejects duplicate enrolled repositories | Restore a unique enrolled-repository list | 1 failed; 368 passed |
| duplicate-authority: rejects duplicate authority repositories | Restore a unique authority-repository list | 1 failed; 368 passed |
| returns false authority for an enrolled shadow | Put the shadow target in the authority list | 1 failed; 368 passed |
| appends only the two safe GitHub outputs when the path is present | Write the wrong authority output | 1 failed; 368 passed |
| binds trusted policy and current PR facts for authority | Replace the bound required-check list | 1 failed; 368 passed |
| binds non-authority execution as a before-head shadow | Grant authority to the shadow binding | 1 failed; 368 passed |
| requires publisher configuration for authority | Restore publisher configuration to the rejected authority input | 1 failed; 368 passed |
| binds the sample config as a shadow when a run URL is supplied | Grant authority to the publisher-free sample binding | 1 failed; 368 passed |
| requires a unique run URL for authority | Restore a run URL to the rejected authority input | 1 failed; 368 passed |
| resolves runtime placeholders in Claude and ticketing paths | Expect paths under a different runtime root | 1 failed; 368 passed |
| rejects unresolved placeholders in executable paths at bind time | Replace unresolved placeholders with the supported install-root placeholder | 1 failed; 368 passed |
| superseded: classifies a superseded head and writes stop_reason | Restore the expected pull-request head | 1 failed; 368 passed |
| merged: classifies a merged PR and writes stop_reason | Restore the open unmerged pull request | 1 failed; 368 passed |
| closed: classifies a closed unmerged PR and writes stop_reason | Restore the open pull request | 1 failed; 368 passed |
| draft: classifies a draft PR and writes stop_reason | Restore the non-draft pull request | 1 failed; 368 passed |
| fork: classifies a fork-head PR and writes stop_reason | Restore the same-repository pull request | 1 failed; 368 passed |
| conflict: classifies a merge conflict and writes stop_reason | Restore the mergeable pull request | 1 failed; 368 passed |
| empty: classifies an empty PR and writes stop_reason | Restore a changed file | 1 failed; 368 passed |
| classifies the PR before rejecting invalid trusted configuration | Restore the valid trusted configuration | 1 failed; 368 passed |
| requires an absolute runtime root | Restore the absolute runtime root | 1 failed; 368 passed |
| writes the two bound files privately under the Margot root | Bind a different base revision | 1 failed; 368 passed |
| requires GH_TOKEN before reading configuration or GitHub | Supply a token and continue past the token guard | 1 failed; 368 passed |
| rejects unknown deployment command arguments | Remove the unknown command argument | 1 failed; 368 passed |
| rejects duplicate flags after parseArgs | Remove the duplicate repository flag | 1 failed; 368 passed |
| maps the close-stranded-check command into the guarded closer | Claim the selected package published | 1 failed; 368 passed |
| maps a closer GitHub failure to exit 2 | Return the error decision instead of throwing | 1 failed; 368 passed |
| rejects a run URL prefix without its trailing slash | Restore the trailing slash | 1 failed; 368 passed |
| rejects a malformed closer repository before GitHub | Restore the owner/name repository | 1 failed; 368 passed |
| maps every bind-request CLI flag into the bound files | Swap the required-check and protected-path list values | 1 failed; 368 passed |
| maps every bind-request CLI flag into the bound files | Read false authority as true | 1 failed; 368 passed |
| rejects an explicitly empty bind-request run URL | Replace the empty run URL with a valid URL | 1 failed; 368 passed |
