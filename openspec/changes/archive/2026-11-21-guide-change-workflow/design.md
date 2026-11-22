# Interaction design

## One decision at the current checkpoint
Keep the six-phase rail for orientation. Put the recommended button under the phase where its effect will appear. Reuse the shared next-step rules and eligibility checks in board and detail. A compact disclosure provides optional actions and technical evidence. Keep the terminal accessible for users who choose to work there.

| Evidence for this change and phase | What the user sees | Who acts |
| --- | --- | --- |
| Plan ready, implementation available | Ready to implement · Start implementation | User |
| Implementation still running | Implementing · 4 of 6 tasks complete | Agent |
| Agent explicitly requests input | Agent has a question · Open conversation | User |
| PR status unknown after refresh fails | PR status unavailable · last checked time and View PR if known | User can inspect, no duplicate Ship |
| Checks pending | PR #42 · Checks running | GitHub |
| Conflicting PR | PR #42 conflicts with main · Resolve conflicts if eligible, otherwise View PR | User |
| Implementation PR merged, tasks complete, archive eligible | Implementation PR merged · Archive change under Archived | User |
| Archive recorded locally, archive PR open | Archived locally · View archive PR | Depends on review or checks |
| Archive PR merged | Archived · PR merged | Finished |

Prefer positive evidence. Match PRs to the owning phase and change incarnation. An old retry, an idle terminal or a missing GitHub connection cannot prove a blocker. On an action failure retain the user's place, explain the consequence, and refresh current evidence before proposing another write. A refresh can reconcile a completed operation. It cannot authorize a push, merge, task confirmation or cleanup. Preserve manual operation for projects without GitHub or an agent.

## Following one change across visits
Consider a change to disable orders. On first opening it, choose **Draft plan** under Drafts. Select a segment to inspect Proposal, Specs, Design or Tasks by full name. When the required documents exist, Ready turns green as implementation starts. An optional proposal PR skipped at this point is history, with no reminder to ship it.

On returning tomorrow, the implementation session has ended with four of six tasks complete. Keep the task count visible under Implementing and offer the eligible continuation there. If the agent instead requested a decision, open its question directly. Keep the phase still when work is idle. After the final task, surface any required validation before offering the eligible shipping action. A successful request should immediately show progress and then the implementation PR.

If that PR conflicts, offer the existing conflict resolution flow beside that PR. A verified merge retires the blocker. Offer Archive under Archived when eligible. Once archived locally, show the archive PR there until its outcome is known. For a local-only change, local archive is the endpoint. A missing GitHub response alone cannot establish that the project is local-only.

## Walkthrough for acceptance
Give a newcomer a fictional change and ask them to start its plan, return after an interrupted implementation, recover from a PR conflict, and finish archiving it. At each stop ask them to identify who acts next and what clicking the primary control will do. Record wrong-phase clicks, unnecessary retries and instances where they need Help. Exercise keyboard and touch as well as pointer navigation. This is a proposed evaluation, not an observed usability result.

## Evidence used by the timeline
The snapshot supplies schema documents, local archive status and task counts. SessionControls checks starter eligibility and handles agent handoff. A running session with an explicit waiting report owns the question shortcut. The implementation and archive sessions supply their own worktrees for shipping. Phase delivery records and branch-matched PRs identify the remote work. A failed PR refresh retains known links while suspending actions based on stale checks.
