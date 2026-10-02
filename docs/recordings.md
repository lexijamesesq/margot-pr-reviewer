# Recording provenance and sanitization

Seven historical captures were normalized into the service contract. The following
SHA-256 digests identify the original captured emit files without publishing their
repository names or metadata. Historical outputs predate Margot; no Jev or
review-model calls were made to create these fixtures.

| Recording | Source emit SHA-256 | Diff evidence |
| --- | --- | --- |
| mechanical-bump | f2af72d5044b3c733e39d95cf96df45164833200af0bc335996bcb7be2935d82 | retrieved exact comparison |
| council-clear | 844e2abdcceef2fb9724b2dfab9b3bd4f6296a40f583d8e33aec35a15a5c1f68 | retrieved exact comparison |
| voice-hold | 1df054d31bf1bdd9dff22c11eeeb345abc196e69b2bfd8ba8289f625481d5ba2 | retrieved exact comparison |
| invalid-accounting | 3c43e24a115758722ddc8b2d8f742ce7fa7523a92eb14a776837dc961f89e1ee | reconstructed; original base missing |
| author-changes | ffa9ba0aa5e1d5c5867537eaa31b44f5a0a216174e4bbe9c231702d10184ff33 | retrieved exact comparison |
| prior-ledger | e088b7a34071a6aa8cbfe08c5a9419f498d388e852f0352e1912a7af32fcfe66 | retrieved comparison and normalized previous ledger |
| no-council-floor | 664530a11143327a4ce4877bd7be01845afc255490ccc0bb157ae0f3ac8617cd | reconstructed; original base missing |

Five comparisons were retrieved read-only from public GitHub at the recorded exact
base/head SHAs. Existing `gh` authentication was expired; unauthenticated HTTPS
worked. Identifying references were sanitized for distribution; request SHAs are pseudonymous.
The other two source harnesses lacked a real base SHA, so their inputs remain
reconstructed. The no-council case deliberately uses synthetic functional input
to retain confidence-floor coverage; ordinary README prose follows documentation
policy instead.

All cases have reconstructed three-way classifier responses and check receipts:
the historical service captured an earlier question shape. These are explicitly
recorded services for Margot wiring, not evidence of current model judgment.
Selected card findings, numerical risk distributions and voice outcomes derive
from the captures. Checked evidence retains each card's first captured probe when
available. Voice dispositions are normalized by finding ID; the invalid-accounting
case deliberately retains the historical missing-accounting error. Publication is
in-memory and reconstructed. No live GitHub review is created.

Sanitization uses neutral file names and repository/author identifiers, pseudonymous
SHAs, and removes URLs, original repo names, machine paths, session links and tokens.
Source model envelopes, prompts and encoded ledgers are not distributed. The
prior-ledger capture includes its normalized first-round MINOR entries and the fixing guide delta. The actor and SHA identities remain neutral reconstructions.

`npm run audit:recordings` scans every nested key/value against the denylist, rejects
URLs and unexpected absolute paths, permits only the explicit virtual bundle paths,
and reports seven clean files. Repository commit hooks additionally run gitleaks.
