card: works-and-proven
completion: completed

Checked:
- I read `README.md` at the head sha (lines 1–6) against the diff (`@@ -1,3 +1,5 @@`) to find every behaviour the change adds. There is only one: new prose at `README.md:4-5`. No code, test, workflow or config file changed (fileCount=1). This check would have found any changed runtime behaviour that has a concrete regression risk but no test or other verification. It found none: a static documentation line has no runtime behaviour to regress.
- I compared the PR body's Verification section with the floor's receipt at head `0123abcd`. It claims `ci / checks` and `trusted-scan / trusted-scan`: both are listed with conclusion success by github-actions on this head. It claims Margot's review: `review / margot` is listed as success. It claims a merge by `merge-app[bot]`: this is presented as a later step of the proof, not as a check that already ran, and `autoMergeArmed` is false, so no merge is claimed as having happened. This check would have found a body claiming a check that did not run or did not pass on this head.

Not covered:
- Tests that only check a mock was called, or that copy the implementation: not applicable. No test file is in the changed file list, and the diff touches only `README.md`.
- A failing test deleted or loosened: not applicable. The diff has no `-` lines, and the only changed file is `README.md`, so no assertion was removed.

Findings:
