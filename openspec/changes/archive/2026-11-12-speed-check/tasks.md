# Tasks

## 1. Parallel full suite

- [x] 1.1 Configure the default test script to run all files with eight workers and a 15-second timeout; verify the full test command completes under five minutes and passes.
- [x] 1.2 Route `check` and macOS CI through the shared full test script; verify workflow commands still run the complete suite.
- [x] 1.3 Keep a serial test command for debugging; verify it runs tests without parallel workers.

## 2. Fast local iteration

- [x] 2.1 Add an opt-in fast test script that skips only the twenty slowest measured integration-heavy files; verify it excludes those files and runs the remainder.
- [x] 2.2 Document the full, fast and serial commands and their intended use; verify command names and coverage distinction are clear.
