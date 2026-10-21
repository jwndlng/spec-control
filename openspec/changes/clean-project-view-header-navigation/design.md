# Design

## Context

`RepoHeader` in `src/ui/kanban.tsx` renders the whole repository board header: a title row (breadcrumb + `BoardStats`),
a status row (`CheckoutSummaryButton` with its own branches modal from `src/ui/checkout.tsx`, `RepoPullRequestsButton`,
`LabelChips`, shared-config badges, the "updated" badge) and `.band-actions` (`ProjectConsoleButton`, `PullButton`,
`FetchNoteBadge`, `CleanupButton`, Import from issues, New change). The project settings dialog
(`ProjectSettingsDialog`, `src/ui/projectSettings.tsx`) is driven by the `Tracking` object of `useTracking`
(`src/ui/untracked.tsx`), which only the overview instantiates; its open/closed state lives in `overviewDialogs`
(`src/ui/overviewState.ts`) and its focus return goes through `settingsButtonOf(id)`, which finds any element carrying
`data-project-settings=<id>`. `CheckoutSummaryButton` is used only by the board.

## Goals / Non-Goals

**Goals:**
- One header component tree with three clear parts — title row, quick view, action groups — and one overlay for detail.
- Reuse the existing settings dialog, labels dialog, pull-requests dialog and checkout chips unchanged in behaviour.
- Keep the derivation of what the quick view and the overlay show in pure functions that `bun test` can cover.

**Non-Goals:**
- No change to the overview's rows and tiles, the combined board's band, or any dialog's own content.
- No new API route, config field or server work; no Rename on the board.
- No change to what any action does — only where it sits and how it is described.

## Decisions

1. **Pure header model.** A new `src/ui/projectDetails.ts` exports `actionGroups(input)` (which groups and actions are
   offered, in order, with their descriptions and inactive reasons), `quickViewFacts(repo, config)` (which facts appear,
   including the shared-config attention marker) and `detailSections(repo, config, prs)` (which overlay sections have
   content). `RepoHeader` and the new `ProjectDetailsDialog` (`src/ui/projectDetails.tsx`) only render them. *Why:* the
   visibility rules are the spec's substance and the UI tests here are logic tests; the overview's `overviewState.ts`
   pattern is the precedent. *Alternative:* conditionals inline in JSX, as today — harder to test and how the header
   got cluttered.
2. **Descriptions live next to the controls.** Each action component (`PullButton`, `CleanupButton`,
   `ProjectConsoleButton`, Import, New change) takes the description from one exported constant map
   (`ACTION_DESCRIPTIONS`) and renders it as `title` and `aria-describedby` (a visually hidden span), keeping any
   existing inactive-reason tooltip as the override. *Alternative:* visible helper text under every button — clearer
   for a first visit but brings back the clutter; the visible group caption plus the tooltip is the compromise.
3. **Groups are `role="group"` with a caption.** Each group is a `<div role="group" aria-labelledby>` with a small
   uppercase caption above its buttons; `.band-actions` becomes a flex row of groups that wraps by group
   (`flex-wrap` on the area, `nowrap` inside a group). The existing narrow-window rule (area moves below as one block)
   is kept.
4. **One overlay replaces the branches modal on the board.** `CheckoutSummaryButton` gets an `onOpen` prop instead of
   owning its modal; the board passes a handler that opens `ProjectDetailsDialog` with `section="checkouts"`, which
   scrolls that section into view and focuses its heading. The checkout list markup moves into an exported
   `CheckoutList` reused by the overlay. Since the button is used only on the board, its own modal is removed.
5. **Settings on the board reuse `useTracking`.** `RepoHeader` (or `Kanban`) instantiates `useTracking` with
   `onConfig` from a new `onConfig` prop that `app.tsx` wires to `setConfig` (as it already does for the overview), and
   `rediscover` as a no-op refresh. The board renders `SettingsButton`, `ProjectSettingsDialog` and `RepoLabelsDialog`
   from the same state; focus return keeps working because the board's button carries `data-project-settings`. The
   `disabled` dialog event additionally navigates to `/` when it fires on the board. *Alternative:* a board-specific
   settings dialog — would duplicate every control and its tests.
6. **Overlay content is read-only from what is loaded.** The Pull requests section reads the cached list through the
   existing `usePullRequests` hook without calling its refresh, and its control opens the existing repository
   pull-requests dialog (which keeps its own refresh-on-open rule). The Sync section reuses `FetchNoteBadge` text plus
   `autoFetchEvery`. Nothing in the overlay triggers a scan or query.
7. **Fetch note moves, unchanged.** `FetchNoteBadge` is rendered in the quick view; its component and texts are not
   touched, so the overview is unaffected.

## Risks / Trade-offs

- [Two dialogs at once: settings opens Labels, overlay opens the PR dialog] → both reuse the one-modal-at-a-time
  patterns already in place (settings is replaced by labels; the overlay closes before opening the PR dialog).
- [Users used to labels and "updated" in the header lose them at a glance] → they are one click away in Details, and
  anything needing attention (config, warnings, scan errors, off-default branch) stays in the header.
- [`useTracking` on the board duplicates state with an overview mounted elsewhere] → the board and the overview are
  never mounted together (separate routes), and both write through the same config route and `setConfig`.
- [Tour or help text pointing at "beside Pull"] → update `helpContent.tsx`'s fetch sentence; the tour has no step on the
  repository header.
