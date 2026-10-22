# Design

## Context

`src/server/cleanup.ts` is the only place that deletes a branch, and it only removes what provably loses nothing:
`removeWorktree` (`sessions/worktree.ts`) runs `checkWorktreeRemovable` and a non-forcing `git worktree remove`, and
`judgeBranch` requires the branch's work to be in the default branch. The project details overlay
(`src/ui/projectDetails.tsx`) renders the snapshot's checkouts through `CheckoutList` (`src/ui/checkout.tsx`) and
offers no action. Changes know where they came from: every `ChangeSnapshot` carries `checkout` / `otherCheckouts`
(which checkout's copy it was read from) and `branchMatch`; session branches are named by `sessionBranch`
(`src/shared/sessionBranch.ts`).

## Goals / Non-Goals

**Goals:**
- One destructive action, scoped to one worktree, that the server re-proves before running, with a local copy of the
  uncommitted work and a restore command for the branch.
- The highlight is derived purely from the snapshot on the client: no new scan field, no git.

**Non-Goals:**
- Deleting local branches that have no worktree (they are not in the Checkouts section; Clean up handles merged ones).
- Bulk deletion, deleting remote branches, or backing up ignored files.
- Changing what the Clean up dialog offers.

## Decisions

**D1 — Two endpoints, preview then confirm, on `/api/repos/<id>/branches/delete`.** `GET ?path=<worktree>` returns a
`BranchDeletePreview`; `POST { path, branch, commit, statusDigest }` deletes. Same shape as cleanup and dismissal,
so the same `cleanupTarget` guard and the existing `crossSiteRefusal` apply. The preview is read-only git:
`worktree list --porcelain`, `status --porcelain=v1 -z --untracked-files=all` (with `GIT_OPTIONAL_LOCKS=0`),
`rev-parse HEAD`, `rev-list --count <commit> --not --remotes` and `rev-list --count <base>..<commit>` — all already on
the read-only list.

**D2 — "What the dialog showed" is a digest.** The preview returns the full commit and a SHA-256 of the raw porcelain
status output. The POST is refused unless the worktree's current HEAD, branch ref and status digest all match. This
is stricter than the cleanup's per-item re-check and avoids sending the file list back. Alternative — re-checking only
the commit — would let a file written after the dialog was opened be deleted silently (its backup would exist, but the
user never saw it listed).

**D3 — Back up before forcing, in `~/.spec-control/branch-backups/<repoId>/<UTC stamp>-<branch slug>/`.** Files go
under `files/` with their worktree-relative paths, plus `backup.json` (repo id, path, branch, commit, files, time).
Only entries from the porcelain status that exist and are regular files or symbolic links are copied (a symlink is
recreated, never followed); deletions need no copy because the commit has them. Each path is checked to stay inside
the worktree. A limit of 10 000 files / 512 MiB keeps an untracked build tree from filling the disk: over it, the
deletion is refused before anything is removed, and the preview already says so. If any copy fails, nothing is
removed. Alternative — `git stash` — would write refs into the repository and is forbidden by invariant 1;
`git diff --binary > patch` misses untracked files and needs the same copy anyway.

**D4 — `git worktree remove --force` once, never twice.** A single `--force` discards modified and untracked files but
still refuses a locked worktree; the dashboard unlocks only a worktree under its own `worktrees/<repoId>/` (as
`removeWorktree` does), and a user's lock is a refusal in the preview. Then `git branch -D -- <name>` after
re-reading `refs/heads/<name>` equals the commit. If the branch delete fails after the worktree is gone, the result
says so with git's message; the backup and restore command are still shown.

**D5 — It lives in `cleanup.ts` and takes the cleanup lock.** `previewBranchDelete` and `deleteBranch` reuse the
module's `git` helper, `context` (base, default branch, worktree list, managed root), `isBranchName` and the `running`
set, so `isCleaningUp` keeps sessions from starting in the repository while a deletion runs, and a cleanup and a
deletion cannot overlap (`CleanupBusyError` → 409). The running-session set comes from
`state.sessions?.runningWorktreePaths()`, as for cleanup. After success the route calls
`state.sessions?.forgetWorktrees()` and `state.scanner.trigger()`.

**D6 — The highlight is a pure function of the snapshot (`src/ui/deleteBranchState.ts`).** A branch has an active
change when some non-archived change has it as `branchMatch`, as the branch of `checkout` or of any of
`otherCheckouts`, or when it equals `sessionBranch(action, change)` for an active change. The default branch, the
main checkout, detached and stale entries are never marked. The marker is rendered by `CheckoutList` only (not on the
header chip), as a `marker no-change` text `no active change` with a tooltip — text, not colour alone.

**D7 — The dialog is nested inside the details overlay.** `ProjectDetailsDialog` holds the worktree being deleted;
while it is set, the overlay's `canClose` returns false so Escape and the backdrop close only the inner dialog, which
handles its own Escape. The acknowledgement checkbox appears only when `atStake` (uncommitted files, or commits not in
the base, or base unknown); the confirm label is `Delete <branch> and its worktree` or `Remove this worktree` when
detached. The demo simulates both endpoints over its own sample checkouts.

## Risks / Trade-offs

- [Ignored files are lost — `.env`, local databases] → The dialog says so explicitly; backing them up would copy
  `node_modules` and build trees.
- [A loose commit is garbage-collected eventually, so the restore command stops working] → Same as cleanup today; the
  result says to restore soon. The backup folder is never pruned by the dashboard.
- [The status digest makes a busy worktree (an editor writing files) hard to delete] → The refusal says to look again;
  reopening the dialog reads a fresh preview.
- [A policy change against invariant 1's "non-forcing" wording] → The spec and CLAUDE.md are amended in this change,
  scoped to one confirmed worktree.
