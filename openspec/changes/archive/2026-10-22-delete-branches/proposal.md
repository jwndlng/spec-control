# Proposal

## Why

The project details overlay lists every checkout of a repository, but it offers no action on them: a worktree whose
branch holds uncommitted or unmerged work — an abandoned experiment, a session the user gave up on — can only be
removed outside the dashboard, because **Clean up** offers only what provably loses nothing. And nothing in that list
tells the user which branches no longer belong to any active change, which are exactly the ones worth looking at.

## What Changes

- The overlay's **Checkouts** section offers **Delete…** on every linked worktree (not the main checkout, not a stale
  record, not the default branch). It opens a confirmation dialog that reads, with read-only git, what would be lost:
  the uncommitted files (count and names), commits not on any remote or not in the default branch, whether the
  dashboard created the worktree, and why deleting is refused when it is (a running agent session, a lock the user
  set, the default branch).
- Confirming deletes even when the worktree has uncommitted files or the branch is not merged: the dashboard first
  copies every uncommitted, non-ignored file under `~/.spec-control/branch-backups/`, then removes the worktree with
  `git worktree remove --force` (unlocking only a worktree it created), then deletes the branch with `git branch -D`
  if it still points at the commit the dialog showed. When the user has work at stake the dialog asks for an explicit
  acknowledgement before its confirm control is enabled. The result names the backup folder and the
  `git branch <name> <commit>` command that restores the branch.
- The server re-checks everything on confirmation: the worktree is still the repository's, on the same branch and
  commit, its uncommitted files are those the dialog showed, no session runs in it and no cleanup runs in the
  repository. Anything else is refused and nothing is deleted.
- Each linked worktree in the Checkouts section whose branch belongs to no active change of the project is
  highlighted with a `no active change` marker (text plus tooltip, never colour alone); the summary line says how
  many there are.
- **BREAKING** (policy, not API): the overlay was specified to offer no action on an individual checkout, and the
  dashboard never forced a worktree removal or deleted an unmerged branch. Both change, for this one confirmed action.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `repository-cleanup`: a new requirement for deleting one branch and its worktree on confirmation even with
  uncommitted or unmerged work, with backup, re-checks and restore information; the "never touches more" requirement
  makes room for that forced removal.
- `project-overview`: the board header's Checkouts section highlights branches with no active change and offers
  **Delete…** on linked worktrees, instead of offering no action on an individual checkout.
- `dashboard-api`: the "never writes" requirement's cleanup entry adds the forced removal of a confirmed worktree,
  the deletion of its branch whatever its merge state, and the backup copy under `~/.spec-control/`.

## Impact

- `src/server/cleanup.ts` — `previewBranchDelete` / `deleteBranch` (stays the only place that deletes a branch; shares
  the per-repository cleanup lock, so sessions do not start meanwhile).
- `src/server/paths.ts` — the backup folder.
- `src/server/api.ts` — `GET`/`POST /api/repos/<id>/branches/delete` behind the existing same-origin guard.
- `src/shared/types.ts` — `BranchDeletePreview`, `BranchDeleteRequest`, `BranchDeleteResult`.
- `src/ui/checkout.tsx`, `src/ui/projectDetails.tsx`, `src/ui/deleteBranch.tsx` (new), `src/ui/deleteBranchState.ts`
  (new), `src/ui/checkoutMarkers.ts`, `src/ui/api.ts`, `src/ui/styles.css`, `src/ui/changelog.ts`, `src/ui/kanban.tsx`
  (passes the rescan callback to the overlay), `src/ui/modal.tsx` if the nested dialog needs it.
- `src/ui/demo/demoApi.ts`, `src/ui/demo/demoCleanup.ts` — the demo simulates the deletion.
- `CLAUDE.md` invariant 1 — the cleanup entry.
- Tests: `test/cleanup.test.ts`, `test/cleanupApi.test.ts`, new `test/deleteBranchUi.test.ts`.
