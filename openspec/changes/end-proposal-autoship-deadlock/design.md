# Design

## Context

See `proposal.md` for motivation. Proposal auto-ship currently runs from the successful process-exit path. Explicit session ending and application shutdown also end the agent, but they must remain distinguishable so shutdown does not trigger new repository writes. The existing deterministic Ship flow and `shouldAutoShipOnExit` eligibility checks define the behavior to reuse.

## Goals / Non-Goals

**Goals:**
- Run proposal eligibility and deterministic Ship after an explicit user end of a running proposal session.
- Keep the eligibility check immediately before shipping and keep current docs-only, required-artifact, and opt-in checks.
- Make the end result observable to the caller and in session state.

**Non-Goals:**
- Change proposal artifact readiness rules, PR merge policy, or proposal worktree cleanup.
- Auto-ship proposals when the application shuts down or when an agent exits unsuccessfully.
- Add a second Ship implementation or change ordinary Ship behavior.

## Decisions

- Carry the termination reason into the shared session end path. Only an explicit user request to end the session is eligible for this additional auto-ship attempt; process exit code `0` continues to use the existing path, and application shutdown remains ineligible. This avoids treating every nonzero exit as user intent.
- Reuse the existing proposal checks and deterministic Ship operation after the process has ended. A missing required artifact, non-OpenSpec file, disabled docs auto-merge, or unavailable repository state prevents shipping under the same safeguards already used for exit-based auto-ship.
- Return shipping outcome through the existing end-session response/session state instead of introducing a separate endpoint. If shipping fails, preserve the ended session and surface the failure without discarding its worktree or branch.

## Risks / Trade-offs

- [Ending may expose a latent Ship failure after the agent has stopped] → Keep the worktree and branch on any failure, retain the error in the end result, and allow the existing manual Ship path to recover.
- [The end action may race with natural process exit] → Serialize the termination and auto-ship decision per session and ensure the proposal Ship flow can run at most once for the session.

## Migration Plan

No data migration is needed. Existing session records remain valid. Rollback consists of removing the explicit-user-end eligibility path; already shipped PRs and session records remain compatible.
