# Proposal

## Why

The full local check takes long enough to interrupt an agent's iteration, with most of the time spent in tests that create temporary Git repositories, worktrees, servers and pseudo-terminals. Use Bun's file-level parallelism and a timeout that fits the heavier parallel workload, while retaining a complete suite for CI and pre-push checks.

## What Changes

- Run the full test suite across a bounded number of Bun worker processes by default.
- Raise the default per-test timeout to accommodate filesystem and process contention under parallel execution.
- Add a fast local test command that skips the slowest integration-heavy files; keep it explicitly separate from the full check.
- Keep a serial test command for diagnosing ordering or shared-resource issues.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a development workflow change and does not alter product behavior.

## Impact

- `package.json` test and check scripts.
- `test/scanner.test.ts` if its test-specific timeout needs adjustment.
- `CONTRIBUTING.md` local check guidance.
- `.github/workflows/ci.yml` to use the same full parallel test script on macOS.
