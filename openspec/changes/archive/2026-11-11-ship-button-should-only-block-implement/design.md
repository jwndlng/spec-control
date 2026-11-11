# Design

## Context

The task preflight added in `complete-tasks-before-shipping` treats Ship as a gate before any commit, push or pull
request creation. That is too strict when a task describes a check that needs the pull request or when a human needs to
review an unresolved item. The implementation action should remain responsible for making progress on automatable
work; Ship should make the current artifact set available for review. Archive likewise should not be held by task
state once its required artifacts are ready.

Ship is deterministic and should remain so. The useful feedback is the pull request result from the operation itself:
its URL, status, and any unresolved-task context. This lets the UI present a direct link and a deliberate next step
without guessing from a generic success message.

## Decisions

### D1. Separate implementation readiness from review readiness

Unfinished or unknown task state continues to inform and gate Implement, including automatic implementation rules.
For explicit Ship and Archive, the required artifact/schema readiness remains authoritative; unresolved tasks are
reported but do not stop the action. Ship and Archive do not edit task files or represent unresolved work as complete.

This permits PR-based checks and human review to happen. It also keeps task ownership with the agent and preserves
the existing distinction between implementation and review.

### D2. Preserve task follow-up after shipping

When Ship proceeds with unresolved tasks, its result includes the bounded task summary already used by preflight (or
an explicit unknown state). The UI presents this as follow-up context. A successful push or PR creation is not
evidence that tasks passed, and automatic merge or archive eligibility continues to use its own current task rules.

### D3. Make the Ship result actionable

The Ship API returns the pull request URL when it finds or creates a PR. The UI displays a direct link and a clear
success state. It also offers the existing agent follow-up path for checking PR feedback or resolving conflicts,
subject to the normal session and prompt availability rules. Ship itself does not start an agent or make a merge
decision.

An existing PR is reported with its URL and is not recreated. A failure to obtain a valid PR URL is reported as a
partial or failed Ship outcome rather than a success without a review destination.

## Risks

- Users may mistake a successful Ship for completed work. Showing unresolved tasks beside the PR link and keeping
  automatic merge gates intact reduces this risk.
- A PR may be created but its URL may be unavailable due to a command or response failure. The result needs to
  distinguish this from a complete success and retain enough context for recovery.

## Open Questions

None.

