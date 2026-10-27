# Tasks

## 1. Setting and validation

- [ ] 1.1 Add `editor?: string[]` to `AgentSessionsConfig` in `src/shared/types.ts` with a doc comment (argument list, `{path}` optional, absent means `code`), and a shared `DEFAULT_EDITOR = ["code"]`; verify with `bun run check` (typecheck)
- [ ] 1.2 Add `editor` to `agentSessionsSchema` in `src/server/config.ts` (design D1): non-empty arguments, no control character, `{path}` the only `{…}`, in at most one argument and never the first, an empty list read as absent; verify with `test/config.test.ts` cases accepting `code`, `zed` and `open`, `-a`, `Visual Studio Code`, `{path}`, refusing `{path}` alone, `code`, `{change}`, two `{path}` arguments and a newline with an error naming the editor command, and a config without the field loading unchanged

## 2. Starting the editor

- [ ] 2.1 Create `src/server/sessions/editor.ts` with `editorArgv(config, folder)` (D1: replace `{path}`, else append the folder) and `openEditor(argv, folder)` (D3: `Bun.which` check, folder must be an existing directory, `Bun.spawn` without a shell, `cwd` the folder, stdio ignored, `detached`, `unref`); verify with `test/editor.test.ts` cases for the default, a placeholder in the middle, a path with spaces kept as one argument, a missing executable and a missing folder
- [ ] 2.2 Verify in `test/editor.test.ts` with a stand-in editor script on `PATH` (in the style of `test/fixtures/fake-agent.ts`, writing its argv and cwd to a temp file outside the repository) that it is started once with the expected arguments and working directory, and that a temp git repository and its worktree are byte-for-byte unchanged afterwards

## 3. API

- [ ] 3.1 Add `POST /api/sessions/<id>/editor` and `POST /api/worktrees/editor` to `src/server/api.ts` (D2), resolving the folder through `src/server/sessions/manager.ts` from the session record or the session worktree list, with the refusals of the dashboard-api spec (403 disabled or excluded, 404 unknown, 400 invalid name or changeless session, 409 folder gone, 503 not found, 500 start failed), both behind `crossSiteRefusal`; verify with `test/terminalApi.test.ts` (or a new `test/editorApi.test.ts`) cases for each refusal, path traversal `../x`, a project console, a cross-origin request and a successful start with the stand-in editor
- [ ] 3.2 Add `editor: { command, found }` to `GET /api/sessions` (D5); verify with a test that a command not on `PATH` reports `found: false` and the default reports `["code"]`

## 4. UI

- [ ] 4.1 Add `openEditor(sessionId)` and `openWorktreeEditor(repoId, name)` to the API interface in `src/ui/api.ts`, and to the demo backend in `src/ui/demo/demoApi.ts` refusing with "The demo opens no editor" while reporting the editor as found (D6); verify with a `test/demoSessions.test.ts` case
- [ ] 4.2 Add an **Open in editor** control beside **Copy cd** in the Console tab header and the no-record state of `src/ui/sessionPanel.tsx`, and in `OrphanActions` of `src/ui/sessions.tsx`; tooltip names the command; disabled with the not-found reason and a link to `/settings?section=agents` when the editor is not found; errors shown as the panel shows other action errors; no control for consoles or integration sessions; verify with UI tests in the style of the existing session panel tests
- [ ] 4.3 Add the **Editor command** field (one argument per line, empty stored as absent, hint naming `code` as the default and `open -a "Visual Studio Code" {path}` as an example) to the Agent sessions section in `src/ui/agentSettings.tsx`; verify with a `test/agentSettingsUi.test.ts` case that typing `zed` stores `["zed"]` and clearing stores nothing

## 5. Documentation

- [ ] 5.1 Add a sentence to invariant 1 in `CLAUDE.md` (next to "Starting the user's agent in that worktree on the user's click is not a write by the dashboard") saying the same holds for the user's editor opened with **Open in editor**, offered only where agent sessions apply, started without a shell on a folder the server chose
- [ ] 5.2 Describe **Open in editor** and the Editor command in `src/ui/helpContent.tsx`, including VS Code's "Shell Command: Install 'code' command in PATH"
- [ ] 5.3 Add a What's new entry at the top of `src/ui/changelog.ts` for **Open in editor** (see "What's new" in CONTRIBUTING.md)

## 6. Verification

- [ ] 6.1 Run `bun run check` and `bunx openspec validate start-editor-in-worktree --strict`, both passing
- [ ] 6.2 Build with `bun run build`, start a session in a test repository, press **Open in editor** with the default `code` and with a stand-in command, and confirm the editor opens on the worktree, stays open after the dashboard stops, and nothing in the repository changed
