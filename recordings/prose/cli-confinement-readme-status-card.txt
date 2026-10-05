card: works-and-proven
completion: completed

Checked:
- Compared `README.md` at the head sha with the diff. The one changed behavior is the new status sentence at `README.md:5`, which is rendered text only. No code, workflow or config reads it, and the repo tree has no test tree that could pin it. This would have caught any runtime or tested behavior changed with no proof. None exists, and the change can be checked by reading it, so no test is owed.
- Checked each verification the PR body claims against the floor's receipt for head `0123abcd`. `ci / checks` succeeded (github-actions). `trusted-scan / trusted-scan` succeeded. `review / margot` succeeded. The merge by `merge-app[bot]` is framed as a step still to come, not as something done (`autoMergeArmed=false`). This would have caught a body claiming a check that didn't run or didn't pass on this head. Every past-tense claim is backed.
- Read `workflows/ci.yml:20-35`. `ci / checks` is the shared floor, `shared-ci.yml@v1`, with `check_name: checks`. This confirms the claimed check name maps to a real required job and wasn't invented. It would have caught a claim naming a check this repo doesn't define.
- Looked for deleted or loosened tests. The diff touches only `README.md` (fileCount=1, complete=true), so no test file was removed or weakened. This would have caught a failing test being deleted or loosened instead of fixed.

Not covered:
- Mock-only or mirror-the-implementation tests: this doesn't apply. The diff adds or changes no test, so there is nothing to probe.

Findings:
