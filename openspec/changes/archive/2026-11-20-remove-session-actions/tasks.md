# Tasks

## 1. Show session actions directly

- [x] 1.1 Replace the Session actions disclosure in `src/ui/sessionPanel.tsx` with an always-visible labeled group; verify `test/sessionPanelUi.test.ts` covers direct rendering, action labels, and the absence of a disclosure while retaining existing eligibility.
- [x] 1.2 Remove disclosure-only styling and update the editor UI assertions; verify `test/editorUi.test.ts` confirms Open in editor remains available through the visible session action group.

## 2. User-facing documentation

- [x] 2.1 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing the visible session actions; verify the entry passes the changelog loader checks in `test/whatsNew.test.ts`.
