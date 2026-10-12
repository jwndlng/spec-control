# Design

## Context

See proposal.md for why. Today `cloneInto` (`src/server/githubClone.ts`) spawns `git clone` with stderr piped and reads
it only after git exits; `GithubClones` holds jobs in memory with a two-slot semaphore, and a waiting job is listed as
`cloning` although git has not started. The UI has one shared store (`githubClonesState.ts`) that polls
`GET /api/github/clones` every second while a clone runs (fixed in #286). The setup wizard's `continueWorkspaceStep`
(`src/ui/setupState.ts`) starts clones and then awaits `waitForClones`. The Add from GitHub dialog
(`src/ui/addGithub.tsx`) borrows the issue import's CSS classes.

## Goals / Non-Goals

**Goals:**
- Progress the user can read, from git's own reports, with no new process and nothing of git's text shown but parsed
  values and the masked failure reason.
- Cancel with exactly the cleanup a failed clone already has.
- Setup never waits on the network.

**Non-Goals:**
- Faster clones (shallow, partial, single-branch): each breaks something a tracked repository relies on (work status,
  merged detection, scans needing no network); a full clone stays.
- Pausing or resuming a clone; persisting clones across restarts.
- A general notification system: the overview's confirmation is a single polite status line.

## Decisions

### D1. Parse `--progress` from stderr as it streams
`git clone --progress` writes progress to stderr even without a terminal, as `\r`-separated updates such as
`Receiving objects:  45% (450/1000), 12.30 MiB | 4.10 MiB/s`, `Resolving deltas:  80% (80/100)` and
`Updating files:  30% (300/1000)`. The server reads stderr as a stream, splits on `\r` and `\n`, and matches only these
known prefixes (plus `remote: …` lines, which map to `connecting`); everything else is kept only in a bounded tail
(last 8 KiB) for the failure reason, which goes through `reasonFrom` and `maskCredentials` as today. Reading as it
arrives also means a chatty clone can never fill the pipe. Progress updates are coalesced: the job's `progress` changes
at most every 500 ms, and `updatedAt` lets the UI show "no progress for N s" if git goes quiet.
Alternative: estimate progress from the folder's size on disk — no phase, no total, and a `du` per poll; rejected.

### D2. `queued` is a state, not a flavour of `cloning`
The job is `queued` until it takes a slot, then `cloning`. Discovery keeps leaving out every folder whose clone is
queued or cloning (both have the folder). Cancel on a queued job removes it from the waiting list before git starts;
on a running job it kills git (SIGTERM, then SIGKILL after 5 s), waits for exit, then does the same non-recursive
`rmdir` as a failure. A cancel racing a normal finish resolves to whichever happened first: a clone that already has an
outcome answers `409`.

### D3. The wizard stops waiting
`continueWorkspaceStep` keeps its order (create folders → save → track → start clones) but drops `waitForClones`:
`outcome: "next"` once every listed repository is accepted, `"stay"` only for a refused start (409 folder exists, 404
root gone), which leaves nothing running for that repository. The Done step reads the same shared clone store, filtered
to the ids setup started, and renders them with the shared clone row (D5). `SetupSaved.cloned` becomes the repositories
started rather than finished.

### D4. The dialog closes on Clone (overview only)
In `clone` mode, `submit` starts each chosen repository; when every one is accepted the host closes the dialog and the
overview shows a polite, auto-hiding status ("Cloning 2 repositories — follow them under Unmanaged projects", about six
seconds, `role="status"`). With refusals the dialog stays, keeping only the refused rows in **To clone**. In `collect`
mode (wizard) nothing changes: Add hands the choice back.

### D5. One clone row component
A hook-free `CloneRow` (state word, progress bar with phase / percent / elapsed, Cancel / Retry / Dismiss as the state
allows) is used by the dialog, the Done step and Unmanaged projects, so they say the same thing. The bar is a native
`<progress>` with `aria-valuetext` "receiving objects, 45 percent"; an indeterminate bar while the phase has no
percentage yet (`connecting`). Elapsed time comes from `startedAt` and the page's clock, refreshed with the 1 s poll.

### D6. Dialog layout
Two columns on wide screens, stacked on narrow ones: the list (search, owner, Refresh, rows, typed entry) and the
**To clone** panel (root select, one row per choice with folder field and full path, Clone). Own CSS classes
(`add-github-*`) instead of the issue import's. Rows are labels, so the whole row toggles the checkbox.

## Risks / Trade-offs

- [git's progress wording is translated in the user's locale] → the clone runs with `LC_ALL=C` (`LANGUAGE` unset), so
  git reports in its untranslated English; the failure reason is then English too. A prefix not recognised just leaves
  the phase unchanged and the clone still finishes.
- [Killing git mid-write leaves files] → git cleans up a clone it did not finish on SIGTERM; the non-recursive `rmdir`
  then succeeds, and when it does not the entry names the path, as for a failure.
- [Setup finishes with clones still running] → the Done step and the overview both show them; Finish says they go on.

## Migration Plan

UI and in-memory only; no configuration or persisted state changes. Rollback restores waiting in setup and the old
dialog.
