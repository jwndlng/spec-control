# change-creation Specification

## Purpose
Lets users start a new OpenSpec change in a tracked repository from that repository's Kanban board or from the combined board — creating the change directory, its schema marker and an optional free-text prompt — without leaving the dashboard.

## Requirements

### Requirement: The repository board offers a "New change" action
The repository board header SHALL offer a "New change" action that opens a form with two fields: a change name and an optional free-text prompt. The combined board SHALL offer a "New change" action as well, opening the same form with a third field, a project dropdown, as specified in the "The combined board's form asks for the project" requirement. Activating either action MUST NOT write anything. A repository is **eligible** for a new change when it is enabled, its last scan succeeded and it has an `openspec/changes/` parent to create into. The repository header SHALL show the action for every eligible repository and SHALL NOT show it for a repository that is not eligible. The combined board SHALL show the action when at least one tracked repository is eligible and SHALL NOT show it when none is.

#### Scenario: Action on the header
- **WHEN** a user opens the board for an enabled, successfully scanned repository
- **THEN** the header shows a "New change" action

#### Scenario: Failed scan
- **WHEN** the repository's last scan failed
- **THEN** the header does not show the "New change" action

#### Scenario: No openspec directory
- **WHEN** the repository has no `openspec/changes/` parent (its `openspec/` directory is missing)
- **THEN** the header does not show the "New change" action

#### Scenario: Action on the combined board
- **WHEN** a user opens the combined board and at least one tracked repository is eligible
- **THEN** the board shows a "New change" action, and activating it opens the form without writing anything

#### Scenario: No eligible repository
- **WHEN** every tracked repository's last scan failed
- **THEN** the combined board does not show the "New change" action

### Requirement: The form takes the keyboard focus once
When the "New change" form opens, the keyboard focus SHALL move to the first field the user has to fill: the project dropdown when the form has one and no project is pre-selected, otherwise the change name field. From then on, for as long as that form stays open, the form MUST NOT move the keyboard focus: choosing a project, typing in either text field, the change name's live validation, a failed submission and any re-render of the board around the open form — a background poll, for example — SHALL leave the focus, the selection and the caret exactly where the user put them. Closing the form and opening it again SHALL apply the same rule again.

#### Scenario: Focus on open
- **WHEN** the user activates the "New change" action on a repository header
- **THEN** the keyboard focus is in the change name field, so the name can be typed without clicking

#### Scenario: Focus on open with a project to choose
- **WHEN** the user activates the "New change" action on the combined board and no project is pre-selected
- **THEN** the keyboard focus is on the project dropdown

#### Scenario: Focus on open with a pre-selected project
- **WHEN** the user activates the "New change" action on the combined board and a project is pre-selected
- **THEN** the keyboard focus is in the change name field

#### Scenario: Choosing a project keeps the focus
- **WHEN** the focus is on the project dropdown and the user chooses `alpha-infra`
- **THEN** the focus stays on the project dropdown

#### Scenario: Typing in the prompt field
- **WHEN** the user clicks into the prompt field and types "Log every mutation"
- **THEN** every character reaches the prompt field and the focus stays there

#### Scenario: The board refreshes while the form is open
- **WHEN** the board re-renders while the form is open and the focus is in the prompt field
- **THEN** the focus is still in the prompt field and the caret has not moved

#### Scenario: Reopening the form
- **WHEN** the user closes the form and activates the same "New change" action again
- **THEN** the keyboard focus is again on the first field the user has to fill

### Requirement: The form validates the change name live
The form SHALL validate the change name against the new-change-name rule of "Reserved and unusable change names are refused" — the same rule the server enforces — refuse an empty or whitespace-only value, and MUST NOT allow submission while the value is invalid. The refusal reason SHALL be presented as text, next to the field.

#### Scenario: Invalid character
- **WHEN** the user types `foo/bar` into the change name field
- **THEN** the submit action is disabled and a message names the allowed characters

#### Scenario: Empty name
- **WHEN** the user clears the change name field
- **THEN** the submit action is disabled and a message says the name is required

#### Scenario: Valid name
- **WHEN** the user types `add-audit-trail`
- **THEN** no error is shown and the submit action is enabled

#### Scenario: Reserved name
- **WHEN** the user types `archive` or `Archive` into the change name field
- **THEN** the submit action is disabled and a message says the name is reserved for archived changes

#### Scenario: Leading dot or dash
- **WHEN** the user types `.git` or `-wip`
- **THEN** the submit action is disabled and a message says a name must not start with `.` or `-`

### Requirement: Submitting the form creates the change directory
On submit the dashboard SHALL send `POST /api/repos/<id>/changes` with `{ name, prompt?, dependsOn?, issue? }` and, on success, close the form. The server SHALL create `openspec/changes/<name>/` in the repository, atomically (exclusive create so two concurrent requests cannot both succeed), and SHALL write into it:
- `.openspec.yaml` — a marker with `schema:` taken from the repository's `openspec/config.yaml` (falling back to `spec-driven` when the repository has no `schema` set) and `created:` set to today's date in the server's local time zone. This is the same marker that `openspec new change` writes; the dashboard writes it directly and MUST NOT invoke the `openspec` CLI or any other external command for it.
- `prompt.md` — only when a non-empty prompt was submitted, containing the text as written under a short fixed heading. The heading SHALL be `# Prompt`. `prompt.md` is not a schema artifact and does not affect the change's artifact status.
- `depends-on.yaml` — only when at least one dependency was submitted, holding a `depends_on:` list of the submitted change names in the order given, under a one-line comment saying what the file means. It is the file the change-dependencies capability reads; it is not a schema artifact either.
- `issue.yaml` — only when the request carries the issue the change is imported from (`issue: { number, title }`, sent by the Import from issues dialog of the `issue-import` capability, never by the New change form), recording the repository's GitHub `owner/name` as the server derives it from the repository's `origin` remote — never taken from the request — the issue number and its title, under a one-line comment saying what the file means. It is the file the `issue-import` capability reads; it is not a schema artifact either.

Once every one of these writes has succeeded, and only then, the dashboard SHALL stage the new directory in the repository's index so that git tracks the change from the moment it exists, as specified in the "Creating a change stages the new directory" requirement.

After a successful create the repository SHALL be rescanned and the new change SHALL appear on the board without a page reload. The response SHALL be `201` with `{ name, staged }`, where `staged` says whether the new directory was staged.

#### Scenario: Create without prompt
- **WHEN** the user submits `add-audit-trail` with no prompt
- **THEN** `openspec/changes/add-audit-trail/` exists with a `.openspec.yaml` and no `prompt.md`, and the change appears in the `Backlog` column after the rescan

#### Scenario: Create with prompt
- **WHEN** the user submits `add-audit-trail` with the prompt "Log every mutation to the audit table"
- **THEN** the change directory contains `.openspec.yaml` and `prompt.md` starting with `# Prompt` followed by the text as written

#### Scenario: Schema from the repository's config
- **WHEN** the repository's `openspec/config.yaml` sets `schema: alpha` and the user submits `add-audit-trail`
- **THEN** the new `.openspec.yaml` sets `schema: alpha`

#### Scenario: Default schema
- **WHEN** the repository's `openspec/config.yaml` has no `schema` key and the user submits `add-audit-trail`
- **THEN** the new `.openspec.yaml` sets `schema: spec-driven`

#### Scenario: Staging is reported
- **WHEN** the user submits `add-audit-trail` into a git repository and the directory is staged
- **THEN** the `201` body reports `staged` as true

#### Scenario: Create with dependencies
- **WHEN** the user submits `add-billing-ui` with the dependencies `add-billing-schema` and `add-billing-api`
- **THEN** the change directory contains `.openspec.yaml` and a `depends-on.yaml` whose `depends_on` lists `add-billing-schema` then `add-billing-api`, and after the rescan the change reports both dependencies

#### Scenario: Create from an issue
- **WHEN** the request for `retry-webhooks` carries `issue: { number: 42, title: "Retry webhook delivery" }` and the repository's `origin` is `git@github.com:acme/alpha-infra.git`
- **THEN** the change directory contains `.openspec.yaml`, `prompt.md` and an `issue.yaml` recording `acme/alpha-infra`, `42` and `Retry webhook delivery`, and after the rescan the change reports that source issue

#### Scenario: Create without dependencies writes no file
- **WHEN** the user submits `add-audit-trail` without picking a dependency
- **THEN** the change directory has no `depends-on.yaml` and no `issue.yaml`

### Requirement: Creation is refused with a reason
The server SHALL refuse `POST /api/repos/<id>/changes` without touching the disk when: the name is not a valid change name (`400`); the request carries an `issue` whose `number` is not a positive integer or whose `title` is not a string of at most 256 characters (`400`); the request carries an `issue` and the repository's `origin` remote is not on `github.com` (`409`); a change with that name already exists at `openspec/changes/<name>/`, active or under `openspec/changes/archive/YYYY-MM-DD-<name>/` (`409`); the repository is not an enabled, successfully scanned repository from the config (`409`); or the repository has no `openspec/changes/` parent directory to create into (`409`). The response body SHALL name the reason as text. The refusal MUST leave the repository untouched — no directory, file, git command or `openspec` invocation.

#### Scenario: Duplicate active name
- **WHEN** a change `add-audit-trail` already exists in `openspec/changes/`
- **THEN** the response is `409` with a message naming the clash, and no new directory is created

#### Scenario: Duplicate archived name
- **WHEN** an archived change `openspec/changes/archive/2026-08-12-add-audit-trail/` exists
- **THEN** the response is `409` with a message naming the archived clash, and no new directory is created

#### Scenario: Unknown repository
- **WHEN** the id does not match a configured repository
- **THEN** the response is `404` and nothing is written

#### Scenario: Disabled or failed repository
- **WHEN** the repository is disabled in the config, or its last scan failed
- **THEN** the response is `409` and nothing is written

#### Scenario: No openspec directory
- **WHEN** the repository has no `openspec/` directory to create into
- **THEN** the response is `409` and nothing is written

#### Scenario: Issue for a repository off GitHub
- **WHEN** the request carries an `issue` and the repository's `origin` is on `gitlab.example.test` or it has no `origin`
- **THEN** the response is `409` with a message saying the repository is not on GitHub, and nothing is written

#### Scenario: Invalid issue
- **WHEN** the request carries `issue: { number: 0 }` or `issue: { number: "42" }`
- **THEN** the response is `400` and nothing is written

#### Scenario: Concurrent creates
- **WHEN** two `POST /api/repos/<id>/changes` requests for the same name arrive at once
- **THEN** exactly one succeeds with `201` and the other returns `409` with a message naming the clash

### Requirement: Creating a change stages the new directory
After `.openspec.yaml` and any `prompt.md`, `depends-on.yaml` and `issue.yaml` have been written, the dashboard SHALL stage the new change directory by invoking git exactly once, as `git add -- openspec/changes/<name>/`, run in the repository the change was created in, with terminal prompting disabled and optional locks disabled. The path passed after `--` SHALL be the directory the dashboard has just created and nothing else, so that files the user had already modified or left untracked elsewhere in the repository are not staged.

That invocation is the only git command creating a change may run and the only write the dashboard makes outside the new directory. Creating a change MUST NOT commit, push, stash, reset, switch a branch, create or delete a ref, contact a remote or run a repository hook, and MUST NOT invoke the `openspec` CLI or any other external command. Reading the `origin` remote to learn the GitHub repository for `issue.yaml` SHALL use only the read-only `git config --get`, and SHALL happen before anything is written.

Staging is best-effort: the change already exists on disk, so if git is unavailable, the repository is not a git repository, its index is locked, git exits non-zero or the invocation times out, the dashboard SHALL leave the change in place and still answer `201`, reporting `staged` as false. Nothing about the change's validity, its column or its appearance on the board depends on whether it was staged. Git MUST NOT be invoked at all for a create that is refused, except the read-only `git config --get remote.origin.url` of a create that carries an issue.

#### Scenario: The new change is tracked
- **WHEN** a change `add-audit-trail` is created in a git repository
- **THEN** `git status` reports `openspec/changes/add-audit-trail/.openspec.yaml` as an added, staged path rather than as untracked

#### Scenario: Only the new directory is staged
- **WHEN** a change is created in a repository that already has an unrelated modified file and an unrelated untracked file
- **THEN** those two files are left exactly as they were — neither is staged — and only the new change directory's files are added to the index

#### Scenario: Nothing is committed
- **WHEN** a change is created in a git repository
- **THEN** `HEAD`, the checked-out branch and every ref are unchanged, no commit is created and no remote is contacted

#### Scenario: Not a git repository
- **WHEN** a change is created in a repository that is not a git repository
- **THEN** the response is `201` with `staged` false, the change directory and its files exist, and the change appears on the board

#### Scenario: Staging fails
- **WHEN** the new directory is written but the `git add` fails or times out
- **THEN** the response is still `201`, with `staged` false, and the change directory and its files are left in place

#### Scenario: A refused create runs no git
- **WHEN** `POST /api/repos/<id>/changes` is refused for any reason
- **THEN** no git command is run for that repository — apart from reading `remote.origin.url` for a create that carries an issue — and its index is byte-for-byte unchanged

#### Scenario: Dependencies are staged with the change
- **WHEN** a change is created in a git repository with dependencies
- **THEN** `git status` reports its `.openspec.yaml` and `depends-on.yaml` as added, staged paths, and the single `git add` is the only git command run

#### Scenario: The source issue is staged with the change
- **WHEN** a change is created from an issue in a git repository
- **THEN** `git status` reports its `.openspec.yaml`, `prompt.md` and `issue.yaml` as added, staged paths, and no git command that writes other than the single `git add` was run

### Requirement: The combined board's form asks for the project
The form opened from the combined board SHALL show a project dropdown before the change name. The dropdown SHALL list, by repository name, every eligible repository and no other, in the order the board lists repositories. It SHALL be pre-selected when the choice is unambiguous: when exactly one repository is eligible, or when the board's repository filter selects exactly one eligible repository. Otherwise it SHALL start on an empty "Choose a project" entry, and the form MUST NOT allow submission until a project is chosen, saying so as text next to the dropdown. On submit the form SHALL send `POST /api/repos/<id>/changes` for the chosen repository, exactly as the repository header's form does; everything the server does and refuses is unchanged. A refusal SHALL be shown in the form as it is for the header's form, with the chosen project kept. If the chosen repository stops being eligible while the form is open, the form SHALL clear the choice rather than submit to it.

#### Scenario: Only eligible repositories are offered
- **WHEN** `alpha-infra` and `beta-soc` are eligible and `gamma-web`'s last scan failed
- **THEN** the dropdown offers `alpha-infra` and `beta-soc` and not `gamma-web`

#### Scenario: Nothing pre-selected with several projects
- **WHEN** two repositories are eligible and the repository filter is empty
- **THEN** the dropdown shows "Choose a project", the submit action is disabled, and a message says a project is required

#### Scenario: Pre-selected from the repository filter
- **WHEN** the repository filter selects only `beta-soc` and the user activates "New change"
- **THEN** the dropdown is pre-selected on `beta-soc`

#### Scenario: Pre-selected when only one is eligible
- **WHEN** `alpha-infra` is the only eligible repository
- **THEN** the dropdown is pre-selected on `alpha-infra`

#### Scenario: Create in the chosen project
- **WHEN** the user chooses `beta-soc`, types `add-audit-trail` and submits
- **THEN** `POST /api/repos/<beta-soc id>/changes` is sent with `{ "name": "add-audit-trail" }`, the form closes, and after the rescan the change appears in `beta-soc`'s group of the `Backlog` column without a page reload

#### Scenario: Refusal keeps the choice
- **WHEN** the user submits `add-audit-trail` into `beta-soc` and a change with that name already exists there
- **THEN** the form stays open, shows the message naming the clash, and `beta-soc` is still chosen

### Requirement: The form opens as a dialog
The New change form SHALL open as a dialog over the page, like the change detail view: a titled panel on a dimmed backdrop, naming where the change will be created (`<repository>/openspec/changes/<name>/`, or `openspec/changes/<name>/` while no project is chosen), never as a strip across the page. The dialog SHALL close on Escape, on a click on the backdrop, with its close control and with **Cancel**, and none of these SHALL close it while the change is being created. Everything the other requirements of this capability say about the form — its fields, validation, focus, refusal and staging — SHALL be unchanged.

#### Scenario: Opening
- **WHEN** the user activates **New change** on the board of `alpha-infra`
- **THEN** a dialog titled `New change` opens over the dimmed board, naming `alpha-infra/openspec/changes/<name>/`, with the change name field focused

#### Scenario: Escape
- **WHEN** the dialog is open and nothing is being created and the user presses Escape
- **THEN** the dialog closes and nothing has been written

#### Scenario: Creating
- **WHEN** the user submits and the request is still running
- **THEN** Escape and a click on the backdrop leave the dialog open until the request finishes

### Requirement: The combined board's form can target repositories by label
The form opened from the combined board SHALL offer two ways to choose where the change is created: **One project**,
the project dropdown specified in "The combined board's form asks for the project", and **By label**. One project SHALL
be the default. In By label mode the form SHALL offer every label displayed on at least one tracked repository, ignoring
case, as the project-labels capability defines displayed labels, and SHALL let the user select one or more of them.
The form SHALL then list every tracked repository that displays all selected labels, ignoring case, in the order the
board lists repositories, each with a checkbox. An eligible repository's checkbox SHALL start checked; a repository that
is not eligible SHALL be listed without a usable checkbox and with the reason it is skipped as text. The form MUST NOT
allow submission while no label is selected or no repository is checked, saying which as text, and SHALL state on the
submit action how many repositories the change will be created in. The change name and prompt fields, their live
validation and the focus rule SHALL be the same as in One project mode. Switching mode, selecting labels or checking
repositories MUST NOT write anything.

#### Scenario: Repositories carrying the label are listed
- **WHEN** `alpha-infra` and `demo-ops` display `terraform`, `beta-soc` does not, and the user selects `terraform` in By label mode
- **THEN** the form lists `alpha-infra` and `demo-ops`, both checked, and not `beta-soc`, and the submit action says `Create in 2 projects`

#### Scenario: Several labels combine with AND
- **WHEN** the user selects `terraform` and `client` and only `alpha-infra` displays both
- **THEN** only `alpha-infra` is listed

#### Scenario: A repository that cannot take the change
- **WHEN** `gamma-web` displays `terraform` and its last scan failed
- **THEN** `gamma-web` is listed unchecked with a reason saying its last scan failed, and it cannot be checked

#### Scenario: Unchecking a repository
- **WHEN** `alpha-infra` and `demo-ops` are listed and the user unchecks `demo-ops`
- **THEN** the submit action says `Create in 1 project`

#### Scenario: Nothing to create into
- **WHEN** the user is in By label mode and has selected no label, or has unchecked every listed repository
- **THEN** the submit action is disabled and a message says what is missing

### Requirement: Creating by label creates the change in every checked repository
On submit in By label mode the form SHALL send `POST /api/repos/<id>/changes` with the same `{ name, prompt? }` once for
each checked repository, one request at a time, in the listed order — exactly the request the One project mode sends,
so everything the server does, stages and refuses for each repository is unchanged. A refusal for one repository MUST
NOT stop the requests for the others, and nothing created SHALL be removed because another repository refused. While
the requests run the form SHALL show which repository is in progress and SHALL NOT close by Escape, a click on the
backdrop, its close control or **Cancel**. When every request has finished the form SHALL stay open and show one result
per repository: created, with whether it was staged, or refused, with the server's reason as text. The board SHALL be
refreshed once all requests have finished, so every created change appears without a page reload. Closing the form
after that SHALL NOT send anything.

#### Scenario: Created in every repository
- **WHEN** `alpha-infra` and `demo-ops` are checked and the user submits `bump-terraform-1-9` with the prompt "Bump the required Terraform version to 1.9"
- **THEN** one `POST /api/repos/<alpha-infra id>/changes` and then one `POST /api/repos/<demo-ops id>/changes` are sent, each with `{ "name": "bump-terraform-1-9", "prompt": "Bump the required Terraform version to 1.9" }`, both results say created, and both changes appear in the `Backlog` column after the refresh

#### Scenario: One repository refuses
- **WHEN** `demo-ops` already has a change `bump-terraform-1-9` and the user creates it by label in `alpha-infra` and `demo-ops`
- **THEN** `alpha-infra`'s result says created, `demo-ops`'s result shows the message naming the clash, and the change in `alpha-infra` is kept

#### Scenario: Not staged
- **WHEN** one of the checked repositories is not a git repository
- **THEN** its result says created and not staged

#### Scenario: Busy while creating
- **WHEN** the requests are still running and the user presses Escape
- **THEN** the form stays open until every request has finished

### Requirement: The projects overview offers a new change for its label filter
While the projects overview's label filter holds at least one label and at least one listed repository is eligible,
the overview SHALL offer **New change in these projects**. Activating it SHALL open the New change dialog in By label
mode with the filter's labels selected, listing the repositories as the "The combined board's form can target
repositories by label" requirement specifies, and MUST NOT write anything. Everything that form does on submit SHALL be
as the "Creating by label creates the change in every checked repository" requirement specifies. The action SHALL NOT
be shown while the label filter is empty.

#### Scenario: Opening from the filter
- **WHEN** the overview is filtered by `terraform` and lists `alpha-infra` and `demo-ops`, and the user activates **New change in these projects**
- **THEN** the New change dialog opens in By label mode with `terraform` selected and `alpha-infra` and `demo-ops` checked, and nothing has been written

#### Scenario: No label filter
- **WHEN** the overview's label filter is empty
- **THEN** the overview does not show **New change in these projects**

### Requirement: The form can declare the change's dependencies
When the form targets exactly one repository — the repository header's form, or the combined board's form once a
project is chosen — it SHALL offer an optional **Depends on** field: a multi-select of that repository's active
changes as the latest snapshot reports them, by name, sorted by name, each with its column. Each choice SHALL be shown
as one row: its checkbox, then its name, then its column, on one line, the column at the row's end; a name too long for
the row MAY wrap within itself, but the checkbox, the name and the column MUST NOT be stacked under each other.
Activating the name or the column SHALL toggle the choice's checkbox. Nothing SHALL be selected
when the form opens. Changing the chosen project SHALL clear the selection. When the form targets repositories by label
(several repositories at once), it SHALL NOT offer the field and SHALL send no dependencies. The selected names SHALL be
sent as `dependsOn` in the order the user selected them; with nothing selected the form SHALL send no `dependsOn`.
Selecting dependencies MUST NOT write anything before submit, and MUST NOT change the existing changes in any way: the
new change declares what it waits for, the changes it names are left as they are.

#### Scenario: Picking dependencies
- **WHEN** the user opens **New change** on `alpha-infra`'s board, types `add-billing-ui` and selects `add-billing-schema` and `add-billing-api`
- **THEN** the form sends `{ "name": "add-billing-ui", "dependsOn": ["add-billing-schema", "add-billing-api"] }`

#### Scenario: One line per choice
- **WHEN** the **Depends on** field offers `add-billing-api`, in the column `Ready`
- **THEN** its checkbox, the name `add-billing-api` and `Ready` appear on one line, `Ready` at the end of the row, and clicking the name checks the box

#### Scenario: Only active changes are offered
- **WHEN** `alpha-infra` has the active changes `add-billing-schema` and `add-billing-api` and the archived change `add-audit-log`
- **THEN** the **Depends on** field offers `add-billing-api` and `add-billing-schema`, and not `add-audit-log`

#### Scenario: The project changes
- **WHEN** on the combined board the user chose `alpha-infra`, selected `add-billing-schema`, then chooses `beta-soc`
- **THEN** the selection is empty and the field offers `beta-soc`'s active changes

#### Scenario: Label targeting
- **WHEN** the form targets every repository carrying the label `billing`
- **THEN** the form offers no **Depends on** field and sends no `dependsOn`

#### Scenario: No active changes
- **WHEN** the target repository has no active change
- **THEN** the **Depends on** field says there is nothing to depend on, and the form can still be submitted

### Requirement: Reserved and unusable change names are refused
A name SHALL be accepted for a new change only when it matches `^[A-Za-z0-9._-]+$`, is at most 128 characters long, does
not start with `.` or `-`, does not contain `..`, does not end in `.` or `.lock`, and is not `archive` in any letter case.
This rule SHALL be defined once, shared by the server and the UI, and used by the New change form in every mode, by the
Import from issues dialog and by `POST /api/repos/<id>/changes`, which SHALL refuse any other name with `400` and a
message naming the rule it breaks, without touching the disk — no directory, file, git command or `openspec`
invocation. The rule SHALL apply only to creating a change: a change directory that already exists under another name
matching `^[A-Za-z0-9._-]+$` SHALL still be scanned, shown and acted on as before.

#### Scenario: The archive root is not a change name
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "archive" }` for `demo-ops`, which has no archived
  change and so no `openspec/changes/archive/` yet
- **THEN** the response is `400` with a message saying `archive` is reserved, `openspec/changes/archive/` does not exist
  afterwards, and the repository's index is unchanged

#### Scenario: Letter case does not matter
- **WHEN** the name is `Archive`
- **THEN** the response is `400` and nothing is written

#### Scenario: Names git cannot branch
- **WHEN** the name is `.git`, `-wip`, `a..b`, `notes.` or `notes.lock`
- **THEN** the response is `400` with the rule the name breaks, and nothing is written

#### Scenario: Existing directories keep working
- **WHEN** a repository already has `openspec/changes/.draft/` with a proposal
- **THEN** the board still shows `.draft` and it can still be dismissed
