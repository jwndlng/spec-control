# Tasks

## 1. Server

- [x] 1.1 Add `BranchDeletePreview`, `BranchDeleteRequest` and `BranchDeleteResult` to `src/shared/types.ts`, and a
      `branchBackupsDir()` to `src/server/paths.ts` under the dashboard home. Verify with `bun run typecheck`.
- [x] 1.2 Implement `previewBranchDelete(repo, path, sessions)` in `src/server/cleanup.ts` (design D1, D2, D5): the
      worktree must be linked, not stale or bare; report branch, full commit, uncommitted paths (≤ 200 listed, total
      count), status digest, commits on no remote, commits not in the base, managed, locked, backup-limit overflow and
      a refusal reason (session running, user lock, default branch, cleanup running). Verify with cases in
      `test/deleteBranch.test.ts` covering a dirty worktree, an unmerged clean branch, a detached worktree, a user lock, a
      running session and that the preview leaves `.git/index` and the worktree byte-for-byte unchanged.
- [x] 1.3 Implement `deleteBranch(repo, request, sessions)` in `src/server/cleanup.ts` (D2–D5): take the cleanup lock,
      re-check path/branch/commit/digest/session/lock, back up uncommitted non-ignored files under
      `~/.spec-control/branch-backups/` with `backup.json`, unlock only a managed worktree, `git worktree remove
      --force`, then `git branch -D` if the ref still points at the commit. Verify with tests: confirmed deletion of a
      dirty worktree (files backed up with their content, directory and branch gone, restore command restores the
      commit), a file added after the preview is refused with nothing removed, a moved branch is refused, a running
      session is refused, a detached worktree removes no branch, and the remote, `refs/remotes/` and the main
      checkout's branch, status and index are unchanged.
- [x] 1.4 Add `GET` and `POST /api/repos/<id>/branches/delete` to `src/server/api.ts` through `cleanupTarget`, shape
      validation of the body (path string, branch valid or null, 40/64-hex commit, 64-hex digest), `CleanupBusyError`
      → 409, rescan and `forgetWorktrees()` after a POST. Verify with cases in `test/deleteBranchApi.test.ts`: unknown repo
      404, malformed body 400, cross-site POST refused, a successful round trip.

## 2. UI

- [x] 2.1 Add `src/ui/deleteBranchState.ts`: `branchesWithActiveChange(repo)`, `noActiveChange(repo, worktree)`,
      `canDelete(repo, worktree)`, `atStake(preview)`, `confirmLabel(preview)` and the result texts (D6, D7). Verify with
      `test/deleteBranchUi.test.ts` covering branchMatch, checkout and otherCheckouts branches, session branch names,
      archived changes, default branch, main/detached/stale entries.
- [x] 2.2 Add `branches.deleteBranchPreview` / `deleteBranch` to `src/ui/api.ts` and the demo simulation in
      `src/ui/demo/demoCleanup.ts` / `demoApi.ts` (deleting a sample worktree removes it from the demo snapshot until
      reload). Verify with a case in `test/demoApi.test.ts`.
- [x] 2.3 Add `src/ui/deleteBranch.tsx` (the dialog: loading, refusal, what is lost with the file list, the ignored-files
      note, acknowledgement checkbox when at stake, confirm, result with backup folder and copyable restore command),
      and in `CheckoutList` the `no active change` marker plus a **Delete…** control per deletable row; the Checkouts
      summary says how many branches have no active change. `ProjectDetailsDialog` hosts the nested dialog and keeps
      the overlay open while it is (D7); `kanban.tsx` passes the rescan callback. Styles in `src/ui/styles.css`. Verify
      with `bun run check` and a rendering test of `CheckoutList` in `test/deleteBranchUi.test.ts`.
- [x] 2.4 Add a `changelog.ts` entry and a line in the help page (`helpContent.tsx`) for the new action and highlight.
      Verify the changelog and help tests pass.

## 3. Documentation and invariants

- [x] 3.1 Update CLAUDE.md invariant 1's repository-cleanup entry (forced removal of one confirmed worktree, branch
      deletion whatever its merge state, backup under `~/.spec-control/branch-backups/`). Verify by reading the entry
      against `specs/dashboard-api/spec.md` of this change.

## 4. Verification

- [x] 4.1 Run `bun run check` and confirm it passes.
- [x] 4.2 Build the binary (`bun run build`) and run it against a scratch repository with a dirty worktree: the
      preview endpoint lists the uncommitted file, and confirming removes the worktree and branch and leaves a backup.
      Verify by inspecting the scratch repository and `~/.spec-control/branch-backups/`.
- [~] 4.3 The user confirms in their own dashboard that the highlight and the dialog read well and behave as expected.
