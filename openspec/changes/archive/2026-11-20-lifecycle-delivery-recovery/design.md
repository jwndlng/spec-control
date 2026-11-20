# Design

## Context

See proposal.md - Why. The lifecycle monitor compares completion revisions to avoid retrying an already handled completion. Agent reports use revision 1; explicit confirmations currently do too, so a changed worktree can be mistaken for an already handled delivery revision.

## Goals / Non-Goals

**Goals:**
- Give each explicit confirmation of the same managed action a monotonic revision.
- Let the user re-confirm only when a delivery recovery specifically requests it.
- Preserve independent artifact, task, and stable worktree verification.

**Non-Goals:**
- Automatically accepting unresolved archive tasks.
- Bypassing delivery blockers or changing Ship's safety checks.

## Decisions

- Persist the last explicit confirmation revision on the session, keyed by the existing managed action ID. A new managed action or user input that invalidates completion clears it.
- When deriving managed completion from an explicit confirmation, return the stored revision. Each valid reconfirmation increments it; the monitor can then create a delivery record for a changed evidence snapshot.
- The detail view offers reconfirmation only when the latest delivery recovery includes `confirm-complete`, so users do not repeatedly authorize unchanged work. The existing confirmation handler and verification pipeline remain in use.
- Keep the newest delivery record per phase at its pull-request checkpoint. Do not repeat its status in a separate notice. A retry refusal that says the branch is already merged becomes terminal `merged` state, including migration of records persisted by older versions; merged checkpoints cannot show Retry.
- Label a completion action `Confirm & Ship`, explain that verification runs first, and reflect accepted confirmation immediately while the server verifies artifacts, tasks, and stable worktree evidence.
- Resolve Archive Ship from the newest archive session for the change, not the currently selected Console session.

## Risks / Trade-offs

- A repeated click with unchanged evidence can advance the completion revision, but the monitor's same-snapshot reconciliation prevents duplicate delivery. The UI only offers reconfirmation for a blocker that requires updated completion evidence.
- Persisted sessions without the new field continue at revision 1, preserving compatibility.
- Historical records can contain repeated failures for one phase; showing only the latest actionable record avoids presenting stale recovery controls.
