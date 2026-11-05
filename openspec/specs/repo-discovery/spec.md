# repo-discovery Specification

## Purpose
Defines how the dashboard persists its configuration and discovers, tracks and names OpenSpec-enabled repositories, including the Settings view that exposes these controls.

## Requirements

### Requirement: Dashboard configuration is persisted in the user's home directory

The dashboard SHALL store its configuration in `~/.spec-control/config.json` containing `scanRoots`, `ignorePaths`, `repos` (each with `id`, `path`, `name`, `enabled`), `pollIntervalSeconds` and `port`, and optionally `setup`, whose only value is `"pending"` and which, when present, means the setup wizard of the `setup-wizard` capability has not been finished or skipped yet. The dashboard MUST create the directory and a default config on first start and MUST write config atomically (temp file + rename). All stored paths (`scanRoots`, `ignorePaths`, `repos[].path`) MUST be canonical: `~` expanded, symlinks resolved and spelled with their on-disk casing; a path that does not exist is stored normalised as given. When loading a config written by an earlier version, the dashboard MUST default a missing `ignorePaths` to an empty list, canonicalise stored paths, and merge repositories that resolve to the same directory — keeping the enabled entry, otherwise the first, together with that entry's name and id — and MUST NOT reset the config because of such entries. Loading MUST keep every well-formed stored repository `id` as it is, also when the entry's path now canonicalises to a different spelling of the same directory, and SHALL assign an id only to an entry that has none. A configuration created because none existed, or because the stored one was invalid and was reset to defaults, SHALL carry `setup: "pending"`; a configuration loaded from disk without `setup` SHALL load without it and MUST NOT gain it, and any other value of `setup` SHALL be dropped.

#### Scenario: First start creates default config
- **WHEN** the dashboard starts and `~/.spec-control/config.json` does not exist
- **THEN** it creates the directory and a config with empty `scanRoots`, empty `ignorePaths`, empty `repos`, `pollIntervalSeconds: 60`, `port: 4711` and `setup: "pending"`

#### Scenario: Config survives restart
- **WHEN** a user enables a repo and restarts the dashboard
- **THEN** the repo is still listed as enabled after restart

#### Scenario: Config without ignorePaths loads
- **WHEN** the stored config has no `ignorePaths` key
- **THEN** it loads with `ignorePaths: []` and all other values unchanged

#### Scenario: Legacy duplicate entries are merged
- **WHEN** the stored config contains the same directory twice under different spellings, one disabled and one enabled and renamed to "Beta SOC"
- **THEN** after loading, the config contains that directory once, with its canonical path, `enabled: true` and name "Beta SOC"

#### Scenario: An earlier configuration is not set up again
- **WHEN** the stored config was written by an earlier version and has no `setup` key
- **THEN** it loads without `setup` and is not rewritten to add it

#### Scenario: A reset configuration asks for setup
- **WHEN** the stored config is invalid and is moved aside and reset to defaults
- **THEN** the new config carries `setup: "pending"`

#### Scenario: A folder renamed by case keeps its id across a restart
- **WHEN** `/w/acme/Acme` is tracked with id `f055f4484961`, the folder is renamed to `/w/acme/acme` on a case-insensitive file system and the dashboard is restarted
- **THEN** the loaded config holds the repository with path `/w/acme/acme` and id `f055f4484961`, and its session records and activity history still belong to it

### Requirement: Discovery finds OpenSpec-enabled repositories under configured roots

The dashboard SHALL discover repositories by walking each given scan root to a bounded depth (default 4) and reporting directories that contain `openspec/config.yaml`. Scan roots MUST be canonicalised before walking so that every directory is reported at most once under its canonical path, however the roots were spelled or however they overlap. The walk MUST skip `node_modules`, `.git`, `.venv`, `target` and `dist` directories, MUST skip every directory that equals or lies below an ignore path, MUST NOT descend into a directory it reported (nested copies are not projects of their own), and MUST NOT report linked git worktrees (directories whose `.git` is a file). Discovery SHALL run whenever the user adds or removes a workspace root or an ignore path in Settings (against the edited values, without requiring a save), when Settings is opened with at least one root configured, when the projects overview runs it as the `project-overview` capability specifies (against the saved values), and when the user requests it explicitly. Discovery MUST be read-only: it MUST NOT modify the persisted configuration. Alongside those repositories, the same walk SHALL report **integratable** repositories as a separate result: directories with their own `.git` directory and no `openspec/config.yaml`. The walk MUST keep descending into an integratable repository, so which OpenSpec projects it reports is exactly what it was before; an integratable repository that contains a reported OpenSpec project MUST then be dropped from that separate result. A folder into which a clone of the `github-repositories` capability is still running MUST be reported in neither result.

#### Scenario: Repos are found under multiple roots
- **WHEN** scan roots are `~/Workspace/alpha` and `~/Workspace/acme` and both contain projects with `openspec/config.yaml`
- **THEN** discovery returns each project directory exactly once with its absolute path

#### Scenario: Overlapping roots do not duplicate
- **WHEN** scan roots are `~/Workspace` and `~/Workspace/alpha`
- **THEN** each project under `~/Workspace/alpha` is returned exactly once

#### Scenario: Differently spelled roots do not duplicate
- **WHEN** the file system is case-insensitive and scan roots are `~/Workspace/alpha` and `~/workspace/alpha`, or one root is a symlink to the other
- **THEN** each project is returned exactly once, with its on-disk path and a single id

#### Scenario: Ignored directories are skipped
- **WHEN** a scan root contains `node_modules/some-pkg/openspec/config.yaml`
- **THEN** that directory is not reported

#### Scenario: Ignore paths are skipped
- **WHEN** `ignorePaths` contains `~/Workspace/mirror/repos` and that directory holds checkouts with `openspec/config.yaml`
- **THEN** none of those checkouts are reported, while the same projects elsewhere under the roots still are

#### Scenario: Ignore path matches whole segments only
- **WHEN** `ignorePaths` contains `/w/repos` and a project exists at `/w/repos-extra/app`
- **THEN** `/w/repos-extra/app` is reported

#### Scenario: Nested copies and worktrees are not reported
- **WHEN** a repository contains `test/fixtures/other/openspec/config.yaml`, and a sibling directory is a linked worktree of that repository
- **THEN** only the repository itself is reported

#### Scenario: Missing scan root
- **WHEN** a given scan root does not exist
- **THEN** discovery reports an error for that root and still returns results from the other roots

#### Scenario: Adding a root triggers discovery immediately
- **WHEN** the user adds `~/Workspace/alpha` as a workspace root in Settings and has not saved
- **THEN** discovery runs against the edited roots without further user action and Settings states how many untracked repositories were found

#### Scenario: Removing a root triggers discovery immediately
- **WHEN** the user removes a workspace root in Settings
- **THEN** discovery runs against the remaining roots and repositories that were only found under the removed root are no longer counted

#### Scenario: Editing ignore paths triggers discovery immediately
- **WHEN** the user adds an ignore path in Settings and has not saved
- **THEN** discovery runs against the edited values and repositories below that path are no longer counted

#### Scenario: Removing the last root clears candidates
- **WHEN** the user removes the only workspace root
- **THEN** no discovery request is made and Settings counts no candidates

#### Scenario: Opening Settings runs discovery
- **WHEN** the user opens Settings and the config contains at least one workspace root
- **THEN** discovery runs and Settings states how many untracked repositories were found, without clicking anything

#### Scenario: Opening the overview runs discovery
- **WHEN** the user opens the projects overview and the config contains at least one workspace root
- **THEN** discovery runs against the saved roots and ignore paths and its result is listed under the overview's Unmanaged projects

#### Scenario: Discovery does not change the config
- **WHEN** discovery finds repositories that are not in the config
- **THEN** `~/.spec-control/config.json` is unchanged

#### Scenario: Only the latest discovery result is shown
- **WHEN** the user edits the roots twice in quick succession and the first discovery finishes after the second
- **THEN** the result shown reflects the second edit only

#### Scenario: Integratable repositories are reported alongside candidates
- **WHEN** a scan root holds `/w/acme/beta-soc` with `openspec/config.yaml` and `/w/acme/chat-groups`, a git repository without it
- **THEN** discovery reports `beta-soc` as a candidate and `chat-groups` as integratable, in two separate results

#### Scenario: The candidate list is unaffected
- **WHEN** discovery runs over roots that contain both OpenSpec projects and plain git repositories
- **THEN** the candidates are exactly those reported before integratable repositories were added, including projects nested inside a plain git repository

#### Scenario: A clone in progress is not reported
- **WHEN** a clone into `/w/acme/beta-soc` is running and its `.git` directory already exists, and discovery runs over `/w/acme`
- **THEN** `/w/acme/beta-soc` is neither a candidate nor integratable until the clone has finished

### Requirement: Tracking is opt-in per repository

Discovered repositories that are not already in the config SHALL be offered as candidates and MUST NOT be added to the config by discovery. A repository SHALL be added to the config only when the user acts for that one repository: by enabling that individual candidate (on the projects overview, where it takes effect at once), by starting an integration for that individual integratable repository after which `openspec/config.yaml` appears in it, or by cloning that repository with **Add from GitHub** (`github-repositories` capability), after which a clone holding `openspec/config.yaml` is added. In each case it is added with `enabled: true` and its default name. Only repositories with `enabled: true` are scanned and shown on the board. Repositories already present in the config MUST keep their `enabled` state, `name` and agent-session settings when discovery runs again and MUST NOT be listed as candidates; this comparison MUST use canonical paths, so a repository tracked under one spelling is never offered again under another. A repository SHALL leave the config only when the user forgets it on the projects overview, which is offered for disabled repositories only. Ignore paths affect discovery only: a repository already in the config stays configured even if it lies below an ignore path.

#### Scenario: Newly discovered repo is only a candidate
- **WHEN** discovery finds a repository that is not yet in the config
- **THEN** it is listed as a candidate, is not added to the config, and does not appear on the board

#### Scenario: Enabling a single candidate
- **WHEN** discovery lists candidates `a`, `b` and `c` and the user enables `b` on the projects overview
- **THEN** the config contains `b` with `enabled: true`, does not contain `a` or `c`, and `b` no longer appears in the candidate list

#### Scenario: Re-running discovery preserves user choices
- **WHEN** a repo was previously enabled, renamed to "Beta SOC" and switched off for agent sessions, and discovery runs again
- **THEN** the repo remains enabled with name "Beta SOC" and agent sessions off, and is not listed as a candidate

#### Scenario: Tracked repo is not offered under another spelling
- **WHEN** a repository is tracked and discovery runs with a root that reaches the same directory through a symlink or different casing
- **THEN** the repository is not listed as a candidate

#### Scenario: Disabled repo stays configured
- **WHEN** the user disables a tracked repo on the projects overview
- **THEN** it remains in the config with `enabled: false`, keeps its name, and is not listed as a candidate

#### Scenario: Forgotten repo becomes a candidate again
- **WHEN** the user forgets a disabled repo on the projects overview that still exists under a workspace root, and discovery runs
- **THEN** the repo is absent from the config and listed as a candidate with its default name

#### Scenario: Ignoring a path keeps tracked repos
- **WHEN** a tracked repository lies below a path the user adds to `ignorePaths`
- **THEN** the repository stays in the config and on the board

#### Scenario: A confirmed integration adds the repository
- **WHEN** the user starts an integration for `/w/acme/chat-groups` and `openspec/config.yaml` appears in it
- **THEN** it is added to the config with `enabled: true` and its default name, without the user pressing Enable for it

#### Scenario: An unconfirmed integration adds nothing
- **WHEN** the user starts an integration and no `openspec/config.yaml` appears
- **THEN** the config is unchanged and the repository is still listed as integratable

#### Scenario: A confirmed clone adds the repository
- **WHEN** the user clones `acme/beta-soc` into `/w/acme` with Add from GitHub and the clone holds `openspec/config.yaml`
- **THEN** `/w/acme/beta-soc` is added to the config with `enabled: true` and its default name, without the user pressing Enable for it

#### Scenario: A clone without OpenSpec adds nothing
- **WHEN** the user clones `acme/chat-groups` into `/w/acme` and it holds no `openspec/config.yaml`
- **THEN** the config is unchanged and `/w/acme/chat-groups` is listed as integratable

### Requirement: Repository display names are editable

Each repository SHALL have a display `name` defaulting to its directory basename, editable in Settings. When a candidate is enabled and its default name is already used by another repository in the configuration being edited, its name SHALL default to `<basename> (<parent directory name>)` instead. The repository `id` SHALL be derived from the repository's canonical absolute path when the repository is added to the configuration — by Enable, a confirmed integration, a tracked clone or the setup wizard — and SHALL then be kept: neither renaming it, nor a later change in how its path is spelled on disk (a case-only rename, the folder replaced by a symbolic link to it), nor validating or loading the configuration SHALL change it. When the id derived from a new repository's path is already held by another configured repository, the next id SHALL be derived deterministically from the same path, and discovery SHALL report a candidate with the id it would be added with. One directory MUST never have two ids: the configuration MUST NOT hold two repositories whose paths resolve to the same directory, and every check whether a path is already configured MUST compare canonical paths.

#### Scenario: Default name from directory
- **WHEN** `/w/acme/beta-soc` is discovered
- **THEN** its default name is `beta-soc`

#### Scenario: Rename keeps identity
- **WHEN** the user renames a repo on the projects overview
- **THEN** its `id` is unchanged and the board shows the new name

#### Scenario: Colliding default name is disambiguated
- **WHEN** `acme/pkg-tools` is tracked as `pkg-tools` and the user enables the candidate `ops/repo-mirror/repos/pkg-tools`
- **THEN** the new entry's name defaults to `pkg-tools (repos)`

#### Scenario: Same directory has one id
- **WHEN** the same directory is addressed as `/w/acme/app` and, on a case-insensitive file system, as `/W/acme/app`
- **THEN** both yield the same `id`

#### Scenario: Enabling a folder tracked under its old spelling
- **WHEN** `/w/acme/Acme` is tracked, the folder has been renamed to `/w/acme/acme`, and `/w/acme/acme` is enabled from the projects overview
- **THEN** the existing entry is enabled with its id unchanged and no second entry is added

#### Scenario: A taken id is not reused
- **WHEN** a repository keeps the id derived from `/w/acme/Tools` after its folder was renamed, and on a case-sensitive file system a new folder `/w/acme/Tools` is discovered
- **THEN** the candidate is reported with a different id, and enabling it stores that id

### Requirement: Settings view exposes discovery and configuration

The Settings view SHALL allow the user to add or remove scan roots, add or remove ignore paths, re-run discovery on demand, and set the poll interval. Next to the workspace roots it SHALL state how many untracked repositories the latest discovery run found — candidates and integratable repositories, each counted — with a link to the projects overview, where they are listed, enabled, integrated and ignored. Settings SHALL NOT list candidates or integratable repositories, and SHALL NOT offer to enable, disable, rename or forget a tracked repository or to change its agent-session settings: all of that is done on the projects overview. The view SHALL state that ignore paths only affect discovery. The view SHALL indicate while discovery is in progress and SHALL show per-root discovery errors. Running discovery MUST NOT save the draft configuration. Saving SHALL persist to config and trigger a scan when the poll interval changed.

#### Scenario: Enabling a repo triggers a scan
- **WHEN** the user enables a disabled repository on the projects overview
- **THEN** the config is persisted without visiting Settings and a scan starts so the repository's changes appear on the board without a manual refresh

#### Scenario: Discovery leaves unsaved edits unsaved
- **WHEN** the user changes the poll interval, then adds a workspace root, and discovery completes
- **THEN** the persisted config still has the old poll interval and old roots, and the unsaved-changes indicator is shown

#### Scenario: Root error is shown
- **WHEN** the user adds a workspace root that does not exist
- **THEN** Settings shows an error for that root next to the roots list and still counts the repositories found under the other roots

#### Scenario: Found repositories point to the overview
- **WHEN** discovery finds 2 candidates and 1 integratable repository
- **THEN** Settings states that 2 repositories using OpenSpec and 1 without it are not tracked, links to the projects overview, and lists none of them

#### Scenario: Manual rediscover
- **WHEN** the user creates a new OpenSpec project under an existing root and clicks Rediscover in Settings
- **THEN** the number of untracked repositories Settings states includes the new project

#### Scenario: Ignoring a candidate
- **WHEN** the user adds a candidate's path to the ignore paths in Settings
- **THEN** the path is added to the draft ignore paths, discovery re-runs, the candidate is no longer counted, and nothing is persisted until the user saves

#### Scenario: Integratable repositories are listed apart from candidates
- **WHEN** discovery reports both candidates and integratable repositories
- **THEN** Settings counts the two apart and lists neither, and the projects overview lists both under Unmanaged projects, each labelled with what it is

#### Scenario: Ignoring an integratable repository
- **WHEN** the user adds an integratable repository's path to the ignore paths in Settings
- **THEN** discovery re-runs, the repository is no longer counted, and nothing is persisted until the user saves

#### Scenario: Same-named repositories are distinguishable
- **WHEN** `acme/chat-groups` and `ops/repo-mirror/repos/chat-groups` are both tracked
- **THEN** on the projects overview one shows the hint `acme` and the other `ops/repo-mirror/repos`, a repository with a unique name shows no hint, and Settings shows neither

#### Scenario: Tracked repositories are not listed
- **WHEN** 17 repositories are tracked and the user opens Settings
- **THEN** the Workspace roots, Scanning and Agent sessions sections list none of them, and the Workspace roots section links to the projects overview

### Requirement: Repositories sharing a git remote are flagged, never merged

Discovery SHALL determine the `origin` remote URL of every candidate and every configured repository with a read-only git call, normalise it so that SSH and HTTPS forms of the same repository compare equal (ignoring a trailing `.git` and host letter case), and mark each candidate with the other known repositories — tracked or candidate — that share its remote. The projects overview SHALL show this on the candidate's entry as an informational badge naming those repositories. The dashboard MUST NOT hide, merge or disable a repository because of its remote. A repository without an `origin` remote, or one that is not a git repository, is never flagged.

#### Scenario: Second clone of a tracked project
- **WHEN** `acme/pkg-tools` is tracked and a candidate `ops/repo-mirror/repos/pkg-tools` has the same `origin`
- **THEN** the candidate is listed with a badge naming `pkg-tools` and can still be enabled

#### Scenario: Two untracked clones
- **WHEN** nothing is tracked and two candidates share an `origin`, one via `git@github.com:org/app.git` and one via `https://github.com/org/app`
- **THEN** both candidates are listed and each is flagged with the other

#### Scenario: Distinct projects sharing a remote stay separate
- **WHEN** `demo-ops` and `demo-agent` are different directories with the same `origin`
- **THEN** both remain separately listable, enableable and trackable

#### Scenario: No remote
- **WHEN** a candidate is not a git repository or has no `origin`
- **THEN** it is listed without a badge and discovery reports no error for it

### Requirement: Agent session settings are part of the configuration

The configuration SHALL contain an `agentSessions` object with `enabled` (default `false`), `agents` (at least one profile; default: the Claude Code profile and no other preset) and `defaultAgent` (the id of one of them), and each repository entry MAY carry `agent: { enabled, agentId, autoMergeDocs }` (default absent, meaning included, using the default agent and not auto-merging; `enabled: false` excludes the repository; `autoMergeDocs` is an optional boolean, absent meaning `false`, that lets Ship ask for auto-merge of a pull request changing only OpenSpec documents, as the `agent-sessions` capability specifies). A profile has `id`, `name`, `command` (a non-empty list of arguments whose first element is the executable and in which `{prompt}` is the only placeholder), `prompts` (optionally one template each for `draft`, `implement`, `validate`, `archive`, each containing `{change}` as its only placeholder, and optionally `integrate`, which MUST NOT contain any placeholder at all because the repository folder is the agent's working directory; a profile without `integrate` uses the agent-neutral default Integrate prompt), and optionally `resumeCommand` and `unsetEnv`. A configuration without these fields, or carrying settings of an earlier version of this feature, MUST load: missing fields take their defaults and unknown fields are dropped. Validation MUST reject duplicate agent ids, a `defaultAgent` or a repository `agentId` that names no configured agent, a repository `autoMergeDocs` that is not a boolean, an empty command, unknown placeholders, a starter prompt without `{change}`, an `integrate` prompt containing any placeholder, and any command, resume command or prompt containing a permission-bypass mode or flag.

#### Scenario: Older configuration loads
- **WHEN** the stored configuration has no `agentSessions` key, or has one written by the earlier transcript-based version
- **THEN** it loads with the Claude Code profile as the only and default agent, the stored `enabled` value kept (`false` when absent), and no repository excluded

#### Scenario: Unknown placeholder
- **WHEN** a configuration is saved with an agent prompt `/opsx:apply {change} {branch}`
- **THEN** it is rejected naming the unknown placeholder and the stored configuration is unchanged

#### Scenario: Bypass flag rejected
- **WHEN** an agent's command contains a flag that switches off the agent's permission checks
- **THEN** the configuration is rejected

#### Scenario: Repository names a removed agent
- **WHEN** a configuration is saved in which a repository selects an agent id that is not configured
- **THEN** it is rejected

#### Scenario: Integrate prompt with a placeholder
- **WHEN** a configuration is saved with an agent's `integrate` prompt containing `{change}`
- **THEN** it is rejected naming that placeholder and the stored configuration is unchanged

#### Scenario: Configuration without an Integrate prompt
- **WHEN** a configuration whose agents carry no `integrate` prompt is loaded
- **THEN** it loads unchanged, no `integrate` prompt is added to it, and those agents offer Integrate with the agent-neutral default prompt

#### Scenario: A saved Integrate prompt is kept
- **WHEN** a configuration whose Claude Code profile carries an `integrate` prompt is loaded
- **THEN** that prompt is kept as it is and used by Integrate

#### Scenario: Auto-merge is off unless set
- **WHEN** a configuration whose repositories carry `agent: { enabled: true }` or no `agent` at all is loaded
- **THEN** it loads unchanged, no `autoMergeDocs` is added to it, and Ship asks for no auto-merge in any of those repositories

#### Scenario: Auto-merge setting that is not a boolean
- **WHEN** a configuration is saved with a repository's `agent.autoMergeDocs` set to `"yes"`
- **THEN** it is rejected and the stored configuration is unchanged

### Requirement: Settings expose agent sessions with their risks stated

The Settings view SHALL provide a section for agent sessions containing the global switch; the list of agent profiles, each editable (name, command with one argument per line, its prompts including the Integrate prompt, resume command), removable while another remains, selectable as default, and marked with whether its executable was found on this machine; a way to add a profile and to add every preset that is not configured yet, each preset offered marked with whether its executable was found on this machine and the found ones listed first; and a note, linking to the projects overview, that each tracked repository's switch — on by default — and, when more than one agent is configured, its choice of agent are set there. The section MUST state plainly that enabling it lets the dashboard start that program on this machine, that the agent can change files and run commands as the user allows it to, that each session works in its own worktree under the dashboard home and never in a main checkout, the one exception being an integration session, which runs in the repository folder itself, and that it applies to every tracked repository unless switched off. The controls below the switch MUST be inactive while it is off.

The section SHALL be organised as headed groups, in this order: the switch with that statement; **Agents** (the profiles and the ways to add one); **Shortcuts**; **Console**; **Projects** (the note above). Within each profile the fields SHALL be grouped under their own headings: **Command** (name, command, resume command); **Change starters** (the Draft artifacts, Implement, Validate and Archive prompts); and **Action prompts** (the Ship, Resolve conflicts and Integrate prompts). Each prompt's additional instructions SHALL be shown directly with that prompt, labelled as belonging to it, and never separated from it by another prompt. A profile's header SHALL show its name, its command, whether it is the default, whether its executable was found, and the controls to make it the default and to remove it, so that these work without expanding the profile. The section SHALL NOT list session worktrees: they are shown, with their work status and the actions on them, in Open work and the change detail.

#### Scenario: Enabling and excluding one repository
- **WHEN** the user turns on the global switch in Settings and saves, and switches repository `beta-soc` off on the projects overview
- **THEN** cards of every other tracked repository offer session starters and cards of `beta-soc` do not

#### Scenario: Adding an agent
- **WHEN** the user adds an agent, enters its command one argument per line and an Implement prompt, and saves
- **THEN** the agent is stored with that argument list, is offered in each repository's agent choice, and shows whether its executable was found

#### Scenario: Adding a preset
- **WHEN** `agy` is found on this machine, `codex` is not, the configuration lists only the Claude Code profile, and the user opens the agent sessions section
- **THEN** the Antigravity preset is offered first and marked as found, the Codex preset is offered after it and marked as not found, the Claude Code preset is not offered, and choosing Antigravity and saving stores it as an ordinary profile that the user can edit or remove

#### Scenario: A configured preset is not offered again
- **WHEN** a profile with the id `agy` is configured, edited or not
- **THEN** the Antigravity preset is not offered

#### Scenario: Restoring a removed preset
- **WHEN** the user removed the Claude Code profile and saved
- **THEN** the Claude Code preset is offered again, and choosing it adds the profile with its current preset prompts

#### Scenario: Editing the Integrate prompt
- **WHEN** the user edits an agent profile's Integrate prompt and saves
- **THEN** the prompt is stored and used the next time **Integrate** is activated for that agent

#### Scenario: The in-place exception is stated
- **WHEN** the agent sessions section is shown
- **THEN** it says that sessions run in their own worktree and never in a main checkout, except an integration session, which runs in the repository folder itself

#### Scenario: The section's groups
- **WHEN** agent sessions are enabled and the user opens the Agent sessions section
- **THEN** below the switch it shows the headings Agents, Shortcuts, Console and Projects in that order, and no other group

#### Scenario: A profile's fields are grouped
- **WHEN** the user expands the Claude Code profile
- **THEN** its name, command and resume command are under Command; its Draft artifacts, Implement, Validate and Archive prompts under Change starters; its Ship, Resolve conflicts and Integrate prompts under Action prompts; and each prompt's additional instructions follow that prompt before the next prompt begins

#### Scenario: Making a profile the default without expanding it
- **WHEN** two profiles are configured and the collapsed one's header is shown
- **THEN** its header offers Make default and Remove agent, and activating Make default marks it as the default without expanding it

#### Scenario: No worktree list in Settings
- **WHEN** a session worktree exists and the user opens the Agent sessions section
- **THEN** the section lists no worktree, and the worktree is still listed in Open work

### Requirement: An agent profile may carry a Ship prompt

An agent profile MAY contain a `ship` prompt next to its starter prompts. It is validated like them except that the `{change}` placeholder is optional. Settings SHALL offer it for editing and show the default that applies when it is empty. Configs without it MUST load unchanged.

#### Scenario: Existing config
- **WHEN** a config written before this change is loaded
- **THEN** it loads without warning and Ship uses the default prompt

#### Scenario: Bypass flag in a Ship prompt
- **WHEN** a config's Ship prompt contains a permission-bypass flag
- **THEN** the config is rejected like any other prompt containing one

### Requirement: Settings show the default Integrate prompt

Settings SHALL show, for each agent profile, the agent-neutral default Integrate prompt as the placeholder of an empty
Integrate prompt field and SHALL say that leaving it empty uses that default; it MUST NOT say that an empty Integrate
prompt makes the agent offer no Integrate action. Clearing the field and saving SHALL store the profile without an
`integrate` prompt. The hint for additional Integrate instructions SHALL say that they are appended to the Integrate
prompt or, when it is empty, to the default.

#### Scenario: Empty field shows the default
- **WHEN** the Settings view shows an agent profile without an `integrate` prompt
- **THEN** the Integrate prompt field is empty, shows the default prompt as its placeholder, and its hint says that empty uses the default

#### Scenario: Clearing the prompt
- **WHEN** the user clears an agent's Integrate prompt and saves
- **THEN** the stored profile has no `integrate` prompt and **Integrate** stays available, using the default

### Requirement: Discovery never re-adds a forgotten repository

Running discovery SHALL NOT add to the configuration a repository the user forgot, by any path — including the
re-check of integration sessions that discovery performs (`repo-integration` capability). A forgotten repository under
a workspace root SHALL be listed as a candidate until the user enables it.

#### Scenario: A repository set up with Integrate is forgotten
- **WHEN** the user forgets the disabled repository `/w/acme/alpha-infra`, which was added by a confirmed integration, and discovery runs
- **THEN** `/w/acme/alpha-infra` is absent from the configuration and listed as a candidate with its default name
