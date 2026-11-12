# Tasks

## 1. Project configuration and validation

- [x] 1.1 Add optional project `allowedCommands` types and shared normalization/validation; verify literal token grammar, token boundaries, control characters, shell syntax, wildcards, bypass flags, normalization, duplicates and length/count limits with focused tests.
- [x] 1.2 Validate prefixes against protected operations, merge/cleanup gates, broad parent commands, shell/interpreter execution and dispatch wrappers, including executable paths; verify accepted tooling prefixes and refused escape paths in validator tests.
- [x] 1.3 Extend the home-config schema and repository-agent patch helper with replacement, omission and clear semantics; verify old-config round trips, empty-key removal and preservation of unrelated settings in `test/config.test.ts` and `test/repoSettings.test.ts`.
- [x] 1.4 Extend the existing project-agent API route and full-config save validation; verify malformed arrays, atomic refusal, unknown projects, cross-origin refusal, concurrent unrelated patches and absence of repository writes or process starts in API tests.

## 2. Effective policy and agent translation

- [x] 2.1 Add the project list to resolved policies without changing profile inheritance; verify change agent overrides retain project commands, other projects receive none, and missing lists default empty in `test/permissionResolver.test.ts`.
- [x] 2.2 Translate custom prefixes into Claude session permission arguments for non-minimum profiles, retaining built-ins and deny/gate precedence; verify exact-prefix and trailing-argument rules, near misses, argv isolation and unchanged minimum behavior in `test/permissionAdapters.test.ts`.
- [x] 2.3 Return explicit inactive or unsupported notices for minimum, Codex, Antigravity without session delivery and generic agents; verify their existing mode, sandbox and approval arguments remain unchanged in adapter tests.
- [x] 2.4 Expose normalized commands and application limitations through the effective-permissions endpoint using the launch adapter; verify repository/change/agent filters, existing response fields and preview/adapter agreement in `test/permissionApi.test.ts`.

## 3. Launch lifecycle and isolation

- [x] 3.1 Route the current project list through fresh starts, restart, resume and raw-argv launch branches, preserving existing session-profile behavior; verify fake-agent argv and that editing a list leaves a running agent untouched but changes its next explicit launch in `test/agentSessions.test.ts`.
- [x] 3.2 Apply project commands to project-console launches, including in-place projects, while excluding main console and integration sessions; verify scope with fake agents and assert repository and global-agent settings files remain unchanged.
- [x] 3.3 Build the single executable and exercise a supported-adapter launch with a fake agent from the compiled server; verify custom permission arguments, resume behavior and terminal relay without real agents or network access.

## 4. Project settings, demo and user documentation

- [x] 4.1 Add accessible Custom commands Add/Remove controls to the shared project dialog, including pending/error states, session-enabled visibility and single-agent/non-git support; verify row, tile and board entry points, persistence, clearing, keyboard focus and unchanged routes in project-settings UI tests.
- [x] 4.2 Explain literal prefixes, next-start application, protected commands and repository-code execution, and display minimum/unsupported-runtime status; verify agent/profile changes update the explanation while preserving commands, and update `src/ui/helpContent.tsx` to describe the same behavior.
- [x] 4.3 Extend demo project-agent updates and synthetic sample data for the command list; verify add/remove persistence and validation agree with server semantics through demo tests and a demo build.
- [x] 4.4 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing project custom commands and runtime limits; verify the entry with `test/whatsNew.test.ts`, then run `bun run check`, `bun run build` and `openspec validate allow-custom-cmds --strict` for the completed change.

## Workflow follow-up

- [x] Repair the pre-existing misplaced delta header in `openspec/specs/dashboard-api/spec.md` so the archived permission-profile requirements are parsed inside `## Requirements`, then rerun `openspec validate allow-custom-cmds --strict`.
