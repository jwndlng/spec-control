# Tasks

## 1. Domain Types and Configuration Schema

- [x] 1.1 Add `AgentPermissionProfileId`, `AgentPermissionPolicy`, `AdapterResult`, `AgentCapabilityMatrix`, and extend `AgentSessionsConfig`, `RepoAgentConfig`, and `ChangeAgentOverride` in `src/shared/types.ts`; verified with `bun x tsc --noEmit`.
- [x] 1.2 Extend configuration validation schema in `src/server/config.ts` for `defaultPermissionProfile` (`minimum`, `less-friction`, `full-automation`), `optInMerge`, and `optInCleanup`, rejecting invalid profiles and bypass flags; verified with `bun test test/config.test.ts` (57 passed).
- [x] 1.3 Implement `resolvePermissionPolicy(config, repoId, changeName)` in `src/server/sessions/permissionResolver.ts` following change override -> repository setting -> global default -> `minimum` hierarchy; verified with unit tests in `test/permissionResolver.test.ts`.
- [x] 1.4 Implement `ProtectedCommandPolicy` in `src/server/sessions/protectedCommands.ts` defining high-risk patterns (`rm -rf`, `git push --force`, `git reset --hard`, `sudo`, `curl | sh`) that always require confirmation; verified with unit tests in `test/protectedCommands.test.ts`.

## 2. Permission Adapters Architecture

- [x] 2.1 Implement `AgentPermissionAdapter` interface and `PermissionAdapterRegistry` in `src/server/sessions/permissionAdapters.ts`; verified registry resolution with unit tests in `test/permissionAdapters.test.ts`.
- [x] 2.2 Implement `ClaudeAdapter` in `src/server/sessions/permissionAdapters.ts` generating `--permission-mode`, `--allowed-tools`, and `--disallowed-tools` excluding protected commands; verified permission mode, allow/deny flags, and protected patterns in `test/permissionAdapters.test.ts`.
- [x] 2.3 Implement `CodexAdapter` in `src/server/sessions/permissionAdapters.ts` generating `--sandbox` and `--ask-for-approval` arguments; verified minimum profile args with unit tests in `test/permissionAdapters.test.ts`.
- [x] 2.4 Implement `AntigravityAdapter` in `src/server/sessions/permissionAdapters.ts`; supported `--mode` and `--sandbox` arguments are verified in `test/agentSessions.test.ts`, and documented permission-rule syntax is represented in the API preview. **User: verify whether your installed Antigravity CLI provides a supported per-session settings-file override (the current official CLI reference documents no `--settings` flag); if it does, provide its syntax so session-scoped protected-command rules can be wired without editing global settings.**
- [x] 2.5 Implement `GenericAdapter` fallback for unrecognized agent binaries; verified that it injects no flags in `test/permissionAdapters.test.ts`.

## 3. Session Launcher and Ephemeral Isolation

- [x] 3.1 Update the argument builder in `src/server/sessions/agents.ts` to inject adapter permission arguments directly after the executable and launch arguments; verified argument order in `test/agentSessions.test.ts`; change and custom starts use the same permission-aware launch path.
- [x] 3.2 Update `SessionManager` in `src/server/sessions/manager.ts` to record the active permission profile on `SessionRecord`; profile recording is implemented, but ephemeral Antigravity settings cannot be safely created until a supported per-session settings path is confirmed. **User: verify the installed Antigravity CLI's per-session settings override as specified in 2.4; then session-file cleanup can be implemented and tested against it.**

## 4. API Endpoints

- [x] 4.1 Implement `GET /api/repos/:id/agent-permissions` in `src/server/api.ts` returning effective profile, policy, CLI previews, protected commands, capability matrix, and security notices; verified by `test/permissionApi.test.ts` for preview fields and unknown repository.
- [x] 4.2 Implement `POST /api/repos/:id/changes/:change/permission-profile` in `src/server/api.ts` to set or clear per-change permission overrides; verified by `test/permissionApi.test.ts` for set, clear, effective override, malformed JSON, invalid profile, and disabled-session refusal.

## 5. User Interface and Documentation

- [x] 5.1 Implement permission profile selector, `optInMerge` / `optInCleanup` checkboxes, and code execution risk warning banner in Agent sessions settings; verified by `test/agentSettingsUi.test.ts` and the full `bun run check`.
- [x] 5.2 Implement cross-agent capability matrix table, protected commands list, and live CLI argument preview in Agent sessions settings; verified by `test/agentSettingsUi.test.ts` and the full `bun run check`.
- [x] 5.3 Add change-level permission profile override selector to change launch and detail views, with repository profile inheritance in project settings; verified selectors/API wiring in `test/sessionPanelUi.test.ts` and demo persistence in `test/demoApi.test.ts`.
- [x] 5.4 Add a What's new entry describing predefined agent permission profiles and capability previews; added it under the repository's discovered `src/ui/changelog/entries/` layout and verified the changelog validation test passed during `bun run check`.
