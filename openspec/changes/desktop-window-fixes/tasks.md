# Tasks

## 1. Desktop app (desktop/)

- [ ] 1.1 Stop the spawned server before quitting when `takeLock()` reports `held` after start (design D1), with any helper in `desktop/src/logic/quit.ts`; verify with `test/desktop/quit.test.ts` ("Another instance took the lock while the server started", "Attached server is left alone")
- [ ] 1.2 Add `windowForPort` to `desktop/src/logic/links.ts` and apply it in `showWindow` (design D2); verify with `test/desktop/links.test.ts` ("Port changed before Retry", "Same port")
- [ ] 1.3 Add `newWindowTarget` and hand same-origin new-window requests to the browser (design D3); verify with `test/desktop/links.test.ts` ("Same-origin link that asks for a new tab", in-window navigation unchanged)

## 2. Markdown links (UI)

- [ ] 2.1 Let `renderMarkdown` take a link resolver, render relative targets as text without one, and narrow `safeHref` to absolute targets (design D4); verify with `test/markdown.test.ts` (existing dangerous and external cases, What's new without relative links)
- [ ] 2.2 Pass the detail view's resolver from `src/ui/changeDetail.tsx` (shown file, listed files, detail URL with `file=`); verify with `test/markdown.test.ts` or `test/changeDetail.test.ts` for "Link to another artifact of the change", "Link to a delta spec" and "Relative link outside the change"

## 3. Wrap-up

- [ ] 3.1 Update the `desktop/` paragraph of `CLAUDE.md` and add a What's new entry to `src/ui/changelog.ts`; verify with `bun run check`
- [ ] 3.2 Run `bun run check`, `bun run build` and `bun run build:desktop`; in the app, change the port, stop the server, Retry, and check links and Reload; open a proposal with `[design](./design.md)` and follow it; verify by hand on an Apple silicon Mac
