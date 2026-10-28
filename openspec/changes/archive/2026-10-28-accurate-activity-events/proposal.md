# Proposal

## Why

Three derivations tell a change from another one of the same name, or from one the scan merely did not see, the wrong
way. Two of them write wrong history into the activity log, which is never corrected afterwards and feeds the feed's
metrics; the third offers Implement too early.

- **An active change is compared with an old archive of its name.** `diffSnapshots` keys the previous snapshot's changes
  by name only (`src/server/activity/events.ts`, `new Map(was.changes.map((c) => [c.name, c]))`). The scanner reports
  active changes first and archives after them, so for a name that is both — a new change reusing the name of an archived
  one — the archive wins the key and the active change is compared with it. Reproduced: `demo-ops` holds the archive
  `2026-09-01-rotate-keys` and an active `rotate-keys` in `Drafts`; every scan records `rotate-keys` moved from
  `Archived` to `Drafts`, inflating the moves per day. When the new `rotate-keys` is archived in turn, nothing is recorded
  at all: both archives compare with the old one and the vanished active change is "seen".
- **A worktree that is not read for one scan looks like changes removed and created again.** `scanWorktrees`
  (`src/server/scanner.ts`) reads at most `WORKTREE_LIMIT` (12) worktrees, chosen by the modification time of their
  `openspec/changes`, and a worktree whose read times out or fails only adds a warning. The scan is still `ok: true`, so a
  change that exists only in such a worktree is missing from it: the diff records `change-removed`, and `change-created`
  once the worktree is read again. A change that also has a copy in the main checkout falls back to that copy and records
  a move back and forth instead. (From the code; not run.)
- **A dependency is met by an old archive of a reused name.** `resolveDependencies` (`src/shared/dependencies.ts`,
  `met = byName.get(name)?.some(onMainAsFinished)`) counts any copy of the name. Reproduced: `add-billing-ui` depends on
  `add-billing-schema`; the main checkout holds the archive `2026-09-01-add-billing-schema` and a new
  `add-billing-schema`, created `2026-10-01`, is in `Drafts`. The dependency is `met`, the card is not blocked and
  Implement is offered, though the change it waits for has not been implemented.

The third is not an activity defect, but it is the same mistake as the first — an archive of a reused name standing in
for the active change — and is fixed by the same rule the scanner already applies elsewhere (`foldLeftovers`,
`mergeChanges`, stale changes, the pull-request link's "settled before created"), so it is carried here rather than in a
change of its own.

## What Changes

- **Active and archived changes are compared separately.** Active changes are matched by name, archives by name and
  archive date. A new archive date of a name whose active change is gone is the archived event, from that change's last
  column; an active change next to an old archive of its name is compared only with its own previous state.
- **The scan says which worktrees it did not read.** The repository snapshot lists the paths of the linked worktrees with
  an `openspec/changes` directory that were left out by the limit or failed or timed out. The board is unchanged.
- **An unread worktree is not activity.** A change whose leading copy was in a worktree the new scan did not read, or is
  in one the previous scan did not read, is not compared in that comparison: no created, moved, progress, archived or
  removed event. A worktree that is gone from `git worktree list` is not unread; its changes are removed as today.
- **A reused name's dependency waits for the new change.** When an active change of the dependency's name exists, it alone
  decides: `met` once it is `Done` in the main checkout (or an archive of the name dated on or after its creation is
  there), never because of an older archive.
- No new git command, no network, no write; the activity log's format is unchanged.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `activity-feed`: "Activity is detected by comparing consecutive snapshots" — matching by name and archive date; a new
  requirement that an unread worktree is not activity.
- `change-scanner`: "Reading worktrees is bounded and isolated" — the snapshot lists the worktrees it did not read.
- `change-dependencies`: "Each dependency has a state" — an active change of the name decides, not an older archive.

## Impact

- `src/server/activity/events.ts`: separate keys for active changes and archives; the archive pairing; skipping changes
  led from an unread worktree on either side.
- `src/server/scanner.ts`: `scanWorktrees` returns the paths it left out or could not read; the repository snapshot
  carries them.
- `src/shared/types.ts`: an optional `unreadWorktrees` on `RepoSnapshot` (absent in older cached snapshots, read as none).
- `src/shared/dependencies.ts`: `met` decided from the active copy when there is one.
- `src/ui/changelog.ts`: a What's new entry.
- Tests: `test/activityEvents.test.ts` (both reproductions, the unread-worktree scenarios), `test/worktreeScan.test.ts`
  (the list for the limit and for a failing worktree), `test/dependencies.test.ts` (reused name waiting, then met).
- Specs: `openspec/specs/activity-feed/spec.md`, `openspec/specs/change-scanner/spec.md`,
  `openspec/specs/change-dependencies/spec.md`.
- No CLAUDE.md change: invariant 5 already says the log is history and never an input; nothing here reads it.

## Overlaps

- `serialise-home-writes` (PR #359) adds an `activity-feed` requirement about log compaction and changes
  `src/server/activity/log.ts`, not `events.ts`; `apply-what-was-previewed` (PR #374 archives it) adds one about the
  feed's latest request. Different requirements, no shared code.
- `contain-repository-reads` (PR #371) changes `src/server/scanner.ts` (bounded reads, including `depends-on.yaml`) and
  other `change-scanner` requirements; textual overlap only.
- `add-validate-phase` changes `src/shared/types.ts` (other fields).
- `link-only-own-branch` (PR #382, proposed alongside) changes `scanWorktree` and `branchMatch` in `src/server/scanner.ts`
  and `src/server/mergeChanges.ts` — the neighbouring function of `scanWorktrees`.
