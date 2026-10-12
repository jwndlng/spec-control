# Spec Delta

## MODIFIED Requirements

### Requirement: Add from GitHub is offered on the overview and in setup

The projects overview SHALL offer **Add from GitHub** in its header band's action area and, while no repository is
tracked, in its "No repositories tracked yet" empty state; the setup wizard's Workspace step SHALL offer the same
choice as specified in the `setup-wizard` capability. Activating it SHALL open a dialog with two parts. The first is the
repository list described below, one row per repository with a checkbox, its `owner/name`, a badge for each of
private, archived and already added, its description on a line of its own and when it was last pushed, followed by a
field to type a repository. The second is a **To clone** panel listing every repository chosen, from the list or typed,
in the order they were chosen, each with its folder name — which defaults to the repository's name and can be edited —
the full path it will be cloned into, and a control to remove it from the choice; it SHALL say so while nothing is
chosen. The user picks the workspace root to clone into, preselected when exactly one is configured. The dialog SHALL
be confirmed with **Clone**, which names how many repositories it starts. Nothing SHALL be cloned before the user
confirms. In the overview, once every chosen clone has been accepted, the dialog SHALL close by itself and the overview
SHALL say, for a few seconds and to assistive technology, how many repositories are being cloned and that they are
listed under Unmanaged projects; a refused repository SHALL keep the dialog open with its reason on its row in the
**To clone** panel, the accepted ones removed from it. The action SHALL be unavailable, with the reason stated in its
tooltip and accessible name, when no workspace root is configured or when `git` was not found on this machine. It SHALL
NOT depend on agent sessions being on.

#### Scenario: Offered in the band
- **WHEN** the user opens the projects overview with one workspace root configured
- **THEN** **Add from GitHub** stands in the header band's action area next to **New project**, active

#### Scenario: Target shown
- **WHEN** the only workspace root is `/w/acme` and the user chooses `jdoe/beta-soc`
- **THEN** the **To clone** panel lists `jdoe/beta-soc` with the folder name `beta-soc` and the path `/w/acme/beta-soc`

#### Scenario: Rows of the list
- **WHEN** the list holds the private, archived repository `jdoe/demo-ops` described as "Operations" and last pushed three days ago
- **THEN** its row shows `jdoe/demo-ops`, the badges `private` and `archived`, "Operations" on its own line and "pushed 3d ago"

#### Scenario: Clone closes the dialog
- **WHEN** the user chooses `acme/beta-soc` and `acme/chat-groups` on the overview and activates **Clone 2**
- **THEN** the dialog closes, the overview says that 2 repositories are being cloned and can be followed under Unmanaged projects, and both are listed there

#### Scenario: A refusal keeps the dialog open
- **WHEN** the user activates **Clone 2** and the folder of `acme/chat-groups` already exists
- **THEN** the dialog stays open, its **To clone** panel lists only `acme/chat-groups` with the reason, and `acme/beta-soc` is being cloned

#### Scenario: No workspace root
- **WHEN** no workspace root is configured
- **THEN** **Add from GitHub** is inactive on the overview and its reason says to add a workspace root in Settings

#### Scenario: git missing
- **WHEN** `git` is not found on this machine
- **THEN** **Add from GitHub** is inactive and its reason says that git was not found

#### Scenario: Closing without confirming
- **WHEN** the user chooses two repositories in the dialog and closes it without activating **Clone**
- **THEN** no process was started for a clone, no folder was created and the configuration is unchanged

### Requirement: A repository is cloned with git, without prompts or hooks

On the user's confirmation the dashboard SHALL create the target folder with an exclusive, non-recursive create, so that
a folder that appeared in the meantime is refused rather than reused, and SHALL then run `git clone` from
`https://github.com/<owner>/<name>.git` into it. The clone SHALL be a full clone, with `origin` as the remote name,
without submodules, without running any hook and without automatic maintenance, so that no later read of it needs the
network. It SHALL rely on git's own credential handling under the pull action's rules (`repository-pull` capability):
no terminal prompt, SSH in batch mode, credentials never read, stored or forwarded, and credentials in any text returned
masked. While it runs, the dashboard SHALL read git's progress reports as they arrive and keep, for that clone only,
its current phase — connecting, receiving objects, resolving deltas or checking out files — the percentage git reports
for that phase and, when git reports it, the amount received so far; it SHALL keep nothing else of git's output, and the
progress SHALL never be an input to anything but what is shown. When the clone fails or exceeds its timeout of ten
minutes, the dashboard SHALL stop it, SHALL remove the target folder only if it is empty — with a non-recursive remove,
deleting nothing else — and SHALL report the masked reason with, when the folder could not be removed, its path; for an
authentication failure the reason SHALL also say that a private repository needs git credentials for github.com, for
example through `gh auth setup-git`. At most two clones SHALL run at a time; a clone waiting for one of the two is
`queued` and its git has not started. The user SHALL be able to cancel a queued or running clone: a queued one is taken
out of the queue and git never starts; a running one is stopped. Either way the target folder is removed only if it is
empty, with the same non-recursive remove, and the clone is `cancelled`. The dashboard MUST NOT write anything into the
clone itself, add or change a remote, check out another branch or configure anything in it.

#### Scenario: What is on disk after a clone
- **WHEN** the user clones `acme/beta-soc` into `/w/acme/beta-soc`
- **THEN** `/w/acme/beta-soc` is a git repository on the remote's default branch with `origin` set to `https://github.com/acme/beta-soc.git` and its working tree equals that branch, and nothing else under `/w/acme` changed

#### Scenario: Progress while receiving
- **WHEN** git reports that it has received 45% of the objects of `acme/beta-soc`, 12.3 MiB so far
- **THEN** the clone's entry has the phase receiving objects, 45% and 12.3 MiB, and none of git's other output

#### Scenario: Clone fails
- **WHEN** the remote refuses the clone because the repository does not exist or needs credentials
- **THEN** the outcome is `failed` with the masked reason, `/w/acme/beta-soc` does not exist, and the configuration is unchanged

#### Scenario: No prompt
- **WHEN** the repository is private and no credential helper provides credentials
- **THEN** the clone fails with a reason within the timeout, no prompt appears anywhere, and the reason mentions `gh auth setup-git`

#### Scenario: Two clones into the same folder
- **WHEN** two clone requests for `/w/acme/beta-soc` arrive at the same time
- **THEN** exactly one clone is made, the other is refused because the folder exists, and only one folder exists

#### Scenario: Hooks do not run
- **WHEN** the user's git template directory installs a `post-checkout` hook
- **THEN** cloning does not run it

#### Scenario: A third clone waits
- **WHEN** two clones are running and the user starts a third
- **THEN** the third is `queued`, its folder exists and is empty, and its git starts once one of the two has finished

#### Scenario: Cancelling a running clone
- **WHEN** the user cancels the clone of `acme/beta-soc` while it receives objects
- **THEN** git is stopped, `/w/acme/beta-soc` does not exist afterwards, the clone is `cancelled`, the configuration is unchanged, and nothing else under `/w/acme` changed

#### Scenario: Cancelling a queued clone
- **WHEN** the user cancels a `queued` clone
- **THEN** no git process is started for it, its empty folder is removed and it is `cancelled`

### Requirement: Clones run in the background and report their outcome

A clone SHALL go on when the dialog is closed, the setup wizard moves to another step or the page is reloaded. Once a
clone succeeded, a clone holding `openspec/config.yaml` SHALL be added to the configuration with `enabled: true` and
its default name, disambiguated as for any enabled candidate, and a scan SHALL start, without a further action by the
user. A clone without that marker SHALL NOT be added to the configuration; it is a git repository under a workspace
root, so discovery reports it as integratable and it can be integrated as the `repo-integration` capability specifies.
Wherever a clone is shown — the Add from GitHub dialog while open, the setup wizard and the projects overview — it SHALL
be shown with its state in words: `queued`, cloning with a progress bar that shows its phase, its percentage and the
time since it started, tracked, cloned without OpenSpec (with a pointer to **Integrate** under Unmanaged projects),
failed with its reason, or cancelled. A queued or running clone SHALL offer Cancel there; a failed or cancelled one SHALL
offer to retry it and to dismiss its entry. The progress bar SHALL be exposed to assistive technology as a progress
indicator with its phase and percentage, and its value SHALL update at least every two seconds while the clone runs.
While a clone is queued or runs, the projects overview SHALL list it under Unmanaged projects with its `owner/name`,
target path and progress, and a clone that failed or was cancelled since the dashboard started SHALL be listed there,
until it is dismissed or the dashboard restarts. These outcomes and the progress are kept in memory only and are never
an input to scanning, columns, counts or actions.

#### Scenario: An OpenSpec repository
- **WHEN** `acme/beta-soc` holds `openspec/config.yaml` and the user clones it into `/w/acme`
- **THEN** `/w/acme/beta-soc` is tracked as `beta-soc` with `enabled: true` and appears under Managed projects after the scan

#### Scenario: A repository without OpenSpec
- **WHEN** `acme/chat-groups` holds no `openspec/config.yaml` and the user clones it into `/w/acme`
- **THEN** the configuration is unchanged, its entry says it was cloned without OpenSpec, and `/w/acme/chat-groups` is listed under Unmanaged projects labelled `no OpenSpec` with **Integrate**

#### Scenario: Closing the dialog while cloning
- **WHEN** the user activates **Clone** for `acme/beta-soc` and the dialog closes before the clone finished
- **THEN** Unmanaged projects lists `acme/beta-soc` with its progress, and once the clone finished it is under Managed projects without the user acting

#### Scenario: Progress is shown
- **WHEN** a clone of `acme/beta-soc` has been receiving objects for 40 seconds and is at 62%
- **THEN** its entry shows a progress bar at 62% labelled with the phase and "40 s", read by assistive technology as receiving objects, 62 percent

#### Scenario: Retrying a failed clone
- **WHEN** a clone of `acme/beta-soc` failed and the user activates its retry after fixing their credentials
- **THEN** the clone runs again into the same target under the same rules

#### Scenario: Retrying a cancelled clone
- **WHEN** the user cancelled the clone of `acme/beta-soc` and activates its retry
- **THEN** the clone runs again into the same target under the same rules
