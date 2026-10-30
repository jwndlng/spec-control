# repository-pull Specification

## Purpose
Defines the pull action: the one user-requested operation that contacts a repository's remote and updates its main checkout — a fetch followed by a fast-forward-only merge of the upstream, the cases in which the update is refused rather than forced, how credentials, prompts and hooks are handled, and where the action is offered in the UI.

## Requirements

### Requirement: Pull fetches, then fast-forwards only
The pull action SHALL, in the repository's main checkout, first fetch from the remote of the checked-out branch's upstream (or from `origin` when the branch has no upstream but that remote exists), and then — only when the checkout is on the repository's default branch, that branch has an upstream, and it is behind it — update it with a fast-forward-only merge of the upstream. It MUST NOT create a merge commit, rebase, stash, reset, force, delete or switch branches, and MUST NOT touch linked worktrees or submodules. Uncommitted changes to files the fast-forward does not touch SHALL be left as they are. The fetch MUST NOT trigger automatic repository maintenance.

#### Scenario: Behind and clean
- **WHEN** the main checkout is on its default branch, clean, and two commits behind its upstream
- **THEN** after the pull it is at the upstream's commit and the result says it was fast-forwarded by 2 commits

#### Scenario: Already up to date
- **WHEN** the remote has nothing new
- **THEN** the result says `up to date` and the working tree, index and branch are unchanged

#### Scenario: Unrelated local edits survive
- **WHEN** the checkout has an uncommitted edit to `notes.md` and the incoming commits only change `src/app.ts`
- **THEN** the fast-forward happens and `notes.md` still has the uncommitted edit

#### Scenario: Worktrees are left alone
- **WHEN** a repository with three linked worktrees is pulled
- **THEN** no file, index or branch of any linked worktree changes

### Requirement: The update is refused rather than forced
When the fast-forward cannot be done safely the action SHALL leave the branch, index and working tree exactly as they were and SHALL report why, while the fetch SHALL still have run: when the checkout is not on the repository's default branch or is detached (`skipped`), when the branch has no upstream (`skipped`), when local and remote history have diverged (`refused`), and when an uncommitted change would be overwritten (`refused`). A refusal because of uncommitted changes SHALL list the **blocking files** — every path that has an uncommitted change in the main checkout (staged, unstaged or untracked) and that the incoming commits change — each classified as a change leftover (identical or differing, see "Change leftovers blocking a pull are resolved on confirmation") or as local work; when git refuses but no blocking file can be determined, git's message SHALL be reported instead. Every refusal SHALL say in plain words what the user can do: for local work, commit or set aside the listed files and pull again; for diverged history, reconcile the local commits outside the dashboard. The result MUST NOT suggest forcing, resetting or discarding anything. A repository without any remote SHALL be reported as having nothing to pull, without running a fetch. A fetch that fails SHALL be reported as `failed` with git's reason and SHALL NOT be followed by an update.

#### Scenario: On a feature branch
- **WHEN** the main checkout is on `feat/redesign` and the default branch is `main`
- **THEN** the remote is fetched, nothing in the working tree changes, and the result says it only fetched because the checkout is on `feat/redesign`, not `main`

#### Scenario: Diverged
- **WHEN** the default branch has one local commit the remote lacks and the remote has one the checkout lacks
- **THEN** the update is refused as diverged, the result says the local commit has to be reconciled outside the dashboard without suggesting a force, and the local commit and working tree are untouched

#### Scenario: Overlapping local edit
- **WHEN** `src/app.ts` has an uncommitted edit and an incoming commit changes `src/app.ts`
- **THEN** the update is refused, the result lists `src/app.ts` as local work and says to commit or set it aside and pull again, and the edit, the index and the branch are unchanged

#### Scenario: Only files the incoming commits touch are listed
- **WHEN** `src/app.ts` and `notes.md` have uncommitted edits and the incoming commits change only `src/app.ts`
- **THEN** the blocking files are exactly `src/app.ts`

#### Scenario: Remote unreachable
- **WHEN** the remote cannot be reached
- **THEN** the result is `failed` with the reason, and nothing in the repository's working tree changed

#### Scenario: No remote
- **WHEN** the repository has no remote configured
- **THEN** the result says there is nothing to pull and no fetch is run

### Requirement: Credentials, prompts and hooks
The action SHALL rely on git's own credential handling (SSH agent, credential helpers) and the dashboard MUST NOT read, store, request, log or forward credentials. It MUST NOT prompt: terminal prompts SHALL be disabled and SSH SHALL run in batch mode unless the user has configured their own SSH command through the environment, so that a remote requiring interaction fails instead of waiting. The fetch SHALL have a timeout after which it is stopped and reported as failed. Repository hooks MUST NOT run as part of the action; when the repository has a `post-merge` hook and a fast-forward happened, the result SHALL say that hooks were not run. Any text returned to the browser SHALL have credentials embedded in URLs masked.

#### Scenario: Login required
- **WHEN** the remote needs a password and no credential helper provides one
- **THEN** the pull fails with a reason within the timeout and no prompt appears anywhere

#### Scenario: Hook present
- **WHEN** the repository has an executable `post-merge` hook and the pull fast-forwards
- **THEN** the hook does not run and the result says hooks were not run

#### Scenario: Credentials in an error
- **WHEN** git's error message contains `https://user:secret@host/repo.git`
- **THEN** the reason shown has the user and secret masked

#### Scenario: Remote never answers
- **WHEN** the fetch produces no result within the timeout
- **THEN** the process is stopped and the result is `failed: timed out`

### Requirement: Pull is offered where repositories are shown, and only runs on request
The repository board header and each git repository's row in the projects overview SHALL offer a Pull action, and the overview SHALL offer "Pull all". The dialog that ends an agent session SHALL offer a pull for that session's repository as part of confirming it, under the rules of the `agent-sessions` capability. While a pull runs the control SHALL show that it is running and SHALL NOT start a second one, nor SHALL a second one be started for the same repository from another of these places. The outcome SHALL be shown next to the control as text — up to date, fast-forwarded with the number of commits, fetched only, refused, or failed — with the reason available, and the view SHALL update from the rescan without a page reload. Using the control in an overview row MUST NOT navigate into the repository. Nothing SHALL pull without the user activating one of these controls. In a projects overview row and tile the Pull control SHALL be a bordered button with the same height, border and font size as the **Console** button beside it, its border shown at rest and not only on hover, so it does not read as plain text; its label, tooltip and outcome are the same as elsewhere.

#### Scenario: From the overview
- **WHEN** the user activates Pull in the row of a repository that is three commits behind
- **THEN** the row shows that it is running, then `+3 commits`, the overview stays where it is, and the repository's data refreshes

#### Scenario: Pull all
- **WHEN** the user activates "Pull all" with five git repositories tracked
- **THEN** each repository's outcome is listed, including any that were only fetched or failed, with their reasons

#### Scenario: Non-git repository
- **WHEN** a tracked repository is not a git repository
- **THEN** no Pull action is offered for it

#### Scenario: From the end-session dialog
- **WHEN** the user confirms the end-session dialog with its pull offer selected
- **THEN** that repository is pulled once, and the outcome is reported both in the dialog and next to the repository's Pull control

#### Scenario: Already running elsewhere
- **WHEN** a pull for a repository is still running and the user confirms an end-session dialog for that repository with the pull offer selected
- **THEN** no second pull is started and the running pull's outcome is the one reported

#### Scenario: Pull looks like a button on the overview
- **WHEN** the projects overview shows the git repository `alpha-infra`, in the table layout and in the tiles layout, without the pointer over its Pull control
- **THEN** in both layouts its Pull control shows a border and has the same height as the Console button beside it

### Requirement: Change leftovers blocking a pull are resolved on confirmation
A blocking file SHALL be a **change leftover** when all of these hold: its path lies inside `openspec/changes/<name>/` for a valid change name other than `archive`; it is not in the checkout's current commit; locally it is only a new file, staged or untracked (not also deleted); and the incoming upstream commit contains it. A leftover SHALL be **identical** when its working-tree content and, when staged, its staged content both equal the incoming content, and SHALL **differ** otherwise. Any other blocking file SHALL be **local work**.

When every blocking file is a change leftover, the refused result SHALL offer **Resolve and pull**, naming each leftover and whether it differs. Nothing SHALL happen until the user confirms. On confirmation the dashboard SHALL NOT fetch again; it SHALL re-determine the blocking files itself and SHALL proceed only when the upstream still points at the commit the user was shown, the blocking files are exactly the ones shown, each is still a change leftover, and each still has the content it had when shown. Otherwise it SHALL change nothing and report the pull refused with the reason. When it proceeds it SHALL, in this order: save a copy of every leftover that differs under `~/.spec-control/` (its working-tree content, and its staged content too when that is different again); remove the leftovers, and only them, from the main checkout's index and working tree; and run the fast-forward again. The result SHALL name every file it replaced and, for each copy, where it was saved. When the retried fast-forward is still refused, the dashboard SHALL put each leftover back as it was — its content, and whether it was staged — and report the pull refused; the copies SHALL be kept.

When any blocking file is local work, no resolution SHALL be offered and a request to resolve SHALL be refused without touching anything. Resolve and pull SHALL be offered for one repository at a time, from every place a pull outcome is shown, and never by "Pull all" for several repositories at once.

#### Scenario: Identical leftover
- **WHEN** `openspec/changes/add-login/.openspec.yaml` was created and staged locally, and the incoming commits add that file with the same content, and git refuses the fast-forward
- **THEN** the result offers Resolve and pull, and after confirmation the checkout is fast-forwarded, the file has the incoming content and is tracked, and no copy was saved

#### Scenario: Differing leftover
- **WHEN** a staged `openspec/changes/add-login/prompt.md` differs from the one the incoming commits add
- **THEN** after confirmation a copy of the local `prompt.md` exists under `~/.spec-control/`, the checkout is fast-forwarded, and the result names the replaced file and where its copy is

#### Scenario: Untracked leftover
- **WHEN** a change's files were created but never staged, and the incoming commits add the same paths
- **THEN** they are classified as change leftovers and can be resolved the same way

#### Scenario: Leftover mixed with local work
- **WHEN** the blocking files are a staged change leftover and an uncommitted edit to `src/app.ts`
- **THEN** no resolution is offered, `src/app.ts` is listed as local work, and a resolve request is refused with every file, the index and the branch unchanged

#### Scenario: A file already in the current commit is not a leftover
- **WHEN** `openspec/changes/add-login/proposal.md` is tracked in the current commit, has an uncommitted edit, and the incoming commits change it
- **THEN** it is listed as local work

#### Scenario: Leftover changed after the offer
- **WHEN** Resolve and pull was offered and the user edits the leftover before confirming
- **THEN** the confirmation is refused because the file changed, and nothing is removed, copied or merged

#### Scenario: Upstream moved after the offer
- **WHEN** another fetch moved the upstream to a newer commit between the offer and the confirmation
- **THEN** the confirmation is refused, nothing is touched, and the user is asked to pull again

#### Scenario: Retried fast-forward still refused
- **WHEN** after the leftovers were removed the fast-forward is refused because another file changed meanwhile
- **THEN** each leftover is back with its content and staged state, any copies remain, and the result is refused with the reason

#### Scenario: Pull all
- **WHEN** "Pull all" runs and one repository is blocked only by change leftovers
- **THEN** that repository's outcome lists its leftovers and offers Resolve and pull for it alone, and nothing is resolved without that repository's own confirmation

### Requirement: An automatic fetch and a pull never overlap
At most one fetch of a project SHALL run at a time, whether it was started by a pull or automatically. When the user asks for a pull of a project whose automatic fetch is running, the pull SHALL wait for that fetch to finish and then run as usual, including its own fetch; it MUST NOT be refused because of the automatic fetch. When an automatic fetch falls due while a pull or Resolve and pull of the project is running, that automatic fetch SHALL be skipped and the next one SHALL be one interval later. A successful pull's fetch SHALL count as the project's most recent fetch, so a reported automatic-fetch failure no longer shows after it.

#### Scenario: Pull during an automatic fetch
- **WHEN** the user activates Pull on a project while its automatic fetch is running
- **THEN** the control shows that the pull is running, the pull starts once the automatic fetch has finished, and its outcome is reported as usual rather than as already running

#### Scenario: Automatic fetch during a pull
- **WHEN** an automatic fetch of a project falls due while the user's pull of that project is running
- **THEN** no second fetch is started, and the next automatic fetch is one interval later

#### Scenario: A pull clears a failure
- **WHEN** the last automatic fetch of a project failed and the user then pulls it successfully
- **THEN** the project no longer reports an automatic-fetch failure

### Requirement: Projects are fetched automatically unless switched off, fetch only
Every project SHALL have **auto fetch**, set per project on the projects overview, with an interval of 15 or 30 seconds, 1, 5, 10, 15 or 30 minutes or one hour, or switched **off**. A project without a saved setting SHALL be fetched **every minute**; only a project whose auto fetch the user switched off SHALL NOT be fetched except by the pull action. While a project's auto fetch is not off, the dashboard SHALL fetch it once at that interval for as long as the dashboard runs, starting one interval after the dashboard started, after the setting was switched on or changed, or after setup ended. While setup is pending (`setup: "pending"`, the setup wizard of a fresh installation not finished or skipped yet), no project SHALL be fetched automatically, so that a project tracked in the wizard is not fetched before the user could choose its auto fetch; a fetch that falls due while setup is pending SHALL be skipped without running git, and once setup is marked done every project SHALL be fetched under its own setting, one interval later. An automatic fetch SHALL be exactly the fetch step of the pull action — from the remote of the checked-out branch's upstream, or from `origin` when the branch has no upstream but that remote exists, without submodules, without automatic repository maintenance, under the same credential, prompt, timeout and masking rules — and nothing else: it MUST NOT fast-forward, merge, rebase, reset, stash, prune, switch a branch, resolve change leftovers or run hooks, and MUST NOT change the main checkout's branch, index or working tree or any linked worktree. It writes only what a fetch writes: remote-tracking refs, `FETCH_HEAD` and objects.

An automatic fetch SHALL be skipped, without running git, for a project that is disabled, is not a git repository, has no remote, whose last scan failed, or that is no longer configured; and the dashboard SHALL NOT fetch automatically at all in the demo. Projects SHALL be fetched with bounded concurrency, so that many projects falling due at once do not all fetch at the same moment. A failed automatic fetch SHALL be retried only at the next interval, never sooner. An automatic fetch of a project SHALL NOT be started while the previous automatic fetch of that project is still running or waiting to run, however short the interval; that one is skipped and the next attempt is one interval later.

When an automatic fetch moved any remote-tracking ref, the project SHALL be rescanned and the work statuses of its worktrees SHALL be recomputed rather than served from a cache, so that a branch whose pull request merged shows `merged`, and the conflict signal is computed against the new base, without a page reload. When it moved nothing, no rescan SHALL be started for it. The outcome of the most recent automatic fetch of each project — when it ran, whether it succeeded, and the masked reason when it failed — SHALL be kept in memory only and reported with the project's scan result; it is never an input to columns, counts, statuses or actions.

#### Scenario: On by default
- **WHEN** an enabled git project with a remote has no auto-fetch setting and the dashboard runs for three and a half minutes
- **THEN** its remote has been fetched three times, and its main checkout's branch, index and working tree are byte-for-byte as they were

#### Scenario: Switched off
- **WHEN** a project's auto fetch is switched off and the dashboard runs for two hours
- **THEN** no fetch of that project is run

#### Scenario: Fetching every 15 minutes
- **WHEN** a project has auto fetch every 15 minutes and the dashboard runs for 46 minutes
- **THEN** its remote has been fetched three times, and its main checkout's branch, index and working tree are byte-for-byte as they were

#### Scenario: Behind but never fast-forwarded
- **WHEN** a project with auto fetch on is on its default branch, clean, and its remote gains two commits
- **THEN** after the next automatic fetch its upstream ref has moved, its branch still points at the old commit, and its working tree is unchanged

#### Scenario: A merged branch is detected
- **WHEN** a session's branch was squash-merged on the remote and the project's next automatic fetch brings the new default branch in
- **THEN** the project is rescanned and that worktree's work status reads `merged` without the user pulling or reloading

#### Scenario: Nothing new
- **WHEN** an automatic fetch moves no remote-tracking ref
- **THEN** no rescan is started because of it

#### Scenario: Remote unreachable
- **WHEN** an automatic fetch fails because the remote cannot be reached
- **THEN** nothing in the repository's working tree changed, the failure and its masked reason are reported with the project, and the next attempt is one interval later

#### Scenario: Changing the interval
- **WHEN** a project fetched every hour is switched to every 15 seconds
- **THEN** its next automatic fetch is 15 seconds after the change, and then every 15 seconds

#### Scenario: A slow fetch is not doubled
- **WHEN** a project fetched every 15 seconds has an automatic fetch that takes 40 seconds
- **THEN** no second fetch of that project starts while it runs, and the next one starts at the first interval after it finished

#### Scenario: Switched off while pending
- **WHEN** a project's auto fetch is switched off while its next fetch is pending
- **THEN** that fetch does not run, and none follows

#### Scenario: Disabled project
- **WHEN** a project with auto fetch on is disabled on the overview
- **THEN** it is not fetched while it is disabled, and its setting is kept

#### Scenario: Demo
- **WHEN** the demo shows a project with auto fetch on
- **THEN** no fetch is run

#### Scenario: Not while setup is pending
- **WHEN** a fresh installation's setup wizard tracked `alpha-infra`, an enabled git project with a remote and no auto-fetch setting, and the user stays in the wizard for five minutes
- **THEN** no fetch of `alpha-infra` is run

#### Scenario: Fetching starts once setup is done
- **WHEN** the user then finishes or skips setup
- **THEN** `alpha-infra` is fetched one minute later, and every minute after that

### Requirement: Pull and fetch ignore configuration that would change what they do
The fast-forward of the pull action and of Resolve and pull SHALL be run so that it cannot stash, rebase or update a
submodule whatever the configuration says (`merge --ff-only --no-autostash` with `submodule.recurse` off), and the fetch
of the pull action and of the automatic fetch SHALL be run so that it cannot prune (`--no-prune --no-prune-tags`) or
recurse into submodules. Hooks SHALL NOT run for the fetch, the fast-forward, the leftover removal from the index or the
restoring `add`, as required by "Writing git commands run no hooks and ignore configuration that would widen them" in the
`dashboard-api` capability. A refusal caused by these options SHALL be reported like any other refusal.

#### Scenario: Autostash configured
- **WHEN** the user's configuration sets `merge.autoStash=true`, `src/app.ts` has an uncommitted edit and an incoming
  commit changes `src/app.ts`
- **THEN** the pull is refused listing `src/app.ts` as local work, the edit and the index are unchanged, there are no
  conflict markers, and `git stash list` is empty

#### Scenario: Prune configured
- **WHEN** the repository sets `fetch.prune=true` and `remote.origin.prune=true`, and the branch behind
  `origin/feat/old-work` was deleted on the remote
- **THEN** after an automatic fetch and after a pull `refs/remotes/origin/feat/old-work` still exists

#### Scenario: Hook on fetch
- **WHEN** the repository has an executable `reference-transaction` hook and an automatic fetch moves `origin/main`
- **THEN** `origin/main` moved and the hook did not run

#### Scenario: Hook on Resolve and pull
- **WHEN** the repository has an executable `post-index-change` hook and the user confirms Resolve and pull for a staged
  leftover
- **THEN** the leftover is removed from the index, the checkout is fast-forwarded, and the hook did not run

### Requirement: Blocking files are classified from a project in a subfolder
For a project in a subfolder of its git repository, the blocking files SHALL be determined, classified, copied, removed
and put back by their paths relative to the repository's top level, read and addressed the same way by every git command
and file operation involved, so that the file that is judged is the file that is touched. A path SHALL be a change
leftover candidate only when it lies in the project's own `openspec/changes/<name>/`; any other blocking path, inside or
outside the project, SHALL be local work. Blocking files SHALL be shown relative to the top level, which for a project at
the top level is unchanged.

#### Scenario: Leftover in a subfolder project
- **WHEN** the project `/w/acme/monorepo/packages/tools` has a staged `openspec/changes/add-login/.openspec.yaml` that the
  incoming commits add with the same content, and git refuses the fast-forward
- **THEN** `packages/tools/openspec/changes/add-login/.openspec.yaml` is listed as an identical change leftover, Resolve and
  pull is offered, and after confirmation the checkout is fast-forwarded

#### Scenario: Same relative path at the top level
- **WHEN** in that repository both `openspec/changes/add-login/prompt.md` at the top level and
  `packages/tools/openspec/changes/add-login/prompt.md` are staged new files the incoming commits add
- **THEN** for the project `packages/tools` the top-level file is local work, no resolution is offered, and neither file,
  the index nor the branch changes

### Requirement: Pulls and fetches are serialised per git repository
The rule of "An automatic fetch and a pull never overlap" SHALL apply per git repository, identified by its git common
directory, not per project: for several tracked projects in one git repository at most one fetch, pull or Resolve and pull
SHALL run at a time, a pull SHALL wait for an automatic fetch of any of them, a second pull or Resolve and pull SHALL be
refused as already running, and an automatic fetch that finds any of them running SHALL be skipped and retried one
interval later. Each project's automatic-fetch outcome SHALL still be reported with that project.

#### Scenario: Two projects in one repository
- **WHEN** `/w/acme/monorepo/packages/a` and `/w/acme/monorepo/packages/b` are tracked and the user pulls `a` while a pull
  of `b` runs
- **THEN** the pull of `a` is refused as already running and only one fast-forward of the checkout happens

#### Scenario: Automatic fetch of a sibling project
- **WHEN** an automatic fetch of `packages/b` falls due while the user's pull of `packages/a` runs
- **THEN** no second fetch is started, and `b`'s next automatic fetch is one interval later

### Requirement: The blocked-pull list stays open while Resolve and pull runs
When the user confirms **Resolve and pull** from the list of blocking files opened beside a repository's Pull control,
the list SHALL stay open while the pull runs, showing the files it was confirmed for with Resolve and pull disabled and
stating that it is running, and SHALL then show the new outcome. It SHALL NOT close because the repository's pull is
running.

#### Scenario: Resolve and pull from the Pull control
- **WHEN** the pull of `demo-ops` was refused over two change leftovers, the user opens the list from the badge and
  confirms Resolve and pull
- **THEN** the list stays open showing "Resolving…" with Resolve and pull disabled, and once the pull finishes it shows
  the outcome, such as the fast-forward and the files replaced
