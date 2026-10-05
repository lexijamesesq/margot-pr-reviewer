# Changelog

## 0.6.12

- A MAJOR finding that a card re-raises with `late=delta-reach: <reason>` no longer drops to a late advisory when its earlier ledger entry was an advisory; it blocks at its honest severity, as the prompt promises.
- A held review names one reason, in the same words, in the review comment and in the check title. A protected-path hold says "it touches a protected path"; holds from a fallback-scored risk, uncomputed ownership, calibration, an error and a pending author each get a plain sentence in the comment too.
- The shipped `recordings/prose` texts are synthetic and describe `example/project`.
- The ledger reader no longer accepts a `margot-ledger:v2` marker; nothing has ever written one.
- `samples/deployment.sample.json` carries placeholder values instead of a stale release.
- The check closer words each stop as its own sentence, titles every stop with "Margot:", and gives an unexplained stop its own summary.
- The package entry exports only the library API the README documents (`review`, `recordedServices`, `liveServices`, `liveConfigSchema` and their types). `githubAdapter`, `githubClient`, `githubPublisher`, `render`, `renderCheckText` and `findingTally` are no longer exported.
- `packageIntegrity` in the deployment is now optional; when present it is still checked for its `sha512-` form. The SHA-256 remains required.
- `margot-instance bind-request` names the reference in the error when a `claude.references` entry is malformed.
- `margot-instance`: a malformed JSON flag names the flag, `--help` prints the usage and exits 0, and its refusal messages say `margot-instance`.

## 0.6.11

- A `claude.references` entry may give `ref`, a branch or tag name, instead of `head`. `margot-instance bind-request` resolves it to its commit with `GET /repos/{owner}/{repo}/commits/{ref}` (using `GH_TOKEN`) and writes only `head` to the bound `config.json`, so a reference no longer goes stale between hand-edited pins. An entry gives exactly one of `head` or `ref`; one that gives `head` is passed through unchanged. A ref that does not resolve fails `bind-request` (exit 1) naming the reference and ref. The runtime still requires `head`, so reads stay immutable within a run.

## 0.6.10

- A host that dispatches no class no longer turns every review functional. With no `classification` and no `triage` in the request, nothing is dispatched and the verified triage's class stands (functional, as `triage_unavailable`, when there is none). A dispatched class that is stricter still wins, recorded as `dispatch`.
- `jev.url` is now a real configuration key: an optional `https` URL for the Jev endpoint. Unset, Margot calls TypeSafe's endpoint as before.
- The README says what Jev is, that the package is not on the npm registry, and to pin a release asset's SHA-256 digest from the Releases page and verify every install against it.
- `samples/self-hosted.sample.yml` takes the same `repo`, `pr` and `sha` dispatch inputs. `samples/config.sample.json` lists `jev.url`.
- `samples/github-hosted.sample.yml` takes `repo`, `pr` and `sha` dispatch inputs in place of hard-coded values, and its header says what dispatches it.
- New `CONTRIBUTING.md`.

## 0.6.9

- A review that fails after the council has begun now also tells the author in the pull request. Margot posts a short comment, "Not reviewed: (the stage that failed). The review check has the details. Held for the operator.", alongside the `not reviewed (error)` check. The comment names the stage and points to the check instead of quoting the reason. Errors before the review began (facts, history, binding, required checks) still end as a check only. Nothing is posted when the head has moved, the run was superseded, or the review itself was already posted.
- New `samples/github-hosted.sample.yml`: the workflow for a team that uses GitHub-hosted runners only.

## 0.6.8

- The review no longer asks Jev to classify. It takes its class from the verified triage for the head, or reviews as functional when there is none; the dispatcher's class still applies on top and an oversized diff is still reviewed as functional.
- The triage check's machine JSON carries a new `mechanical_probability` field, and a verified triage hands it to the review, so the mechanical comment keeps its confidence figure. Older triage checks without the field render no figure.
- The review check opens as "Margot: preflight complete — setting up the review runner" when the run starts, replacing "Margot: preflight — mechanical checks", which belongs to the host's wait for required checks.

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
