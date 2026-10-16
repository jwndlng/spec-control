# Tasks

## 1. Confirmable in-place dialog

- [x] 1.1 Add `endConfirmable(session, status, busy)` to `src/ui/sessionState.ts` (design D1) and use it for the confirm button in `src/ui/endSessionDialog.tsx`; verify with unit tests in `test/workStatusUi.test.ts`: in place without status → true, worktree without status → false, worktree with status → true, busy → false in every case.

## 2. No pull offer in place

- [x] 2.1 Make `pullOffer` take the session and return `offered: false` for an in-place session (design D2), and pass the session from the dialog; verify with unit tests: an in-place session in a git repository (with or without a commit) gets no offer, a worktree session in a healthy git repository still gets a preselected offer.

## 3. Check

- [x] 3.1 Run `bun run check`; verify that lint, typecheck and tests pass.
- [~] 3.2 In `bun run dev`, track a fresh `git init` folder with an `openspec/` change, start Implement (it runs in place), then click **End session**; verify the button is enabled, no pull is offered, and confirming ends the agent. Then click **Clean up** and verify **Done** is enabled.
