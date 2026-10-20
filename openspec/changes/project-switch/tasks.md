# Tasks

## 1. Switcher state

- [x] 1.1 Add `src/ui/projectSwitchState.ts` with `switchEntries` (sorted by name ignoring case, path hints from
      `nameHints`, current and failed-scan flags, path as tooltip) and `filterEntries` (name or hint, ignoring case);
      verify with `test/projectSwitch.test.ts`

## 2. Switcher control

- [x] 2.1 Add `src/ui/projectSwitch.tsx`: a button with the name, chevron, path tooltip and an accessible label; a menu
      with a focused search field, one link per entry (current marked with `aria-current`, hint, failed badge), an
      empty note, Down/Up/Enter/Escape handling, closing on outside click and focus leaving; verify the rendered
      structure and the link `href`s and click handling in `test/projectSwitch.test.ts`
- [x] 2.2 Use it for the repository name in `RepoHeader` (`src/ui/kanban.tsx`), passing the snapshot's repositories, and
      add the styles to `src/ui/styles.css`; verify `bun run check` passes
- [~] 2.3 Check in the running dashboard (`bun run dev`) that switching, searching, keyboard use, Escape, ⌘-click and
      both themes behave as the spec says

## 3. Wrap-up

- [x] 3.1 Run `bun run check` and `bun run build`; both succeed
