# Guide a change from first visit to archive

## Why
A maintainer opening one change needs to know where it stands, who acts next and how to finish it. The board already shows where work stands. The difficult part is deciding who acts next when local task completion, the agent and GitHub tell different parts of the story.

## Current flow review

| Journey | Current evidence | Proposed improvement |
| --- | --- | --- |
| Plan | Drafts shows four abbreviated labels at 7.5px. Full names are available on hover. The artifact tabs already contain the documents. | Keep the compact segments. Selecting Drafts opens a readable list of the actual schema documents with status and links. Use the same interaction by touch and keyboard. |
| Implement | Ready describes the availability of a plan. Implementing can be inferred from tasks or session evidence. A session ending does not establish completion. | Show the next eligible action at its phase. Use a short scoped result such as “4 of 6 tasks complete” when resuming. Pulse only while work runs. |
| Validate and ship | Done may include tasks awaiting the user. The card uses recommendedAction while detail also computes separate completion and delivery actions. | Surface required decisions before optional actions. Explain what each button will do, e.g. “Review 2 tasks” or “Verify and open PR”. Preserve explicit approvals. |
| Recover and archive | Delivery distinguishes failed, waiting and merged. Unknown mergeability can read as “Checks running”. Archived can mean a local move whose archive PR is still open. Help still describes a separate checkpoint after Done. | Name the phase and the verified condition. Show a recovery action only when it can help. Show “Archive PR awaiting merge” until merge is confirmed. Update Help alongside the UI. |

## Returning to this change
Reopening the same detail tomorrow should answer why progress stopped. If implementation paused after four tasks, show “4 of 6 tasks complete” with the eligible continuation. If the agent asked a question, link directly to that change’s conversation. If GitHub is running checks, show the PR and let the user leave.

## What changes first
1. Align card and detail recommendations and recovery wording. This benefits every existing change.
2. Make returning to the same change predictable after a session ends, a PR merges or a worktree changes.
3. Make the planning documents readable from Drafts and clarify the final archive outcome.

## Capabilities and impact
Modified capability: change-detail. Reuse the existing session, task and PR evidence. Coordinate with reorg-change-details-header by keeping phase controls in the timeline.
