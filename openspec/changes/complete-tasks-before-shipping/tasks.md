# Tasks

## 1. Completion instructions

- [x] 1.1 Update preset Implement and Fast-forward instructions to require evidence, completion of automatable tasks and precise human blockers; verify preset, customized profile and fast-forward prompt tests.
- [x] 1.2 Extend Ship instructions while preserving custom text, additional instructions, title conventions and auto-merge ordering; verify prompt composition tests and align the delta requirements with deterministic Ship on current main.

## 2. Ship preflight

- [x] 2.1 Read a bounded, framework-neutral task summary from the session checkout, including open and awaiting task text and unknown/truncated cases; test malformed, missing, symlinked and oversized inputs.
- [x] 2.2 Enforce a fresh preview and confirmation for unresolved or unknown tasks in the Ship API, including changed-between-preview-and-confirmation; verify direct requests cannot bypass it and complete tasks ship normally.
- [x] 2.3 Add Finish tasks, Ship anyway and cancel to the session panel and end-session Ship instead flow; test all paths, concurrent clicks, and readable task explanations; update Help.
- [x] 2.4 Ensure opt-in docs auto-merge does not bypass unresolved-task handling; verify existing auto-merge and fast-forward behavior and its stated limitations.

## 3. Finish checks after merge

- [x] 3.1 Identify a linked merged implementation PR and unresolved tasks without relying on stale or proposal PRs as proof; test missing, stale, closed, unrelated and merged PR cases.
- [x] 3.2 Add Finish checks for running and ended sessions and the no-session recovery path, preserving worktree ownership and prompting the agent to verify evidence and prepare a follow-up; test each path and failure.
- [x] 3.3 Expose Finish checks on the board and in the Console tab, with PR freshness and actionable refusals; update Help and demo data, and verify navigation and accessibility tests.

## 4. Integration

- [ ] 4.1 Run `bun run check` and verify the full suite passes; build and exercise the compiled binary for changed agent-session behavior.
- [x] 4.2 Add a What's new entry under `src/ui/changelog/entries/` and verify the changelog tests pass.
