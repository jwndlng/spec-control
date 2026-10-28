# Design

## Context

`diffSnapshots` is pure: it compares two snapshots and emits events. Its only key is the change name, though a snapshot
can hold one active change and several archives of the same name, and it has no way to tell a change that is gone from
one that sat in a checkout this scan skipped. `resolveDependencies` is likewise keyed by name and asks whether any copy
is finished.

## Decisions

### D1. Two keys: name for active changes, name and date for archives

The scanner reports at most one active change per name (`mergeChanges`) and one archive per name and date (an archive
directory is `<date>-<name>`). Keying active changes by name and archives by `name@date` makes every key unique, so no
entry can shadow another. The one event that crosses the two sets is archiving: an archive key that is new and whose name
had an active change that is now gone is that change's archived event, from its previous column, and the vanished active
change is accounted for by it (no removed event). A new archive key without such an active change keeps today's
first-sight rule (recorded only within 7 days), which covers an archive arriving by a pull.

Rejected: keeping the name key and preferring the active entry. The new archive of a reused name would then still compare
with the old one and be lost.

### D2. The scan lists what it did not read; it does not fill the gap

`scanWorktrees` already knows which candidates it cut off and which failed. It returns their paths — the same
subdirectory-adjusted paths the changes' `checkout.path` carries — and the repository snapshot holds them as
`unreadWorktrees`, omitted when empty. The diff skips a change whose leading checkout in one snapshot is in the other
snapshot's unread list, in both directions: the previous lead unread now (would be removed, or move back to the main
checkout's copy) and the new lead unread before (would be created, or move forward again).

Rejected: carrying the previous scan's copies of an unread worktree forward into the new snapshot. The board would then
show state this scan did not read, against "The repository is the source of truth"; the warning already says what was
skipped. Rejected: suppressing only `change-removed`, as first suggested — the matching `change-created` on the next
scan, and the moves of a change with a main-checkout copy, are the same phantom.

The cost is that a real change inside a worktree while it was unread is recorded only from the next comparison in which
both sides read it — a missing event, never a false one, which is the right failure for history.

### D3. An active change of the name decides its dependency

When the merged changes hold an active change of the dependency's name, that change is the one being waited for: `met`
only when the main checkout holds it in `Done`, or holds an archive of the name dated on or after its creation date (the
same comparison `foldLeftovers` and `mergeChanges` use to tell a reused name from a leftover). Without an active change,
today's rule applies unchanged: any archive in the main checkout, or a main-checkout copy in `Done`. An active change
without a creation date is decided by its own state only; in practice the scanner folds such a copy into the archive as a
leftover before dependencies are resolved, so the case does not reach this rule. The cycle check uses the same `met`.

Rejected: always ignoring archives older than the newest active change's creation without asking whether an active change
exists — the result is the same, but the rule as written names the case it is for.
