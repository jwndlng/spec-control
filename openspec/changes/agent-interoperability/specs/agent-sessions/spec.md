# Spec Delta

## ADDED Requirements

### Requirement: Ship commits, pushes and opens a pull request deterministically
For a session whose worktree has status `uncommitted`, `unpushed` or `pushed` the dashboard SHALL offer a **Ship** action that executes deterministically on the server without starting, resuming, or typing into an agent. When Ship is activated (or triggered automatically when a managed `Draft` session on `docs/<change>`, `Archive` session, or `Fast-forward` session exits cleanly after completing its work), the server SHALL:

1. Write `spec-control.branch` (or `spec-control.archive-branch` for an archive session) into the change's `.openspec.yaml` (or archived `.openspec.yaml`) in the session's worktree if not already set to the session's branch.
2. Check with read-only git whether the worktree has uncommitted or untracked changes (`status --porcelain=v1 -z`) and, if so, stage all changes (`git add --all`) and commit them (`git commit --no-verify -m <title>`) in the session's worktree with repository hooks disabled.
3. Push the session's branch to `origin` (`git push --no-verify --set-upstream origin HEAD:refs/heads/<branch>`) with batch SSH and credentials masked.
4. Determine whether an open pull request for `<branch>` already exists in the repository's GitHub repository; if none exists, create one against the repository's default branch via `gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>` and refresh the repository's pull-request cache.

When the session's repository has auto-merge of docs-only pull requests switched on, the server SHALL decide with read-only git in the session's worktree whether the branch ships **only OpenSpec documents**: every path that differs between the base and `HEAD` lies under `openspec/` at the repository root, and at least one such path exists. When that holds, the server SHALL record `autoMergeAskedAt` on the session (and return `autoMergeInstructionIncluded: true`), and the panel SHALL say that, because only OpenSpec documents changed, Spec Control will merge the pull request automatically once its checks pass. An in-place session has no worktree and no branch: it has no work status, Ship MUST NOT be offered for it, and a Ship request for it SHALL be refused.

#### Scenario: Ship commits, pushes and opens a pull request without an agent
- **WHEN** Ship is used on a running or ended session for `rotate-keys` whose worktree on `feat/rotate-keys` has uncommitted files
- **THEN** the server writes `branch: feat/rotate-keys` in `.openspec.yaml`, commits all changes in the worktree, pushes `feat/rotate-keys` to `origin`, opens a pull request via `gh pr create`, refreshes the repository's pull-request cache, and starts or types into no agent process

#### Scenario: Ship when commits are already made and only unpushed
- **WHEN** the agent already committed its changes in the worktree and `.openspec.yaml` already records `branch: feat/rotate-keys`, so the worktree is clean and `unpushed`
- **THEN** Ship creates no extra commit, pushes `feat/rotate-keys` to `origin`, and opens the pull request using the existing commit subject as the default title

#### Scenario: Nothing to ship
- **WHEN** Ship is requested for a session whose worktree is `merged`, `clean` or `missing`
- **THEN** the request is refused and no git write or `gh` command runs

#### Scenario: Ship is not offered without git
- **WHEN** the panel of an in-place session is open
- **THEN** no Ship control is shown, no work status is shown for it, and a Ship request for that session is refused

#### Scenario: Shipping a docs-only branch with auto-merge on
- **WHEN** Ship runs on the archive session of `rotate-keys` in a repository with auto-merge of docs-only pull requests on, and the branch only moves `openspec/changes/rotate-keys/` under `openspec/changes/archive/` and changes `openspec/specs/secrets/spec.md`
- **THEN** the session records `autoMergeAskedAt`, the result states `autoMergeInstructionIncluded: true`, and the panel says the pull request will be merged once its checks pass

#### Scenario: Code in the branch
- **WHEN** Ship runs in a repository with auto-merge on and the branch changes `openspec/changes/rotate-keys/tasks.md` and `src/keys.ts`
- **THEN** the session records no `autoMergeAskedAt` and the result states `autoMergeInstructionIncluded: false`

### Requirement: Merge merges a ready pull request deterministically
For a change session (whether `running` or `exited`) that is not in place and whose branch is the head branch of an **open** pull request in the session's repository's last good pull-request list, the dashboard SHALL offer a **Merge** action while that pull request is ready (`pull-requests`: "A linked open pull request has a readiness") and carries a head commit, whether or not the project has docs auto-merge on. Merge executes directly on the server without starting, resuming, or typing into an agent: it runs `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <commit>` via `runGh`, where `<number>` (a positive integer) and `<commit>` (a 40-character hexadecimal SHA) are taken from the server's pull-request list and never from the browser, and refreshes the repository's pull-request cache. Spec Control MUST NOT pass `--delete-branch` or `--auto`.

A Merge request SHALL be refused when agent sessions are disabled, the session is in place, has no linked open pull request in the last good list, or that pull request is not ready or has no head commit.

#### Scenario: Merging a ready pull request by hand on a running or ended session
- **WHEN** the Implement session of `cache-api-calls` (running or exited) has branch `feat/cache-api-calls` heading open pull request `#41` whose checks pass and which is mergeable at head commit `c0ffee0123456789abcdef0123456789abcdef01`, and the user activates Merge in its panel
- **THEN** the server runs `gh pr merge 41 --repo acme/demo-ops --squash --match-head-commit c0ffee0123456789abcdef0123456789abcdef01`, refreshes the pull-request list, and writes nothing to any agent terminal

#### Scenario: Not ready
- **WHEN** Merge is requested for a session whose pull request's checks are still running
- **THEN** the request is refused and no `gh pr merge` process is started

### Requirement: A ready docs-only pull request is merged automatically by the server
Whenever a pull-request query for a repository completes with a good list — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL, for each change session of that repository (whether `running` or `exited`) that carries the auto-merge record of "A merged auto-merge pull request ends its session", is not in place and did not adopt its worktree, look in that query's result for an open pull request whose head branch is the session's branch, and SHALL merge that pull request directly via `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>` only when **all** of these hold at that moment:

- agent sessions are enabled, the repository has docs auto-merge switched on, and this is not the demo;
- the pull request is open and not a draft, its base branch is the repository's default branch, its mergeability is `mergeable` and its checks are `passing` — checks `none` SHALL NOT count, because a pull request whose checks have not registered yet looks the same;
- the pull request is docs-only (`pull-requests`: "What a pull-request list contains") and carries a head commit;
- when the session's worktree still exists, its checked-out commit is that head commit and the worktree holds only OpenSpec documents under the check Ship makes — decided with read-only git, without contacting a remote, at that moment; a git command that fails counts as not holding;
- no merge was already attempted by the dashboard for this session, pull request and head commit.

Before running `gh pr merge`, the session SHALL record the pull request's number, the head commit and the time (`mergeAsked`), so that a second query completing meanwhile starts no duplicate merge. At most one automatic merge attempt SHALL be made per session, pull request and head commit; a new head commit makes the pull request eligible again. Because the merge runs directly through `gh pr merge` on the server, it works identically whether the session's agent is still running or has already exited, and never starts, resumes, or types into an agent. Sessions started by Fast-forward never carry the record and SHALL never be auto-merged.

#### Scenario: Archive pull request goes green after the agent exited
- **WHEN** `demo-ops` has docs auto-merge on, the archive session of `rotate-keys` carries the auto-merge record, its worktree is at commit `c0ffee0123456789abcdef0123456789abcdef01` with only `openspec/` changes, and a watch refresh lists `#88` from `chore/archive-rotate-keys` open against the default branch, not a draft, mergeable, checks passing, docs-only, head commit `c0ffee0123456789abcdef0123456789abcdef01`
- **THEN** the server records `#88` and `c0ffee0123456789abcdef0123456789abcdef01` on the session and runs `gh pr merge 88 --repo acme/demo-ops --squash --match-head-commit c0ffee0123456789abcdef0123456789abcdef01` without starting or typing into an agent

#### Scenario: No checks at all
- **WHEN** everything holds except that `#88` has no checks
- **THEN** no merge is run and `#88` is shown as ready as before

#### Scenario: A file outside openspec
- **WHEN** everything holds except that `#88` is not docs-only
- **THEN** no merge is run

#### Scenario: Draft, conflict or another base
- **WHEN** everything holds except that `#88` is a draft, or conflicts with its base, or targets a branch other than the default branch
- **THEN** no merge is run

#### Scenario: The worktree is ahead of the pull request
- **WHEN** everything holds except that the worktree's commit is not `#88`'s head commit
- **THEN** no merge is run

#### Scenario: Seen again at the same head commit
- **WHEN** a later refresh lists `#88` still open at the same head commit after a merge for it was already attempted
- **THEN** no second `gh pr merge` is run for that head commit

#### Scenario: A fix was pushed
- **WHEN** a check failed, a fix was pushed, and a later refresh lists `#88` ready again at a new head commit with checks passing
- **THEN** one `gh pr merge` naming the new head commit is run

#### Scenario: Docs auto-merge switched off
- **WHEN** the user switched docs auto-merge off for `demo-ops` after the session recorded `autoMergeAskedAt`, and a refresh lists `#88` ready and docs-only
- **THEN** no merge is run

#### Scenario: Demo
- **WHEN** the demo lists a ready docs-only pull request for a session that carries the record
- **THEN** nothing is run

### Requirement: Spec Control records a change's branch in `.openspec.yaml`
Whenever Spec Control prepares a managed session worktree for a change or executes a deterministic Ship (manual or automatic) in that worktree, the server SHALL record the session's branch directly in the change's `.openspec.yaml` (or archived `.openspec.yaml`) using the pure transformation supplied by the repository's framework module (`spec-frameworks`: "OpenSpec changes record their pull request's branch in `.openspec.yaml`"):

- For a session whose action is `archive`, it SHALL set `archive-branch` under `spec-control:` to the session's branch.
- For every other change session, it SHALL set `branch` under `spec-control:` to the session's branch.

The write SHALL check with `lstat` that neither `openspec/`, `openspec/changes/`, the change or archive directory, nor `.openspec.yaml` is a symbolic link, and SHALL replace `.openspec.yaml` by atomic rename of a temporary file in the same directory. If the key already holds that branch name, the file SHALL be left untouched. Spec Control SHALL NOT append a branch-recording instruction to any agent prompt.

#### Scenario: Worktree setup records the implementation branch
- **WHEN** an Implement session is started for `rotate-keys` in worktree `rotate-keys` on branch `feat/rotate-keys`
- **THEN** `openspec/changes/rotate-keys/.openspec.yaml` in that worktree carries `branch: feat/rotate-keys` under `spec-control:`, and the agent's prompt contains no branch-recording instruction

#### Scenario: Archive Ship records the archive branch
- **WHEN** an Archive session for `rotate-keys` on branch `chore/archive-rotate-keys` ships `openspec/changes/archive/2026-10-20-rotate-keys/.openspec.yaml`
- **THEN** that file carries `archive-branch: chore/archive-rotate-keys` under `spec-control:` alongside its existing `branch` entry, included in the shipped commit

#### Scenario: Symbolic link is refused
- **WHEN** `openspec/changes/rotate-keys/.openspec.yaml` in a worktree is a symbolic link
- **THEN** Spec Control does not follow or overwrite the link

## MODIFIED Requirements

### Requirement: Session starters run a fixed prompt for a validated change
The dashboard SHALL offer the starters **Draft artifacts** (change in `Unknown`, `Backlog` or `Drafts`, or in `Ready` while an artifact the schema does not require for implementing is not done), **Implement** (change in `Ready` or `Implementing`), **Validate** (change in `Done` with the sub-state `validate`) and **Archive** (change in `Done`, in either sub-state), each only when the repository's agent has an opening prompt configured for it (except that **Archive** on a `Done` change with `subState: "complete"` and `specsSynced !== false` runs deterministically on the server and SHALL be offered even if the profile has no Archive prompt), and none for archived changes. **Implement** SHALL NOT be offered for a change in `Done`: nothing is left to implement there, and offering it is what sends an agent back into finished code. **Draft artifacts** SHALL NOT be offered for a change in `Implementing` or `Done`, whatever artifacts it lacks: an artifact the schema does not require is no reason to send an agent back to planning once implementation started, and a request for it SHALL be refused with the reason that the change is past drafting. Which of the available starters a card or the Console tab recommends is a matter of display (`kanban-board`: "A change's actions are one split button"); the available starters and every refusal SHALL be decided by stage, sub-state and dependencies alone, never by a linked pull request. **Implement** SHALL NOT be offered for a change that is **blocked** by its dependencies (change-dependencies), whatever its stage: it is offered again on the first scan after the change stops being blocked. Being blocked SHALL NOT withhold **Draft artifacts**, **Validate** or **Archive**, and SHALL NOT end, interrupt or send anything to a session that is already running. A request to start a starter that is not available for the change's current stage, sub-state and dependencies SHALL be refused; a request for **Implement** refused because the change is blocked SHALL name, as its reason, each dependency that is not `met` together with its state, or say that the change's `depends-on.yaml` could not be read. The opening prompt SHALL be produced from the profile's template, in which `{change}` is the only placeholder, replaced by the change name after it passed change-name validation. The agent MUST be started without a shell from an argument list; the prompt MUST reach it either as exactly one argument (where the command contains `{prompt}`) or by being submitted to its terminal after start-up under the rules for text sent on the user's behalf (where it does not). No text from the browser other than the validated change name may become part of the command line.

Every preset's prompts SHALL carry the meaning of the `- [~]` task marker, which OpenSpec itself does not define: `- [~]` means that a task **needs the user**: the agent did every part of it it can, and what is left is for a person — either to verify the result or to carry out a step only they can (enter a secret, sign in to an account, try it on a real device). The **Implement** prompt SHALL instruct the agent, for a task only the user can verify or carry out, to do every part of it it can, then leave it as `- [~]` rather than ticking it or leaving it open, and add to that task's own line, after its text, what exactly the user has to check or do; the **Validate** prompt SHALL instruct the agent to take the change's `- [~]` tasks one at a time, tell the user exactly what to check or do, help with what it can, and tick off only those the user confirms as done, leaving the rest as `- [~]`; and the **Archive** prompt (used when `specsSynced === false` or `subState === "validate"`, or when sent into a running session) SHALL instruct the agent to sync the change's delta specs into the main specs and then archive the change, without asking whether to sync, to archive right away when nothing is left to sync, and to tick off the tasks left for the user to validate once the user has confirmed them. Because Spec Control itself stages, commits, pushes, and opens the archive pull request once the archive session exits cleanly, the preset Archive prompt SHALL NOT ask the agent to commit, push, or open a pull request, and no prose archive auto-merge instruction or branch-recording instruction SHALL be appended to any starter prompt. Each preset's prompts SHALL invoke the OpenSpec workflow in the form that `openspec init --tools <tool>` installs for that agent — Claude Code's `/opsx:<workflow>` commands, Antigravity's `/opsx-<workflow>` workflows, and, for Codex, which gets skills and no commands, a plain-language instruction that names the OpenSpec skill and `{change}`. Each SHALL remain an ordinary prompt template the user can edit or remove, and each SHALL be a single line, so that it can be typed into a terminal.

A saved configuration in which a profile whose id is a preset's id still carries one of that preset's former prompts for a starter verbatim SHALL be read as carrying that preset's current prompt for that starter; any other prompt, a removed one, and every prompt of a profile whose id is no preset's SHALL be left as saved. This SHALL apply per preset and per starter, so upgrading one prompt never rewrites another and one preset's former prompts never upgrade another preset's profile.

When **Archive** is activated on a change in `Done` with `subState: "complete"` (no `- [~]` tasks) and `specsSynced !== false` (the change has no delta specs, carries `skip_specs: true`, or its delta specs are already reflected in `openspec/specs/`) in a git repository whose sessions use worktrees, Spec Control SHALL execute the archive deterministically on the server without starting an agent process: it prepares the `chore/archive-<change>` worktree from the default branch, moves `openspec/changes/<change>` to `openspec/changes/archive/<YYYY-MM-DD>-<change>` (using today's UTC date), writes `spec-control.archive-branch: chore/archive-<change>` into the archived `.openspec.yaml`, commits all changes, pushes `chore/archive-<change>` to `origin`, opens the pull request via `gh pr create`, and records a completed `archive` session (with the auto-merge timestamp when docs auto-merge is on and the branch changes only files under `openspec/`). When `specsSynced === false` or `subState === "validate"` (or the repository runs sessions in place), **Archive** SHALL start an agent session with the profile's Archive prompt; when that agent session exits with code `0` and `openspec/changes/archive/*-<change>` exists in its worktree, Spec Control SHALL automatically run the deterministic Ship flow to record `archive-branch`, commit any remaining changes, push, and open the pull request.

A starter that does not result in a session MUST NOT fail silently. When starting is refused or fails, the dashboard SHALL show the reason to the user in the place the starter was activated from, without requiring a session panel to be open — a session that could not be created has no panel to report itself in. The message SHALL be the reason the request was refused with. It SHALL be cleared once a later start from the same place succeeds.

#### Scenario: Implement on a ready change
- **WHEN** the user starts **Implement** on change `cache-api-calls` with the preconfigured profile
- **THEN** the agent is started with two arguments, `claude` and one prompt that begins with `/opsx:apply cache-api-calls` and tells it to leave a task only the user can verify or carry out as `- [~]`, with what the user has to check or do added to the task's line

#### Scenario: A step only the user can carry out
- **WHEN** an Implement session for `cache-api-calls` reaches the task `Add the API token to the deployment secrets`, which the agent cannot do itself, and every other task is ticked
- **THEN** the preconfigured prompt has told the agent to leave it as `- [~]` with what the user has to do on its line, the change moves to `Done` with the sub-state `validate`, **Validate** and **Archive** are offered, and **Implement** is not

#### Scenario: Former preconfigured Implement and Validate prompts are upgraded
- **WHEN** a saved configuration's `claude` profile carries, verbatim, the Implement and Validate prompts that only spoke of tasks the user can verify
- **THEN** the loaded configuration carries the current preconfigured Implement and Validate prompts, which also cover tasks only the user can carry out

#### Scenario: Validate on a change awaiting validation
- **WHEN** change `cache-api-calls` is in `Done` with `tasks.awaiting` `2` and the repository's agent has a Validate prompt
- **THEN** the **Validate** starter is offered for it, and starting it opens a session whose prompt names the change and asks the agent to walk the user through its `- [~]` tasks, saying for each what to check or do

#### Scenario: Implement is not offered next to Validate
- **WHEN** a change is in `Done` with the sub-state `validate`
- **THEN** its starters are **Validate** and **Archive**, and **Implement** is not among them

#### Scenario: Validate is refused while tasks are open
- **WHEN** a Validate session is requested for a change in `Implementing`
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: Archive on a change awaiting validation
- **WHEN** change `cache-api-calls` is in `Done` with `tasks.awaiting` `2` and the repository's agent has an Archive prompt
- **THEN** the **Archive** starter is offered for it, and starting it opens an archive session

#### Scenario: Preconfigured Archive prompt syncs without asking
- **WHEN** the user starts **Archive** on change `cache-api-calls` with `specsSynced: false` and the preconfigured profile
- **THEN** the agent is started with two arguments, `claude` and one prompt that begins with `/opsx:archive cache-api-calls`, tells it to sync the delta specs before archiving without asking, and tells it to tick off the tasks left for the user to validate once the user has confirmed them

#### Scenario: Agent without a Validate prompt
- **WHEN** a repository's agent has no Validate prompt and a change is in `Done` with the sub-state `validate`
- **THEN** no Validate starter is offered for it, and **Archive** still is

#### Scenario: Former preconfigured Archive prompt is upgraded
- **WHEN** a saved configuration's `claude` profile has the Archive prompt `/opsx:archive {change}`
- **THEN** the loaded configuration carries the current preconfigured Archive prompt for that profile

#### Scenario: Edited Archive prompt is kept
- **WHEN** a saved configuration's `claude` profile has the Archive prompt `/opsx:archive {change} and ask me before syncing`
- **THEN** the loaded configuration carries exactly that prompt

#### Scenario: Shell metacharacters are inert
- **WHEN** a profile's prompt template produces text containing quotes, `;` or `$(…)`
- **THEN** the agent receives that text as one argument and no shell interprets it

#### Scenario: Invalid change name
- **WHEN** a session is requested for a change name containing characters outside the allowed set
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: A refused start is reported on the card
- **WHEN** the user activates a starter and the request is refused, so that no session is created
- **THEN** the card that starter belongs to shows the reason, and no session panel is required for it to be visible

#### Scenario: Former preconfigured prompts upgrade per starter
- **WHEN** a saved configuration's `claude` profile has a former preconfigured Archive prompt verbatim and an edited Implement prompt
- **THEN** the loaded configuration carries the current preconfigured Archive prompt and exactly the edited Implement prompt

#### Scenario: Antigravity preset uses its installed workflows
- **WHEN** the user starts **Archive** on change `cache-api-calls` with `specsSynced: false` and the Antigravity preset
- **THEN** the prompt begins with `/opsx-archive cache-api-calls`, tells the agent to sync the delta specs before archiving without asking, and tells it to tick off the tasks left for the user to validate once the user has confirmed them

#### Scenario: Codex preset names the skill in plain language
- **WHEN** the user starts **Implement** on change `cache-api-calls` with the Codex preset
- **THEN** the prompt contains no slash command, names the OpenSpec apply skill and `cache-api-calls`, and tells the agent to leave a task only the user can verify or carry out as `- [~]`, with what the user has to check or do added to the task's line

#### Scenario: Former prompts do not cross presets
- **WHEN** a saved configuration's `agy` profile carries, verbatim, a former prompt of the Claude Code preset that was never one of the Antigravity preset's
- **THEN** the loaded configuration carries exactly that prompt for the `agy` profile

#### Scenario: Agent without a prompt for a starter
- **WHEN** a repository's agent has no Archive prompt and a change is in `Done` with `specsSynced: false`
- **THEN** no Archive starter is offered for it

#### Scenario: Command without a prompt placeholder
- **WHEN** an agent's command does not contain `{prompt}` and the agent shows its text prompt after start-up
- **THEN** the agent is started as given and the opening prompt is typed into its terminal and submitted with a separate Enter once the agent shows it

#### Scenario: Agent starts with a dialog instead of a prompt
- **WHEN** an agent whose opening prompt is typed shows a first-run dialog with a highlighted option after start-up
- **THEN** no Enter is pressed and the dialog is left for the user to answer in the terminal

#### Scenario: Archive on a synced change
- **WHEN** change `cache-api-calls` is in `Done` with `subState: "complete"` and its delta specs already synced
- **THEN** the Archive starter is offered for it, and starting it moves `openspec/changes/cache-api-calls` to `openspec/changes/archive/<YYYY-MM-DD>-cache-api-calls`, records `archive-branch`, commits, pushes, and opens the pull request deterministically without starting an agent process

#### Scenario: Archive is refused before every task is done
- **WHEN** an Archive session is requested for a change in `Implementing`
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: The reason goes away on the next successful start
- **WHEN** a starter was refused, its reason is shown, and a later start from the same card succeeds
- **THEN** the reason is no longer shown

#### Scenario: Implement is withheld while a dependency waits
- **WHEN** change `add-billing-ui` is in `Ready` and depends on `add-billing-api`, which is `waiting`
- **THEN** **Implement** is not among its starters, and **Draft artifacts** is offered only if one of its artifacts is not done

#### Scenario: A blocked Implement is refused with the dependencies as reason
- **WHEN** an Implement session is requested for `add-billing-ui` while it depends on `add-billing-api` (`waiting`) and `add-billing-scheme` (`missing`)
- **THEN** the request is refused naming `add-billing-api` as waiting and `add-billing-scheme` as missing, no worktree is created and no process is started

#### Scenario: Drafting a blocked change
- **WHEN** change `add-billing-ui` is in `Drafts` and depends on a change that is `waiting`
- **THEN** **Draft artifacts** is offered and starting it opens a session as for any other change

#### Scenario: Implement returns once the dependency is met
- **WHEN** `add-billing-ui` is in `Ready` and its only dependency becomes `met` on the next scan
- **THEN** its **Implement** starter is offered again

#### Scenario: A running session is left alone
- **WHEN** an Implement session of `add-billing-ui` is running and a `depends-on.yaml` naming a `waiting` change is added to it
- **THEN** the session keeps running and nothing is sent to it, and no new **Implement** is offered for the change

#### Scenario: Archive in a fresh worktree with auto-merge on
- **WHEN** a repository has auto-merge of docs-only pull requests on and the user starts **Archive** on change `rotate-keys` with `specsSynced: false`, whose worktree is created fresh from the base
- **THEN** the opening prompt is the profile's Archive prompt with its additional Archive instructions (with no prose auto-merge tail), and the session carries the auto-merge record so Spec Control auto-ships on clean exit and auto-merges once checks pass

#### Scenario: The archive instruction presumes no pull request
- **WHEN** an Archive session starts with `specsSynced: false`
- **THEN** its prompt contains no git push or pull-request instruction because Spec Control ships the branch once the session exits cleanly

#### Scenario: Archive with auto-merge off
- **WHEN** a repository without auto-merge of docs-only pull requests starts **Archive** on `rotate-keys` with `specsSynced: false`
- **THEN** the opening prompt is the profile's Archive prompt with its additional instructions and nothing else, and the session carries no auto-merge record

#### Scenario: Archive branch already carrying code
- **WHEN** a repository has auto-merge on and **Archive** is started for `rotate-keys` whose archive branch already exists with a commit changing `src/keys.ts`
- **THEN** the session carries no auto-merge record

#### Scenario: Archive without git
- **WHEN** a folder without git has auto-merge recorded in its configuration and **Archive** is started in place
- **THEN** no git command runs for the check and the session carries no auto-merge record

#### Scenario: Other starters never carry it
- **WHEN** a repository has auto-merge on and **Implement** or **Validate** is started in a worktree that holds only OpenSpec documents
- **THEN** the session carries no auto-merge record

#### Scenario: A session that was already open
- **WHEN** a repository has auto-merge on and **Archive** is requested for a change whose session is already open, so that session is returned
- **THEN** nothing is typed into it

#### Scenario: Done change without a design offers no Draft
- **WHEN** change `rotate-keys` is in `Done`, its `design.md` was never written and the schema does not require it for implementing
- **THEN** its available starters are **Archive** only, and a request to start **Draft artifacts** for it is refused with the reason that the change is past drafting

#### Scenario: Implementing change without a design
- **WHEN** change `rotate-keys` is in `Implementing` and its optional `design.md` is not written
- **THEN** its available starters are **Implement** only

#### Scenario: Ready change may still draft its design
- **WHEN** change `rotate-keys` is in `Ready` and its optional `design.md` is not written
- **THEN** its available starters are **Implement** and **Draft artifacts**, and a Draft session for it may be started

#### Scenario: Ready change with every artifact written
- **WHEN** change `rotate-keys` is in `Ready` and every artifact is written
- **THEN** its available starters are **Implement** only

#### Scenario: The Archive prompt asks for the whole move to be committed
- **WHEN** a saved configuration still carrying the previous preconfigured Archive prompt verbatim (which asked the agent to include in its commit every file the archive moved or removed) is loaded
- **THEN** it is read as carrying the current preconfigured Archive prompt

### Requirement: Additional instructions extend an action's prompt without replacing it
A profile SHALL be able to carry **additional instructions** for each of its prompts — the session starters, Resolve conflicts and Integrate — kept separately from the prompt itself; saved additional instructions for `ship` or `merge` in an existing `config.json` SHALL still be accepted when loaded and saved so existing configurations remain valid, even though Ship and Merge now execute deterministically on the server without sending a prompt to an agent. Whenever the dashboard produces the prompt of an agent action, it SHALL append that action's additional instructions to the prompt it would otherwise have sent, and SHALL send nothing else: the prompt template stays as configured, and additional instructions for one action MUST NOT reach another. This applies wherever that prompt is used — starting a session, sending a starter's prompt into a running session, Resolve conflicts and Integrate.

The composed text SHALL be one line: additional instructions SHALL be trimmed and any run of whitespace in them, including a line break, SHALL become a single space before they are appended, separated from the prompt by one space. Placeholders SHALL be substituted in the composed text under the rules of the prompt being extended, so additional instructions for a starter or Resolve conflicts MAY use `{change}` and MUST use no other placeholder, additional Integrate instructions MUST contain no placeholder at all, and no additional instructions may carry a permission-bypass mode or flag. Additional instructions that break these rules SHALL be refused when the configuration is saved, with a message naming the field, leaving the stored configuration unchanged.

Additional instructions SHALL be an addition, never a prompt of their own: an action whose prompt is not configured SHALL stay unavailable and its additional instructions SHALL NOT be sent anywhere. Resolve conflicts and Integrate SHALL be the exceptions in effect, because each has an agent-neutral default prompt: their additional instructions SHALL be appended to the profile's own prompt for that action, or to that action's default when the profile has none. Settings SHALL offer the additional instructions of each prompt beside that prompt, saying that the text is appended to it; empty additional instructions SHALL be stored as absent.

#### Scenario: Additional instructions reach a starter's prompt
- **WHEN** the repository's agent has the Implement prompt `/opsx:apply {change}` and additional Implement instructions `Run the linter before you finish.`, and Implement is started for change `cache-api-calls`
- **THEN** the agent receives one prompt reading `/opsx:apply cache-api-calls Run the linter before you finish.`

#### Scenario: Additional instructions extend the default Ship prompt
- **WHEN** a saved configuration carries additional Ship instructions `Add the checklist from CONTRIBUTING.md to the pull request body.`
- **THEN** the configuration loads and saves without error, while Ship itself executes deterministically on the server

#### Scenario: Additional instructions extend the default Integrate prompt
- **WHEN** the default agent's profile has no Integrate prompt of its own but additional Integrate instructions `Commit nothing.`, and **Integrate** is activated
- **THEN** the agent receives the agent-neutral default Integrate prompt followed by one space and `Commit nothing.`

#### Scenario: Additional instructions are one line
- **WHEN** additional Archive instructions are saved as two lines with trailing blanks
- **THEN** the composed Archive prompt is a single line in which those lines are joined by one space, so that a prompt typed into a terminal is not submitted early

#### Scenario: Additional instructions stay with their own action
- **WHEN** a profile carries additional instructions for Implement only
- **THEN** the Draft, Validate, Archive, Resolve conflicts and Integrate prompts are sent exactly as they are configured

#### Scenario: Additional instructions do not make an action available
- **WHEN** a profile has no Validate prompt but additional Validate instructions, and a change is in `Done` with `subState: "validate"`
- **THEN** Validate is still not offered for that change, a Validate request is still refused with the reason that the agent has no Validate prompt, and the additional instructions are not sent

#### Scenario: Unknown placeholder is refused
- **WHEN** additional Implement instructions containing `{repo}` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Placeholder in additional Integrate instructions is refused
- **WHEN** additional Integrate instructions containing `{change}` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Permission bypass is refused
- **WHEN** additional Draft instructions asking the agent to run with `--dangerously-skip-permissions` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Prompt sent into a running session
- **WHEN** a session for `cache-api-calls` is running and the Implement prompt is sent into it, with additional Implement instructions configured
- **THEN** the composed prompt, including those instructions, is what is typed into the terminal under the rules for text sent on the user's behalf

### Requirement: A repository can require Conventional Commits pull request titles
Each repository entry in the configuration MAY carry `prTitleConvention`, whose only valid value is `conventional-commits`; absent means the repository has no pull request title convention. A configuration without the field SHALL load unchanged with no convention for any repository, and a configuration carrying any other value SHALL be rejected when saved, leaving the stored configuration unchanged. The setting SHALL be stored only in the dashboard's own configuration and MUST NOT be written to, or read from, any tracked repository.

Whenever Spec Control generates a deterministic commit message and pull request title during Ship (manual or automatic):
- When `prTitleConvention` is `conventional-commits`, Spec Control SHALL format the default title as `docs(openspec): add <change>` for a proposal branch (`docs/<change>`), `chore(openspec): archive <change>` for an archive branch (`chore/archive-<change>`), and `feat: <change>` for an implementation branch (`feat/<change>`, unless the user supplied an explicit title or the branch already has a commit ahead of the base whose subject follows Conventional Commits).
- When `prTitleConvention` is absent, Spec Control SHALL format the default title as `Add OpenSpec proposal <change>` for a proposal branch, `Archive OpenSpec change <change>` for an archive branch, and `<change>` (or the branch's latest commit subject ahead of base) for an implementation branch.

No agent prompt — the session starters, Resolve conflicts, Integrate — SHALL carry a Conventional Commits sentence.

#### Scenario: Ship for a repository with the convention
- **WHEN** `demo-ops` has `prTitleConvention: conventional-commits` and Ship commits and opens a pull request for an implementation session of `rotate-keys`
- **THEN** the commit message and pull request title default to `feat: rotate-keys`

#### Scenario: The convention and additional instructions
- **WHEN** the repository has `prTitleConvention: conventional-commits` and Ship runs on a proposal session on `docs/rotate-keys`
- **THEN** the commit message and pull request title default to `docs(openspec): add rotate-keys`

#### Scenario: The convention and auto-merge of docs-only pull requests
- **WHEN** the repository has the convention and auto-merge of docs-only pull requests on, and Ship runs on an archive session for `rotate-keys` that ships only OpenSpec documents
- **THEN** the commit message and pull request title default to `chore(openspec): archive rotate-keys` and the session records `autoMergeAskedAt`

#### Scenario: Ship after the session ended
- **WHEN** the repository has the convention and Ship is used on an ended session for `rotate-keys`
- **THEN** the server commits, pushes, and opens the pull request with the Conventional Commits title without starting an agent

#### Scenario: Repository without the convention
- **WHEN** a repository has no `prTitleConvention` and Ship runs on an archive session of `rotate-keys`
- **THEN** the commit message and pull request title default to `Archive OpenSpec change rotate-keys`

#### Scenario: Other prompts are unaffected
- **WHEN** the repository has the convention and Implement or Resolve conflicts is started for one of its changes
- **THEN** that prompt is sent exactly as it would be without the convention

#### Scenario: Unknown convention is refused
- **WHEN** a configuration is saved in which a repository carries `prTitleConvention: angular`
- **THEN** it is rejected naming the field and the stored configuration is unchanged

#### Scenario: Older configuration loads
- **WHEN** a configuration whose repository entries carry no `prTitleConvention` is loaded
- **THEN** it loads unchanged and no repository has a convention

### Requirement: Fast-forward drafts, implements and ships in one session
The dashboard SHALL offer a fifth starter, **Fast-forward**, for a change that should go from its artifacts to a pull
request without the user reviewing anything in between. It SHALL be offered exactly when all of these hold: **Draft
artifacts** is offered for the change (at least one artifact is not done, the change is not archived); the change is
not planned yet — in `Backlog` or `Drafts` (or without artifacts), not in `Ready` or later, where an optional artifact
may still be missing but **Implement** and **Ship** already apply; the change is not **blocked** by its dependencies (change-dependencies), because fast-forwarding implements it; and the repository's
agent has both a **Draft artifacts** and an **Implement** prompt. A request to start or send **Fast-forward** when any of
these does not hold SHALL be refused like any unavailable starter — a refusal because the change is blocked naming each
dependency that is not `met` with its state, as for **Implement** — and SHALL create no worktree and start no process.

A Fast-forward session SHALL run where a **Draft artifacts** session of the same change would run — in a git repository
in the change's worktree on branch `feat/<change>`, in place where a Draft session would be in place — and SHALL count
as that change's one open session. Its action SHALL be recorded as `fastForward` and shown as **Fast-forward** wherever a
session's action is named (the session panel, Open work and the activity log).

Its opening prompt SHALL be composed, as one line, of, in this order: the agent's **Draft artifacts** prompt with that
prompt's additional instructions; a fixed agent-neutral sentence telling the agent not to stop for the user's review once
every artifact is written, because this change is fast-forwarded and the pull request will be its only review, and to go
straight on to implementing it; and the agent's **Implement** prompt with its additional instructions. Because Spec
Control ships the branch deterministically once the Fast-forward session exits with status `0` and all tasks are settled
(`done` or `awaiting`), the Fast-forward prompt SHALL NOT append a Ship prompt, branch-recording instruction, or
Conventional Commits sentence. `{change}` SHALL be replaced in every part by the validated change name and is the only
placeholder; nothing else from the browser SHALL reach the prompt. The profile SHALL NOT have a Fast-forward prompt of
its own, so every profile that has a Draft and an Implement prompt can fast-forward without being configured for it, and
editing those prompts changes the Fast-forward prompt with them. The `- [~]` meaning carried by the Implement prompt
therefore holds in a Fast-forward session too.

A Fast-forward session SHALL NOT record that docs auto-merge was requested; the pull request Spec Control opens for it is
the change's only review and MUST stay open for review. When the Fast-forward session's agent exits with code `0` and the
change in its worktree has at least one task and no open (`- [ ]`) tasks remaining, Spec Control SHALL automatically run
the deterministic Ship flow (record `branch`, commit any uncommitted work, push `feat/<change>`, and open the pull
request).

While a session of the change runs, **Fast-forward** MAY be sent into it as a next step under the rules for sending a
starter's prompt into a running session, under the same availability conditions.

#### Scenario: Fast-forward on a drafted-nothing change
- **WHEN** change `cache-api-calls` is in `Backlog`, is not blocked, and the repository's agent is the preconfigured Claude Code profile
- **THEN** **Fast-forward** is offered next to **Draft artifacts**, and starting it creates the worktree on `feat/cache-api-calls` and starts `claude` with one prompt that begins with `/opsx:ff cache-api-calls`, then says not to stop for review, and ends with `/opsx:apply cache-api-calls` and its `- [~]` instruction

#### Scenario: Project with a pull request title convention
- **WHEN** **Fast-forward** is started for `cache-api-calls` in a repository whose `prTitleConvention` is `conventional-commits` and the agent finishes all tasks and exits with code `0`
- **THEN** Spec Control automatically commits any uncommitted files in `feat/cache-api-calls` and opens the pull request with a Conventional Commits title (`feat: cache-api-calls`)

#### Scenario: Never auto-merge
- **WHEN** **Fast-forward** is started and completed for a change of a project with docs-only auto-merge switched on
- **THEN** the session records no auto-merge request and its pull request is not auto-merged

#### Scenario: Not offered without an Implement prompt
- **WHEN** the repository's agent has a Draft artifacts prompt but no Implement prompt
- **THEN** **Draft artifacts** is offered and **Fast-forward** is not, and a request for it is refused

#### Scenario: Not offered for a blocked change
- **WHEN** change `cache-api-calls` in `Drafts` depends on `add-billing-api`, which is `waiting`
- **THEN** **Draft artifacts** is offered and **Fast-forward** is not, and a request for it is refused naming `add-billing-api — waiting`

#### Scenario: Not offered once planned
- **WHEN** the change is in `Ready` with its tasks written and its optional design not written
- **THEN** **Fast-forward** is not offered and a request for it is refused

#### Scenario: Shell metacharacters stay inert
- **WHEN** the Draft prompt of the profile contains `$(rm -rf ~)` and **Fast-forward** is started
- **THEN** that text reaches the agent only inside the one prompt argument and no shell is started

### Requirement: A Draft session in a docs auto-merge project opens its proposal pull request
When a **Draft artifacts** session works on `docs/<change>` and the repository has docs auto-merge switched on, Spec Control SHALL record `autoMergeAskedAt` on the session when the worktree holds nothing outside `openspec/` (with an empty worktree counting as holding nothing outside), and SHALL NOT append a prose proposal git/PR instruction to the Draft prompt; the agent receives only the profile's Draft prompt and its additional Draft instructions.

When that Draft session on `docs/<change>` exits with code `0`, `autoMergeDocs` is on, every required artifact of `<change>` in the worktree is `done`, and the worktree holds only files under `openspec/`, Spec Control SHALL automatically run the deterministic Ship flow in that worktree: it writes `spec-control.branch: docs/<change>` in `openspec/changes/<change>/.openspec.yaml`, commits all changes with title `docs(openspec): add <change>` when the project declares Conventional Commits pull request titles and `Add OpenSpec proposal <change>` otherwise, pushes `docs/<change>` to `origin`, opens the pull request against the default branch via `gh pr create`, and sets `autoMergeAskedAt` on the session so that "A ready docs-only pull request is merged automatically by the server" and "A merged auto-merge pull request ends its session" merge the proposal pull request and clean up its worktree once its checks pass.

#### Scenario: Draft opens the proposal pull request
- **WHEN** `demo-ops` declares Conventional Commits titles, has docs auto-merge on, the user starts **Draft artifacts** for `rotate-keys`, and the agent writes all required artifacts under `openspec/changes/rotate-keys/` and exits with code `0`
- **THEN** the agent's opening prompt was only the profile's Draft prompt with its additional Draft instructions, and on exit Spec Control commits the artifacts on `docs/rotate-keys` with message `docs(openspec): add rotate-keys`, pushes `docs/rotate-keys`, opens the pull request against the default branch, and records `autoMergeAskedAt` on the session

#### Scenario: Without a title convention
- **WHEN** the same project declares no title convention and the Draft session on `docs/rotate-keys` exits with all required artifacts written
- **THEN** Spec Control commits and opens the proposal pull request with the title `Add OpenSpec proposal rotate-keys`

#### Scenario: The worktree holds code
- **WHEN** the `docs-rotate-keys` worktree, reused from an earlier session, holds an uncommitted `src/app.ts`, and Draft is started or exits for `rotate-keys`
- **THEN** Spec Control does not auto-ship or set `autoMergeAskedAt` on the session

#### Scenario: Without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts**
- **THEN** the session works on `feat/rotate-keys` and does not auto-ship on exit

#### Scenario: Draft sent into an Implement session
- **WHEN** Draft is sent into the running Implement session of `rotate-keys` on `feat/rotate-keys`
- **THEN** the prompt carries no proposal instruction and the session does not auto-ship as a proposal PR

#### Scenario: Fast-forward is unchanged
- **WHEN** the user starts **Fast-forward** for `rotate-keys` in a project with docs auto-merge on
- **THEN** the session works on `feat/rotate-keys` and never carries the auto-merge record

### Requirement: A merged auto-merge pull request ends its session
When the dashboard records `autoMergeAskedAt` on a change session — for a Draft session on `docs/<change>` in a docs auto-merge project, an Archive session in a docs auto-merge project whose worktree holds only OpenSpec documents, or a Ship whose branch changes only OpenSpec documents in a docs auto-merge project — it SHALL record on that session the time it did so (the latest such time when it happens more than once). The same record is what makes a session eligible for automatic docs-only merging ("A ready docs-only pull request is merged automatically by the server"). A session without that record SHALL never be ended or have its worktree removed by this requirement.

Whenever a pull-request query for a repository completes — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL look in that query's result for each session of that repository that carries the record, is not in place and did not adopt its worktree, and whose worktree still exists or whose agent still runs. When the result holds a pull request in the merged state whose head branch is that session's branch and whose merge time is later than the recorded time, and the repository has auto-merge of docs-only pull requests switched on at that moment, the dashboard SHALL, without asking, end the session's agent if it is still running, and then remove its worktree under exactly the rules of "Worktree clean-up is offered only when safe": by a non-forcing `git worktree remove`, only when it holds no uncommitted change and either its work status is `merged` or no commit exists only on its branch. When those checks refuse, the agent SHALL still be ended, the worktree SHALL be kept, and the session SHALL keep the reason. It SHALL decide this only from the pull-request query's result and read-only git; it MUST NOT fetch, and MUST NOT delete the session's branch or any other ref — the branch is left for repository cleanup. A session that this ended or cleaned up SHALL keep, and its panel and card SHALL show, that it was ended because pull request `#<number>` merged, and whether its worktree was removed or why it was kept. A merged pull request found again in a later query SHALL change nothing more. In the demo nothing SHALL be ended or removed.

#### Scenario: Archive pull request merges while the board is watching
- **WHEN** a repository has docs auto-merge on, the archive session of `rotate-keys` carries `autoMergeAskedAt`, Spec Control shipped branch `chore/archive-rotate-keys` and opened `#88`, merged `#88` via `gh pr merge` once `#88` was ready, and a later pull-request watch refresh shows `#88` merged
- **THEN** the session's agent (if still running) is ended, its clean, pushed worktree is removed, branch `chore/archive-rotate-keys` still exists locally, and the panel says the session ended because `#88` merged and its worktree was removed

#### Scenario: Nothing was asked
- **WHEN** a pull-request refresh shows the pull request of an Implement session's branch merged, and that session never carried `autoMergeAskedAt`
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Auto-merge switched off since
- **WHEN** the user switched docs auto-merge off for the repository after the Ship that recorded `autoMergeAskedAt`, and a refresh then shows that pull request merged
- **THEN** the session keeps running and its worktree is kept

#### Scenario: An earlier pull request of the same branch
- **WHEN** a session recorded `autoMergeAskedAt` at 10:00 and the refresh shows a pull request of its branch that merged at 09:30
- **THEN** nothing is ended or removed

#### Scenario: Uncommitted work keeps the worktree
- **WHEN** the auto-merge pull request of a session has merged and its worktree has an uncommitted file
- **THEN** the agent is ended, the worktree is kept, and the panel says the worktree was kept because it has uncommitted changes

#### Scenario: Already ended by the user
- **WHEN** the user ended a session but kept its worktree, and a later refresh shows its auto-merge pull request merged
- **THEN** the worktree is removed when the checks allow it, and no agent is started or ended

#### Scenario: No query, no action
- **WHEN** the auto-merge pull request of a running session merges on GitHub while no view that queries pull requests is open
- **THEN** the session keeps running and no `gh` or git process is started for it until a pull-request query runs

#### Scenario: Seen again
- **WHEN** a later refresh shows the same merged pull request for a session this already ended
- **THEN** nothing else is ended, removed or recorded

#### Scenario: Proposal pull request merges
- **WHEN** the Draft session of `rotate-keys` on `docs/rotate-keys` carries `autoMergeAskedAt`, Spec Control opened `#90`, and a later refresh shows `#90` merged after that time while docs auto-merge is on
- **THEN** the clean worktree `docs-rotate-keys` is removed, branch `docs/rotate-keys` still exists locally, and the panel says the session ended because `#90` merged

## REMOVED Requirements

### Requirement: Ship asks the agent to commit, push and open a pull request
**Reason**: Replaced by deterministic server-side Ship ("Ship commits, pushes and opens a pull request deterministically") so committing, pushing, and opening pull requests require zero LLM tokens and behave identically across all agents.
**Migration**: Use "Ship commits, pushes and opens a pull request deterministically".

### Requirement: Merge asks the agent to merge its ready pull request
**Reason**: Replaced by deterministic server-side Merge ("Merge merges a ready pull request deterministically") via `gh pr merge --match-head-commit`, which works even after the session's agent has exited.
**Migration**: Use "Merge merges a ready pull request deterministically".

### Requirement: A ready docs-only pull request is handed to its agent to merge
**Reason**: Replaced by deterministic server-side docs-only auto-merge ("A ready docs-only pull request is merged automatically by the server") via `gh pr merge --match-head-commit` instead of typing a Merge prompt into a running agent terminal.
**Migration**: Use "A ready docs-only pull request is merged automatically by the server".

### Requirement: An agent asked to open a pull request is asked to record its branch
**Reason**: Replaced by server-side `.openspec.yaml` branch recording ("Spec Control records a change's branch in `.openspec.yaml`") so agents no longer need to edit `.openspec.yaml` from a prompt instruction.
**Migration**: Use "Spec Control records a change's branch in `.openspec.yaml`".

### Requirement: An ended proposal session's pull request is merged through the change's running session
**Reason**: Because Spec Control now merges ready docs-only pull requests directly on the server via `gh pr merge --match-head-commit` regardless of whether the proposal session's agent is still running, an ended proposal session on `docs/<change>` no longer needs to hand its pull request over to a running implementation session's terminal to be merged.
**Migration**: Ready proposal pull requests on `docs/<change>` are merged directly by the server under "A ready docs-only pull request is merged automatically by the server" and "Merge merges a ready pull request deterministically".
