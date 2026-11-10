# Proposal

## Why

The permission adapters allow a fixed set of commands, so projects with their own build, test or tooling commands cannot add them to the agent's permission list through Spec Control. Users need project-specific allowances that reach supported agents without editing global agent settings.

## What Changes

- Add a project-level list of custom command prefixes in the project settings dialog, persisted in Spec Control's home configuration.
- Include validated entries in the resolved permission policy and effective agent preview, and add them to session allowances where the runtime supports them.
- Keep `minimum` read-only: custom allowances apply only with `less-friction` or `full-automation`. Preserve protected-command rules, merge/cleanup opt-ins and host policies.
- Disclose unsupported runtime behavior instead of claiming that every agent can automatically approve these commands. Apply changes on the next agent start, including resume, without changing a running process.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Project-scoped custom command allowances, validation, runtime translation and launch lifecycle.
- `dashboard-api`: Save and clear project command allowances and expose their effective policy and runtime support.
- `project-overview`: Manage custom commands through the shared project settings dialog.

## Impact

- Planning artifacts: `openspec/changes/allow-custom-cmds/`.
- Configuration and validation: `src/shared/types.ts`, `src/shared/repoSettings.ts`, a shared command-validation module, and `src/server/config.ts`.
- API and sessions: `src/server/api.ts`, `src/server/sessions/permissionResolver.ts`, `permissionAdapters.ts`, `protectedCommands.ts`, and `manager.ts` in that sessions directory.
- UI and demo: `src/ui/projectSettings.tsx`, its styles, the tracking state and API types as needed, `src/ui/demo/`, `src/ui/helpContent.tsx`, and an independent `src/ui/changelog/entries/` file.
- Verification: configuration, repository settings, permission API/resolver/adapter, project settings UI, demo and fake-agent session tests under `test/`; compiled-binary smoke verification.
- No new dependency or repository-write exception is needed. Coordinate shared permission types and UI with `unify-change-permission-picker`; this change adds no per-change command editor and preserves its single-picker design.
