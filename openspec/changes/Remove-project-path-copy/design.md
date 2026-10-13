# Design

## Context

`RepoHeader` in `src/ui/kanban.tsx` renders, below the title and status rows, `<div class="row path">` holding
`<code>{repo.path}</code>` and `<CopyButton text={cdCommand(repo.path)} label="Copy cd" />`. Its only styling is
`.repo-head .path` and `.repo-head .path code` in `src/ui/styles.css`. `CopyButton` and `cdCommand` are shared with
other views.

## Goals / Non-Goals

**Goals:**
- The board header no longer shows the path line or the Copy cd button.
- The full path stays one hover away.

**Non-Goals:**
- Removing Copy cd anywhere else (session panel, project console, worktree paths, integration view).
- Changing the overview rows or tiles, which already expose the path as a tooltip.

## Decisions

- **Path as the repository name's tooltip.** The breadcrumb's repository name gets `title={repo.path}`, wrapped in a
  `<span>` since it is plain text inside the `<h1>` today. Alternative: drop the path from the header entirely — but
  then two same-named repositories are indistinguishable on their boards, and the overview already sets the precedent
  of a full-path tooltip on the name.
- **Remove the CSS with the markup.** `.repo-head .path` is only matched by this line (`.detail-toolbar .path`,
  `.list .item .path` and `.agent-repo .path` are separate selectors), so its two rules go too.
- **No What's new entry.** This removes a control rather than shipping a feature; per CONTRIBUTING.md only user-visible
  `feat` pull requests add one. It ships as `fix(ui)`.

## Risks / Trade-offs

- [Someone relied on Copy cd on the board header] → The same `cd` is still offered in the project console and every
  session panel; the path itself remains in the tooltip.
