# Changelog

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
- A verdict code reaches without the voice carries the previous reviewer's risk label and summary: "low exposure" with the dimension Jev scored highest (such as "low exposure — operations"; the risk answer now keeps Jev's `score`, and a dimension without one counts as 2) and "Reviewed against the summoned lenses; no blocking findings." (or "No review lens was required for this change."), the mechanical label and summary, and "editorial documentation change" with `verdict_source: documentation_editorial`.
- A floor stop is titled "Margot: preflight — required checks not green — waiting for the next push" with the previous reviewer's summary, reversing the 0.6.12 wording.
- A fresh verdict whose risk line has no classification is held at the voice stage instead of posted, as the previous reviewer's template gate held it. The voice's own ERROR is exempt, and a saved verdict replays as posted. The shipped recordings gain the `risk` line the voice always gives.
- A fresh review whose shown card finding has no plain sentence (its text only punctuation) is held at the render stage instead of posted, completing the previous reviewer's template gate.
- The verdict check's summary is the outcome, the band and the first sentence of the risk label (`APPROVED, HIGH: mechanical change — no functional change.`). The band rationale stays in the check text's `band_reason:` line.
- A held approval names its reason in the previous reviewer's words and order: "the risk was scored by the fallback (reduced confidence)", "risk is" and the band, "it changes Margot's own machinery; approve it and" the configured merge actor "merges it", "ownership could not be established", or "above my authority", always followed by "Yours to merge." The fallback notice is one sentence whichever step fell back. Calibration alone adds no authority line, and the check is titled "calibrating".
- Correction: the 0.6.14 note that holding a documentation change on a fallback answer restores the previous reviewer's rule was wrong. The previous reviewer reviewed such a change and recorded it as Jev-sourced; 0.8.0 does the same.

Deliberate differences from the previous reviewer:

- The voice's band decides merge eligibility, one band for display and merge (the operator's ruling). The previous reviewer used Jev's conservative level.
- Jev's routing and risk state names the ownership tier but not the owned files: the host passes only the tier (`MARGOT_OWNED_TIER`), and Margot adds no channel for the file list.
- The ledger size budget drops the replay receipt first, then this round's fixed entries, then the oldest dismissals. The previous reviewer's order dropped dismissals first and lost them, which two independent reviews found and fixed as a bug.
- The risk anchors keep the previous reviewer's wording, including "changes estate control", because the thresholds are calibrated on it.
- An editorial documentation change still renders the council roster, every card skipped, as the previous reviewer rendered it.
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
