# Design

## Context

`DetailHeader` passes a single `DetailPr` to `ChangeFacts`. In the same view, `LifecycleTimeline` already resolves proposal, implementation and archive deliveries separately. The header’s worktree path also has two possible sources, the checkout supplying the snapshot and the most recently active session.

## Goals / Non-Goals

Make the header readable across session switches and successive deliveries. Scope the work to presentation using the current snapshot, cached PRs and selected session. Board actions, polling, scanner metadata and shipping eligibility retain their existing contracts.

## Decisions

- Remove the header’s PR input and its availability line at the rendering boundary. Collapsing the line would still associate one PR with the whole change. Keep the parent’s cached PR subscription for checkpoint links and actions.
- Bind the header path and its copy control to a non-main snapshot checkout. Choosing the most recently active session can show a path unrelated to the displayed artifacts. Console already identifies the selected worktree and its status.
- Render the existing optional implementation model label with Implementing, including when that phase has no action button. Hiding the label altogether would lose the detail view’s recorded-model behavior.
- Keep the column, age, completion and checkout badges, source issue, dependency links, warnings and actions in their existing positions. Each describes the change or the source of its artifacts across sessions.

## Risks / Trade-offs

- PR numbers and source issue numbers look similar. Test a change with both and assert their destinations within the header and timeline separately.
- Removing a shared PR helper could affect cards or checkpoint actions. Check its callers and retain shared matching, readiness and presentation used elsewhere.
- A main-checkout change can have several session worktrees. Verify selecting another session changes the Console path while the header continues to describe the snapshot.
