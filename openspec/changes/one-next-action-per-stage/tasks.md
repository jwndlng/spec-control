# Tasks

## 1. Available actions (shared, server)

- [ ] 1.1 Change `availableActions` in `src/shared/types.ts` so `draft` is offered in `unknown`, `backlog` and `drafts`, and in `ready` only while an artifact is not done, never in `implementing` or `done`; verify with unit tests for each scenario of "Session starters run a fixed prompt for a validated change", including a `Done` change without `design.md` offering only `archive`
- [ ] 1.2 Make the session manager's refusal of Draft in `Implementing` or `Done` say that the change is past drafting; verify with a session-manager refusal test that starts no process and creates no worktree

## 2. Recommended action

- [ ] 2.1 Add `src/shared/nextStep.ts` with `recommendedAction` (stage primary step, fallback in menu order, pull-request steps `resolveConflicts`, `merge`, `implement`/`fixChecks` for failing checks, `waiting` with reason) and `menuActions`; verify with `test/nextStep.test.ts` covering every stage, blocked, missing prompt, every readiness, `Done` with failing checks, merged, closed, no link and archived

## 3. Split button

- [ ] 3.1 Add `src/ui/actionMenu.tsx` with the split button and a pure `menuKey` reducer (open on Enter/Space/Arrow Down, Arrow Up/Down, Home/End, Escape returns focus to the arrow, Tab closes); verify with `test/actionMenu.test.ts` for each key and for the menu being omitted when empty
- [ ] 3.2 Render `SessionControls` (`src/ui/sessions.tsx`) through the split button: recommended action in the main part, `menuActions` in the menu, Fast-forward as a menu item keeping its confirmation, both parts disabled while starting or confirming, the waiting label as a status; verify with `test/sessionState.test.ts` that a `Ready` card without a design shows Implement with Draft in the menu and a card whose pull request's checks run shows the waiting label with its starters in the menu
- [ ] 3.3 Make Merge, Resolve conflicts and Fix checks open the Console tab with the session whose branch heads the pull request, and Merge a GitHub link without such a session (`src/ui/kanban.tsx`, `src/ui/changeDetail.tsx`); verify in `bun run dev` against a scratch repository
- [ ] 3.4 Style the split button, menu and waiting label in light and dark themes (`src/ui/styles.css`); verify keyboard use and focus return by hand in a browser, and with a screen reader that the arrow announces as a menu button
- [ ] 3.5 Update the demo sessions (`src/ui/demo/demoSessions.ts`) so the demo shows a card waiting for checks, one ready to merge and one with failing checks; verify in the demo build

## 4. Change detail

- [ ] 4.1 Use the same split button in the Console tab, limited to what a prompt can reach for a running session, and describe Draft in `Ready` as writing the artifacts not required for implementing; verify that a `Ready` change without a design shows Implement with Draft in the menu, and that an open pull request leaves Implement in the menu

## 5. Documentation and verification

- [ ] 5.1 Update the help text for card actions and Fast-forward (`src/ui/helpContent.tsx`)
- [ ] 5.2 Run `bun run check` and `bun run build`, and verify the compiled binary serves the board with the split button
- [ ] 5.3 Add a What's new entry at the top of `src/ui/changelog.ts`: each card offers one recommended action with the others in a menu (Fast-forward moved there), Draft artifacts no longer appears once implementation started, and a card with an open pull request recommends Merge, Resolve conflicts or Implement for failing checks, or says what it waits for
