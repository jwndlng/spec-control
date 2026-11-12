# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Add home-scoped dismissal identities with creation metadata and stable fallback incarnation tokens; verify same-name repositories, worktree changes, restart, and verified name reuse without modifying tracked files.

- [x] 1.2 Replace dismissal preview/confirm with reversible hiding and add dismissed-list/restore routes; verify worktree-only and running-agent cases, identity races, cross-site rejection, idempotent restore, and safe rejection of legacy deletion payloads.

- [x] 1.3 Filter dismissed identities in board presentation and add Show dismissed/Restore while retaining dependency and Open work evidence; verify scanning or restarting does not resurrect cards or hide running sessions from management.

- [x] 1.4 Move the former destructive operation to Delete change files and its distinct API, preserving file previews, fingerprint/path/symlink checks, running-session refusal, scoped staging, and main-only limits; verify no destructive dismissal call survives in UI/demo clients.

- [x] 1.5 Document Dismiss, Restore, Delete record, Delete change files, and cleanup as distinct actions in Help; verify each control and confirmation describes its actual scope.

- [x] 1.6 Focused tests, bun run check, and the demo build passed. Browser layout and keyboard review waived per user instruction; it was not performed.

- [x] 1.7 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
