# Changelog

## 0.6.7

- Errors keep their cause: the CLI names the file, field, variable or configuration setting that failed, and Jev authentication failures are distinguishable from outages.
- A short Terms section defines Jev, the council, cards, the voice, the operator and the card bundle.
- The self-instrument hold says it waits for a maintainer.
- `margot-review` prints its usage with `--help` and the package version with `--version`.

## 0.6.6

Margot reviews a pull request and decides whether it can merge.

- Classifies a change as mechanical, documentation or functional, routes it to
  the review cards it needs, and scores its risk band.
- Rules the verdict with a voice model when code alone cannot clear the change,
  and keeps an authenticated ledger so later rounds converge on earlier findings.
- Records its actions locally by default, or publishes check runs and reviews to
  GitHub when the configuration sets `publication: "github"` and a write token is
  supplied.
- Fails closed: a missing or failed service response is an error, never an
  empty success.
- `margot-instance` validates deployments, binds requests and closes stranded
  checks.
