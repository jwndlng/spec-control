# Design

## Context

A card is the leading copy of a change across the main checkout and the scanned linked worktrees (`mergeChanges.ts`).
Branches without a worktree are never read, so an archive committed on a branch whose worktree is gone is invisible.
Session worktrees are listed separately (`listWorktrees` in `sessions/workStatus.ts`, served with `/api/sessions`), with
a work status that says `uncommitted` as soon as anything is dirty, which is why end-session and Clean up refuse a
worktree whose only edit is inside a change the default branch has already archived. The one forced removal the
dashboard has is the branch-and-worktree deletion dialog (`deleteBranch` in `cleanup.ts`), with a backup first.

## Goals / Non-Goals

**Goals:** recognise the two cases from git alone, mark them, and route each to an action that already exists or is
prompt-only.

**Non-Goals:** no new git write or subcommand, no automatic removal or session start, no change to columns (a stranded
archive is not treated as archived — it has not reached the default branch, which is the point), no `gh` query (the
detection must work without GitHub and on every scan).

## Decisions

### D1 Stranded archives are found by the scan, from branch names

`src/server/staleChanges.ts` exports `findStrandedArchives(repoPath, prefix, changes, archivedOnMain)`, reached through an
optional `RepoSource.strandedArchives` so fake sources in tests need nothing. It runs once per scan of a git repository
with a commit, after the merge, for the active changes only, and only when there are any:

1. one `git for-each-ref --format=%(refname) refs/heads refs/remotes` per repository;
2. per change, candidate refs whose short name contains the change's name (as `findBranchMatch` does for the main
   checkout), excluding the default branch and `*/HEAD`, at most four, local first;
3. `git ls-tree --name-only <ref> -- <prefix>openspec/changes/archive/` and a match on `^\d{4}-\d{2}-\d{2}-<name>$`;
4. the default branch (`origin/HEAD`, else `HEAD`) is asked the same `ls-tree` once per scan — an archive it already
   has is the Pull button's business, not a carry-over;
5. `git log -1 --format=%H <ref> -- <archive dir>` for the commit.

Names come from the scan (validated change names) and refs from `for-each-ref`; every ref is passed after the
`--end-of-options`-free position git expects for a revision, and refs starting with `-` are dropped. Alternatives:
reading every branch's tree (too costly on repositories with many branches); asking `gh` for merged pull requests (needs
the network and a signed-in `gh`, and the archive commit of case 2 is in no pull request at all).

### D2 Settled worktrees are decided where work status is read

`listWorktrees` already reads each session worktree; for one whose session is not running it calls
`settledArchive(repoPath, worktreePath, change)` (same module as D1): `ls-tree` of the base for the archive,
`contentIsInBase` (or nothing ahead) for the commits, and `status --porcelain -z --untracked-files=all` for the dirty
paths, every one of which must start with `<prefix>openspec/changes/<change>/` or
`<prefix>openspec/changes/archive/<date>-<change>/`. The prefix is the project's subdirectory in its repository
(`rev-parse --show-prefix` of the repository path), because porcelain paths are relative to the repository's top level.
The result is `settled?: { archive, uncommitted }` on `SessionWorktree`. It stays in the worktree list's cache, so it
costs nothing extra on polls.

### D3 Removing a settled worktree reuses the deletion dialog

The detail opens `DeleteBranchDialog` for the worktree's path. That dialog already refuses for a running session, backs
up uncommitted files, forces the removal and deletes the branch only if it still points at the commit shown — exactly
the guarantees "everything that would be lost is already merged or archived" needs, plus a backup for the case the user
disagrees. A new non-forcing "remove if settled" route was considered: it could not remove a dirty worktree without a
new forced write in invariant 1, which is what this change avoids. The dialog gains an optional `note` the detail fills
with "Everything it holds is already archived on <base>", so the acknowledgement it asks for reads in context. The
session record stays, ended, as after any end-session.

### D4 Carry-over is an archive session with a fixed prompt

`POST /api/sessions` accepts `carryOver: true` with `action: "archive"`. The manager then requires `snapshot.strandedArchive`
from its own snapshot (409 otherwise), skips the stage check (`availableActions` offers Archive only in Done), keeps
every other check of `open`, and composes `carryOverPrompt(agent, change, strandedArchive, defaultBranch)` from a fixed template in
`agentDefaults.ts` (`CARRY_OVER_ARCHIVE_PROMPT`), followed by the archive auto-merge instruction when `archiveAutoMerge`
says so. The commit (`/^[0-9a-f]{40}$/`) and the branch (`isBranchName`, remote-tracking names included) are re-validated
before they reach the prompt. If a session for the change already runs, `open` returns it as it does today and types
nothing. The prompt is agent-neutral text — no slash command — so every agent profile can run it.

### D5 Marks in the UI come from one pure module

`src/ui/staleState.ts` exports `staleReason(card, worktrees)` → `{ kind: "stranded" | "settled", title, worktree? }` or
undefined, used by the card badge and the detail notice, so both say the same and the logic is tested without a DOM.

## Risks / Trade-offs

- [A branch whose name merely contains another change's name, e.g. `feat/auth-v2` for `auth`] → the archive directory
  must match the exact name, so another change's archive never matches.
- [Many matching branches] → capped at four per change; the newest archive wins.
- [The agent cherry-picks onto a stale base] → the archive session's worktree starts from `origin/HEAD` like any other;
  a conflict surfaces through the existing conflict signal and Resolve conflicts.
- [Settled check costs git calls per worktree] → only for worktrees without a running session, inside the existing
  cached listing; `ls-tree` of the base once per repository per listing.
