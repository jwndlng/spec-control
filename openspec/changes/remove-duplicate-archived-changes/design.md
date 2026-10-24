# Design

## Context

A change is archived by moving `openspec/changes/<name>/` to `openspec/changes/archive/<YYYY-MM-DD>-<name>/`. When the
agent commits the new directory but not the removal of the old one — the half-committed move
`stale-means-archived-and-merged` describes — and that commit merges, the default branch holds both. `add-validate-phase`
in this repository is such a case: both copies are on `main`, and they differ in two lines of `tasks.md` (ticks made in
the active copy after it was archived).

**What the board shows today for that case.** The scanner reads the main checkout's active copy and its archive.
`foldLeftovers` (`src/server/mergeChanges.ts`) moves every main-checkout active copy of an archived change that was not
created after the archive into that archive's `otherCheckouts`, whether or not its files are committed. So the board
shows **one card, in `Archived`**; the change detail adds a warning badge `active copy left · Done` whose tooltip
(`leftoverHint`, `src/ui/format.ts`) says the copy "usually holds files that were never committed and stayed behind when
the archive arrived" and to "remove `openspec/changes/add-validate-phase/` to clear this". There is no Stale badge and no
action. `stale-means-archived-and-merged` does not list it as a leftover either, because its files are in the main
checkout's commit. Removing the directory by hand in the main checkout — what the tooltip suggests — leaves a deletion
that has to be committed and pushed, which is exactly what the dashboard never does and the main checkout should not hold.

## Goals / Non-Goals

**Goals:** report the committed duplicate precisely, say so on the board, and offer one action that ends with the
duplicate gone from the default branch through a pull request — without the dashboard writing to the repository.

**Non-Goals:** see the proposal.

## Decisions

### D1. Detect on the default branch's tree, not on disk

The duplicate is a property of the default branch: what every future checkout and pull will bring. The scan reads
it from the default branch as locally known (`baseRef`: `origin/HEAD`, else the main checkout's `HEAD`), like the
stranded-archive detection:

- `ls-tree` of `openspec/changes/` and of `openspec/changes/archive/` on that ref (the changes layout of the framework
  module, as today) gives the active names and the archive directories;
- for a name with both, the newest archive of that name (by date, as `newestArchive` already picks) is the archive;
- `cat-file -p <ref>:openspec/changes/<name>/.openspec.yaml` gives the active copy's `created`; a copy created *after*
  the archive's date is a new change reusing the name and is not a duplicate (the same name-reuse rule as everywhere);
  a copy with no readable `created` counts as not later;
- `git diff --name-only <ref>:<archive dir> <ref>:openspec/changes/<name>` lists the paths whose content differs, at most
  50 plus a count.

All of these are subcommands already in the read-only list (`ls-tree`, `cat-file`, `diff`); none touches a working tree,
index or remote. One failing git command drops that change's report and fails nothing.

Rejected: detecting from the main checkout's files. The main checkout may be behind (then a pull fixes it) or carry the
user's uncommitted edits; the default branch is the one place a commit is needed.

### D2. The board keeps the archived card; only the reason and the hint change

The card is already right: the change *is* archived, and folding keeps the active copy from showing up as live work in
`Done`. So the column, stage and counts stay as they are. The scan sets `duplicate` on the archived change
(`{ archive, differing, differingCount }`); the card shows the existing **Stale** badge with the reason "archived on the
default branch, but `openspec/changes/<name>/` is still committed there too", and `leftoverHint` says *committed next to
its archive on the default branch* when the change carries `duplicate`, keeping today's wording for the uncommitted copy
that `stale-means-archived-and-merged` cleans up. A change that is both stale for leftovers and a duplicate shows one
badge with both reasons.

When the default branch has the duplicate but the main checkout has not pulled it (so nothing is folded yet), the change
is still reported from the scan of the default branch and the notice adds that Pull brings it, as for stale leftovers.

### D3. Remove duplicate is an archive session on `chore/archive-<name>`

The fix is a commit that deletes a directory under `openspec/` — an archive's missing half. It runs as an **archive
session** (action `archive`) with a fixed opening prompt, exactly like **Carry over archive**:

- the branch is the archive session's `chore/archive-<name>`, which the pull-request link, the recorded
  `archive-branch` fallback and the stale branch list already treat as the change's — so the pull request it opens is
  linked to the change and its leftovers are found later without adding a branch name anywhere;
- the docs auto-merge archive instruction and auto-merge record apply under the same conditions as for any archive
  session (`shipsOnlyOpenSpec` with `allowEmpty`), so with docs auto-merge on the existing flows ask the agent to merge
  once ready and end the session after the merge.

Unlike Carry over, the prompt asks the agent to commit, push and open the pull request itself, since there is nothing
else for Ship to add and a one-directory deletion is the whole change.

The worktree is created from the default branch, so it holds the duplicate. If a local `chore/archive-<name>` branch
exists, the existing worktree rule would check out that old branch — typically the merged branch of the original archive,
which lacks today's default branch. The action is therefore refused while that branch exists (or a worktree is on it),
with the reason; that branch is a stale leftover the change's **Clean up leftovers…** removes when it is merged, and
otherwise holds work the user has to look at first.

Rejected: a new fixed branch `chore/remove-duplicate-<name>`. It would work, but every exact branch list (pull-request
link candidates, the stale branch list) would need a fourth name, for a rare one-off.

### D4. The prompt asks before carrying anything over

The two copies can differ: ticks made in the active copy after it was archived, as in `add-validate-phase`. Silently
deleting would lose them; silently copying would rewrite an archive. The fixed prompt names the change, the archive
directory and the differing paths from the scan, and asks the agent to show the user, for each differing file, what the
active copy has that the archive lacks, to carry into the archive only what the user confirms, then to delete
`openspec/changes/<name>/`, commit, push and open a pull request that changes only files under `openspec/`. It names
nothing taken from the request.

### D5. Nothing written by the dashboard; Dismiss is not the tool

The dashboard only starts the session; all writes are the agent's under its own permission prompts. Invariant 1 is
unchanged. **Dismiss change** is rejected as the way out: it deletes the directory in the main checkout and stages the
deletion, leaving uncommitted state in the main checkout, and it is the deletion *on the default branch* that is needed.

## Risks / Trade-offs

- **The agent deletes more than the duplicate.** The prompt names one directory; the docs-only check before any
  automatic merge request still applies, and the pull request is reviewed or merged under the project's own rules.
- **A refusal while `chore/archive-<name>` exists** costs one extra step (Clean up leftovers first), in exchange for never
  starting from an outdated branch.
- **Scan cost.** One `ls-tree` per repository plus, per duplicate only, one `cat-file` and one `diff`; duplicates are rare.
