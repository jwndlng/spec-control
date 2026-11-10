# Design

## Context

See `proposal.md` — Why for motivation. Today, Spec Control provides an agent session orchestrator (`src/server/sessions/`) that launches interactive terminal processes for AI coding assistants (Claude Code, OpenAI Codex, Antigravity) inside isolated git worktrees (`~/.spec-control/worktrees/`).

Currently, agent profiles (`AgentProfile` in `src/shared/types.ts`) only support static `command` lines and user-configured `launchArgs`. There is no first-class abstraction for agent permissions or approval policies. Consequently, users either face frequent interactive permission approval prompts when agents attempt to run tests, stage files, or push branches, or users resort to adding dangerous bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`) directly to `launchArgs`. Spec Control's configuration validation already explicitly bans bypass flags in `launchArgs` to prevent catastrophic whole-system exposure, but lacks a structured, secure mechanism to grant fine-grained, scoped permissions for routine development operations.

Furthermore, installed agents implement radically different security and approval models:
- **Claude Code**: Provides fine-grained command-pattern filtering (`--allowed-tools "Bash(git *)"`) and structured permission modes (`--permission-mode plan|acceptEdits|auto`).
- **OpenAI Codex**: Employs an OS/filesystem sandbox (`--sandbox read-only|workspace-write`) and approval policies (`--ask-for-approval on-request|never`), but does not offer per-command regex/pattern authorization.
- **Antigravity**: Provides execution modes (`--mode plan|accept-edits|auto`), a terminal restrictions sandbox (`--sandbox`), and ephemeral session settings (`--settings`).

This design establishes an extensible, strongly typed permission policy model, dedicated runtime adapters, ephemeral session isolation, and comprehensive UI transparency controls.

## Goals / Non-Goals

**Goals:**
- Provide three standardized permission profiles (`minimum`, `less-friction`, `full-automation`) that map cleanly across Claude Code, OpenAI Codex, and Antigravity.
- Define a modular, object-oriented adapter architecture (`AgentPermissionAdapter`) that translates abstract policies into concrete CLI arguments and session settings.
- Enforce strict session scoping: child processes receive ephemeral permission settings; user global agent configurations (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/antigravity-cli/settings.json`) are never touched.
- Provide full transparency in Settings and launch dialogues: show an effective CLI argument preview, cross-agent capability matrix, and explicit repository code execution risk disclosures.
- Implement hierarchical profile inheritance: Global default → Per-repository setting → Per-change override.
- Enforce an immutable protected commands safety guardrail: high-risk operations (e.g. `rm -rf`, `git push --force`, `git reset --hard`, `sudo`) always require interactive user approval across all profiles.
- Decouple tool authorization from prompt orchestration: granting an agent the ability to push or create a PR does not replace or alter the prompt instructing it to do so.

**Non-Goals:**
- Creating a proprietary hypervisor or OS-level sandbox within Spec Control itself: Spec Control relies on the agents' native sandboxing and permission switches.
- Enabling or supporting unconstrained global bypass flags: Spec Control will never generate or permit bypass flags.
- Automating post-PR actions (merging, branch deletion, deployment) in the initial scope without explicit user opt-in flags (`optInMerge`, `optInCleanup`).
- Modifying third-party or remote infrastructure permissions (e.g., GitHub tokens, AWS credentials, npm registry tokens).

## Decisions

### Decision 1: Shared Abstract Policy with Runtime Adapters vs. Raw Per-Agent Flag Inputs
- **Choice**: Introduce a unified `AgentPermissionPolicy` interface and polymorphic `AgentPermissionAdapter` implementations (`ClaudeAdapter`, `CodexAdapter`, `AntigravityAdapter`).
- **Rationale**: User-configured raw CLI flags lead to syntax errors, platform drift, and accidental security misconfigurations. An abstract policy decouples Spec Control's domain logic from volatile CLI flags of third-party tools.
- **Alternatives Considered**:
  - *Raw Flag Strings*: Let users enter flags per profile. Rejected because it fails to provide unified profiles across different agents, cannot render meaningful cross-agent capability matrices, and risks users entering banned bypass flags.
  - *Hardcoded Switch Statements in `agents.ts`*: Rejected as monolithic and difficult to test; violates Open-Closed Principle for future agent support.

### Decision 2: Ephemeral Process Arguments & Temporary Session Files vs. Global Config Modification
- **Choice**: Pass all permissions via CLI flags (`--permission-mode`, `--allowed-tools`, `--sandbox`, `--ask-for-approval`) and ephemeral session-scoped config files passed via `--settings` or `-c`.
- **Rationale**: Preserves user trust and adheres to Spec Control invariants. Modifying global configuration files (`~/.claude.json`, `~/.codex/config.toml`) risks corrupting the user's personal setup, leaking permissions across unrelated terminal sessions, and creating race conditions between concurrent sessions.
- **Alternatives Considered**:
  - *Modifying Global Agent Configs with Rollback*: Writing permissions to `~/.claude.json` on session start and reverting on exit. Rejected because process crashes, force-kills, or power failures would leave global configurations permanently altered.

### Decision 3: Profile Defaulting to `minimum` with Opt-In to `less-friction`
- **Choice**: Default new installations and unset configurations to `minimum` (plan/read-only), while recommending `less-friction` for active development workflows.
- **Rationale**: Adheres to the principle of least privilege. Automating mutations and test runs should be an intentional user choice.
- **Alternatives Considered**:
  - *Default to `less-friction`*: While convenient, running repository code (tests and build scripts) automatically may pose security risks when opening untrusted repositories.

### Decision 4: Handling Architectural Differences in Agent Capabilities
- **Choice**: Implement the adapter interface to synthesize the closest safe approximation for each agent, while documenting limitations in an explicit `AgentCapabilityMatrix`:
  - *Claude Code*: Uses `--permission-mode acceptEdits` combined with specific `--allowed-tools "Bash(git *)" "Bash(gh pr *)" "Bash(bun run check*)"`.
  - *OpenAI Codex*: Uses `--sandbox workspace-write --ask-for-approval on-request`. Because Codex cannot filter bash sub-commands, the UI clearly discloses that shell operations are constrained by Codex's workspace sandbox rather than command regexes.
  - *Antigravity*: Uses `--mode accept-edits --sandbox` and session-scoped tool policies via ephemeral `--settings`.
- **Rationale**: Transparently acknowledging runtime variance is better than claiming false parity or restricting all agents to the lowest common denominator.
- **Alternatives Considered**:
  - *Lowest Common Denominator*: Restricting all agents to simple yes/no approval prompts. Rejected because it negates the primary benefit of fine-grained agents like Claude Code.

### Decision 5: Phased Implementation with Merge and Cleanup as Separate Gated Opt-Ins
- **Choice**: The core `less-friction` profile covers drafting through PR creation. PR merging (`optInMerge`) and worktree/branch cleanup (`optInCleanup`) are modeled as separate boolean opt-ins under `full-automation`.
- **Rationale**: Creating a pull request is non-destructive and creates an external review boundary. Merging code into the main branch or deleting local/remote branches carries significantly higher blast radius and should require explicit opt-in.
- **Alternatives Considered**:
  - *Bundling merge and cleanup into `less-friction`*: Rejected as unsafe.

### Decision 6: Defense-in-Depth Protected Commands Policy (Allowlist + Denylist)
- **Choice**: Implement an immutable, runtime-enforced `ProtectedCommandPolicy` identifying destructive or system-altering commands (recursive deletion `rm -rf`, force-pushing `git push --force`, hard git reset `git reset --hard`, destructive clean `git clean -fdx`, privilege escalation `sudo`, piping to shell `curl | sh`). These commands are strictly excluded from automated approval across all profiles, requiring interactive human confirmation.
- **Rationale**: While positive allowlisting (`--allowed-tools "Bash(git status*)"`) is the primary defense, allowlist patterns can unintentionally over-match (e.g. `Bash(git *)` or broad tool permissions in `full-automation`). Introducing an explicit negative barrier ensures high-risk operations cannot be executed autonomously regardless of configuration.
- **Alternatives Considered**:
  - *Rely solely on positive allowlists*: Rejected because in `full-automation` or broader tool authorizations, positive allowlists may lack the granularity to prevent an agent from running `rm -rf` or `git reset --hard`.
  - *User-configurable denylist*: Rejected because security invariants should protect users by default without requiring manual configuration of obvious destructive footguns.

## Architecture & Class Design

```
+-------------------------------------------------------------+
|                     Spec Control Core                       |
|                                                             |
|   Config / UI                SessionManager                 |
|   (Profile Selection)        (Lifecycle & Worktrees)        |
+-------------------+--------------------+--------------------+
                    |                    |
                    v                    v
      +-----------------------------+    |
      |   PermissionPolicyResolver  |    |
      +--------------+--------------+    |
                     |                   |
                     v                   |
      +-----------------------------+    |
      |    AgentPermissionPolicy    |    |
      +--------------+--------------+    |
                     |                   |
                     v                   v
      +--------------------------------------------------+
      |            PermissionAdapterRegistry             |
      +--------------------------------------------------+
          |                   |                     |
          v                   v                     v
+-------------------+ +-------------------+ +-------------------+
|  ClaudeAdapter    | |   CodexAdapter    | |AntigravityAdapter |
+-------------------+ +-------------------+ +-------------------+
          |                   |                     |
          v                   v                     v
  --permission-mode     --sandbox             --mode
  --allowed-tools       --ask-for-approval    --sandbox
                        -c key=value          --settings
```

### Class Model (SWE / Modular Structure)

```typescript
// Core domain interfaces
export type AgentPermissionProfileId = 'minimum' | 'less-friction' | 'full-automation';

export interface AgentPermissionPolicy {
  readonly profileId: AgentPermissionProfileId;
  readonly fileAccess: 'read-only' | 'workspace-write';
  readonly allowCheckCommands: boolean;
  readonly allowGitStagingAndCommit: boolean;
  readonly allowGitPush: boolean;
  readonly allowPullRequestCreation: boolean;
  readonly optInMerge: boolean;
  readonly optInCleanup: boolean;
  readonly protectedCommands: readonly string[];
}

export interface ProtectedCommandPolicy {
  isProtected(command: string): boolean;
  getProtectedPatterns(): readonly RegExp[];
}

export interface AdapterResult {
  readonly cliArgs: readonly string[];
  readonly ephemeralSettingsFile?: {
    readonly path: string;
    readonly content: string;
  };
  readonly runtimeNotes: readonly string[];
}

export interface AgentPermissionAdapter {
  readonly agentType: 'claude' | 'codex' | 'agy' | 'generic';
  supports(executable: string): boolean;
  buildAdapterArgs(policy: AgentPermissionPolicy, context: SessionContext): AdapterResult;
}
```

## Agent Capability Matrix

| Capability / Dimension | Claude Code (`claude`) | OpenAI Codex (`codex`) | Antigravity (`agy`) |
| :--- | :--- | :--- | :--- |
| **Execution Modes** | `plan`, `acceptEdits`, `auto`, `default` | Approvals: `on-request`, `never` | `plan`, `accept-edits`, `auto` |
| **Filesystem Sandboxing** | Worktree root + `--add-dir` | OS sandbox (`read-only`, `workspace-write`) | Built-in terminal sandbox (`--sandbox`) |
| **Command-Level ACLs** | Regex/pattern matching via `--allowed-tools "Bash(cmd*)"` | None (all permitted inside sandbox) | Tool whitelist via session `--settings` |
| **Interactive Prompts** | Controlled via `--permission-mode` | Controlled via `--ask-for-approval` | Controlled via `--mode` |
| **Protected Command Enforcement** | Enforced via `--disallowed-tools` / allowlist exclusion | Handled via approval policy & workspace boundary | Enforced via session `--settings` tool policy |
| **Ephemeral Session Config** | `--settings <inline-or-file>` | `-c key=value` overrides | `--settings <inline-or-file>` |
| **Dangerous Bypass Flag** | `--dangerously-skip-permissions` *(BANNED)* | `--dangerously-bypass-approvals-and-sandbox` *(BANNED)* | `--dangerously-skip-permissions` *(BANNED)* |

## Security Boundaries & Threat Model

1. **Host Integrity Invariant**:
   - Spec Control never bypasses system boundaries.
   - Global configs (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/antigravity-cli/settings.json`) are immutable from Spec Control's perspective.
2. **Worktree Isolation**:
   - Agents are spawned with `cwd` set to `~/.spec-control/worktrees/<id>/<change-name>`.
   - File edits and git operations are confined to the task worktree.
3. **Arbitrary Code Execution Disclosure**:
   - `less-friction` authorizes running `bun run check`, `npm test`, linters, and build scripts.
   - Any script executed via `package.json` can execute arbitrary native code.
   - Mitigation: Spec Control explicitly surfaces this risk in the UI and never describes `less-friction` or `full-automation` as safe against malicious repositories.
4. **Network Access Boundaries**:
   - `minimum` forbids network transmission tools.
   - `less-friction` authorizes pushing to `origin` and interacting with GitHub PR APIs (`gh pr`).
   - Third-party network requests remain governed by agent CLI environment variables.
5. **Protected Commands Safety Boundary**:
   - High-risk operations (recursive file deletion `rm -rf`, force pushes `git push --force`, destructive resets `git reset --hard`, privilege escalation `sudo`, remote script execution `curl | sh`) are barred from autonomous execution.
   - In Claude Code, these patterns are omitted from `--allowed-tools` and registered in `--disallowed-tools`.
   - In OpenAI Codex, approval policies preserve interactive prompts when destructive operations are requested.
   - In Antigravity, session-scoped tool restrictions in `--settings` mandate interactive confirmation for protected patterns.

## Risks / Trade-offs

- **[Agent CLI Flag Evolution]** → Third-party agent CLIs may deprecate or modify flags in future releases.
  - *Mitigation*: The adapter registry isolates flag generation into modular classes with dedicated unit test coverage matching CLI versions.
- **[Codex Coarse Command Granularity]** → Codex lacks per-command pattern filters, meaning `workspace-write` permits any shell command that writes within the workspace.
  - *Mitigation*: The capability matrix and Settings UI explicitly display this limitation to the user.
- **[Ephemeral Settings Cleanup Failure]** → An agent process might exit abruptly, leaving temporary files in `~/.spec-control/sessions/<id>/`.
  - *Mitigation*: Register process exit handlers and sweep orphan session configuration directories on Spec Control startup and session cleanup.

## Phased Implementation Plan

1. **Phase 1: Domain Types & Config Schema**
   - Define `AgentPermissionProfileId`, `AgentPermissionPolicy`, and config schemas.
   - Implement `resolvePermissionPolicy` inheritance hierarchy.
   - Add unit tests for config validation and inheritance.
2. **Phase 2: Adapter Implementations**
   - Implement `AgentPermissionAdapter`, `ClaudeAdapter`, `CodexAdapter`, and `AntigravityAdapter`.
   - Implement `PermissionAdapterRegistry`.
   - Unit test each adapter across all three profiles.
3. **Phase 3: Session Launcher Integration**
   - Integrate adapter resolution into `launchCommand` in `src/server/sessions/agents.ts`.
   - Handle ephemeral file creation and deterministic cleanup in `SessionManager`.
4. **Phase 4: API Endpoints**
   - Add `GET /api/repos/:id/agent-permissions` for effective policy resolution and CLI preview.
   - Add change-level override endpoint `POST /api/repos/:id/changes/:change/permission-profile`.
5. **Phase 5: User Interface**
   - Add permission profile selector, sub-capability checkboxes, capability matrix, and CLI preview in `src/ui/settings.tsx`.
   - Add risk disclosure banner.
   - Add What's New entry in `src/ui/changelog.ts`.

## Open Questions

1. **Custom Agent Fallback Policy**: Should user-defined custom agent binaries (e.g. `custom-agent-cli`) default to passing no permission arguments, or allow users to define a custom argument template?
   - *Current Design*: Default to no argument injection (safe no-op) with a warning. Custom profiles can continue using `launchArgs`.
2. **Ephemeral Config File Location**: Should ephemeral settings be passed inline as JSON strings (e.g. `--settings '{"..."}'`) or as temporary files written under `~/.spec-control/sessions/<id>/`?
   - *Current Design*: Prefer inline JSON arguments when argument length limits allow, falling back to session-isolated temporary files if command line length exceeds OS limits (e.g., on Windows/macOS execve limits).
