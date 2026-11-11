# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Repair the pre-existing misplaced `## ADDED Requirements` headers in `openspec/specs/agent-sessions/spec.md` and `openspec/specs/dashboard-api/spec.md` without changing any requirement content; verify both main specs parse all permission requirements and the deltas' archive comparison is structurally valid. Evidence: removed the dashboard-api heading; agent-sessions was already repaired on origin/main. CLI list/show exposes all 7 session and 2 API permission requirements (66 and 50 total); original archived deltas pass the installed archive merger and repository sync comparison.

- [ ] 1.2 Validate the repaired main specs with the installed CLI and compare all requirement/scenario text before and after to prove only structural headings changed; run repository-required checks before pushing and record results. Verification done: byte comparisons preserve all 116 requirements and 722 scenarios; normal CLI validation passes both specs and strict change validation passes. Strict main-spec validation reports only long-requirement warnings (55 session, 44 API). Blocker: latest `bun run check` exited 1 after lint/typechecking passed and 2,317 tests passed; three scanner tests exceeded 5,000 ms: `scans a fixture repo: artifacts, tasks, archive dates, columns`, `a change without a design is Ready: the spec-driven schema requires only tasks`, and `unexpected change directory names are skipped with a warning`. Earlier scanner-file rerun passed 38/38; the full check has not passed. Resolve the scanner timeouts and obtain a passing full check before pushing. See pull-request.md for recorded checks.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
