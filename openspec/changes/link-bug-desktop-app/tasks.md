# Tasks

## 1. Navigation event logic

- [x] 1.1 Add `navigationEvent(data)` to `desktop/src/logic/links.ts` returning `{ url, allowed? }` from every shape in design.md's table (JSON-string `detail`, object `detail`, nested `detail`, direct fields), and build `eventUrl` on it; verify with `bun test test/desktop/links.test.ts`
- [x] 1.2 Add the pure once-per-URL helper of design D2 (last URL and time in, decision out, clock passed in) to `desktop/src/logic/links.ts`; verify with a test that the same URL within one second is skipped, a different URL or the same URL after one second is not
- [x] 1.3 Rewrite the event-shape tests in `test/desktop/links.test.ts` to use Electrobun 2.0.2's literal payloads: `{ detail: '{"url":"https://github.com/acme/demo-ops/pull/7","allowed":false}' }` is blocked with that URL, `allowed:true` is not, a plain-URL `detail` has no `allowed`, and the parsed `new-window-open` object yields its URL; verify `bun test test/desktop/` passes

## 2. Wiring

- [x] 2.1 In `desktop/src/main.ts`, make the `will-navigate` handler follow the URL only when `navigationEvent(...).allowed === false`, and route both it and `new-window-open` through the once-per-URL helper before `Utils.openExternal`; verify `bun run check` passes and `grep -n "data?.allowed" desktop/src/main.ts` finds nothing
- [~] 2.2 Build the app (`bun run build:desktop`) and, in its window, click a pull request link, an issue link, the version link in the header and a link in a rendered Markdown artifact; verify each opens once in the default browser and the window keeps showing the dashboard, and that a link within the dashboard still navigates in the window

## 3. Release notes

- [x] 3.1 Add a What's new entry at the top of `src/ui/changelog.ts` saying that links to GitHub and other sites open in your browser again in the macOS app; verify `bun run check` passes
