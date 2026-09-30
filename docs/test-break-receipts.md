# Test and deliberate-break receipts

Run: 2026-09-30T03:48:07.963Z. Node v26.3.1.

Baseline: 85/85 passed. Each break changes the named scenario's service output/caller input, or its explicitly declared source mutation; expected assertions stay unchanged. Every run executes the full suite. The one named test failed at its behavioral result assertion, with all other tests passing. Each break was reverted before the next run. Restored baseline: 85/85 passed.

Most breaks mutate only their own scenario input. For those breaks, the harness guarantees that other scenarios are unchanged, so the observed one-failure result cannot reveal a duplicated test. These are controlled service/input counterexamples plus declared source mutations, not a claim of independent or exhaustive implementation mutation coverage. Error scenarios repair exactly the invalid response to prove that the error test distinguishes it from usable evidence. Exact paths, values, and expectations are in tests/scenarios.json; run npm run test:breaks.

Separate source-level checks reversed classification precedence, forced the documentation band, made routing always true, and dropped the old-path rename check. Each mutation was caught by its intended test.

Scenario SHA-256: 49bc319e0c114427ec721a120e5a1249d77b20603fae4f43cf6d136abf865382.

| # | Single failing test | Deliberate break | Observed |
| --- | --- | --- | --- |
| 1 | recorded mechanical bump spends no Claude | Misclassify a version-only bump as functional. | 1 failed, 84 passed; assertion mismatch |
| 2 | recorded clear council reaches publication | Lose a selected safety report. | 1 failed, 84 passed; assertion mismatch |
| 3 | recorded voice rating holds the same displayed band | Lower the voice band while retaining its approval. | 1 failed, 84 passed; assertion mismatch |
| 4 | recorded malformed accounting cannot approve | Repair the missing disposition; the error assertion must detect it. | 1 failed, 84 passed; assertion mismatch |
| 5 | recorded author findings request changes | Return approval despite established issues. | 1 failed, 84 passed; assertion mismatch |
| 6 | recorded prior ledger is refused without overwrite | Erase the prior-ledger marker. | 1 failed, 84 passed; assertion mismatch |
| 7 | recorded no council excludes only uncertain dimensions | Claim confidence in the otherwise ignored MEDIUM dimension. | 1 failed, 84 passed; assertion mismatch |
| 8 | functional takes precedence over other confident classes | Remove the functional classification evidence. | 1 failed, 84 passed; assertion mismatch |
| 9 | documentation takes precedence over mechanical | Remove the documentation classification evidence. | 1 failed, 84 passed; assertion mismatch |
| 10 | ambiguous classification selects full review | Turn ambiguity into a confident mechanical answer. | 1 failed, 84 passed; assertion mismatch |
| 11 | fresh classification raises a trusted mechanical receipt | Replace the fresh functional judgment with mechanical. | 1 failed, 84 passed; assertion mismatch |
| 12 | trusted triage can only raise the test profile | Lower the earlier trusted profile. | 1 failed, 84 passed; assertion mismatch |
| 13 | a human formatting change is mechanical | Misclassify a human formatting pass. | 1 failed, 84 passed; assertion mismatch |
| 14 | agent instructions in markdown are functional | Classify agent behavior as ordinary documentation. | 1 failed, 84 passed; assertion mismatch |
| 15 | substantive documentation defaults to works-and-proven | Claim the substantive change has no changed meaning. | 1 failed, 84 passed; assertion mismatch |
| 16 | editorial documentation skips council and voice | Report changed meaning on an editorial edit. | 1 failed, 84 passed; assertion mismatch |
| 17 | missing documentation meaning answer requires review | Replace missing meaning evidence with a confident no. | 1 failed, 84 passed; assertion mismatch |
| 18 | documentation defects go to the author at LOW | Drop the documented defect from the voice accounting. | 1 failed, 84 passed; assertion mismatch |
| 19 | documentation questions request clarification at LOW | Replace an intent question with a change demand. | 1 failed, 84 passed; assertion mismatch |
| 20 | a selected functional lens runs | Move the safety probability below the summon boundary. | 1 failed, 84 passed; assertion mismatch |
| 21 | confident no council clears without voice | Make the empty routing decision uncertain. | 1 failed, 84 passed; assertion mismatch |
| 22 | uncertain empty routing escalates to voice | Claim confident empty routing. | 1 failed, 84 passed; assertion mismatch |
| 23 | confident MEDIUM no council is held | Voice overrides a MEDIUM decision down to LOW. | 1 failed, 84 passed; assertion mismatch |
| 24 | risk tail at the boundary raises the band | Move high-level tail mass just below the boundary. | 1 failed, 84 passed; assertion mismatch |
| 25 | risk tail below boundary stays LOW | Move tail mass onto the boundary. | 1 failed, 84 passed; assertion mismatch |
| 26 | no confident risk dimension cannot use the floor | Voice lowers a band with no confident dimension. | 1 failed, 84 passed; assertion mismatch |
| 27 | council prevents the no council confidence floor | Remove the council and permit the no-council floor. | 1 failed, 84 passed; assertion mismatch |
| 28 | voice can lower functional risk for both display and merge | Raise the final voice rating. | 1 failed, 84 passed; assertion mismatch |
| 29 | dismissed mandatory findings permit approval | Turn a dismissal into an established unresolved finding. | 1 failed, 84 passed; assertion mismatch |
| 30 | duplicate dispositions are rejected | Remove the duplicate disposition. | 1 failed, 84 passed; assertion mismatch |
| 31 | unknown disposition IDs are rejected | Remove the unknown finding disposition. | 1 failed, 84 passed; assertion mismatch |
| 32 | contradictory approval is rejected | Repair approval with established findings. | 1 failed, 84 passed; assertion mismatch |
| 33 | BLOCKING info findings require voice accounting | Reduce the informational finding below the blocking threshold. | 1 failed, 84 passed; assertion mismatch |
| 34 | objective questions require voice accounting | Lose the objective question. | 1 failed, 84 passed; assertion mismatch |
| 35 | functional authority paths hold | Remove configured authority protection. | 1 failed, 84 passed; assertion mismatch |
| 36 | ordinary documentation on a protected path stays author-owned | Turn a protected edit into a rename. | 1 failed, 84 passed; assertion mismatch |
| 37 | protected old rename path always holds | Remove the protected old rename endpoint. | 1 failed, 84 passed; assertion mismatch |
| 38 | protected new rename path always holds | Remove the protected new rename endpoint. | 1 failed, 84 passed; assertion mismatch |
| 39 | missing trusted configuration cannot approve | Repair only the missing trusted configuration response. | 1 failed, 84 passed; assertion mismatch |
| 40 | malformed request cannot approve | Repair only the malformed request response. | 1 failed, 84 passed; assertion mismatch |
| 41 | incomplete facts cannot approve | Repair only the incomplete facts response. | 1 failed, 84 passed; assertion mismatch |
| 42 | truncated file listing cannot approve | Repair only the truncated file listing response. | 1 failed, 84 passed; assertion mismatch |
| 43 | stale fetched head cannot approve | Repair only the stale fetched head response. | 1 failed, 84 passed; assertion mismatch |
| 44 | wrong repository facts cannot approve | Repair only the wrong repository facts response. | 1 failed, 84 passed; assertion mismatch |
| 45 | unreadable history cannot approve | Repair only the unreadable history response. | 1 failed, 84 passed; assertion mismatch |
| 46 | degraded classification cannot approve | Repair only the degraded classification response. | 1 failed, 84 passed; assertion mismatch |
| 47 | malformed classification probability cannot approve | Repair only the malformed classification probability response. | 1 failed, 84 passed; assertion mismatch |
| 48 | malformed route cannot approve | Repair only the malformed route response. | 1 failed, 84 passed; assertion mismatch |
| 49 | fallback risk cannot approve | Repair only the fallback risk response. | 1 failed, 84 passed; assertion mismatch |
| 50 | missing risk dimension cannot approve | Repair only the missing risk dimension response. | 1 failed, 84 passed; assertion mismatch |
| 51 | invalid risk distribution cannot approve | Repair only the invalid risk distribution response. | 1 failed, 84 passed; assertion mismatch |
| 52 | wrong bundle pin cannot approve | Repair only the wrong bundle pin response. | 1 failed, 84 passed; assertion mismatch |
| 53 | missing explicit card path cannot approve | Repair only the missing explicit card path response. | 1 failed, 84 passed; assertion mismatch |
| 54 | incomplete selected card cannot approve | Repair only the incomplete selected card response. | 1 failed, 84 passed; assertion mismatch |
| 55 | wrong returned card cannot approve | Repair only the wrong returned card response. | 1 failed, 84 passed; assertion mismatch |
| 56 | missing required check cannot approve | Repair only the missing required check response. | 1 failed, 84 passed; assertion mismatch |
| 57 | forged required-check actor cannot approve | Repair only the forged required-check actor response. | 1 failed, 84 passed; assertion mismatch |
| 58 | stale required-check SHA cannot approve | Repair only the stale required-check SHA response. | 1 failed, 84 passed; assertion mismatch |
| 59 | failed required check cannot approve | Repair only the failed required check response. | 1 failed, 84 passed; assertion mismatch |
| 60 | duplicate required check cannot approve | Repair only the duplicate required check response. | 1 failed, 84 passed; assertion mismatch |
| 61 | head movement before publication cannot approve | Repair only the head movement before publication response. | 1 failed, 84 passed; assertion mismatch |
| 62 | wrong publication receipt SHA cannot approve | Repair only the wrong publication receipt SHA response. | 1 failed, 84 passed; assertion mismatch |
| 63 | untrusted triage actor cannot lower review | Repair the triage actor binding. | 1 failed, 84 passed; assertion mismatch |
| 64 | untrusted triage head cannot lower review | Repair the triage head binding. | 1 failed, 84 passed; assertion mismatch |
| 65 | untrusted triage base cannot lower review | Repair the triage base binding. | 1 failed, 84 passed; assertion mismatch |
| 66 | classification service failure is not empty success | Restore the failed classification service response. | 1 failed, 84 passed; assertion mismatch |
| 67 | route service failure is not empty success | Restore the failed route service response. | 1 failed, 84 passed; assertion mismatch |
| 68 | risk service failure is not empty success | Restore the failed risk service response. | 1 failed, 84 passed; assertion mismatch |
| 69 | card:safety service failure is not empty success | Restore the failed card:safety service response. | 1 failed, 84 passed; assertion mismatch |
| 70 | publish service failure is not empty success | Restore the failed publish service response. | 1 failed, 84 passed; assertion mismatch |
| 71 | card timeout cannot approve | Let the timed-out card complete. | 1 failed, 84 passed; assertion mismatch |
| 72 | voice transport failure cannot approve | Restore the missing voice response. | 1 failed, 84 passed; assertion mismatch |
| 73 | malformed voice cannot approve | Return a well-formed voice outcome. | 1 failed, 84 passed; assertion mismatch |
| 74 | duplicate finding IDs cannot disappear | Restore the unique finding ID. | 1 failed, 84 passed; assertion mismatch |
| 75 | held review disables already armed auto merge | Report that auto-merge is not armed. | 1 failed, 84 passed; assertion mismatch |
| 76 | unconfirmed auto merge disable fails closed | Confirm the previously unconfirmed disable. | 1 failed, 84 passed; assertion mismatch |
| 77 | error path attempts to disarm auto merge | Hide the armed merge state on a failed review. | 1 failed, 84 passed; assertion mismatch |
| 78 | calibration never clears | Switch off calibration mode. | 1 failed, 84 passed; assertion mismatch |
| 79 | publication uses the rendered governing result | Suppress the recorded publication. | 1 failed, 84 passed; assertion mismatch |
| 80 | explicit card paths reach every selected reviewer | Inject a nonexistent safety card path. | 1 failed, 84 passed; assertion mismatch |
| 81 | triage classifies without publishing approval | Dispatch triage as review. | 1 failed, 84 passed; assertion mismatch |
| 82 | publication none produces no write | Enable publication on a dry run. | 1 failed, 84 passed; assertion mismatch |
| 83 | sixty first file is retained in authority protection | Remove the protected sixty-first file from the returned evidence. | 1 failed, 84 passed; assertion mismatch |
| 84 | documentation asks whether meaning changed | Remove the documentation meaning question from the route contract. | 1 failed, 84 passed; assertion mismatch |
| 85 | functional routing omits the documentation meaning question | Send the documentation-only question on the functional route. | 1 failed, 84 passed; assertion mismatch |
