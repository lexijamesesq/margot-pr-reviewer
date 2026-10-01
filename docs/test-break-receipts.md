# Test and deliberate-break receipts

Run: 2026-10-01T01:47:43.106Z. Node v26.3.1.

Baseline: 246/246 passed. Each scenario break changes the named scenario's service output/caller input, or its explicitly declared source mutation; expected assertions stay unchanged. Every run executes the full suite. For each scenario break, the named test and any explicitly declared alsoFails tests failed, with all other tests passing. The two older prompt-rule mutations also fail the complete P1 wire contract. Each break was reverted before the next run. Restored baseline: 246/246 passed.

Most breaks mutate only their own scenario input. For those breaks, the harness guarantees that other scenarios are unchanged, so the observed one-failure result cannot reveal a duplicated test. These are controlled service/input counterexamples plus declared source mutations, not a claim of independent or exhaustive implementation mutation coverage. Error scenarios repair exactly the invalid response to prove that the error test distinguishes it from usable evidence. Classification question tests protect the text sent to Jev, not Jev's interpretation of it. Exact paths, values, and expectations are in tests/scenarios.json and tests/source-breaks.json; run npm run test:breaks.

Separate source-level checks caught 16 mutations: reversed classification precedence, forced documentation band, always-true routing, dropped old-path rename check, disabled LOW-band confidence escalation, mis-mapped finding severity, mis-mapped finding confidence, mis-mapped finding location, mis-mapped voice outcome, mis-mapped voice band, disabled ledger author authentication, removed round-two MINOR demotion, silently dropped MAJOR verification, removed shared diff hunk validation, dropped Claude stdin prompt, replaced Claude round delta with full PR diff. Each mutation failed its intended tests; all observed failures are listed below.

Scenario SHA-256: d1a63a1bc5f8858023802dac80a9f453c9eef0e8418a8773fa61dd137312ed54.

Source mutation SHA-256: 6f1a36d29361bcb1b8772f9350a47ab341b8bece821edf5121ba7f14a130dbae.

| # | Single failing test | Deliberate break | Observed |
| --- | --- | --- | --- |
| 1 | result records the route answer Jev returned | Drop Jev's route answer from the result. | 1 failed, 245 passed; assertion mismatch |
| 2 | functional result records the risk answer Jev returned | Drop Jev's risk answer from the result. | 1 failed, 245 passed; assertion mismatch |
| 3 | mechanical result records null Jev answers when no question was asked | Route the mechanical change so a Jev answer is recorded. | 1 failed, 245 passed; assertion mismatch |
| 4 | recorded mechanical bump spends no Claude | Misclassify a version-only bump as functional. | 1 failed, 245 passed; assertion mismatch |
| 5 | recorded clear council reaches publication | Lose a selected safety report. | 1 failed, 245 passed; assertion mismatch |
| 6 | recorded voice rating holds the same displayed band | Lower the voice band while retaining its approval. | 1 failed, 245 passed; assertion mismatch |
| 7 | recorded malformed accounting cannot approve | Repair the missing disposition; the error assertion must detect it. | 1 failed, 245 passed; assertion mismatch |
| 8 | recorded author findings request changes | Return approval despite established issues. | 1 failed, 245 passed; assertion mismatch |
| 9 | recorded second round fixes both earlier MINOR findings | Replace the prior review author with an untrusted actor. | 1 failed, 245 passed; assertion mismatch |
| 10 | recorded no council excludes only uncertain dimensions | Claim confidence in the otherwise ignored MEDIUM dimension. | 1 failed, 245 passed; assertion mismatch |
| 11 | functional takes precedence over other confident classes | Remove the functional classification evidence. | 1 failed, 245 passed; assertion mismatch |
| 12 | documentation takes precedence over mechanical | Remove the documentation classification evidence. | 1 failed, 245 passed; assertion mismatch |
| 13 | ambiguous classification selects full review | Turn ambiguity into a confident mechanical answer. | 1 failed, 245 passed; assertion mismatch |
| 14 | fresh classification raises a trusted mechanical receipt | Replace the fresh functional judgment with mechanical. | 1 failed, 245 passed; assertion mismatch |
| 15 | trusted triage can only raise the test profile | Lower the earlier trusted profile. | 1 failed, 245 passed; assertion mismatch |
| 16 | classification question tells Jev to judge human formatting by behavior | Remove the relevant classification rule from the question sent to Jev. | 2 failed, 244 passed; assertion mismatch |
| 17 | classification question tells Jev agent instructions are functional | Remove the relevant classification rule from the question sent to Jev. | 2 failed, 244 passed; assertion mismatch |
| 18 | substantive documentation defaults to works-and-proven | Claim the substantive change has no changed meaning. | 1 failed, 245 passed; assertion mismatch |
| 19 | editorial documentation skips council and voice | Report changed meaning on an editorial edit. | 1 failed, 245 passed; assertion mismatch |
| 20 | missing documentation meaning answer requires review | Replace missing meaning evidence with a confident no. | 1 failed, 245 passed; assertion mismatch |
| 21 | documentation defects go to the author at LOW | Drop the documented defect from the voice accounting. | 1 failed, 245 passed; assertion mismatch |
| 22 | documentation questions request clarification at LOW | Replace an intent question with a change demand. | 1 failed, 245 passed; assertion mismatch |
| 23 | a selected functional lens runs | Move the safety probability below the summon boundary. | 1 failed, 245 passed; assertion mismatch |
| 24 | confident no council clears without voice | Make the empty routing decision uncertain. | 1 failed, 245 passed; assertion mismatch |
| 25 | uncertain empty routing escalates to voice | Claim confident empty routing. | 1 failed, 245 passed; assertion mismatch |
| 26 | confident MEDIUM no council is held | Voice overrides a MEDIUM decision down to LOW. | 1 failed, 245 passed; assertion mismatch |
| 27 | risk tail at the boundary raises the band | Move high-level tail mass just below the boundary. | 1 failed, 245 passed; assertion mismatch |
| 28 | risk tail below boundary stays LOW | Move tail mass onto the boundary. | 1 failed, 245 passed; assertion mismatch |
| 29 | no confident risk dimension cannot use the floor | Voice lowers a band with no confident dimension. | 1 failed, 245 passed; assertion mismatch |
| 30 | council prevents the no council confidence floor | Remove the council and permit the no-council floor. | 1 failed, 245 passed; assertion mismatch |
| 31 | voice can lower functional risk for both display and merge | Raise the final voice rating. | 1 failed, 245 passed; assertion mismatch |
| 32 | dismissed mandatory findings permit approval | Turn a dismissal into an established unresolved finding. | 1 failed, 245 passed; assertion mismatch |
| 33 | duplicate dispositions are rejected | Remove the duplicate disposition. | 1 failed, 245 passed; assertion mismatch |
| 34 | unknown disposition IDs are rejected | Remove the unknown finding disposition. | 1 failed, 245 passed; assertion mismatch |
| 35 | contradictory approval is rejected | Repair approval with established findings. | 1 failed, 245 passed; assertion mismatch |
| 36 | BLOCKING info findings require voice accounting | Reduce the informational finding below the blocking threshold. | 1 failed, 245 passed; assertion mismatch |
| 37 | objective questions require voice accounting | Lose the objective question. | 1 failed, 245 passed; assertion mismatch |
| 38 | functional authority paths hold | Remove configured authority protection. | 1 failed, 245 passed; assertion mismatch |
| 39 | ordinary documentation on a protected path stays author-owned | Turn a protected edit into a rename. | 1 failed, 245 passed; assertion mismatch |
| 40 | protected old rename path always holds | Remove the protected old rename endpoint. | 1 failed, 245 passed; assertion mismatch |
| 41 | protected new rename path always holds | Remove the protected new rename endpoint. | 1 failed, 245 passed; assertion mismatch |
| 42 | missing trusted configuration cannot approve | Repair only the missing trusted configuration response. | 1 failed, 245 passed; assertion mismatch |
| 43 | malformed request cannot approve | Repair only the malformed request response. | 1 failed, 245 passed; assertion mismatch |
| 44 | incomplete facts cannot approve | Repair only the incomplete facts response. | 1 failed, 245 passed; assertion mismatch |
| 45 | truncated file listing cannot approve | Repair only the truncated file listing response. | 1 failed, 245 passed; assertion mismatch |
| 46 | stale fetched head cannot approve | Repair only the stale fetched head response. | 1 failed, 245 passed; assertion mismatch |
| 47 | wrong repository facts cannot approve | Repair only the wrong repository facts response. | 1 failed, 245 passed; assertion mismatch |
| 48 | unreadable history cannot approve | Repair only the unreadable history response. | 1 failed, 245 passed; assertion mismatch |
| 49 | degraded classification cannot approve | Repair only the degraded classification response. | 1 failed, 245 passed; assertion mismatch |
| 50 | malformed classification probability cannot approve | Repair only the malformed classification probability response. | 1 failed, 245 passed; assertion mismatch |
| 51 | malformed route cannot approve | Repair only the malformed route response. | 1 failed, 245 passed; assertion mismatch |
| 52 | fallback risk cannot approve | Repair only the fallback risk response. | 1 failed, 245 passed; assertion mismatch |
| 53 | missing risk dimension cannot approve | Repair only the missing risk dimension response. | 1 failed, 245 passed; assertion mismatch |
| 54 | invalid risk distribution cannot approve | Repair only the invalid risk distribution response. | 1 failed, 245 passed; assertion mismatch |
| 55 | wrong bundle pin cannot approve | Repair only the wrong bundle pin response. | 1 failed, 245 passed; assertion mismatch |
| 56 | missing explicit card path cannot approve | Repair only the missing explicit card path response. | 1 failed, 245 passed; assertion mismatch |
| 57 | incomplete selected card cannot approve | Repair only the incomplete selected card response. | 1 failed, 245 passed; assertion mismatch |
| 58 | wrong returned card cannot approve | Repair only the wrong returned card response. | 1 failed, 245 passed; assertion mismatch |
| 59 | missing required check cannot approve | Repair only the missing required check response. | 1 failed, 245 passed; assertion mismatch |
| 60 | forged required-check actor cannot approve | Repair only the forged required-check actor response. | 1 failed, 245 passed; assertion mismatch |
| 61 | stale required-check SHA cannot approve | Repair only the stale required-check SHA response. | 1 failed, 245 passed; assertion mismatch |
| 62 | failed required check cannot approve | Repair only the failed required check response. | 1 failed, 245 passed; assertion mismatch |
| 63 | duplicate required check cannot approve | Repair only the duplicate required check response. | 1 failed, 245 passed; assertion mismatch |
| 64 | head movement before publication cannot approve | Repair only the head movement before publication response. | 1 failed, 245 passed; assertion mismatch |
| 65 | wrong publication receipt SHA cannot approve | Repair only the wrong publication receipt SHA response. | 1 failed, 245 passed; assertion mismatch |
| 66 | untrusted triage actor cannot lower review | Repair the triage actor binding. | 1 failed, 245 passed; assertion mismatch |
| 67 | untrusted triage head cannot lower review | Repair the triage head binding. | 1 failed, 245 passed; assertion mismatch |
| 68 | untrusted triage base cannot lower review | Repair the triage base binding. | 1 failed, 245 passed; assertion mismatch |
| 69 | classification service failure is not empty success | Restore the failed classification service response. | 1 failed, 245 passed; assertion mismatch |
| 70 | route service failure is not empty success | Restore the failed route service response. | 1 failed, 245 passed; assertion mismatch |
| 71 | risk service failure is not empty success | Restore the failed risk service response. | 1 failed, 245 passed; assertion mismatch |
| 72 | card:safety service failure is not empty success | Restore the failed card:safety service response. | 1 failed, 245 passed; assertion mismatch |
| 73 | publish service failure is not empty success | Restore the failed publish service response. | 1 failed, 245 passed; assertion mismatch |
| 74 | card timeout cannot approve | Let the timed-out card complete. | 1 failed, 245 passed; assertion mismatch |
| 75 | voice transport failure cannot approve | Restore the missing voice response. | 1 failed, 245 passed; assertion mismatch |
| 76 | malformed voice cannot approve | Return a well-formed voice outcome. | 1 failed, 245 passed; assertion mismatch |
| 77 | duplicate finding IDs cannot disappear | Restore the unique finding ID. | 1 failed, 245 passed; assertion mismatch |
| 78 | held review disables already armed auto merge | Report that auto-merge is not armed. | 1 failed, 245 passed; assertion mismatch |
| 79 | unconfirmed auto merge disable fails closed | Confirm the previously unconfirmed disable. | 1 failed, 245 passed; assertion mismatch |
| 80 | error path attempts to disarm auto merge | Hide the armed merge state on a failed review. | 1 failed, 245 passed; assertion mismatch |
| 81 | calibration never clears | Switch off calibration mode. | 1 failed, 245 passed; assertion mismatch |
| 82 | publication uses the rendered governing result | Suppress the recorded publication. | 1 failed, 245 passed; assertion mismatch |
| 83 | explicit card paths reach every selected reviewer | Inject a nonexistent safety card path. | 1 failed, 245 passed; assertion mismatch |
| 84 | triage classifies without publishing approval | Dispatch triage as review. | 1 failed, 245 passed; assertion mismatch |
| 85 | publication none produces no write | Enable publication on a dry run. | 1 failed, 245 passed; assertion mismatch |
| 86 | sixty first file is retained in authority protection | Remove the protected sixty-first file from the returned evidence. | 1 failed, 245 passed; assertion mismatch |
| 87 | documentation asks whether meaning changed | Remove the documentation meaning question from the route contract. | 1 failed, 245 passed; assertion mismatch |
| 88 | functional routing omits the documentation meaning question | Send the documentation-only question on the functional route. | 1 failed, 245 passed; assertion mismatch |
| 89 | LOW council risk with uncertain dimension requires voice | Raise the only uncertain dimension confidence to the 0.3 boundary. | 1 failed, 245 passed; assertion mismatch |
| 90 | publication rejects malformed SHA | Repair the invalid external head response. | 1 failed, 245 passed; assertion mismatch |
| 91 | publication rejects non-string head | Repair the invalid external head response. | 1 failed, 245 passed; assertion mismatch |
| 92 | held review rejects truthy string disarm response | Replace the truthy non-boolean disarm response with true. | 1 failed, 245 passed; assertion mismatch |
| 93 | error recovery rejects truthy string disarm response | Confirm emergency disarm with the boolean true. | 1 failed, 245 passed; assertion mismatch |
| 94 | held review rejects truthy number disarm response | Replace the truthy non-boolean disarm response with true. | 1 failed, 245 passed; assertion mismatch |
| 95 | error recovery rejects truthy number disarm response | Confirm emergency disarm with the boolean true. | 1 failed, 245 passed; assertion mismatch |
| 96 | held review rejects truthy object disarm response | Replace the truthy non-boolean disarm response with true. | 1 failed, 245 passed; assertion mismatch |
| 97 | error recovery rejects truthy object disarm response | Confirm emergency disarm with the boolean true. | 1 failed, 245 passed; assertion mismatch |
| 98 | error recovery reports unconfirmed boolean disarm | Confirm emergency disarm instead of returning false. | 1 failed, 245 passed; assertion mismatch |
| 99 | voice without council validates the bundle pin | Restore the pinned bundle for a voice-only review. | 1 failed, 245 passed; assertion mismatch |

## Source mutations

| Mutation | Observed failing tests | Result |
| --- | --- | --- |
| reversed classification precedence | functional takes precedence over other confident classes; documentation takes precedence over mechanical | 2 failed, 244 passed; assertion mismatches |
| forced documentation band | documentation defects go to the author at LOW; documentation questions request clarification at LOW; dismissed mandatory findings permit approval | 3 failed, 243 passed; assertion mismatches |
| always-true routing | mechanical result records null Jev answers when no question was asked; recorded mechanical bump spends no Claude | 2 failed, 244 passed; assertion mismatches |
| dropped old-path rename check | protected old rename path always holds | 1 failed, 245 passed; assertion mismatches |
| disabled LOW-band confidence escalation | LOW council risk with uncertain dimension requires voice | 1 failed, 245 passed; assertion mismatches |
| mis-mapped finding severity | Card prose preserves a real mandatory finding | 1 failed, 245 passed; assertion mismatches |
| mis-mapped finding confidence | Card prose preserves a real mandatory finding | 1 failed, 245 passed; assertion mismatches |
| mis-mapped finding location | Card prose preserves a real mandatory finding | 1 failed, 245 passed; assertion mismatches |
| mis-mapped voice outcome | Voice prose preserves finding IDs and dispositions | 1 failed, 245 passed; assertion mismatches |
| mis-mapped voice band | Voice prose preserves finding IDs and dispositions; Duplicate voice bands are rejected | 2 failed, 244 passed; assertion mismatches |
| disabled ledger author authentication | Forged author cannot supply ledger history | 1 failed, 245 passed; assertion mismatches |
| removed round-two MINOR demotion | Round two MINOR is advisory | 1 failed, 245 passed; assertion mismatches |
| silently dropped MAJOR verification | Silent MAJOR returns to voice for confirmation; Voice-confirmed fix counts once; Standing card defeats mechanical shortcut; Standing card defeats editorial shortcut; Same head reuses identical result without paid calls; Same-head retry revalidates required checks; An info-tagged repeat cannot silently close a MAJOR; Changed PR evidence invalidates saved approval; Changed live service configuration invalidates retry | 9 failed, 237 passed; assertion mismatches |
| removed shared diff hunk validation | A partial final hunk cannot claim complete facts; Truncated delta hunk uses complete full PR | 2 failed, 244 passed; assertion mismatches |
| dropped Claude stdin prompt | Claude receives its complete prompt on stdin and only the round delta through read_diff | 1 failed, 245 passed; assertion mismatches |
| replaced Claude round delta with full PR diff | Claude receives its complete prompt on stdin and only the round delta through read_diff | 1 failed, 245 passed; assertion mismatches |
