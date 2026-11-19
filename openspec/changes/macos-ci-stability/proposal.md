# Proposal

## Why

The post-merge macOS CI run exposed timing assumptions in tests and pseudo-terminal writes that passed on Linux. Make those paths robust under macOS scheduling and keep the existing terminal submission behavior intact.

## What Changes

- Poll demo clone states to completion instead of assuming fixed 40 ms delays are enough.
- Wait for the complete fake-agent startup banner before asserting its resolved working directory.
- Send smaller paced chunks to reduce the chance a busy macOS PTY combines them into one paste-sized read.

## Capabilities

No spec requirements change; this fix improves test synchronization and internal terminal write pacing. This change sets `skip_specs: true`.

## Impact

- `src/server/sessions/submit.ts`
- `test/demoApi.test.ts`, `test/terminalSessions.test.ts`, `test/submitText.test.ts`
