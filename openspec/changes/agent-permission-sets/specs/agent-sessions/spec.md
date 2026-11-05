# Spec Delta

## ADDED Requirements

### Requirement: Predefined agent permission profiles and shared policy
The dashboard SHALL support three predefined, opt-in agent permission profiles across all supported agent runtimes:
1. `minimum`: Read-only inspection and planning. Only non-mutating actions (file reads, searches, directory listings, `git status`, `git diff`, `git log`, `openspec status`) SHALL be permitted without confirmation. Any modifying action, file edit, command execution, or network transmission SHALL require explicit user approval.
2. `less-friction`: Scoped implementation inside the change's isolated git worktree. File edits within the worktree, local test/check/build commands (`bun run check`, `npm test`, linters), git staging, git commits, pushing the task branch to `origin`, and creating or updating pull requests SHALL be authorized. Destructive operations (force push, branch deletion, worktree removal, modifications outside the worktree, checkouts of the default branch) SHALL require interactive user approval.
3. `full-automation`: Automated execution of standard Spec Control workflows (Draft, Implement, Validate, Ship, Archive, Conflict Resolution). Actions outside standard Spec Control operations SHALL require interactive confirmation. The profile SHALL support independent sub-capability opt-ins:
   - `optInMerge`: Authorizes the agent to merge a verified, approved pull request.
   - `optInCleanup`: Authorizes the agent to clean up merged task branches and worktrees.

When agent sessions are enabled and no permission profile is configured, the dashboard SHALL default to `minimum`. The dashboard SHALL NOT define or support any permission profile that passes global bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`).

#### Scenario: Minimum profile restricts mutations
- **WHEN** a session starts with the `minimum` permission profile
- **THEN** the agent is launched in a restricted plan/read-only mode requiring interactive confirmation for file writes and shell execution

#### Scenario: Less-friction profile authorizes worktree implementation and PR creation
- **WHEN** a session starts with the `less-friction` permission profile
- **THEN** the agent is launched with authorizations for editing worktree files, running validation commands, committing, pushing to `origin`, and managing pull requests without prompt interruptions

#### Scenario: Full-automation profile enables workflow execution with opt-in gates
- **WHEN** a session starts with `full-automation` and `optInMerge` is disabled
- **THEN** the agent executes implementation and shipping workflows automatically, but requires confirmation before performing pull request merges

#### Scenario: Default profile is minimum
- **WHEN** agent sessions are enabled in a fresh configuration without an explicit profile selection
- **THEN** sessions default to the `minimum` permission profile

### Requirement: Session-scoped permission adapter flag injection
The dashboard SHALL translate the effective permission profile into runtime-specific CLI arguments using dedicated agent adapters for Claude Code (`claude`), OpenAI Codex (`codex`), and Antigravity (`agy`):
- For Claude Code:
  - `minimum`: injects `--permission-mode plan`.
  - `less-friction`: injects `--permission-mode acceptEdits` and `--allowed-tools` specifying bash patterns for git inspection, staging, committing, branch pushing, PR operations, and package checks.
  - `full-automation`: injects `--permission-mode auto`.
- For OpenAI Codex:
  - `minimum`: injects `--sandbox read-only` and `--ask-for-approval on-request`.
  - `less-friction`: injects `--sandbox workspace-write` and `--ask-for-approval on-request`.
  - `full-automation`: injects `--sandbox workspace-write` and `--ask-for-approval never`.
- For Antigravity:
  - `minimum`: injects `--mode plan` and `--sandbox`.
  - `less-friction`: injects `--mode accept-edits`, `--sandbox`, and session-scoped tool authorizations.
  - `full-automation`: injects `--mode auto` and `--sandbox`.

Adapter-generated permission arguments SHALL be injected directly after the executable and any configured launch arguments, preceding command-tail arguments and opening prompts. If a profile uses an unrecognised agent CLI, the dashboard SHALL NOT inject adapter flags and SHALL log a warning.

#### Scenario: Claude adapter in less-friction mode
- **WHEN** an implement session is started with Claude Code under `less-friction`
- **THEN** the process command line contains `--permission-mode` `acceptEdits` and `--allowed-tools` with patterns for worktree git commands and package validation

#### Scenario: Codex adapter in minimum mode
- **WHEN** a draft session is started with Codex under `minimum`
- **THEN** the process command line contains `--sandbox` `read-only` and `--ask-for-approval` `on-request`

#### Scenario: Antigravity adapter in full-automation mode
- **WHEN** a session is started with Antigravity under `full-automation`
- **THEN** the process command line contains `--mode` `auto` and `--sandbox`

#### Scenario: Unrecognized agent CLI
- **WHEN** a session is started with a custom agent binary `my-agent`
- **THEN** no adapter permission arguments are injected and the command executes with its configured arguments unmodified

### Requirement: Ephemeral session configuration isolation and host preservation
Permission configurations generated by adapters SHALL be strictly ephemeral and scoped solely to child processes spawned by Spec Control:
1. The dashboard MUST NOT modify, overwrite, delete, or link user global agent configuration files (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/antigravity-cli/settings.json`, or environment variables).
2. Any temporary configuration files or session settings generated for an agent invocation MUST be created in a secure session-specific temporary directory outside tracked repositories and MUST be deleted when the session terminates.
3. The dashboard MUST NOT circumvent, weaken, or intercept host-level, enterprise, or OS-level security policies or sandbox constraints.

#### Scenario: Global configuration files remain untouched
- **WHEN** multiple sessions run and complete across Claude, Codex, and Antigravity
- **THEN** the user's global configuration files in their home directory remain completely byte-for-byte unmodified

#### Scenario: Ephemeral session settings are cleaned up
- **WHEN** a session requiring a temporary settings file terminates or is closed
- **THEN** the temporary settings file is immediately deleted from the filesystem

### Requirement: Permission profile inheritance and change overrides
The effective permission profile for a change session SHALL be resolved using hierarchical inheritance:
1. Per-change override (`repo.agentOverrides[change].permissionProfile`), if set;
2. Otherwise, per-repository setting (`repo.agent.permissionProfile`), if set;
3. Otherwise, global default (`config.agentSessions.defaultPermissionProfile`), if set;
4. Otherwise, `minimum`.

A running session SHALL record its active permission profile upon launch and keep it for the duration of the session. Updates to global, repository, or change permission settings SHALL take effect upon the next session start and MUST NOT mutate or restart running sessions.

#### Scenario: Per-change override takes precedence
- **WHEN** global default is `minimum`, repository setting is `minimum`, and change `fix-bug` has override `less-friction`
- **THEN** starting a session for `fix-bug` applies `less-friction`

#### Scenario: Repository setting overrides global default
- **WHEN** global default is `minimum` and repository setting is `less-friction`
- **THEN** changes in the repository without overrides start with `less-friction`

#### Scenario: Running session retains its launch profile
- **WHEN** a session is running with `minimum` and the repository permission profile is updated to `less-friction`
- **THEN** the running session process continues with `minimum` and the next session started uses `less-friction`

### Requirement: Separation of permissions from prompt instructions
Permission profiles SHALL govern only tool and execution authorizations. They MUST NOT substitute, remove, or modify workflow prompt instructions:
1. Authorizing git push or pull request tools SHALL NOT automatically trigger a push or pull request without an explicit user action or prompt instruction.
2. Prompts generated for starters (`draft`, `implement`, `validate`, `ship`, `archive`, `resolveConflicts`) SHALL retain their standard instructions regardless of the active permission profile.

#### Scenario: Implement prompt remains unchanged under less-friction
- **WHEN** an implement session is launched under `less-friction`
- **THEN** the prompt submitted to the agent contains the standard implement instructions and does not alter workflow steps based on granted permissions

### Requirement: Protected commands always require explicit confirmation
Inherently destructive, unrecoverable, or system-altering commands SHALL never be granted automatic approval under any permission profile, including `less-friction` and `full-automation`.

The dashboard and its agent permission adapters SHALL enforce interactive user confirmation for the following **protected commands**:
1. Recursive file or directory deletion (`rm -r*`, `rm -rf*`, `rmdir *`);
2. Destructive git history mutations (`git reset --hard*`, `git clean -f*`, `git checkout -f*`, `git restore --staged*`);
3. Remote repository force mutations (`git push *--force*`, `git push *-f*`, `git push origin +*`);
4. Privilege escalation and system management (`sudo *`, `su *`, `chmod *`, `chown *`, `brew *`, `apt *`, `apt-get *`);
5. Remote payload execution (`curl * | sh*`, `curl * | bash*`, `wget * | sh*`, `wget * | bash*`).

Adapters for runtimes supporting command-level restriction rules (such as Claude Code) SHALL omit these patterns from `--allowed-tools` and SHALL pass them to `--disallowed-tools` or runtime deny rules. For agent runtimes that do not support fine-grained command-level pattern whitelisting (such as OpenAI Codex), the dashboard SHALL preserve the interactive approval policy (`--ask-for-approval on-request`) for any shell command matching protected command heuristics or when execution leaves the workspace boundary.

#### Scenario: Recursive deletion triggers confirmation prompt
- **WHEN** an agent running under `less-friction` or `full-automation` attempts to execute `rm -rf ./build`
- **THEN** automatic approval is withheld and the command requires interactive user confirmation

#### Scenario: Force push triggers confirmation prompt
- **WHEN** an agent running under `less-friction` or `full-automation` attempts to execute `git push --force origin task-branch`
- **THEN** automatic approval is withheld and the command requires interactive user confirmation

#### Scenario: Normal worktree file deletion is unaffected
- **WHEN** an agent running under `less-friction` deletes an individual file using tool `Edit` or standard file-write operations within the worktree
- **THEN** the edit succeeds within the worktree without requiring confirmation for non-protected commands

### Requirement: Repository code execution risk disclosure
The dashboard SHALL explicitly inform users that validation checks, test runners, linters, and package build commands execute arbitrary code defined within the tracked repository. The dashboard MUST NOT describe any permission profile as harmless, safe, or sandboxed from untrusted code execution if the profile permits running repository scripts.

#### Scenario: Security notice accompanies profile activation
- **WHEN** a user inspects or selects the `less-friction` or `full-automation` permission profile
- **THEN** the system displays a clear disclosure that running tests and build scripts executes repository code
