# Proposal: Automatically persist completed lifecycle phases

## Why

Completed drafting, implementation, and archival can stall before reaching GitHub because shipping depends on agent exit and docs merging has narrower or permanently suppressed eligibility.

## What Changes

- Drafts → Ready automatically commits, pushes, opens/reuses, and merges its proposal PR independent of optional docs auto-merge.
- Implementing → Done and Done → Archived automatically publish phase PRs. Code implementation merging stays under human control.
- Persist delivery/retry state, reconcile uncertain remote outcomes, and protect newer work.
- Use shared documentation classification, exact-head GitHub evidence, and recoverable merge attempts, including projects with no required checks.

## Capabilities

### New Capabilities

- `lifecycle-delivery`: Persistent checkpoint delivery and recovery.

### Modified Capabilities

- `agent-sessions`: Proposal persistence, scoped shipping, documentation merge policy, and completion gates.
- `dashboard-api`: Delivery status and retry operations.

## Impact

- `src/server/sessions/ (delivery and merge logic)`
- `src/server/scanner.ts (managed completion observations)`
- `src/server/api.ts (delivery routes only)`
- `src/server/pullRequests.ts`
- `src/server/config.ts`
- `new lifecycle delivery modules under src/server/`
- `src/shared/types.ts (delivery and merge contracts)`
- `src/ui/api.ts`
- `src/ui/sessionState.ts (delivery state only)`
- `src/ui/agentSettings.tsx (merge policy copy)`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/ (lifecycle, session, PR, API, persistence fixtures)`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: `repair-permission-spec-structure`, `resolve-agent-workflow-instructions` Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
