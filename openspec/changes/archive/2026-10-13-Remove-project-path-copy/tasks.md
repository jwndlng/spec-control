# Tasks

## 1. Board header

- [x] 1.1 In `RepoHeader` (`src/ui/kanban.tsx`), remove the `<div class="row path">` line with the path and its `Copy cd` `CopyButton`, and drop the `cdCommand` import if nothing else in the file uses it — verify: `grep -n "Copy cd\|row path" src/ui/kanban.tsx` finds nothing
- [x] 1.2 Wrap the breadcrumb's repository name in a `<span title={repo.path}>` so the full path is its tooltip — verify: `bun run dev`, open a board, hover the name and see the path; no path line or Copy cd under the header
- [x] 1.3 Remove the `.repo-head .path` and `.repo-head .path code` rules from `src/ui/styles.css` — verify: `grep -n "repo-head .path" src/ui/styles.css` finds nothing and the other heads (change detail, consoles) look unchanged
- [x] 1.4 Confirm `CopyButton` and `cdCommand` are still used elsewhere and stay exported, and that the demo build renders the board header — verify: `bun run build:demo` succeeds and `bun run check` passes
