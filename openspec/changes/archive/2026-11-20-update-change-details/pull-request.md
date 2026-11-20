# Pull request summary

Move the change permission profile into the active change's Console settings, beside the change agent picker. Artifact tabs and ineligible changes no longer show it. Selection, inheritance, save feedback, and next-session behavior are preserved. Help and What's New describe the new location.

## Checks

- `bun test test/changePermissionPicker.test.tsx test/sessionPanelUi.test.ts test/whatsNew.test.ts test/helpContent.test.ts` — passed (42 tests).
- `git diff --check` — passed.
- `bun run check` — not clean. Lint completed with repository-wide warnings and typecheck completed. The first full test run found one stale Console placement assertion, now updated and passing in the focused tests. A rerun timed out in unrelated integration tests and returned fake GitHub CLI timeouts; I stopped it with 94 test files unstarted, so the full suite remains unverified.
