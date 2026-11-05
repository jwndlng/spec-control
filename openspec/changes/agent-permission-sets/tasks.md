# Tasks

## 1. Domain Types and Configuration Schema

- [ ] 1.1 Add `AgentPermissionProfileId`, `AgentPermissionPolicy`, `AdapterResult`, `AgentCapabilityMatrix`, and extend `AgentSessionsConfig`, `RepoAgentConfig`, and `ChangeAgentOverride` in `src/shared/types.ts`; verify compilation with `bun x tsc --noEmit`.
- [ ] 1.2 Extend configuration validation schema in `src/server/config.ts` for `defaultPermissionProfile` (`minimum`, `less-friction`, `full-automation`), `optInMerge`, and `optInCleanup`, rejecting invalid profiles and bypass flags; verify with unit tests in `test/config.test.ts`.
- [ ] 1.3 Implement `resolvePermissionPolicy(config, repoId, changeName)` in `src/server/sessions/permissionResolver.ts` following change override -> repository setting -> global default -> `minimum` hierarchy; verify with unit tests in `test/permissionResolver.test.ts`.
- [ ] 1.4 Implement `ProtectedCommandPolicy` in `src/server/sessions/protectedCommands.ts` defining high-risk patterns (`rm -rf`, `git push --force`, `git reset --hard`, `sudo`, `curl | sh`) that always require confirmation; verify with unit tests in `test/protectedCommands.test.ts`.

## 2. Permission Adapters Architecture

- [ ] 2.1 Implement `AgentPermissionAdapter` interface and `PermissionAdapterRegistry` in `src/server/sessions/permissionAdapters.ts`; verify registry resolution with unit tests in `test/permissionAdapters.test.ts`.
- [ ] 2.2 Implement `ClaudeAdapter` in `src/server/sessions/permissionAdapters.ts` generating `--permission-mode`, `--allowed-tools`, and `--disallowed-tools` excluding protected commands; verify with unit tests in `test/permissionAdapters.test.ts`.
- [ ] 2.3 Implement `CodexAdapter` in `src/server/sessions/permissionAdapters.ts` generating `--sandbox` and `--ask-for-approval` arguments; verify with unit tests in `test/permissionAdapters.test.ts`.
- [ ] 2.4 Implement `AntigravityAdapter` in `src/server/sessions/permissionAdapters.ts` generating `--mode`, `--sandbox`, and session-scoped settings enforcing protected command confirmation; verify with unit tests in `test/permissionAdapters.test.ts`.
- [ ] 2.5 Implement `GenericAdapter` fallback for unrecognized agent binaries; verify that no extra flags are injected in `test/permissionAdapters.test.ts`.

## 3. Session Launcher and Ephemeral Isolation

- [ ] 3.1 Update `launchCommand` and argument builder in `src/server/sessions/agents.ts` to inject adapter permission arguments directly after the executable and launch arguments; verify with unit tests in `test/agentSessions.test.ts`.
- [ ] 3.2 Update `SessionManager` in `src/server/sessions/manager.ts` to record the active permission profile on `SessionRecord` and clean up ephemeral settings files upon session close or process exit; verify with unit tests in `test/agentSessions.test.ts`.

## 4. API Endpoints

- [ ] 4.1 Implement `GET /api/repos/:id/agent-permissions` in `src/server/api.ts` returning effective profile, policy, CLI previews, protected commands, capability matrix, and security notices; verify with tests in `test/api.test.ts`.
- [ ] 4.2 Implement `POST /api/repos/:id/changes/:change/permission-profile` in `src/server/api.ts` to set or clear per-change permission overrides; verify with tests in `test/api.test.ts`.

## 5. User Interface and Documentation

- [ ] 5.1 Implement permission profile selector, `optInMerge` / `optInCleanup` checkboxes, and code execution risk warning banner in `src/ui/settings.tsx`; verify by running `bun run check`.
- [ ] 5.2 Implement cross-agent capability matrix table, protected commands list, and live CLI argument preview component in `src/ui/settings.tsx`; verify by running `bun run check`.
- [ ] 5.3 Add change-level permission profile override selector to change launch and detail views in `src/ui/projectSettings.tsx` and `src/ui/changeDetail.tsx`; verify by running `bun run check`.
- [ ] 5.4 Add a What's new entry at the top of `src/ui/changelog.ts` describing predefined agent permission profiles and capability previews; verify by running `bun run check`.
