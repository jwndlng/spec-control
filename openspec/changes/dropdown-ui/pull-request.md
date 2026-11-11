Adds the `dropdown-ui` proposal, design, requirements and implementation checklist. This PR contains planning artifacts only; dropdown behavior is unchanged and all 16 implementation tasks remain unchecked.

Checks run on the current branch:

- Passed: `bun run build`, `bun run build:demo` and `dist/spec-control --version` (`dev`).
- Failed: `bun run check` outside the sandbox (lint and typecheck passed; 2,317 tests passed, 3 failed): activity-log scan and archived-list timeouts, plus a stale PR-list refresh assertion (3 calls instead of 4). All three failed tests passed on isolated reruns; the full suite has no passing run. The initial sandbox run also failed to start local test servers.
- Failed: `openspec validate dropdown-ui --strict --json`; `.openspec.yaml` contains the unrecognized `spec-control` key.

Feature-specific DOM, accessibility, touch and macOS checks remain unverified because the shared dropdown and call-site migrations are absent.
