# Tasks

## 1. Stabilize macOS checks

- [x] 1.1 Replace fixed sleeps and startup-banner race assertions with bounded state/output waits; reduce and test PTY chunk size so the long paste-detection test remains green on Darwin.
- [x] 1.2 Run the full `bun run check` and the macOS CI workflow on the pushed branch; verify all tests pass.
