# Margot PR reviewer

Margot is an automated pull-request reviewer. A host — typically a GitHub Actions
workflow — installs a released copy of this package, binds a request and
configuration to a specific pull request, and runs the review.

Margot classifies a change as mechanical, documentation, or functional. A
mechanical change gets no further review. A documentation or functional change
is routed to a council of review cards, each one a fresh model run judging the
diff against a single standard (safety, works-and-proven, principal-engineer,
achieves-the-objective, maintainable-no-slop, house-style). A risk model scores
the change into a LOW, MEDIUM, or HIGH band. When code alone cannot affirmatively
clear the change — any mandatory finding, risk above LOW, an incomplete card, or
model doubt — a voice model rules the verdict: APPROVED, CHANGES_REQUESTED,
CLARIFICATION_REQUESTED, or ERROR. Margot renders that verdict as a PR comment
and, in GitHub mode, as a check run; some outcomes hold the PR for the operator
instead of clearing it for merge.

## Terms

- **Jev** — [TypeSafe](https://typesafe.ai)'s scoring model, which Margot uses to
  classify changes and score risk. Its API key goes in `JEV_KEY`, and `jev.model`
  pins a Jev model version, for example `jev-1.13.0`.
- **The council** — the review cards.
- **A card** — one review standard, run by a model against the diff.
- **The voice** — the model that rules the verdict when code cannot clear the
  change.
- **The operator** — the person who owns the repositories and approves held pull
  requests.
- **The card bundle** — the public repository
  [publish-skills](https://github.com/lexijamesesq/publish-skills). Claude Code
  loads it as a plugin from a checkout at `claude.pluginDirectory`, pinned to the
  commit in `review.cardBundle.commit`.

## Requirements and install

Margot requires Node 22 or later (see `engines` in `package.json`).

Margot is not on the npm registry. GitHub shows each release asset's SHA-256
digest on the repository's
[Releases page](https://github.com/lexijamesesq/margot-pr-reviewer/releases); pin it
when you choose a release, and verify every install against the pin:

```sh
curl --fail --location --silent --show-error "$PACKAGE_URL" --output margot-pr-reviewer.tgz
echo "$PACKAGE_SHA256  margot-pr-reviewer.tgz" | sha256sum --check
npm install --ignore-scripts --save-exact ./margot-pr-reviewer.tgz
```

A live (non-recorded) review needs more than Node: the exact Claude Code CLI
pinned at the configuration's `claude.executable` (its version is checked
against `claude.version`), a Claude credential in the process environment
(`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`), and the review card bundle —
a clean git checkout of the review skills at `claude.pluginDirectory`, pinned
to the exact commit named in `review.cardBundle.commit`.

Every card and voice runs in its own `docker run` of the runtime image built from
`runtime/` (Claude Code, gh, git, jq, ripgrep and the Linear MCP server, each
pinned by build argument). The configuration's `claude.container.image` names that
image by digest; build it with `CLAUDE_CODE_VERSION` equal to `claude.version`
(`docker build -f runtime/Dockerfile .` from the installed release package, which
ships `runtime/`, or from a checkout after `npm run build`). The build asserts the
version and that every flag the package passes exists in `claude --help`.
The container has a read-only root and no capabilities, and mounts two read-only
directories: the base-sha checkout at `claude.container.work`, which the reviewers
see at `/work`, and the card bundle. Reviewers read the pull request head with `gh`
at the head sha; `margot-review` refuses a base checkout that is not the request's
base commit of its repository, clean. A card may use Skill (only `pr-council`), the
`gh` read commands its skill names, and Read, Grep and Glob within `/work` and the
skill; the voice may use only `gh api` and `gh pr diff`. The Claude credential,
`GH_TOKEN` and the ticketing configuration reach the container by environment,
never on its command line. `claude.container.docker` names the docker executable
(default `docker`).

## Configuration

A review run takes two JSON files: a request and a configuration.

- **Request** — repository, PR number, exact base and head SHAs, and phase
  (`triage` or `review`). See `samples/request.sample.json`.
- **Configuration** — review policy, GitHub options, the Jev risk model, and the
  Claude executable and plugin directory. See `samples/config.sample.json` for
  every key, including the review card bundle pin, protected paths, required
  checks, trusted actors, and the classification/routing/risk thresholds.
  `review.mergeActor` is optional: the name shown on a held pull request as who
  merges it once approved; unset, the hold says only "approve it to merge it".

GitHub mode: with `margot-instance bind-request --authority true` the review publishes
its comment and check runs to the pull request. That needs the `publisher` block (the three check
names, the review app's actor and id, and the run URL); `bind-request` fails without it.
Without `--authority true` the review runs in shadow mode and publishes nothing.

`claude.executable`, `claude.pluginDirectory` and `claude.container.work` may use
`${MARGOT_ROOT}`, which `margot-instance bind-request` resolves. A `claude.references` entry may name a `ref` (a branch or tag) in place of `head`; `bind-request` resolves it to its commit for each run.

The ticketing server and tool names in `claude.ticketing` must match those the card
bundle's `pr-reviewer` agent grants; a card run refuses tools the agent does not grant.
`claude.ticketing.command` runs inside the container, so it names the image's own
server (`mcp-linear`); `bind-request` refuses a placeholder or a path under the Margot root.

### Environment variables

`margot-review` and `margot-instance` read these from the process environment:

| Variable | Meaning |
| --- | --- |
| `JEV_KEY` | API key for Jev. Required by `margot-review`. |
| `GH_TOKEN` | GitHub token that reaches the target repository (the workflow's own `github.token` does not, when it runs in a review repository). Read access for `margot-review` and `bind-request`. For `close-stranded-check` it is the review App's `checks: write` token. |
| `MARGOT_WRITE_TOKEN` | The review App's installation token, minted for the target repository with checks, contents and pull-request write access, so publication is made as the App. Required for GitHub publication. |
| `MARGOT_OWNED_TIER` | Protected-path ownership tier: `none`, `owned`, or `required_owned`. Missing or invalid holds the review. |
| `MARGOT_CLASSIFICATION` | The request's dispatched classification (`functional`, `documentation`, or `mechanical`). It can only make the review stricter than the verified triage's class. |
| `MARGOT_TRIAGE` | Used only when no classification is set: `mechanical` leaves the verified triage's class in place, and any other non-empty value makes the review functional. |
| names listed in `claude.ticketing.env` | Forwarded only to the ticketing MCP server. |

## Running `margot-review`

```sh
margot-review REQUEST.json CONFIG.json OUTPUT.json
```

It writes the result to `OUTPUT.json`, and `diagnostics.json` beside it: each card's
raw block, duration, turns and models, and the voice's raw prose, with no tool output,
token or environment. It is written however the review ends, for the host to keep. It exits 1 when the result is an error, printing the
failed stage and diagnostic to stderr, and 0 otherwise, including for held results.

## Running it in GitHub Actions

`samples/self-hosted.sample.yml` is a full workflow. It has three jobs:

1. **`route`** — installs the exact release bytes, verifies them, and runs
   `margot-instance validate-deployment` to confirm the target repository is
   enrolled and to decide whether this run has GitHub publication authority.
2. **`review`** — runs `margot-instance bind-request` to resolve the request and
   configuration for the PR, then runs `margot-review` to produce and publish
   the result.
3. **`close-stranded-check`** — runs on a normal (non-self-hosted) runner with
   `if: always()`. If the earlier jobs did not successfully publish a result, it
   closes any review check this run owns so the PR is not left with a check
   stuck in progress.

`samples/github-hosted.sample.yml` is the same workflow for a team that has only
GitHub-hosted runners: it keeps the deployment and configuration in GitHub
variables, installs the pinned Claude CLI, fetches the card bundle at its pinned
commit, and adds a `triage` job ahead of `review`. Choose it when you have no
runner of your own to hold trusted files.

## Instance commands

### `validate-deployment`

Checks a trusted deployment file's version, exact GitHub release asset URL, and
SHA-256 pin against the caller's enrolled and authority-bearing repositories.
Appends `authority` and `repositoryName` to `GITHUB_OUTPUT` when that variable is
set.

```sh
margot-instance validate-deployment \
  --deployment /trusted/deployment.json \
  --release-repository YOUR_ORG/margot-pr-reviewer \
  --repository YOUR_ORG/YOUR_REPOSITORY \
  --enrolled-repositories '["YOUR_ORG/YOUR_REPOSITORY"]' \
  --authority-repositories '[]'
```

### `bind-request`

Reads the PR through the GitHub API using `GH_TOKEN`. Before writing any
configuration it classifies a merged, closed, superseded, draft, fork-head,
conflicted, or empty request and stops instead. Otherwise it writes
`request.json` and `config.json` under the given Margot root, with the supplied
required checks, protected paths, allowed skipped checks, and authority applied.
With `--authority true` the review publishes to GitHub, and `--run-url` must name
this run; without authority it runs in shadow mode and publishes nothing.

For a benchmark shadow run, `--reviewer-model <model>` overrides the card reviewers'
model and `--fresh true` makes the review fresh, reading no earlier ledger; both are
refused with `--authority true`, so a benchmark never publishes.

Every classified stop exits **75** and prints `stop_reason=<reason>` (one of
`superseded`, `merged`, `closed`, `draft`, `fork`, `conflict`, `empty`); a
superseded stop also prints `live_sha=<current head>`. Both lines are appended
to `GITHUB_OUTPUT` when that variable is set.

```sh
margot-instance bind-request \
  --repository YOUR_ORG/YOUR_REPOSITORY --pr 1 --head "$HEAD_SHA" \
  --phase review --authority false --margot-root "$MARGOT_ROOT" \
  --config /trusted/config.json --required-checks '["ci / checks"]' \
  --protected-paths '[".github/**"]' --allowed-skipped-checks '[]' \
  --run-url "$RUN_URL"
```

### `close-stranded-check`

Closes a review check this run left open when routing failed, review failed, or
publication did not happen. `--check-name` names the review check to close (your
`publisher.checks.review`); it defaults to `review / margot`. For a floor stop,
`--blocking-checks` names what held the floor (such as `pending: ci / checks, lint`) and
goes into the check's title; without it the title says "required checks not green".
Exits 0 after closing or finding nothing to close, and 2 on a GitHub read or write failure.

```sh
margot-instance close-stranded-check \
  --repository YOUR_ORG/YOUR_REPOSITORY --pr 1 --head "$HEAD_SHA" \
  --app-id "$MARGOT_APP_ID" --check-name "review / margot" \
  --own-runs "$RUNS_URL_PREFIX" --own-run-id "$RUN_ID" \
  --route-result "$ROUTE_RESULT" --review-result "$REVIEW_RESULT" \
  --published "$PUBLISHED" --stop-reason "$STOP_REASON" --live-sha "$LIVE_SHA"
```

### `self-instrument`

Posts the self-instrument check for a pull request's live head, before the floor, as
the previous reviewer's preflight did. A functional change to a protected path, or a
rename or move of one in any class, is held (`neutral`, "held for the operator's
approval", listing the matched paths); anything else is `success` ("clear", naming the
class). The class is the verified triage's for the head (the triage check
`--triage-check-name`, default `review / triage`, posted by `--app-id` and trusted
through `--trusted-triage-actors`), or functional without one. `--check-name` defaults
to `review / self-instrument`. It reads with `GH_TOKEN` and posts with
`MARGOT_WRITE_TOKEN`, and refuses a head that is no longer the PR's. Publication posts
the same check again.

```sh
margot-instance self-instrument \
  --repository YOUR_ORG/YOUR_REPOSITORY --pr 1 --head "$HEAD_SHA" \
  --protected-paths '["YOUR_AUTHORITY_PATH/**"]' --app-id "$MARGOT_APP_ID" \
  --trusted-triage-actors '["triage-app"]'
```

## What Margot posts

The review comment opens with the outcome and risk band, a short rationale, and
(when applicable) a note that the change is above Margot's authority and is the
operator's to merge. Below a divider it lists either the mechanical-change line
or the council's per-card results — a status icon, the card name, and its
finding, if any — followed by a round summary (new, open, and closed findings)
and the PR's author, ticket, commit, and run links.

In GitHub mode it is accompanied by a check run named `review / margot`. Its text
has two machine-readable lines: `outcome: <OUTCOME> | band: <BAND>` and
`decision_source: <source>`.

A PR is held for the operator — not cleared for merge, even on an outcome of
APPROVED — when any of the following holds: risk is above LOW; routing or the
risk score of a functional or mechanical change came from the fallback model
rather than Jev (a documentation change is reviewed and not held for its
routing); the review history
could not be read or a trusted ledger in it is corrupt; the
protected-path ownership tier could not be computed; calibration mode is on; the
voice's outcome is anything other than APPROVED; a rename touches a protected
path on either its old or new path; or the change is classified `functional`
and touches a protected path. A documentation or mechanical edit to a protected
path does not hold on that account alone. An `ERROR` outcome means the review
could not be completed at all and is always held.

## Library API

The package's main entry exports:

- `review(request, config, services)` — runs a review and returns a `ReviewResult` (`classified`, `reviewed`, `held` or `error`).
- `recordedServices(recording)` — builds `Services` from a JSON recording such as those under `recordings/`, for offline review.
- `liveServices(config, credentials, onResponse?)` and `liveConfigSchema` — the live implementation `margot-review` runs on.

Minimal recorded-review example:

```js
import { readFile } from "node:fs/promises";
import { review, recordedServices } from "margot-pr-reviewer";

const recording = JSON.parse(
  await readFile(
    new URL(import.meta.resolve("margot-pr-reviewer/recordings/author-changes.json")),
    "utf8",
  ),
);
const services = recordedServices(recording);
const result = await review(recording.request, recording.config, services);
console.log(result.kind === "reviewed" ? result.report : result);
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
