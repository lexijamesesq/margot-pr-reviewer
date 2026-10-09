# Changelog

## 0.10.0

- Classification uses bounded Jev retries and the configured fallback, records which provider decided, and fails explicitly when both providers fail.
- Migrated review consumes an authenticated, revision-bound classification check instead of classifying again. Trusted code/text checks bind publication and review handoff to the current pull request, with recovery and duplicate-publication guards.
- Remove the dedicated self-instrument command, status publication and authority check configuration. Independent protected-path approval holds and ordinary review publication remain.
- This strict interface requires the matching migrated instance configuration and workflows. Existing legacy instances remain pinned to the immutable 0.9.4 package and their matching configuration.

## 0.9.4

- When posting fails after the review returned (the review itself, a hold, or the check), the error check's summary carries that failure's reason, capped at 900 characters, as the previous reviewer's `error_check` did. It no longer shows the fixed "Publication or evaluation failed" text.

## 0.9.3

- The check text carries the voice's `finding` as `setting finding: <finding>` right after `band_reason:`, as the previous reviewer's poster wrote it.
- An error result's check summary is the error's reason, the diagnostic `margot-review` prints, capped at 900 characters, as the previous reviewer's error check set it. Its title, conclusion and the pull-request comment are unchanged.

## 0.9.2

Margot restores the previous reviewer's advisory template-adherence check.

- After the verdict is final, Margot asks Jev, in the previous reviewer's words, whether the risk line is a short classification and whether each card with findings states its own lens's contribution rather than restating another card's finding. The state is the posted risk line, the summary and each council finding as `[card] what`. It is skipped for a mechanical verdict or when there is no risk line.
- The check is advisory: it never changes the outcome, band, holds, decision source or merge eligibility, and it never fails the review. A Jev outage gives `unchecked` without the fallback decider; a malformed answer is re-asked like any Jev answer, and an answer still missing reads as a pass.
- The check text carries the result as the previous reviewer's poster wrote it, after `can auto-merge`: `adherence: clean`, or `adherence: flags` with `risk line reads as a sentence, not a classification` and `cards restating a shared finding: <cards>`, or `adherence: unchecked` / `adherence: skipped`. The result is in `result.json` (`adherence`), in `diagnostics.json` for a completed review, and in the posted review in its own `<!-- margot-adherence:v1 … -->` marker just before the ledger block. A same-head replay reads it back from there without asking Jev again. It is kept out of the ledger encoding, which 0.9.1 parses strictly, so a rollback to 0.9.1 still reads every ledger 0.9.2 posts.
- This reverses the 0.8.0 deliberate difference "Jev's advisory template-adherence check is not restored"; the check is now restored.

## 0.9.1

Margot restores what a regression check of 0.9.0 against the previous reviewer found changed without a record.

- A risk dimension with a well-formed distribution from Jev, all four levels present and summing to 1 within 0.015, is rated by its tail, as the previous reviewer rated it. A malformed one, partial or off its sum, is no longer replaced by the score or refused by the risk schema: it is rated as the deliberate difference on a malformed Jev distribution below states, with a partial distribution's missing levels read as 0. A dimension with no distribution takes its score's level, and with no score level 2.
- The verdict check's summary is `<outcome>, <band>: <first sentence of the risk label>`, capped at 900 characters, instead of the band rationale. The label is the voice's, or the one a code verdict carries.
- `close-stranded-check --blocking-checks` names what held the floor in a floor stop's title, as the host words it (such as "pending: ci / checks, lint"): `Margot: preflight — <what held it> — waiting for the next push`. Without it the title still says "required checks not green".
- `margot-instance self-instrument` posts the self-instrument check for a pull request's live head before the floor, with the previous reviewer's conclusion and wording: `neutral` and held for the operator's approval for a functional change to a protected path or a protected rename in any class, listing the matched paths, and otherwise `success`, naming the class. The class is the verified triage's for the head, or functional without one. It reads the changed files as the review does, from the whole-PR diff with every hunk complete plus GitHub's file listing, and holds rather than clears a change it cannot read completely. Publication posts the check with the same text: the previous reviewer's wording, with the matched paths sorted, in place of the port's own.
- `margot-review` writes `diagnostics.json` beside its output however the review ends: each card's raw block, duration, turns, models and cost, and the voice's raw prose with the same. Tool output, tokens and the environment are not in it.
- `bind-request --reviewer-model <model> --fresh true` binds a benchmark shadow run: the card reviewers' model overridden, no earlier ledger read, and nothing published. Either flag is refused with `--authority true`.
- The card prompt carries the previous reviewer's authorship sentence verbatim ("You did NOT author this PR and you judge its author, never whoever invoked you.") and its confinement sentence verbatim: every local search stays in the read-only base-sha checkout at `/work` and in PR evidence fetched read-only through `gh` at the head sha, never a home path, a mounted volume or the PR head checked out.

Deliberate differences from the previous reviewer:

- A Jev answer that is malformed in any part is asked again, up to three answers in all, before the conservative defaults apply; the first well-formed answer is used. Malformed means a missing or unreadable card, exposure, meaning or classification answer, or a risk dimension that is missing, has no readable distribution, is partial, or sums off by 0.015 or more. Each re-ask is logged and listed in `diagnostics.json`. The previous reviewer re-asked only on a transport failure.
- A malformed Jev distribution, one with levels missing or a sum off by 0.015 or more, is rated at the higher of its tail level and its rounded score when Jev gives a score, and by its tail without one. The previous reviewer rated it by its tail alone, so `{"0": 1}` with a score of 3 was level 0; the rule is never lower than the previous reviewer and never below Jev's own score. A well-formed distribution, all four levels present and summing to 1 within 0.015, keeps the previous reviewer's tail rule, since Jev's score is the expected value of that same distribution.
- The voice's `band` and `rationale` are required, so a malformed verdict is held where the previous reviewer posted it: Margot fails closed.
- The previous reviewer's Jev decision log was opt-in and never enabled, so it is not ported.
- The previous reviewer's manual Colima containment script is not ported: the container's walls are the same, and its own workflow never ran the script.
- The council roster hides dismissed findings, by the operator's contract for the roster.
- An unreadable card block ends the review in an error.

## 0.9.0

Reviewers run in the previous reviewer's container with its tools.

- Every card and voice `claude` invocation runs in its own `docker run --rm --read-only` of the runtime image, as user 1000 with every capability dropped, `no-new-privileges`, 3 GiB memory and 512 processes. Only the base-sha checkout (at `/work`) and the card bundle are mounted, both read-only; the config and `/tmp` are tmpfs. The image is `claude.container.image`, pinned by digest; the base checkout is `claude.container.work`. Before each invocation Margot checks that the base checkout is at the request's base commit, clean, with an `origin` remote naming the request's repository, and otherwise fails with "Base checkout mismatch".
- The containerized calls no longer check `claude.version` at run time, as the previous reviewer did not. The image build installs the exact `CLAUDE_CODE_VERSION`, asserts `claude --version`, and fails if any long flag the package passes to `claude` is absent from `claude --help`; the digest pin then fixes the version. The decision fallback, which still runs `claude.executable` on the host, keeps its check.
- A card's tools are the previous reviewer's: Skill (only `pr-council`, every sibling skill denied), the `gh` read commands its `pr-council` skill names (`gh pr view`, `gh pr diff`, `gh pr checks`, `gh api`, `gh run view`), Read, Grep and Glob over `/work` and the `pr-council` skill, and the configured ticketing read tools. Grep and Glob have no allow rule, so they reach only the working directory and the added skill directory. Agent, Write and Edit are denied, as are reading the MCP config and `/proc`. The voice has Bash, limited to `gh api` and `gh pr diff`. Both roles are denied `gh alias`, `gh extension`, `gh auth` and `gh config`. The tool check expects exactly these tools.
- The evidence MCP server and its tools (`read_diff`, `read_file`, `search_file`, `list_files`, `read_reference`, `read_check_run`) are removed, with the `@modelcontextprotocol/sdk` dependency. The card prompt says the base checkout is at `/work` and to read the pull request head with `gh` at the head sha. In a delta round it names the previously reviewed head and sends the card to `gh api repos/{repo}/compare/{priorHead}...{head}`, limited to the round's files, as its skill states, not to the pull request's diff. The diff is no longer inlined or served. The GitHub adapter's evidence reads (`readFile`, `checkRun`, `tree`) are removed.
- The credentials (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `GH_TOKEN`) and the ticketing MCP config reach the container by environment, never on the command line. The entrypoint writes the MCP config to tmpfs.
- `runtime/` holds the image's Dockerfile, its dockerignore and the entrypoint, ported from the previous reviewer's, and ships in the release package so the image builds from the verified release asset. The flag check reads the compiled `dist/adapters/claude.js`. The card bundle is mounted, not baked.
- Each container is named `margot-<card or voice>-<random>`. When a call times out or is aborted, Margot runs `docker kill` on that name, bounded to 10 seconds, so the container does not outlive the stage; `--rm` removes it.
- `claude.ticketing.command` runs inside the container, so `bind-request` no longer resolves `${MARGOT_ROOT}` in it and refuses a placeholder or a path under the Margot root; it names the image's server, such as `mcp-linear`.
- The card bundle's `agents/pr-reviewer.md` must grant Skill, Read, Grep, Glob and Bash, and `agents/margot.md` must grant Bash.

## 0.8.0

Margot decides and presents reviews as the previous reviewer did wherever the port had diverged without a ruling.

- Advisory ledger entries last one round. Only standing entries summon their card and reach reviewers, who see standing and dismissed entries. From round two a new MINOR or late finding is demoted with no ledger entry; only a re-raised standing entry turns advisory, for that round.
- A dismissed finding a card raises again goes to the voice with its earlier reason, to keep dismissed unless the new changes altered it. The voice decides, not the card: `reopens=` is no longer asked for or parsed. Saved receipts still parse: `reopens` and the `carried-dismissal` advisory value stay in the schema, but nothing writes them.
- From round two a finding without `late=` counts as new, and a `ledger=` key that names none of the card's earlier entries is ignored; neither fails the review. The card prompt no longer carries the package's own `late=new` and attribution sentences; the bundle's `pr-council` skill states `ledger=` and `late=`.
- A mechanical or editorial documentation change whose ledger has a standing entry takes the full path: Jev routes it, the council is the routed cards plus the ledger's, and a mechanical change is scored for risk. Before, only the ledger's cards ran.
- With no cards and confident routing, a band above LOW is held for the operator without the voice (`verdict_source: no_council`), instead of handing the voice an empty council.
- A documentation review whose routing came from the fallback, or from the all-cards outage route, is reviewed and keeps `decision_source: jev`. The triage run is unchanged: its JSON says `decision_source: jev` only when Jev classified that head.
- Every Jev question is one prose state, never split into excerpts and never combined by a maximum. Classification sends the PR, up to 60 changed files, the ownership tier and the whole diff, never the title, body or author. Routing and risk send the PR, its author, title, body to 1,500 characters, up to 60 files of the whole PR and the ownership tier; documentation routing adds the whole diff, and risk adds the council's findings. The questions use the previous reviewer's wording, including the risk anchors and the `documentation_substantive` key. Routing reads the whole PR; cards still read the round's delta.
- The checks a card and the voice receive carry GitHub's own conclusion (`neutral`, `cancelled`, `timed_out` and the rest) and leave out the configured publisher's check names. The required-check gate is unchanged.
- The evidence server serves `read_check_run`: a named check's current run on the head, with its conclusion, posting App, and output title, summary and text. Run logs are not served, because the read token has no `actions: read`. A card gets the tool once the bundle's `agents/pr-reviewer.md` lists `mcp__evidence__read_check_run`.
- The voice prompt for a documentation change carries the previous reviewer's documentation ruling rule. The voice's definition already states the other ruling rules.
- A verdict code reaches without the voice carries the previous reviewer's risk label and summary: its band's exposure with the dimension Jev scored highest (such as "low exposure — operations", or "medium exposure — operations" on a held no-council review; the risk answer now keeps Jev's `score`, and a dimension without one counts as 2) and "Reviewed against the summoned lenses; no blocking findings." (or "No review lens was required for this change."), the mechanical label and summary, and "editorial documentation change" with `verdict_source: documentation_editorial`.
- A floor stop is titled "Margot: preflight — required checks not green — waiting for the next push", reversing the 0.6.12 wording.
- A fresh verdict whose risk line has no classification is held instead of posted, as the previous reviewer's template gate held it. The voice's own ERROR is exempt, and a saved verdict replays as posted. The shipped recordings gain the `risk` line the voice always gives.
- A fresh review whose shown card finding has no plain sentence (its text only punctuation) is held instead of posted, completing the previous reviewer's template gate.
- A review the template gate holds ends at the `template-gate` stage as the previous reviewer's poster error: the check is `action_required`, titled "not reviewed: poster error", with the reason as its summary, and no comment is posted on the pull request.
- A card's `Resolved:` section is kept and reaches the voice and Jev's risk text, as the council's prose did.
- A missing or unreadable field in a Jev answer takes the previous reviewer's conservative default instead of failing the review: an unanswered card is summoned, routing without an exposure answer is unsure, documentation without a meaning answer is substantive, a risk dimension without a distribution takes its score's level (or level 2) with no confidence, which keeps the cautious band (the no-council floor lowers nothing), so a band above LOW is held or ruled by the voice as usual, and a classification with an unreadable answer is functional.
- Correction: the 0.6.14 note that holding a documentation change on a fallback answer restores the previous reviewer's rule was wrong. The previous reviewer reviewed such a change and recorded it as Jev-sourced; 0.8.0 does the same.

Deliberate differences from the previous reviewer:

- The voice's band decides merge eligibility, one band for display and merge (the operator's ruling). The previous reviewer used Jev's conservative level.
- Jev's routing and risk state names the ownership tier but not the owned files: the host passes only the tier (`MARGOT_OWNED_TIER`), and Margot adds no channel for the file list.
- The ledger size budget drops the replay receipt first, then this round's fixed entries, then the oldest dismissals. The previous reviewer's order dropped dismissals first and lost them, which two independent reviews found and fixed as a bug.
- The risk anchors keep the previous reviewer's wording, including "changes estate control", because the thresholds are calibrated on it.
- Jev's advisory template-adherence check is not restored. Its two flags, a risk line that reads as a sentence and a card restating another card's finding, label text the comment already shows verbatim, and the risk line is now required; restoring it would add a Jev call to every review.
- An empty ownership tier holds the review; the previous reviewer read it as no ownership and could clear it. Missing input never approves.
- Triage during a Jev outage reports functional with source `jev_unreachable` and makes no fallback call; the previous reviewer spent a fallback call to reach the same functional class. The floor treats both as not Jev-sourced.

## 0.7.0

- Cards and the voice now load natively from the card bundle. Claude Code runs the bundle's `pr-reviewer` and `margot` agents as a plugin (`--agent publish:pr-reviewer` or `publish:margot`, `--plugin-dir claude.pluginDirectory`), each with the tools its own frontmatter grants. A card invokes the `pr-council` skill and reads its card itself; the prompt names the card. Margot no longer rebuilds the agents from their prose, serves the card through the evidence server's `read_card` tool, or adds prompt text about the tools.
- The bundle commit in `review.cardBundle.commit` must have agents whose frontmatter lists the evidence tools (publish-skills `native-confined` or later). With an older bundle the tool check rejects the run.
- The tool check expects `Skill`, `Read`, the served evidence tools the reviewer's frontmatter lists and any configured ticketing tools for a card, and the evidence tools Margot's frontmatter lists for the voice. A card's `Read` is confined to the bundle's `pr-council` skill directory and an empty working directory. A card's `Skill` is denied every skill in the plugin except `pr-council`.
- A card run refuses, before starting Claude, any configured `claude.ticketing.tools` entry that the bundle's `agents/pr-reviewer.md` does not grant, and names the missing tools.
- Claude runs in an empty working directory; the diff and the MCP configuration are kept in a separate private directory.
- The bundle no longer reports card paths; recordings drop `bundle.cardPaths`.

## 0.6.16

- The decision fallback, which answers Jev's classification, routing and risk questions when Jev is unavailable, runs on `claude.reviewerModel`, the model the council uses, instead of a fixed `claude-haiku-4-5`. Its answers are judgment calls, and no model name stays hard-coded in the package.
- The samples now work across repositories: each job mints its GitHub tokens from the review App with `actions/create-github-app-token`, scoped to the target repository (a read token for `GH_TOKEN`, a checks, contents and pull-requests write token for `MARGOT_WRITE_TOKEN`, a checks-write token for the closer), and the jobs' own `permissions` are `contents: read`. The README's environment table says which token each variable needs. The hosted sample installs the configured ticketing server in a placeholder step.
- A review is rejected unless Claude reports exactly the requested tools and every MCP server connected; before, a missing tool or a server that failed to start was accepted and a card could finish without reading the diff.
- The evidence and ticketing MCP servers run with `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` blanked, so a configured ticketing server cannot read the model credential.
- A same-head re-run that reuses the saved review now carries the current request, so a re-run whose dispatch fields differ (such as `triage` or `classification`) no longer fails publication with a false "Not reviewed: The review could not be published".
- A saved review that fell back, or whose voice ruled ERROR, is no longer reused on a same-head re-run; the head is reviewed afresh once the service answers.

## 0.6.15

- Security fix: the GitHub token and ticketing secrets no longer appear on the `claude` command line, where any process on the host could read them; the MCP configuration is now passed as a 0600 file in the run's private temporary directory.
- A card's labels and completion value tolerate markdown decoration as the voice's do (`**Completion:** completed`, `completion: **completed**`, `Completion: completed.`, a bolded `**Checked:**` heading), and the voice's established and dismissed lists accept `*` bullets as card sections do.
- The Claude settings no longer name one plugin to disable; an empty setting-sources list already keeps installed plugins out of the run.

## 0.6.14

- A fallback (or unreachable-Jev) routing or risk answer now holds a documentation change as it does any other class, with `decision_source: fallback`; this restores the previous reviewer's fail-closed rule, which 0.6.13 had relaxed for documentation.
- The ledger size budget drops this round's fixed entries, which nothing reads later, before any dismissal; the 0.6.13 note above said dismissals outlast only the receipt, but fixed entries were dropped after them.
- `samples/config.sample.json` carries a placeholder `publisher` block and every optional key, so the samples' first `--authority true` run no longer fails with "Authority requires publisher configuration"; the README describes GitHub mode.
- `margot-instance close-stranded-check` takes `--check-name` (default `review / margot`) for the review check to close; the legacy bare `margot` name is no longer tried.
- A card Margot did not run always renders as "skipped: not selected"; the unused per-card skip reason is gone.

## 0.6.13

- A large review no longer loses its dismissals to the size budget: the ledger drops its replay receipt before any dismissal, so the next round does not re-raise a dismissed finding as new.
- The fallback wording says which step fell back. A routing-only fallback no longer claims the risk was scored by a fallback; the comment and the check title name routing, risk, or both. A receipt saved by 0.6.12 with the earlier single `fallback` reason replays with a generic "a model step fell back" sentence.
- The hold-reason sentences cover only the reasons a held approval can carry. The 0.6.12 line below that gives an error and a pending author a sentence overstated it: those outcomes are not approvals, so they are never held under that wording.
- The fallback decider runs the Claude CLI without loading the runner's own settings and refuses a CLI that is not the pinned `claude.version`, as the council reviewers already do.
- A stop reason that is only an inherited object key, such as `toString`, is treated as an unknown stop by the check closer.

## 0.6.12

- When a review ends in an error, `margot-review` prints the failed stage and diagnostic to stderr, so the reason survives in the run log after the output file is removed. The check summary and the not-reviewed comment point to the review run for it.
- A MAJOR finding that a card re-raises with `late=delta-reach: <reason>` no longer drops to a late advisory when its earlier ledger entry was an advisory; it blocks at its honest severity, as the prompt promises.
- A held review names one reason, in the same words, in the review comment and in the check title. A protected-path hold says "it touches a protected path"; holds from a fallback-scored risk, uncomputed ownership, calibration, an error and a pending author each get a plain sentence in the comment too.
- The shipped recordings, including `recordings/prose`, are synthetic and describe `example/project`; their commit hashes are placeholders.
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
