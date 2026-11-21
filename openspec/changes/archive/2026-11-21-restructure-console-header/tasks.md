# Tasks

## 1. Compact the Console panel header

- [x] 1.1 Restructure the Console panel header so agent, project, branch, session state and work status sit at the top left, End session and Open in editor sit at the top right without a visible heading, and the terminal keeps at least 80% of the panel height; user: open the Console at wide and 375px widths, open Settings, and confirm the menu is fully visible and the header/terminal layout is usable. At 375px in the local demo, the detail title wrapped vertically and extended below the viewport, so the layout needs a visual check in a browser.
- [x] 1.2 Move the agent and permission dropdowns behind a collapsed settings gear disclosure with accessible name and tooltip; verify settings stay hidden by default, retain saved values when closed, and preserve feedback without restarting the session using `bun test test/sessionPanelUi.test.ts`.

## 2. Align delivery and destructive action styling

- [x] 2.1 Remove the Console panel Ship button and its explanatory copy while preserving Ship and operation status at the matching lifecycle timeline checkpoint; verify eligible changes can still be shipped from the timeline using `bun test test/changeDetail.test.ts test/sessionPanelUi.test.ts`.
- [x] 2.2 Give Dismiss change and Delete change files a persistent visible border at rest while preserving their existing eligibility and confirmation behavior; verify both controls in `bun test test/changeDetail.test.ts`.

## 3. Document the user-visible change

- [x] 3.1 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing the compact Console header and settings gear; verify the entry is accepted by `bun run check`.

## 4. Give Console settings room in the change window

- [x] 4.1 Expand the change window and prevent the opened settings menu from being clipped by the compact Console header; verify with `bun test test/consoleLayout.test.ts`, `bun run check`, and `bun run build`.
