# Tasks

## 1. Implementation and verification

- [x] 1.1 Consume the predecessor Ship result/PR URL contract and define an operation identity/status endpoint or session payload extension; verify project/session authorization, same-origin mutation protection, and no client-authoritative paths/commands.

- [ ] 1.2 Show immediate Shipping feedback and serialize duplicate requests across controls; verified immediate feedback, duplicate prevention, and no agent launch. Blocked: the predecessor contract explicitly removes task-specific Ship confirmation, so task-preflight cancellation cannot apply.

- [x] 1.3 Render server-observed stages, persistent success with created/reused PR link, and read-only accessible status announcements; verified persisted session state across manager restart, accessible status UI, and a concise Ship explanation with grouped secondary console actions. Status is static, so reduced-motion behavior has no animation to verify.

- [x] 1.4 Report failed step and verified partial outcomes, preserve the result, and offer safe Retry; verified commit failure, push rejection, PR-create failure after push, timed-out PR-create outcome recovery, refresh failure after PR creation, and PR reuse without duplicate remote writes.

- [~] 1.5 Demo and Help updated; focused server/UI retry fixtures, `bun run check`, and `bun run build:demo` pass. User: open `dist/demo/index.html` and confirm the Ship explanation and collapsed Pull request, Change, and Session action groups are easy to follow. Interactive review is unavailable here because the CUA browser access host is unavailable.

- [x] 1.6 Add an independent What's new JSON entry for the visible UX improvement under src/ui/changelog/entries/ and verify it with the changelog validator.

## Workflow follow-up

- Open this change's own PR after required checks pass; archive after implementation merges.
