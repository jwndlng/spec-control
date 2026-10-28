# issue-import Specification

## Purpose

Lets the user pick open GitHub issues of a tracked repository and import each one as a new OpenSpec change, so that
reported bugs and requests flow into the board and every imported change keeps a link to the issue it came from.

## Requirements

### Requirement: Issues are read through the GitHub CLI, read-only
The dashboard SHALL obtain a repository's issues by running the GitHub CLI (`gh`) without a shell, using only
`gh issue list` with JSON output, for open issues only, newest first, up to 100 issues; when that limit is reached the
list SHALL say it is truncated. A tracked repository SHALL be queried only when it is a git repository whose `origin`
remote points to `github.com`, determined exactly as for the pull-request query, and SHALL be addressed by its
`owner/name`. The `gh` process SHALL run with its working directory outside every tracked repository, with prompts
disabled, no standard input and the same timeout as the pull-request query. The dashboard SHALL rely on `gh`'s own
sign-in and MUST NOT read, store, request, log or forward credentials or tokens, and any text it passes to the browser
SHALL have credentials embedded in URLs masked. Each issue SHALL carry its number, title, body, URL, author login,
label names, and when it was opened and last updated. Pull requests SHALL NOT be listed as issues. The dashboard MUST
NOT change anything on GitHub: it MUST NOT comment on, label, assign, close or edit an issue, and MUST NOT run any `gh`
subcommand for issues other than `gh issue list`.

#### Scenario: Listing open issues
- **WHEN** `acme/alpha-infra` has the open issues `#12` and `#15` and the closed issue `#9`
- **THEN** the list holds `#15` then `#12`, each with its title, body, URL, author, labels and dates, and not `#9`

#### Scenario: Truncated
- **WHEN** a repository has 140 open issues
- **THEN** 100 are listed and the list says it is truncated

#### Scenario: Nothing changes on GitHub
- **WHEN** the user lists a repository's issues and imports three of them
- **THEN** the only `gh` subcommand started for issues is `gh issue list`, none of them in a tracked repository's
  directory, and the issues on GitHub are unchanged

### Requirement: Issues are fetched only when the user asks
The issue query SHALL run only when the user opens the **Import from issues** dialog of a repository and when the user
activates that dialog's **Refresh** control, for that repository alone. It MUST NOT run on a timer, during or after a
scan, on page load, from the projects overview, the Pull requests view or any other view, or as a side effect of
another operation, including importing. While a query for a repository runs, a second request for the same repository
SHALL wait for and receive the running query's result rather than start another `gh` process. The fetched list SHALL be
kept in memory only, for display in the dialog: it MUST NOT be written to disk and MUST NOT be an input to scanning,
columns, counts, the activity log or any action.

#### Scenario: Opening the dialog
- **WHEN** the user activates **Import from issues** on `alpha-infra`'s board
- **THEN** one `gh issue list` runs for `acme/alpha-infra` and its result is shown

#### Scenario: Board and scans stay offline
- **WHEN** a board stays open for an hour while scans run on the poll interval and the dialog is never opened
- **THEN** no `gh issue list` process is started

#### Scenario: Refresh
- **WHEN** the dialog is open and the user activates **Refresh**
- **THEN** the repository's issues are queried again and the list is replaced when the query completes

### Requirement: Unavailable and failed issue queries are reported
A repository that cannot be queried SHALL be reported in the dialog with a reason, without an error being raised and
without a `gh` process being started where none is needed: a repository that is not a git repository or has no
`origin` on `github.com` ("not on GitHub"), a machine without `gh` ("GitHub CLI not installed"), and `gh` not signed
in to `github.com` (the reason SHALL name `gh auth login`). A query that fails for another reason, including a timeout,
SHALL be reported as failed with the reason. In each of these cases the dialog SHALL offer nothing to import and SHALL
write nothing.

#### Scenario: Repository on another host
- **WHEN** the user opens **Import from issues** for a repository whose `origin` is on `gitlab.example.test`
- **THEN** the dialog says the repository is not on GitHub and no `gh` process is started

#### Scenario: gh not signed in
- **WHEN** `gh` is installed but not signed in
- **THEN** the dialog explains that `gh auth login` is needed and offers nothing to import

#### Scenario: Timeout
- **WHEN** `gh issue list` does not finish within the timeout
- **THEN** the process is stopped and the dialog reports the query as failed with that reason

### Requirement: The repository board offers Import from issues
The repository board header SHALL offer **Import from issues** for every repository that is eligible for a new change
as the `change-creation` capability defines it and is a git repository, and SHALL NOT offer it otherwise; whether the
repository is on GitHub is reported by the dialog, as "Unavailable and failed issue queries are reported" specifies.
Activating it SHALL open a dialog over the page, closing on Escape, a click on the backdrop, its close control and
**Cancel** except while issues are being imported. The dialog SHALL list the fetched issues, each with `#<number>`, its
title as a link that opens the issue on GitHub in a new browser tab, its author, its labels and its age, and a checkbox.
It SHALL offer a text filter matching number, title and labels, applied on the client without contacting GitHub, and
SHALL show when the list was fetched and whether it is truncated. Nothing SHALL be checked when the list is shown.
Opening the dialog, filtering, checking issues and editing names MUST NOT write anything. The dialog MUST work in every
supported theme and MUST NOT make the browser request any host but the dashboard's own API.

#### Scenario: Action on a GitHub repository
- **WHEN** the user opens the board of an eligible repository whose `origin` is `git@github.com:acme/alpha-infra.git`
- **THEN** the header offers **Import from issues**

#### Scenario: No action without git
- **WHEN** the repository is a tracked folder without git
- **THEN** the header does not offer **Import from issues**

#### Scenario: Filtering
- **WHEN** the dialog lists 30 issues and the user types `timeout`
- **THEN** only issues whose number, title or labels contain `timeout`, ignoring case, are listed, and no `gh` process is started

### Requirement: Each selected issue gets a change name
When the user checks an issue, the dialog SHALL propose a change name derived from its title: lower-cased, every run of
characters other than `a`–`z` and `0`–`9` replaced by one `-`, leading and trailing `-` removed, and cut to at most 48
characters at a `-` boundary where one exists; when that leaves nothing, the name SHALL be `issue-<number>`, and when it leaves a name the New change form refuses as reserved, the name SHALL be that name followed by `-<number>`. The name
SHALL be editable per issue and SHALL be validated live exactly as the New change form validates a name. The dialog
SHALL also refuse, as text next to the name, a name that an active or archived change of the repository already uses
or that another checked issue uses. The import action MUST NOT be available while no issue is checked or any checked
issue's name is refused, and SHALL state how many changes it will create.

#### Scenario: Name from the title
- **WHEN** the user checks issue `#42` titled `Retry webhook delivery on 5xx (again!)`
- **THEN** the proposed name is `retry-webhook-delivery-on-5xx-again`

#### Scenario: Title without usable characters
- **WHEN** the user checks issue `#7` titled `???`
- **THEN** the proposed name is `issue-7`

#### Scenario: Name already taken
- **WHEN** the proposed name of a checked issue is `add-audit-trail` and the repository has an archived change `add-audit-trail`
- **THEN** a message next to that name says it is taken and the import action is disabled until the name is changed

#### Scenario: Two issues, one name
- **WHEN** two checked issues propose the same name
- **THEN** both names are refused as duplicates and the import action is disabled

#### Scenario: Title that names the archive
- **WHEN** the user checks issue `#12` titled `Archive`
- **THEN** the proposed name is `archive-12`

#### Scenario: Reserved name typed by hand
- **WHEN** the user changes a checked issue's name to `archive`
- **THEN** a message next to that name says it is reserved and the import action is disabled until it is changed

### Requirement: Importing creates one change per selected issue
On import the dialog SHALL send `POST /api/repos/<id>/changes` once per checked issue, one request at a time, in the
listed order, with `{ name, prompt, issue: { number, title } }`. The prompt SHALL be the issue's title as a heading,
a line naming the issue as `owner/name#<number>` with its URL, and the issue's body as written. Everything the server
does, stages and refuses for each request SHALL be as the `change-creation` capability specifies. A refusal for one
issue MUST NOT stop the requests for the others, and nothing created SHALL be removed because another request was
refused. While the requests run the dialog SHALL show which issue is in progress and SHALL NOT close. When every
request has finished the dialog SHALL show one result per issue — created, with whether it was staged, or refused, with
the server's reason — and the board SHALL be refreshed once so every created change appears without a page reload.

#### Scenario: Importing two issues
- **WHEN** the user checks `#12` and `#15` of `acme/alpha-infra` and imports them
- **THEN** two create requests are sent, one after the other, each carrying its issue, both results say created, and
  both changes appear in the `Backlog` column after the refresh

#### Scenario: Prompt content
- **WHEN** issue `#42` titled `Retry webhook delivery` with the body `Deliveries fail on 503.` is imported
- **THEN** the new change's `prompt.md` contains `Retry webhook delivery`, `acme/alpha-infra#42` with the issue's URL,
  and `Deliveries fail on 503.`

#### Scenario: One import refused
- **WHEN** one of two checked issues is refused because a change with its name was created in the meantime
- **THEN** the other change is created and kept, and the refused issue's result shows the reason

### Requirement: A change records the issue it was imported from
A change imported from an issue SHALL hold a file `issue.yaml` at the top level of its change directory, recording the
GitHub repository as `owner/name`, the issue number and the issue title at the time of import, under a one-line comment
saying what the file means. `issue.yaml` is not a schema artifact and MUST NOT count towards a change's artifact status.
The scanner SHALL read `issue.yaml` for active and archived changes, from the same checkout it reads the change from,
and report it in the change's snapshot as the change's **source issue**. A file that is missing, not a regular file,
not valid YAML, larger than 16 KiB, or without a well-formed `owner/name` and a positive integer number SHALL leave the
change without a source issue and SHALL NOT fail the scan. The issue's URL SHALL be derived as
`https://github.com/<owner>/<name>/issues/<number>` and never read from the file. The source issue is display
information only: it MUST NOT affect a change's column, sub-state, progress, counts, filters or available actions.

#### Scenario: Imported change
- **WHEN** `openspec/changes/retry-webhooks/issue.yaml` records `acme/alpha-infra` and number `42`
- **THEN** the change's snapshot reports source issue `acme/alpha-infra#42` with the URL `https://github.com/acme/alpha-infra/issues/42`

#### Scenario: Malformed file
- **WHEN** a change's `issue.yaml` records the number `-3` or is not valid YAML
- **THEN** the change has no source issue and the repository's scan succeeds

#### Scenario: Not an artifact
- **WHEN** a change holds only `.openspec.yaml`, `prompt.md` and `issue.yaml`
- **THEN** its column and artifact status are the same as without `issue.yaml`

### Requirement: The source issue is shown and already-imported issues are marked
A change with a source issue SHALL show it on its card and in its detail header as `#<number>` linking to the issue on
GitHub in a new browser tab, with the repository and title in its tooltip. In the Import from issues dialog an issue
SHALL be marked as imported when an active or archived change of that repository has it as its source issue — same
`owner/name` and number — naming that change; an imported issue SHALL NOT be checkable, so it is not imported twice.
Marking is derived from the latest snapshot and the fetched list on display and is never stored.

#### Scenario: Card link
- **WHEN** change `retry-webhooks` has source issue `acme/alpha-infra#42`
- **THEN** its card shows `#42` linking to `https://github.com/acme/alpha-infra/issues/42`

#### Scenario: Already imported
- **WHEN** the dialog lists issue `#42` and the archived change `retry-webhooks` has source issue `acme/alpha-infra#42`
- **THEN** `#42` is marked as imported as `retry-webhooks` and cannot be checked

#### Scenario: Demo
- **WHEN** the demo's Import from issues dialog is opened
- **THEN** it lists invented sample issues and starts no process
