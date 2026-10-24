# Design

## Context

`stale-changes` today knows two cases:
- a **stranded archive**: found by the scan from branch names that *contain* the change's name;
- a **settled worktree**: decided in `listWorktrees` for session worktrees only, and only when every uncommitted file
  lies inside the change's own directories.

A settled worktree leads to the branch-and-worktree deletion dialog (`deleteBranch` in `cleanup.ts`), one worktree at a
time. That dialog already re-checks against what was shown, backs up, forces the removal, and deletes the branch only at
the commit shown. Ending a session offers only the non-forcing removal (`checkWorktreeRemovable`), which refuses any
worktree with uncommitted files. Work status already knows "merged", squash merges included (`contentIsInBase`).

## Where leftovers come from

Read from the code paths that create files around a change's life:

1. **The created change in the main checkout.** `createChange.ts` writes `openspec/changes/<name>/` in the main checkout
   and stages it, and nothing ever commits it there. `copyChangeIfMissing` (`sessions/worktree.ts`) then copies it
   untracked into each session worktree. The pull action's "change leftover" rule only handles these files when the
   incoming commit *contains* them. After an archive, the incoming commit contains the archive instead. The fast-forward
   is not blocked, and the staged directory stays in the main checkout, making an archived change look active again.
   **Caught here** as a main-checkout leftover.
2. **The archive's move, half committed.** `openspec archive` moves `openspec/changes/<name>/` to
   `archive/<date>-<name>/`. An agent that stages only the new directory leaves the old paths as uncommitted
   deletions, or, for a change that was only ever a copy, as untracked files. **Caught here**, without acknowledgement,
   because the paths lie inside the change's directories. **Prevented** by one clause in the preconfigured Archive
   prompts.
3. **The copy never committed in the implementation worktree.** An agent that ships only `src/` leaves the copied
   change directory untracked. **Caught here**. Not prevented by a prompt change: Ship already asks to commit, and its
   prompt is left alone.
4. **Edits after the merge.** `[~]` ticks confirmed after Ship, scratch files, a stray source edit. **Caught here**.
   Files outside the change's directories need the acknowledgement, and the session-end offer is not pre-selected for
   them.
5. **Sessions that never ended cleanly.** A dashboard restart marks a session `exited` without removing its worktree.
   The auto-merge end only removes a clean worktree. **Caught here**.
6. **Branches whose worktree is gone.** Removal from the session views never deletes the branch. **Caught here**.
7. **Leftovers blocking a pull** (local files the incoming commit also adds) are the pull action's own Resolve and pull,
   unchanged.

## Goals / Non-Goals

**Goals:**
- One definition: stale = archived on the default branch + merged.
- Clean up when the user ends the session.
- The board catches the rest.
- Exact branch names everywhere stale detection looks.

**Non-Goals:**
- No new git subcommand and no network.
- No automatic removal without a confirmation.
- No deletion of remote branches or remote-tracking refs.
- No change to columns or counts.
- No stored "merged" flag.
- No deletion of session records.
- No prompt change beyond the Archive clause.

## Decisions

### D1 Merged is derived, never stored

It cannot live in `.openspec.yaml`:
- a pull request cannot record its own merge;
- writing it later needs a commit on the default branch, which invariant 1 does not allow;
- git already proves it.

It is computed per leftover with work status's rule: `rev-list --count <base>..<tip>` is 0, or `contentIsInBase`
holds. It is as fresh as the last fetch, and the automatic fetch keeps it close.

### D2 One exact branch list

`changeBranches(change, sessions)` returns, de-duplicated:
- the recorded `spec-control.branch` and `spec-control.archive-branch`;
- `sessionBranch("implement" | "archive", name)`;
- the `branch` of every session record for the change in that repository.

The recorded keys come from the neutral snapshot fields `record-change-pull-request` adds. For an archived change whose
main checkout has not pulled yet, they are read with `git cat-file -p <base>:<archive>/.openspec.yaml`, a read-only
subcommand already allowed. Both the leftover search and `findStrandedArchives` use this list. A remote-tracking ref
matches by its name without the remote prefix. The containment rule of the stranded-archive search goes: an exact
archive directory name protected it from showing a wrong archive, but the user's complaint is exactly that "contains the
name" picks the wrong branch, and every branch the dashboard or a recorded change uses is now on the list.

### D3 Leftovers are found by the scan

For a git repository with a commit, after the merge step, the scan:
1. lists the default branch's archive once with `ls-tree` (already done for stranded detection);
2. for each change named there and not created after that date, intersects `changeBranches` with the local branches
   (`for-each-ref refs/heads`, once per scan) and the linked worktrees (`worktree list`, already read);
3. checks the main checkout for `openspec/changes/<name>/` and, when present, whether any of its files is in `HEAD`
   (`ls-tree HEAD`).

Only hits get a merged check and a `status --porcelain`. The result is `stale?: { archive, leftovers, kept }` on the
snapshot. Leftover kinds are `worktree`, `branch` and `main`, each with commit or files and uncommitted paths (capped at
200). Most archived changes have no surviving branch, so the cost stays at a set lookup per change.

### D4 Cleanup: one confirmation, item-by-item re-checks

`GET /api/repos/<id>/changes/<name>/stale-cleanup` recomputes without a cache. `?ending=<sessionId>` evaluates that
session's worktree as if ended, for the end-session dialog. `POST` carries what the dialog showed. The server recomputes,
requires the archive still on the base, holds the repository's cleanup lock, then handles each item:
- **worktree:** `deleteBranch`'s re-checks and steps (backup, `worktree remove --force`, `branch -D` at the commit
  shown), plus "still merged".
- **branch:** still at the commit shown and still merged, then the cleanup's `branch -D`.
- **main:** the files and their hashes are as shown and none is in `HEAD`. Files differing from the archive's copy
  (`hash-object` without `-w` against `ls-tree`) are copied to `~/.spec-control/branch-backups/`, then the dismissal's
  deletion and `git add --all -- openspec/changes/<name>/`.

A failing item is skipped and reported, and the rest proceed. All-or-nothing was rejected: one agent touching one
worktree would block the rest, and every guarantee is per item anyway.

### D5 Session end runs the cleanup

`endSessionDialog.tsx` asks for the `?ending=` preview when the session's change has an archive on the base (known from
the snapshot). If the session's worktree is a stale leftover, the dialog swaps the plain removal checkbox for **Clean up
leftovers**, listing every stale leftover of the change. It is pre-selected only when no uncommitted path lies outside
the change's directories; selecting it otherwise is the acknowledgement. On confirm it ends the session, posts the
cleanup, then pulls. The sequence lives on the client because ending and pulling already do; the server re-checks
everything at the `POST`, including that the session is no longer running. When the change is not stale, the dialog
keeps today's behaviour and, if the worktree is kept, says it will be marked stale once the archive is merged.

The pull runs last, so the main-checkout leftover is removed before the fast-forward. That order also helps the
fast-forward, because a staged path is gone.

### D6 Prevention is one clause

`ARCHIVE_TAIL` gains ", and include in your commit every file the archive moved or removed". The current text is pushed
onto the presets' former Archive prompts, so a saved verbatim copy upgrades and an edited one is kept, as for earlier
updates. This targets source 2, the most frequent one. Sources 1 and 3 are fixed by the cleanup, not by asking agents to
commit the main checkout's staged copy: invariant 1 forbids the dashboard from committing, and the main checkout is not
the agent's.

### D7 Invariant 1 changes in wording, not in kind

- Entry (6)'s forced deletion becomes "each linked worktree the user confirmed, in the deletion dialog or a stale
  change's cleanup".
- Entry (7)'s dismissal also covers a stale change's main-checkout copy, after a backup of differing files.

No subcommand is added. `CLAUDE.md` invariant 1 is updated to match.

## Risks / Trade-offs

- **A source edit made after the merge is real, unfinished work.** It is copied first, named, and needs the
  acknowledgement; the session-end offer is not pre-selected for it.
- **"Merged" is as of the last fetch.** A branch pushed after the merge reads as not merged and is kept, which is the
  safe direction.
- **A user's hand-made worktree on the change's branch is included.** A user lock refuses it with its reason, as the
  deletion dialog does.
- **Two changes modify agent-sessions' starters requirement.** This is noted as an overlap with
  `one-next-action-per-stage`.
