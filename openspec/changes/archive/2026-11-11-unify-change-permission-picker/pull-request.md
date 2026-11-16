# One permission picker per change

Change detail now owns one permission picker above the artifact and Console tabs, with readable
inheritance defaults and change-only overrides. Saving, success and refusal/retry feedback stays
scoped to the change. A notice names the recorded running profile and the saved profile when they
differ, explaining next-start timing. Includes Help, demo records and a What's new entry.

Checks run with Bun 1.4.4:
- `bun run check --timeout 15000`: passed, 2,330 tests across 186 files.
- Affected UI, permission API/resolver, demo, Help and What's new tests: 131 passed, 0 failed.
- `bun run build:demo` and `bun run build`: passed; compiled `--version` returned `dev`.
- Built demo in Chromium at 390px and 1440px: verified keyboard type-ahead/Tab navigation,
  one picker across tabs, save/clear, running-profile wording and layout. UI tests cover status/alerts.
- Two default-timeout full runs each had one five-second scanner timeout (`frameworks.test.ts`,
  then `scanner.test.ts`); both tests passed in the successful longer-timeout run.
- Normal OpenSpec validation passed with a metadata warning; strict validation failed on the existing
  `spec-control` branch-tracking key.
