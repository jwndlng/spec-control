# Tasks

## 1. Header model

- [x] 1.1 Add `src/ui/projectDetails.ts` with `actionGroups`, `quickViewFacts` and `detailSections` and the `ACTION_DESCRIPTIONS` map (design decisions 1–2); verify with a new `test/projectDetails.test.ts` covering group order and omission (no-git folder with sessions off shows only Changes without Import), the Pull description text, the shared-config attention marker (outdated, orphaned, unreadable vs. all in sync), and which overlay sections are present (no Checkouts without checkout info, no Labels without labels)

## 2. Action groups

- [x] 2.1 Render the board's action area in `RepoHeader` as captioned `role="group"` groups Agent / Repository / Changes from `actionGroups`, with New change last as the only primary; verify by `bun run dev` on a git fixture project that the three groups show in order and the fetch note is not among them
- [x] 2.2 Give Console, Pull, Clean up, Import from issues and New change their description as tooltip and `aria-describedby`, keeping inactive reasons as override; verify by inspecting accessible descriptions in the running UI and by the `projectDetails` test of the description map
- [x] 2.3 Style groups in `src/ui/styles.css` so they wrap as whole groups and the area moves below the header content at narrow widths; verify at 720px that every action stays visible and no caption is separated from its actions

## 3. Quick view and details overlay

- [x] 3.1 Replace the status row with the quick view from `quickViewFacts`: counts, main checkout chip, branches control, PR control, `FetchNoteBadge`, shared-config attention marker, **Details**; drop labels, in-sync profiles and "updated" from the header; keep notices below; verify on a fixture board that labels and `updated …` are gone and warnings still show
- [x] 3.2 Turn `CheckoutSummaryButton` into a control with an `onOpen` prop and export a `CheckoutList` (design decision 4); verify `bun run check` typechecks and the overview is unaffected
- [x] 3.3 Add `ProjectDetailsDialog` in `src/ui/projectDetails.tsx` with the Repository, Checkouts, Sync, Pull requests, Shared config and Labels sections, opening at a requested section, closing on Escape/backdrop/close with focus return, and reading the cached PR list without refreshing; verify in the running UI that opening it starts no `/api/scan` or pull-request refresh request (browser network panel) and that the branches control opens it at Checkouts
- [x] 3.4 Open the existing repository pull-requests dialog from the overlay's Pull requests section; verify it opens and keeps its own refresh-on-open behaviour

## 4. Project settings on the board

- [x] 4.1 Wire `useTracking` into the board with an `onConfig` prop from `app.tsx` and render `SettingsButton`, `ProjectSettingsDialog` and `RepoLabelsDialog` there (design decision 5); verify that switching Agent sessions off from the board removes the cards' starters without a reload and that focus returns to the board's gear after closing
- [x] 4.2 Navigate to `/` after a successful Disable from the board, leaving the dialog open with the reason on failure; verify with a test of the dialog-event handling (extend `test/untrackedUi.test.ts` or the new test) and manually on a fixture project
- [x] 4.3 Hide the settings button for a repository not enabled in the configuration; verify by the `projectDetails` test or a board render check

## 5. Docs and release notes

- [x] 5.1 Update the fetch-note sentence in `src/ui/helpContent.tsx` ("Beside Pull …") to say where the board shows it; verify by reading the Help page in the running UI
- [x] 5.2 Add a What's new entry at the top of `src/ui/changelog.ts` describing the grouped actions, the quick view with Details and settings on the board; verify `bun run check` passes
- [x] 5.3 Run `bun run check` and `bun run build`, then open a board in `dist/spec-control` to confirm the header, the overlay and the settings dialog work in the compiled binary
