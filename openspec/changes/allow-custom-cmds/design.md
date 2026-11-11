# Design

## Context

See `proposal.md` for motivation and `specs/` for the behavior contract. Project agent settings live in Spec Control's home configuration, with updates through `withRepoAgent` and `POST /api/repos/:id/agent`. `resolvePermissionPolicy` currently resolves profile capabilities; `permissionAdapters` supplies both preview and launch arguments. The Claude adapter has a fixed allowlist. The Codex adapter has workspace-level permissions; the Antigravity adapter returns settings but has no per-session settings delivery. These limitations are explicit in the current adapter code.

The existing worktree and host-policy boundaries remain authoritative. Saving a command is a configuration change, not permission for the dashboard to execute it. Project consoles run in place, so the editor must not promise that every command runs in a worktree.

## Goals / Non-Goals

**Goals:** carry one normalized project list through config, API, policy, preview and applicable process launches; keep preview honest about runtime capabilities; preserve defaults, restrictions and launch isolation.

**Non-Goals:** global or per-change command lists, an arbitrary shell-rule language, running commands directly from the dashboard, changes to permission-profile inheritance, installing agent plugins, or writing agent configuration into a project or the user's global agent settings.

## Decisions

### 1. Store optional `repo.agent.allowedCommands: string[]`

Extend the shared project-agent type and `RepoAgentPatch`; use the existing home-config schema and serialized repository update path. Omission in a patch means unchanged; `null` and `[]` clear the key. The full configuration schema accepts arrays or absence, not `null`. Older configurations remain valid without a migration or version bump. Do not initialize empty lists on every project.

Alternative: a new endpoint or repository-side file would duplicate existing settings machinery or require a repository-write exception. Global settings would lose the requested project scope.

### 2. Use literal command prefixes rather than vendor rule strings

Introduce a shared validator and normalizer for both save routes and UI feedback. Each entry is a sequence of literal tokens from the spec's ASCII character set. Reject control characters before trimming; collapse repeated ASCII spaces, trim and deduplicate in insertion order. Validate the raw input size before normalization as well as the normalized bounds. UI input represents one prefix; a newline is never an instruction separator.

Do not accept `Bash(...)`, regular expressions, quotes, glob syntax or shell operators from configuration. Match a complete prefix and optional trailing arguments at token boundaries. For example, `bun run lint` covers `bun run lint --fix`, not `bun run lint-extra`. In the Claude translation, generate separate exact and space-plus-arguments patterns, escaping through the adapter rather than concatenating arbitrary rule text. Keep each generated rule a separate argv value and preserve the existing position of permission flags.

Validation must reject prefixes overlapping protected operations and merge/cleanup gates, including broad parents such as `git`, `git push` and `gh pr`. Custom git and GitHub entries must be narrow enough to exclude those operations; gated operations remain controlled by existing opt-ins rather than this list. Reject direct shell/interpreter execution and command-dispatch wrappers (for example `sh`, `bash`, `zsh`, `eval`, `exec`, `env`, `command`, `xargs`, and interpreter inline-code modes). Keep executable-basename checks so an absolute executable path cannot evade these checks. Existing deny rules take precedence over any generated allowance.

Alternative: native agent patterns are flexible but leak vendor syntax into shared configuration and make escaping and precedence much harder to review. Repository scripts remain arbitrary code even with literal prefixes; document that limitation instead of presenting syntax validation as code isolation.

### 3. Extend the resolved policy and translate only where support exists

Add `allowedCommands` to `AgentPermissionPolicy`, defaulting to an empty array. Resolve it strictly from the identified project; a change's agent/profile override never replaces the project list. Retain configured entries in the effective policy even under `minimum`, but inject none there and return a limitation explaining their inactive state.

For Claude under `less-friction` or `full-automation`, merge translated custom rules with built-in allowances and retain protected and gated restrictions. Preserve all existing mode and approval choices. For Codex, retain the current sandbox and approval flags and report that custom command allowances cannot be applied by this adapter. For Antigravity, report that allowances are unapplied until per-session settings delivery exists; do not merely add entries to a preview settings object and imply launch applies them. Generic agents get the same honest unsupported result. This change does not implement a new runtime integration.

Alternative: generating global Codex rules or Antigravity settings would violate session isolation. Switching to broader approval modes would change unrelated permissions. Neither is justified by adding a project command list.

### 4. Resolve commands at every explicit process launch

Use the same adapter output for the permission endpoint and the spawn path. Audit fresh starts, resume, restart and raw-argv branches in `SessionManager`, plus project console launch: every project-bound spawn must receive the current project list. A running process is unaffected by settings edits; a later launch uses current commands while preserving the existing rules for that session's permission profile. No text is injected into a running terminal to change permissions.

Main console and integration sessions receive no project allowances. Do not persist custom command lists in historical session records: the current project configuration supplies them on the next start, avoiding stale copies.

Alternative: snapshotting commands with the session record would make resume ignore removals. Mutating a running process would require vendor-specific terminal interaction and violate the existing terminal contract.

### 5. Add an immediate-save list to the shared project dialog

Place Custom commands after the Agent setting, whether or not the Agent picker is visible. Offer one labelled prefix input, Add, and a saved list with individually labelled Remove buttons. Add or Remove replaces the list through the existing project-agent update route; there is no extra Save or confirmation. Prevent duplicate requests while saving, display errors beside the editor, and retain the last saved list on refusal. Unsubmitted input remains a draft, not a saved allowance.

Show the editor whenever sessions are enabled globally and for the project, including non-git projects. Hide it when disabled without deleting configuration. Explain next-start application, literal prefix scope, repository-code execution and supported-runtime limitations. Derive support from the same capability information as the preview, not a promise inferred from the selected profile. The explanation describes the project defaults; change-specific overrides are reflected by the existing effective-permissions endpoint.

Extend shared demo settings behavior and add synthetic example commands; update Help and What's new. Preserve the shared dialog's route and focus behavior across overview rows, tiles and board entry points. The in-flight `unify-change-permission-picker` keeps ownership of the change-level picker; this work does not add another one.

## Risks / Trade-offs

- A custom script or tool can execute arbitrary repository code → keep the existing code-execution disclosure and avoid claiming the prefix validator provides a security sandbox.
- Prefix translation could cover adjacent commands or absorb CLI flags → reject rule syntax, emit separate argv values, and verify exact matches, trailing arguments and near-miss commands.
- Runtime support differs → ship useful Claude allowances and explicit unsupported notices for other current adapters; never weaken approval settings to simulate support.
- Settings and launch could drift → reuse normalization and adapter output, and exercise fresh start, resume and project-console branches with fake agents.
- Concurrent project updates could overwrite unrelated settings → use the existing serialized config updater and patch semantics; include preservation checks.
- The existing main `dashboard-api` spec had a misplaced `## ADDED Requirements` header → moved its permission-profile requirements back under the main `## Requirements` section so strict validation and archive can parse them.

## Migration Plan

Deploy the optional field with an empty effective default; existing behavior is unchanged until a user adds commands. No repository files, external settings or schema version change is required. Removing all entries rolls back the feature for a project on its next agent launch. Before downgrading to a version whose configuration schema lacks this field, clear the lists using the current version; already-running agents retain their process permissions until stopped.
