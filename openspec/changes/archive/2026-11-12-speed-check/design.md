# Design

## Context

The suite contains 2262 tests across 192 files. On this machine, Bun's serial run took 749.6 seconds; the slowest files are scanner, agent/session, terminal/session and Git cleanup tests. Four workers reduced the run to 402.9 seconds, but three scanner tests exceeded Bun's default five-second per-test timeout under load. Two workers still produced a scanner timeout, so use more workers with a higher timeout and measure the full result.

## Goals / Non-Goals

**Goals:**
- Keep full coverage in `bun run check` while bringing its test stage under five minutes on the development machine.
- Make a separate fast subset available for local iteration without treating it as the pre-push check.
- Preserve a serial option for investigating test interference.

**Non-Goals:**
- Exclude slow tests from CI or the full check.
- Rewrite integration tests or replace their real local Git/process behavior with mocks.

## Decisions

- Use Bun's file-level `--parallel` workers; do not mark tests within a file concurrent. The latter could overlap shared setup and filesystem state.
- Start with eight workers and a 15-second per-test timeout, then run the complete suite to confirm the time target and stability. The two-worker experiment did not finish within five minutes and still hit a scanner timeout.
- Keep full tests as the default and add `test:fast` as an opt-in command that excludes the twenty files with the longest measured durations. Document that it is not a substitute for the full check.
- Provide `test:serial` for debugging. The full `check` and platform CI should call the shared full test script so they use the same configuration.

## Risks / Trade-offs

- Eight workers increase memory and CPU use → keep the worker count fixed and explicit, and leave a serial command available.
- Parallel contention can expose existing 5-second assumptions → raise Bun's test timeout and verify all tests pass.
- A fast subset can be mistaken for full verification → name and document it as local-only; keep CI and pre-push on the full suite.
