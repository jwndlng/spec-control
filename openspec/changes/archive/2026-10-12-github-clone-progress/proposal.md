# Proposal

## Why

Adding GitHub repositories (`add-github-repositories`) works, but using it is not pleasant. The setup wizard's
Continue waits until every clone has finished, with nothing to show what is happening. A clone shows only `Cloning…`,
without a phase, a percentage or how long it has been running, and it cannot be stopped. The Add from GitHub dialog
reuses the issue import's rows, so the list, the repositories chosen, and where each one is cloned to are hard to tell
apart. With the polling bug fixed (#286), a large repository still looks stuck while it downloads.

## What Changes

- **Setup clones in the background.** The Workspace step's Continue creates the marked folders, saves the roots,
  tracks the checked projects, starts the clones and moves to the next step without waiting for them. The clones go on
  while the user finishes setup. The Done step lists each clone with its progress or outcome, and offers Retry for a
  failed one; the projects overview shows them as it already does. A refused start (folder exists, root gone) still
  keeps the step open with the reason, because nothing is running yet.
- **Visible progress.** `git clone` runs with `--progress`, and its standard error is read as it arrives. Each clone
  entry gets its current phase (`connecting`, `receiving objects`, `resolving deltas`, `checking out files`), a
  percentage for that phase, the bytes received so far when git reports them, and the time it started (its `queued`
  state while it waits for one of the two slots). The dialog, the Done step and the Unmanaged projects entry show a
  progress bar with the phase, the percentage and the elapsed time. Nothing of git's output is shown except those parsed
  values and, on failure, the masked reason as today.
- **Cancel.** A queued or running clone can be cancelled from the dialog, the Done step and its Unmanaged projects
  entry. Cancelling stops git (or takes the clone out of the queue) and removes the target folder only if git left it
  empty, with the same non-recursive remove as a failed clone; the entry becomes `cancelled`, which can be retried or
  dismissed like a failed one. Nothing else is deleted.
- **A clearer dialog.** The repository list gets rows of its own: a checkbox, `owner/name`, badges for private,
  archived and already added, the description on a second line and the last push. Chosen repositories move to a
  separate **To clone** panel, one row each with its folder field and full target path, and a remove button.
  **Clone** starts the clones and closes the dialog; the overview then confirms it briefly
  ("Cloning 2 repositories — follow them under Unmanaged projects") and lists them there with their progress.
  A refusal keeps the dialog open with the reason on its row, as today.
- No new process, git or `gh` subcommand, network access or write: invariants 1 and 4 are unchanged apart from Cancel
  stopping a clone the user started, which removes nothing a failed clone would not.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `github-repositories` (introduced by `add-github-repositories`, archived before this change): clone progress, the
  `queued` and `cancelled` states, Cancel, the dialog's layout, Clone closing the dialog, and the confirmation on the
  overview.
- `setup-wizard`: the Workspace step's Continue no longer waits for clones; the Done step shows them with their
  progress, Retry and Cancel.
- `project-overview`: clone entries under Unmanaged projects show progress and offer Cancel; a cancelled clone is
  listed like a failed one.
- `dashboard-api`: clone entries carry `progress` and the `queued` and `cancelled` states; new
  `POST /api/github/clones/cancel`.
- `demo-site`: the simulated clone reports progress and can be cancelled.

## Impact

- Changed: `src/server/githubClone.ts` (streamed stderr, progress parsing, queue state, cancel),
  `src/server/api.ts` (cancel route), `src/shared/types.ts` (`GithubClone.progress`, states),
  `src/ui/githubState.ts`, `src/ui/addGithub.tsx` (layout, closing on Clone), `src/ui/untracked.tsx`,
  `src/ui/overview.tsx` (confirmation), `src/ui/setupWizard.tsx` and `src/ui/setupState.ts` (Continue without waiting,
  Done step clones), `src/ui/styles.css`, `src/ui/demo/demoApi.ts`, `src/ui/helpContent.tsx` if the Help describes
  Add from GitHub, and their tests (`test/githubClone.test.ts`, `test/githubApi.test.ts`, `test/githubUi.test.ts`,
  `test/setupState.test.ts`, `test/setupWizardUi.test.ts`, `test/untrackedUi.test.ts`, `test/demoApi.test.ts`).
- No new dependency, no configuration change.
- Depends on `add-github-repositories` (`depends-on.yaml`): its `github-repositories` spec must be archived first,
  since this change modifies it.
