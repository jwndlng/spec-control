# Tasks

## 1. Project setup guidance

- [ ] 1.1 Add the OpenSpec-only project settings action and console availability reasons; verify managed OpenSpec, other-framework and unavailable-agent cases in UI tests.
- [ ] 1.2 Open the existing project console with a copyable agent-neutral setup request that preserves existing tools and asks the user what to add; test new and running consoles, copying, and that no request is sent automatically.
- [ ] 1.3 Update Help and any demo behavior needed for this action; verify the guidance describes in-place changes and works in the demo.

## 2. Integration

- [ ] 2.1 Verify the setup flow does not invoke OpenSpec or write project files in dashboard code, and run `bun run check`.
- [ ] 2.2 Add a What's new entry at the top of `src/ui/changelog.ts` and verify its shape and order with the What's new test.
