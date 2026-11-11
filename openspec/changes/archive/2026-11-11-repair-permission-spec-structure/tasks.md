# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Repair the pre-existing misplaced `## ADDED Requirements` headers in `openspec/specs/agent-sessions/spec.md` and `openspec/specs/dashboard-api/spec.md` without changing any requirement content; verify both main specs parse all permission requirements and the deltas' archive comparison is structurally valid. Evidence: removed the dashboard-api heading; agent-sessions was already repaired on origin/main. CLI list/show exposes all 7 session and 2 API permission requirements (66 and 50 total); original archived deltas pass the installed archive merger and repository sync comparison.

- [x] 1.2 Validate the repaired main specs with the installed CLI and compare all requirement/scenario text before and after to prove only structural headings changed; run repository-required checks before pushing and record results. Evidence: byte comparisons preserve all 116 requirements and 722 scenarios; CLI list/show, archive-delta merge, repository sync comparison, and normal validation passed for both specs; strict change validation passed, while strict main-spec validation reported only long-requirement warnings (55 session, 44 API). `bun test test/scanner.test.ts` passed 38/38. Final `bun run check` passed: lint, typecheck, and 2,320 tests passed (0 failed). See pull-request.md.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
