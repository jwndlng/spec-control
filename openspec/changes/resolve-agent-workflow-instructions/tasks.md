# Tasks

## 1. Scoped implementation and verification

- [ ] 1.1 Add per-action workflow preflight in the actual managed checkout and resolve readable project skill paths explicitly; verify fresh worktrees with tracked `.claude/skills`, absent native skill directories, and main-only untracked `.agents` assets without assuming runtime-specific discovery paths.

- [ ] 1.2 Provide version/capability-checked CLI instruction fallbacks for Draft, Implement, Validate, and Archive that preserve schema context, blocked states, tracking, verification, and action boundaries; verify missing skill, unsupported CLI, missing CLI, and blocked apply cases with fake runtimes.

- [ ] 1.3 Expose missing workflow setup and fallback mode in session launch diagnostics and Help; verify no silent ad hoc artifact workflow, automatic project reinitialization, global skill install, or untracked asset copying occurs.

- [ ] 1.4 Exercise installed Codex and Antigravity in disposable repositories using documented arguments; record actual versions, skill discovery/fallback and action completion behavior, permission blockers, and recovery. Keep unresolved manual evidence explicit; never mark unsupported runtime features verified.

- [ ] 1.5 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Build the compiled binary and verify the affected terminal/API behavior in the compiled runtime.

- [ ] 1.6 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
