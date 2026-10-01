# Instance command break receipts

Generated 2026-10-01T19:06:38.609Z, Node v26.3.1. Baseline and restored suite: 287/287 passed. Each of 35 isolated breaks ran the complete suite and failed exactly its named assertion.

Instance command cases exercise exact release references, enrolment, authority selection, GitHub outputs, request admission, trusted policy binding, CLI flag mapping, and bound-file writes.

Most breaks are controlled service/input counterexamples selected by MARGOT_INSTANCE_BREAK; error cases repair their bad input. They do not claim exhaustive source mutation coverage or independence. Declared source mutations run without that variable and are identified in the manifest. No live service or paid model call occurs in the harness.

Manifest SHA-256: ed813801d38f9203ab7500cb1efe28f9cbcccc4d03f1998356b5e411f3759557. Reproduce: npm run test:instance-command-breaks.

| Test | Deliberate break | Observed |
| --- | --- | --- |
| accepts the exact configured release and records authority | Replace the exact release reference with an invalid value | 1 failed; 286 passed |
| release-repository: rejects a release asset from a different repository | Restore the configured release repository | 1 failed; 286 passed |
| release-version: rejects disagreement among deployment and asset versions | Restore agreement between the declared and asset versions | 1 failed; 286 passed |
| release-integrity: requires npm integrity | Restore the valid npm integrity value | 1 failed; 286 passed |
| release-sha256: requires the bootstrap SHA-256 | Restore the valid bootstrap SHA-256 | 1 failed; 286 passed |
| enrolment: rejects an unenrolled target | Restore the enrolled target | 1 failed; 286 passed |
| authority-enrolment: rejects authority outside enrolment | Restore authority to the enrolled subset | 1 failed; 286 passed |
| release-protocol: rejects a non-HTTPS release asset | Restore the HTTPS release reference | 1 failed; 286 passed |
| release-host: rejects a release asset from another host | Restore the GitHub release host | 1 failed; 286 passed |
| release-port: rejects a release asset with an explicit port | Remove the explicit release-reference port | 1 failed; 286 passed |
| release-credentials: rejects a release asset with credentials | Remove credentials from the release reference | 1 failed; 286 passed |
| release-query: rejects a release asset with a query | Remove the query from the release reference | 1 failed; 286 passed |
| release-fragment: rejects a release asset with a fragment | Remove the fragment from the release reference | 1 failed; 286 passed |
| duplicate-enrolled: rejects duplicate enrolled repositories | Restore a unique enrolled-repository list | 1 failed; 286 passed |
| duplicate-authority: rejects duplicate authority repositories | Restore a unique authority-repository list | 1 failed; 286 passed |
| returns false authority for an enrolled shadow | Put the shadow target in the authority list | 1 failed; 286 passed |
| appends only the two safe GitHub outputs when the path is present | Write the wrong authority output | 1 failed; 286 passed |
| binds trusted policy and current PR facts for authority | Replace the bound required-check list | 1 failed; 286 passed |
| binds non-authority execution as a before-head shadow | Grant authority to the shadow binding | 1 failed; 286 passed |
| requires publisher configuration for authority | Restore publisher configuration to the rejected authority input | 1 failed; 286 passed |
| binds the sample config as a shadow when a run URL is supplied | Grant authority to the publisher-free sample binding | 1 failed; 286 passed |
| requires a unique run URL for authority | Restore a run URL to the rejected authority input | 1 failed; 286 passed |
| resolves runtime placeholders in Claude and ticketing paths | Expect paths under a different runtime root | 1 failed; 286 passed |
| closed: rejects a closed PR | Restore the open pull request | 1 failed; 286 passed |
| draft: rejects a draft PR | Restore the non-draft pull request | 1 failed; 286 passed |
| fork: rejects a fork PR | Restore the same-repository pull request | 1 failed; 286 passed |
| moved: rejects a moved head | Restore the expected pull-request head | 1 failed; 286 passed |
| rejects an invalid trusted configuration before reading GitHub | Restore the valid trusted configuration | 1 failed; 286 passed |
| requires an absolute runtime root | Restore the absolute runtime root | 1 failed; 286 passed |
| writes the two bound files privately under the engine root | Bind a different base revision | 1 failed; 286 passed |
| requires GH_TOKEN before reading configuration or GitHub | Supply a token and continue past the token guard | 1 failed; 286 passed |
| rejects unknown deployment command arguments | Remove the unknown command argument | 1 failed; 286 passed |
| maps every bind-request CLI flag into the bound files | Swap the required-check and protected-path list values | 1 failed; 286 passed |
| maps every bind-request CLI flag into the bound files | Read false authority as true | 1 failed; 286 passed |
| rejects an explicitly empty bind-request run URL | Replace the empty run URL with a valid URL | 1 failed; 286 passed |
