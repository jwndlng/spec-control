# Tasks

## 1. Project setup guidance

- [x] 1.1 Add the OpenSpec-only project settings action and console availability reasons; verify managed OpenSpec, other-framework and unavailable-agent cases in UI tests.
- [x] 1.2 Open the existing project console with a copyable agent-neutral setup request that preserves existing tools and asks the user what to add; test new and running consoles, copying, and that no request is sent automatically.
- [x] 1.3 Update Help and any demo behavior needed for this action; verify the guidance describes in-place changes and works in the demo.

## 2. Integration

- [x] 2.1 Verify the setup flow does not invoke OpenSpec or write project files in dashboard code, and run `bun run check`. Verified with pinned Bun 1.4.2: lint and typecheck pass; full suite had 2,234 passes and one scanner timeout. After giving that fixture-heavy test a bounded 30-second budget, its isolated rerun passes (13.9 seconds). The terminal startup test now uses the production delay and awaits the actual submission result; the earlier failures all pass in the full run.
- [x] 2.2 Add a What's new entry at the top of `src/ui/changelog.ts` and verify its shape and order with the What's new test.
