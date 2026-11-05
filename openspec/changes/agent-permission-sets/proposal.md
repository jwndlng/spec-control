# Proposal: Predefined Agent Permission Profiles

## Why

Claude Code, OpenAI Codex, and Antigravity currently require different amounts of prompt-tuning and repetitive permission approvals to complete the standard Spec Control lifecycle. While Spec Control automates change worktrees and prompt initiation, completing an implementation task normally requires running local test suites, formatting and staging code, creating git commits, pushing a task branch to `origin`, and opening a pull request—operations that frequently trigger disruptive interactive confirmation prompts or fail when an agent lacks explicit tool authorizations.

Without unified, scoped permission profiles, users face an unappealing trade-off: either manually approving dozens of routine file-writes and git commands in the terminal, or passing dangerous global bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`) that disable security boundaries across their entire system. Introducing predefined, opt-in permission profiles with runtime-specific adapters allows Spec Control to minimize friction for trusted workflows while strictly confining mutations to the change's isolated worktree, preserving user and enterprise security boundaries, and never touching global agent configurations.

## What Changes

- **Predefined Permission Profiles**: Introduce three standardized, opt-in permission tiers across all supported agents:
  1. `minimum`: Read-only inspection and planning. Authorizes file reading, repository searches, and status inspection (`git status`, `git log`, `git diff`, `openspec status`). All mutating actions (file edits, script execution, commits, pushes, network calls) strictly require user confirmation.
  2. `less-friction` (Recommended default for active work): Scoped implementation inside the change's isolated git worktree. Authorizes local file modifications, standard validation checks (`bun run check`, `npm test`, linters), git staging and commits, pushing the task branch to `origin`, and opening or updating the change's pull request. Destructive actions, operations outside the worktree, merges, default-branch checkouts, and deployment scripts require interactive approval.
  3. `full-automation`: End-to-end execution of known Spec Control workflows (Draft, Implement, Validate, Ship, Archive, Conflict Resolution). Includes sub-capability opt-ins for autonomous PR merges (`optInMerge`) and worktree/branch cleanups (`optInCleanup`). Unrecognized commands and out-of-scope system modifications continue to require interactive confirmation.
- **Shared Permission Policy Abstraction & Agent Adapters**: Define a strongly typed, agent-neutral permission model (`AgentPermissionPolicy`) mapped to CLI runtimes via dedicated adapters:
  - `ClaudeAdapter`: Maps policies to `--permission-mode` (`plan`, `acceptEdits`, `auto`), `--allowed-tools` patterns (`Bash(git *)`, `Bash(gh pr *)`, `Bash(bun run check)`), and ephemeral session settings (`--settings`).
  - `CodexAdapter`: Maps policies to `--sandbox` (`read-only`, `workspace-write`), `--ask-for-approval` (`on-request`, `never`), and session config overrides (`-c`).
  - `AntigravityAdapter`: Maps policies to `--mode` (`plan`, `accept-edits`, `auto`), `--sandbox`, and session-scoped `permissions.allow` settings passed via `--settings`.
- **Protected / High-Risk Commands Invariant**: Inherently destructive, system-level, or unrecoverable commands (e.g. `rm -rf`, recursive deletions, `git push --force`, `git reset --hard`, `git clean -fdx`, `sudo`, piping remote URLs into shells `curl | sh`) MUST always require interactive user confirmation and SHALL never be auto-approved, regardless of the active permission profile or opt-in settings. Adapters enforce this through strict allowlist filtering, explicit tool disallow patterns, and session policy constraints.
- **Strict Session Scoping & Host Invariants**: Permissions apply solely to individual agent child processes spawned by Spec Control. User global configuration files (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/antigravity-cli/settings.json`) are never read, modified, or bypassed. Spec Control never overrides or weakens enterprise or host-level security restrictions.
- **Explicit Capability Matrix & Transparency Preview**: Settings and change launch dialogs display an effective permission preview before enabling a profile, showing the exact CLI flags passed, granted tools, and runtime limitations (such as Codex's workspace-level vs. Claude's command-level filtering).
- **Security Notice for Repository Code Execution**: Spec Control explicitly documents and highlights in the UI that running tests, linters, and package scripts executes repository code, rejecting any claim that automated profiles are "harmless."
- **Hierarchical Inheritance & Persistence**: Permission profiles inherit cleanly from global default (`config.agentSessions.defaultPermissionProfile`, defaulting to `minimum`) to per-project setting (`repo.agent.permissionProfile`) to per-change override (`repo.agentOverrides[change].permissionProfile`). Profile choices persist in Spec Control's `config.yaml` without mutating repository files. Running sessions record their active profile upon launch; changes apply to subsequent sessions.
- **Separation of Authorization vs. Orchestration**: Workflow instructions (prompts, task directions, convention titles) remain decoupled from permission flags: granting `gh pr create` authority does not assume or replace the prompt instructing the agent to open the pull request.
- **Scoped Initial Implementation**: The core implementation focuses on drafting through pull request creation. Merging, archiving, branch cleanup, and custom command execution are modeled as explicit separate capabilities with independent opt-in gates.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: Defines the three permission profiles (`minimum`, `less-friction`, `full-automation`), the agent-neutral permission policy, CLI adapter synthesis for Claude Code, Codex, and Antigravity, session-scoped ephemeral flag injection, and configuration inheritance and overrides.
- `settings-page`: Adds permission profile configuration and defaults to the Agent sessions section, providing a cross-agent capability matrix, effective CLI preview, runtime limitation notes, and repository code execution risk disclosures.
- `dashboard-api`: Extends `Config` models with permission profile configurations and adds an API endpoint to query effective permission parameters, CLI flags, and agent capabilities for any repository and change.

## Impact

- `src/shared/types.ts`: Adds `AgentPermissionProfileId`, `AgentPermissionPolicy`, `AgentPermissionCapabilityMatrix`, and extends `AgentSessionsConfig`, `RepoAgentConfig`, and `ChangeAgentOverride`.
- `src/shared/agentDefaults.ts`: Defines profile constants, default policy objects, and adapter contracts.
- `src/server/sessions/permissionAdapters.ts`: New module implementing `AgentPermissionAdapter`, `ClaudeAdapter`, `CodexAdapter`, and `AntigravityAdapter`.
- `src/server/sessions/agents.ts`: Incorporates adapter-generated command-line arguments and ephemeral settings into agent launch configurations.
- `src/server/sessions/manager.ts`: Resolves hierarchical permission profiles during session creation, records active permissions in session state, and cleans up any ephemeral session configurations.
- `src/server/api.ts`: Adds `GET /api/repos/:id/agent-permissions` and handles updated permission profile fields in `PATCH /api/config`.
- `src/ui/settings.tsx`, `src/ui/settingsSections.ts`, `src/ui/projectSettings.tsx`: Renders permission selection controls, security warning banners, capability comparison matrices, and argument previews.
