# Summary

Managed Draft, Implement, and Archive checkpoints now persist to GitHub after verified completion, with saved delivery state and safe retry across restarts. Proposal PRs use a dedicated branch and merge policy; implementation PRs remain for human review. Merge readiness uses shared documentation classification and fresh required-check evidence. Unresolved archive tasks can be published for review only after explicit acceptance and are never marked complete or auto-merged.

# Checks

- `bun run check` — passed: lint, typecheck, 2,459 tests; lint reported 209 warnings and 7 infos.
- `bun run build` — passed; compiled runtime smoke test passed (1 test, 10 assertions).
- Fake-agent lifecycle integration — passed: proposal delivery and same-head merge retry, manager restart recovery, implementation PR and explicit merge, archive PR (`bun test test/agentSessions.test.ts -t 'fake-agent lifecycle delivers proposal'`).
- Required-check and merge-readiness tests passed; lifecycle delivery and unresolved-archive acceptance tests passed.
- Changelog loader validation and `git diff --check` passed.
