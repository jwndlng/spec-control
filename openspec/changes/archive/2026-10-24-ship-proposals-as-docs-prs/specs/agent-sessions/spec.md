## ADDED Requirements

### Requirement: A Draft session in a docs auto-merge project opens its proposal pull request
When a **Draft artifacts** session works on `docs/<change>` and the repository has docs auto-merge switched on, the dashboard SHALL append a fixed **proposal instruction** to the Draft prompt — after the profile's Draft prompt and its additional Draft instructions, separated by one space — when it starts the session and when Draft is sent into that same running session. The instruction SHALL ask the agent, once every artifact of the change is written, to commit them on the session's branch, push it and open a pull request against the default branch titled `docs(openspec): add <change>` when the project declares Conventional Commits pull request titles and `Add OpenSpec proposal <change>` otherwise, containing only files under `openspec/`; not to merge it and not to enable auto-merge on it, because Spec Control asks for the merge once it is ready; and not to start implementing the change. `<change>` SHALL be the validated change name and nothing in the instruction SHALL come from the request.

The instruction SHALL be appended only when read-only git, in the session's worktree at that moment, proves the worktree holds nothing outside `openspec/` under the check Ship makes, with an empty worktree counting as holding nothing outside; a git command that fails counts as not holding. It SHALL NOT be appended to a Draft session on `feat/<change>`, to a session in place, to a Fast-forward session, or to any other action, and sending Draft into a running session on another branch SHALL NOT carry it. The start or send result SHALL state whether it was included. Appending it SHALL set the session's auto-merge record exactly as the Ship and Archive auto-merge instructions do, so that "A ready docs-only pull request is handed to its agent to merge" and "A merged auto-merge pull request ends its session" apply to the proposal pull request unchanged.

The dashboard itself MUST NOT commit, push, open or merge anything for this, and MUST NOT run any git command beyond the read-only check above and the worktree commands of any session.

#### Scenario: Draft opens the proposal pull request
- **WHEN** `demo-ops` declares Conventional Commits titles, has docs auto-merge on, and the user starts **Draft artifacts** for `rotate-keys`
- **THEN** the opening prompt is the profile's Draft prompt with its additional Draft instructions, followed by the proposal instruction naming `docs(openspec): add rotate-keys`, the session carries the auto-merge record, and the start result states that the instruction was included

#### Scenario: Without a title convention
- **WHEN** the same project declares no title convention
- **THEN** the proposal instruction asks for the title `Add OpenSpec proposal rotate-keys`

#### Scenario: The worktree holds code
- **WHEN** the `docs-rotate-keys` worktree, reused from an earlier session, holds an uncommitted `src/app.ts`, and Draft is started for `rotate-keys`
- **THEN** the proposal instruction is not appended, the session carries no auto-merge record, and the result states that it was not included

#### Scenario: Without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts**
- **THEN** no proposal instruction is appended and the session works on `feat/rotate-keys`

#### Scenario: Draft sent into an Implement session
- **WHEN** Draft is sent into the running Implement session of `rotate-keys` on `feat/rotate-keys`
- **THEN** the prompt carries no proposal instruction

#### Scenario: Fast-forward is unchanged
- **WHEN** the user starts **Fast-forward** for `rotate-keys` in a project with docs auto-merge on
- **THEN** the session works on `feat/rotate-keys`, its prompt carries no proposal instruction, and it never carries the auto-merge record

## MODIFIED Requirements

### Requirement: Every session works in its own git worktree, created by the dashboard
In a git repository a session MUST NOT run in the repository's main checkout, except for the in-place cases below. Before starting the agent, the dashboard SHALL ensure a git worktree for the session under `~/.spec-control/worktrees/<repository id>/`, outside the repository's working tree, on branch `feat/<change>` in worktree `<change>` — or, for **Archive**, in a worktree and branch of its own (`archive-<change>`, `chore/archive-<change>`), and, for a **Draft artifacts** session started while the repository has docs auto-merge switched on, in a worktree and branch of its own (`docs-<change>`, `docs/<change>`). Whether a Draft session gets `docs/<change>` SHALL be decided once, when it starts, and kept as the session's branch for its whole life; without docs auto-merge a Draft session works on `feat/<change>` as before. An existing worktree for that name SHALL be reused; an existing branch SHALL be checked out; otherwise the branch SHALL be created from the repository's default branch as currently known locally (`origin/HEAD`, else `HEAD`) — except that when an **Implement** or **Validate** session has to create `feat/<change>`, it SHALL be created from the local branch `docs/<change>` when that branch exists and the default branch's tree as known locally does not hold `openspec/changes/<change>/`, so that the implementation builds on the proposal that is not merged yet. That choice SHALL be made with read-only git only. A session on `feat/<change>` MUST NOT be started on, or adopt a worktree of, `docs/<change>`. A git repository whose scan reports that it has **no commit to branch from** — `HEAD` names no commit and there is no `origin/HEAD`, as **New project** leaves it — has no default branch to create a session's branch from; its change sessions SHALL run in place, as the paragraph on repositories with no commit below specifies, and MUST NOT be refused for lacking a commit. Should the scan be out of date and the branch still have to be created from a `HEAD` that names no commit, starting the session SHALL be refused before any worktree or branch is created and before any agent is started, with a reason that says the repository has no commit yet, rather than git's own error; that check SHALL be read-only. As the one exception, when a Draft or Implement session's branch — `feat/<change>`, or `docs/<change>` for a Draft session that has it — is already checked out in another linked worktree of the repository, the session SHALL adopt that worktree — run the agent there instead of creating one — and SHALL record and show that the worktree was adopted. The dashboard MUST NOT contact a remote for this. If the change's directory is missing from the session's worktree, the dashboard SHALL copy it from the checkout the change's data comes from (the main checkout or a linked worktree), including when it exists there only uncommitted. The main checkout's branch, index and working tree MUST NOT be changed. The session record and panel SHALL show the worktree path and branch.

A tracked folder that holds an `openspec/` tree but is **not a git repository** is a supported repository, and its sessions SHALL run **in place**: the agent's working directory SHALL be the repository folder itself, no worktree SHALL be created, no branch SHALL be made, and no git command SHALL be run for the session. Whether a session runs in place SHALL be decided from the repository's own scan result, never by attempting a git command and reacting to its failure. An in-place session SHALL be recorded as such and MUST NOT carry a branch. The panel SHALL name the folder the agent runs in and SHALL state plainly that the agent edits the tracked folder directly, with no branch, no commit and no undo. Session starters MUST NOT be hidden or disabled because a repository is not a git repository.

An **integration session** — the session started by **Integrate** for a repository that is not tracked and has no `openspec/` tree — is the second in-place case and the first one in a git repository. It SHALL run in place under exactly the rules of the paragraph above: the repository folder is the working directory, no worktree, no branch, no git command for the session, recorded as in place, with the same panel wording. The reason it does not get a worktree is that its whole purpose is to leave `openspec/config.yaml` in the checkout the user works in; on a branch in a worktree the marker would never appear where discovery looks. Whether a session runs in place SHALL still be decided from what the dashboard already knows about the folder, never by attempting a git command and reacting to its failure.

A **project console** — the one session per tracked project for general project tasks, specified in the `project-console` capability — is the third in-place case and the second one in a git repository's main checkout. It SHALL run in place under the same rules: the tracked folder is the working directory, no worktree, no branch, no git command for the session, recorded as in place, with the same panel wording. It runs there because it belongs to no change and so to no branch, and because work on the project as the user sees it — including a project with no commit yet, where no worktree can be made — happens in that checkout. Apart from the case in the next paragraph, these two kinds are the only sessions that MAY run in a git repository's main checkout.

A **change session in a git repository with no commit yet** is the fourth in-place case and the only one in which a change session runs in a git repository's main checkout. When the repository's scan reports that it has no commit to branch from, a change session of any action SHALL run in place under the same rules as in a folder without git: the main checkout is the working directory, no worktree SHALL be created, no branch made and no git command run for the session, the session SHALL be recorded as in place and MUST NOT carry a branch. Whether it runs in place SHALL be decided from the scan result, never by attempting a git command and reacting to its failure. A session started in place SHALL stay in place for its whole life, including when it is resumed or started again after the repository got its first commit; a session started once the scan reports a commit SHALL get its own worktree and branch as usual. The panel SHALL name the folder and SHALL state that the agent works in the repository's checkout because there is no commit to branch from yet, with no branch of its own and no undo; it MUST NOT claim that the folder is not a git repository. Such a session has no work status, no Ship, no worktree to remove and no pull offer, exactly as an in-place session in a folder without git. At most one agent SHALL run in that checkout at a time: a change session SHALL be refused while another in-place session — a change session or the project console — runs there, with a reason naming the change or saying that the project console is running in that folder. In every git repository that has a commit to branch from, a change session never runs in the main checkout.

#### Scenario: Two sessions in one repository
- **WHEN** sessions are open for changes `audit-trail` and `upgrade-runtime` of the same repository
- **THEN** they run in two different worktrees on two different branches and the main checkout's branch and `git status` are unchanged

#### Scenario: Uncommitted change directory
- **WHEN** a session is opened for a change whose directory exists only uncommitted in the main checkout
- **THEN** the worktree contains a copy of that directory before the agent starts

#### Scenario: Change lives only in another worktree on another branch
- **WHEN** a session is opened for change `audit-trail`, which exists only in a worktree on branch `wip/compliance`
- **THEN** a session worktree on `feat/audit-trail` is created and contains a copy of the change directory from that worktree before the agent starts

#### Scenario: The change's branch is already checked out
- **WHEN** an Implement session is opened for change `audit-trail` and branch `feat/audit-trail` is checked out in a linked worktree that the user created
- **THEN** the agent runs in that worktree, no new worktree is created, and the panel shows the worktree as adopted

#### Scenario: Archiving does not reuse the implementation worktree
- **WHEN** a change was implemented in a session whose worktree still exists, and the user later starts **Archive** for it
- **THEN** the archive session runs in a separate worktree on a `chore/archive-<change>` branch

#### Scenario: Worktree cannot be created
- **WHEN** git refuses to create the worktree in a git repository
- **THEN** the request fails with git's reason and no agent is started

#### Scenario: Repository without a commit
- **WHEN** the user starts **Draft artifacts** for change `first-feature` in the tracked git repository `/w/acme/fresh-app`, which was initialised but has no commit, and has no `origin/HEAD`
- **THEN** the agent starts with `/w/acme/fresh-app` as its working directory, the session is recorded as in place without a branch, no worktree or branch is created, and the dashboard runs no git command for the session

#### Scenario: The panel of a session in a repository without a commit
- **WHEN** the panel of the in-place `first-feature` session in `/w/acme/fresh-app` is open
- **THEN** it names `/w/acme/fresh-app`, shows no branch, says the agent works in the checkout because there is no commit to branch from yet and that there is no undo, and does not say the folder is not a git repository

#### Scenario: A second agent in a repository without a commit
- **WHEN** the in-place `first-feature` session runs in `/w/acme/fresh-app` and the user starts Implement for change `second-feature` of the same repository
- **THEN** the request is refused with a reason naming `first-feature`, and no second agent is started

#### Scenario: After the first commit
- **WHEN** the agent of the in-place `first-feature` session has made the first commit in `/w/acme/fresh-app`, a scan has run, and the user starts **Draft artifacts** for change `second-feature`
- **THEN** the `second-feature` session runs in its own worktree on branch `feat/second-feature`, and a resumed `first-feature` session still runs in place

#### Scenario: Out-of-date scan
- **WHEN** a session's branch would be created from a `HEAD` that names no commit although the last scan reported a commit
- **THEN** the request is refused with a reason saying the repository has no commit yet, no worktree, branch or file is created, and no agent is started

#### Scenario: Archiving a change in a folder that is not a git repository
- **WHEN** the user starts **Archive** for a completed change in a tracked folder that has an `openspec/` tree but no `.git`
- **THEN** the agent starts with the tracked folder as its working directory, no worktree and no branch are created, and no git command is run for the session

#### Scenario: The panel names the folder for an in-place session
- **WHEN** the panel of an in-place session is open
- **THEN** it names the repository folder the agent runs in, shows no branch, and states that the agent edits that folder directly with no branch, no commit and no undo

#### Scenario: An integration session runs in the checkout
- **WHEN** the user activates **Integrate** for a git repository that has no `openspec/config.yaml`
- **THEN** the agent starts with that repository folder as its working directory, no worktree and no branch are created, and the dashboard runs no git command for the session

#### Scenario: The integration panel states the risk
- **WHEN** the panel of an integration session is open
- **THEN** it names the repository folder, shows no branch, and states that the agent edits that folder directly with no branch, no commit and no undo

#### Scenario: A project console runs in the checkout
- **WHEN** the user opens the project console of the tracked git repository `/w/acme/demo-ops`
- **THEN** the agent starts with `/w/acme/demo-ops` as its working directory, no worktree and no branch are created, and the dashboard runs no git command for the session

#### Scenario: Change sessions still never run in the main checkout
- **WHEN** a project console runs in `/w/acme/demo-ops`, which has commits, and the user starts Implement for a change of `demo-ops`
- **THEN** the Implement session runs in its own worktree on its own branch, not in the main checkout

#### Scenario: Draft in a project with docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge on and the user starts **Draft artifacts** for change `rotate-keys`
- **THEN** the session runs in worktree `docs-rotate-keys` on a new branch `docs/rotate-keys` created from the default branch, and the main checkout is unchanged

#### Scenario: Draft without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts** for change `rotate-keys`
- **THEN** the session runs in worktree `rotate-keys` on branch `feat/rotate-keys`, as before

#### Scenario: Implement while the proposal pull request is open
- **WHEN** the local branch `docs/rotate-keys` holds the proposal, `origin/HEAD`'s tree has no `openspec/changes/rotate-keys/`, no branch `feat/rotate-keys` exists, and the user starts **Implement**
- **THEN** the session runs in worktree `rotate-keys` on a new branch `feat/rotate-keys` created from `docs/rotate-keys`, and the `docs-rotate-keys` worktree is neither adopted nor changed

#### Scenario: Implement after the proposal merged
- **WHEN** `origin/HEAD`'s tree holds `openspec/changes/rotate-keys/`, the local branch `docs/rotate-keys` still exists, and the user starts **Implement**
- **THEN** `feat/rotate-keys` is created from `origin/HEAD`

#### Scenario: Implement never works on the proposal branch
- **WHEN** `docs/rotate-keys` is checked out in the running Draft session's worktree and the user starts **Implement** for `rotate-keys`
- **THEN** the Implement session gets its own worktree on `feat/rotate-keys` and does not adopt the Draft session's worktree

### Requirement: Session lifecycle and control
A session SHALL be `running` while its agent process lives, `exited` with the process's exit code once it has ended, or `failed` when the agent could not be started. At most one session per change may be running, and no two sessions may run in the same worktree — with one exception: a **Draft artifacts** session on `docs/<change>` ("A Draft session in a docs auto-merge project opens its proposal pull request") does not count towards that limit for any action but Draft, so that one other session of the change may run beside it on its own branch. A request to open a session for a change that already has one running SHALL return that running session and SHALL start no second process, create no second worktree and send nothing to a terminal, whatever action was asked for — **Archive** included, so one change never has two consoles — except that a running session on `docs/<change>` SHALL be returned only for Draft: any other action SHALL be opened as a session of its own (on `feat/<change>`, or its archive branch), or returned as the other running session when there is one, and sending any action but Draft into the session on `docs/<change>` SHALL be refused with a reason naming its branch. A card SHALL keep offering every starter but Draft and Fast-forward while the only running sessions of its change are on `docs/<change>`, and a Console tab SHALL offer only the steps its own session would receive. The refusals an opening is subject to still come first, so an action the change's stage does not allow is refused rather than answered with the running session. Where a session runs in place, in a tracked folder that is not a git repository, the same rule keeps a second agent out of that folder. **End session** SHALL terminate the agent as closing its terminal window would (hang-up, then a forced kill if it does not exit). When the agent's profile has a resume command, an ended session SHALL offer **Resume**, which starts that command in the same worktree within the same session. Because a terminal cannot outlive the process that owns it, stopping the dashboard MUST end every agent, and sessions recorded as running at start-up MUST be shown as ended with that reason.

#### Scenario: Duplicate open
- **WHEN** a session for a change is running and the same starter is used again
- **THEN** the existing session is returned and no second process is started

#### Scenario: Archive next to a running session
- **WHEN** a change's Implement session is still running, the change is in `Done`, and Archive is opened for it
- **THEN** no second session starts: the running session is returned, no archive worktree or branch is created, and Archive can instead be sent into that session

#### Scenario: A folder without git keeps one agent
- **WHEN** a session is running for a change in a tracked folder that has no `.git`, and Archive is opened for that change
- **THEN** the running session is returned and no second agent is started in that folder

#### Scenario: Agent exits
- **WHEN** the user quits the agent from within the terminal
- **THEN** the session becomes `exited` with the exit code, every attached viewer is told, and the terminal's output remains viewable

#### Scenario: Resume
- **WHEN** an ended session's agent has the resume command `claude`, `--continue` and the user presses Resume
- **THEN** that command is started in the session's worktree and the session is `running` again

#### Scenario: Dashboard stopped
- **WHEN** the dashboard receives a termination signal while a session is running
- **THEN** the agent is ended and the session is recorded as ended because the dashboard was stopped

#### Scenario: Implement beside the proposal session
- **WHEN** the Draft session of `rotate-keys` runs on `docs/rotate-keys` and the user activates **Implement** on its card
- **THEN** a second session starts on `feat/rotate-keys` in its own worktree, both run, and a further Draft goes into the session on `docs/rotate-keys` while a further Implement returns the one on `feat/rotate-keys`

#### Scenario: Implement sent into the proposal session
- **WHEN** Implement is sent into the running session on `docs/rotate-keys`
- **THEN** it is refused with a reason naming `docs/rotate-keys`, and nothing is typed

### Requirement: A merged auto-merge pull request ends its session
When the dashboard appends the Ship or Archive auto-merge instruction, or the proposal instruction of a Draft session ("A Draft session in a docs auto-merge project opens its proposal pull request"), to a prompt for a change session — starting the session, sending the action into its running session, or Ship — it SHALL record on that session the time it did so (the latest such time when it happens more than once). The same record is what makes a session eligible for an automatic Merge prompt ("A ready docs-only pull request is handed to its agent to merge"); a Merge prompt SHALL NOT change it. A session without that record SHALL never be ended or have its worktree removed by this requirement.

Whenever a pull-request query for a repository completes — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL look in that query's result for each session of that repository that carries the record, is not in place and did not adopt its worktree, and whose worktree still exists or whose agent still runs. When the result holds a pull request in the merged state whose head branch is that session's branch and whose merge time is later than the recorded time, and the repository has auto-merge of docs-only pull requests switched on at that moment, the dashboard SHALL, without asking, end the session's agent as ending the session does, and then remove its worktree under exactly the rules of "Worktree clean-up is offered only when safe": by a non-forcing `git worktree remove`, only when it holds no uncommitted change and either its work status is `merged` or no commit exists only on its branch. When those checks refuse, the agent SHALL still be ended, the worktree SHALL be kept, and the session SHALL keep the reason. It SHALL decide this only from the pull-request query's result and read-only git; it MUST NOT start a pull-request query, a `gh` process or a timer for it, MUST NOT fetch, and MUST NOT delete the session's branch or any other ref — the branch is left for repository cleanup. A session that this ended SHALL keep, and its panel and card SHALL show, that it was ended because pull request `#<number>` merged, and whether its worktree was removed or why it was kept. A merged pull request found again in a later query SHALL change nothing more. In the demo nothing SHALL be ended or removed.

#### Scenario: Archive pull request merges while the board is watching
- **WHEN** a repository has docs auto-merge on, the archive session of `rotate-keys` was started with the archive auto-merge instruction, its agent pushed branch `archive-rotate-keys` and opened `#88`, the dashboard sent it a Merge prompt once `#88` was ready, and a later pull-request watch refresh shows `#88` merged
- **THEN** the session's agent is ended, its clean, pushed worktree is removed, branch `archive-rotate-keys` still exists locally, and the panel says the session ended because `#88` merged and its worktree was removed

#### Scenario: Nothing was asked
- **WHEN** a pull-request refresh shows the pull request of an Implement session's branch merged, and that session's prompts never carried the auto-merge instruction
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Auto-merge switched off since
- **WHEN** the user switched docs auto-merge off for the repository after the Ship that carried the instruction, and a refresh then shows that pull request merged
- **THEN** the session keeps running and its worktree is kept

#### Scenario: An earlier pull request of the same branch
- **WHEN** a session's prompt carried the auto-merge instruction at 10:00 and the refresh shows a pull request of its branch that merged at 09:30
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
- **WHEN** the Draft session of `rotate-keys` on `docs/rotate-keys` was started with the proposal instruction, its agent opened `#90`, and a later refresh shows `#90` merged after that time while docs auto-merge is on
- **THEN** the session's agent is ended, its clean, pushed worktree `docs-rotate-keys` is removed, branch `docs/rotate-keys` still exists locally, and the panel says the session ended because `#90` merged
