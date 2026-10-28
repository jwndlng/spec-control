# Design

## Context

The shared-config grid derives its pending assignments from the selection and the live snapshot on every render; the
preview dialog receives only the previews, and its Apply calls back into the panel, which reads `pending` again. The
server re-derives the result from the file and the stored profiles at apply time and writes it. The activity feed and
the board each set state from whichever fetch resolves last.

## Decisions

### D1. The dialog owns the previewed assignments

`preview()` stores `{ assignments, previews }` together; `PreviewDialog` gets both and its Apply sends
`assignments` joined with each preview's `digest` (`withDigests(assignments, previews)` in `sharedConfigState.ts`).
Repositories the preview refused are left out. The panel's `apply()` no longer reads `pending`. The dialog is modal,
so the selection cannot change under it; closing it drops the stored preview.

### D2. A server-computed digest, checked before writing

`digest = sha256(before + "\0" + after)`, hex, computed in `previewFor`. `applyTo(repo, shared, profileIds, digest)`
calls `previewFor` as today and refuses unless the fresh digest equals the one sent. One digest covers both ways the
result can drift: the file changed (`before` differs) and the profiles changed (`after` differs). `unchanged` still
means the fresh `after` equals the fresh `before` — with a matching digest that is what the preview showed.

A missing digest is refused rather than accepted, so no client can apply without a preview; the UI is the only caller.

Rejected: sending the previewed `after` text and writing it. The server would write bytes taken from a request; today
it writes only what it computes itself ("Re-reads the file; never trusts a preview"), and that stays.
Rejected: only the UI fix. It closes the poll race but not a file edited, or a profile saved in another tab, between
preview and click — the same unseen write.

### D3. Latest request wins in the feed

As `githubState.ts` does: a `seq` ref incremented by every `load()` and every filter change; an answer is applied only
when its number is still current. `loadOlder` captures the number at the start and drops its page if `load()` or a
filter change ran since, and `wanted` is increased only for an applied page. `onSeen` is called only for an applied
answer. Kept as a small pure helper (`latestOnly()`) in `activityState.ts` so it can be tested without a DOM.

### D4. Snapshots only move forward

`newerSnapshot(shown, next)` returns true when nothing is shown or `next.generatedAt >= shown.generatedAt` (ISO strings
compare as text). `loadState` and the refresh's `onSnapshot` call it before `setSnapshot` and before updating the
`generatedAt` ref. Equal is taken so an unchanged poll still clears an error. A clock moved backwards on the server
would hold the board until a scan passes the old time; the next scan after restart compares against what is shown, and
that edge is accepted.

## Risks

- A user who edits `openspec/config.yaml` while the preview is open sees `refused`; the reason tells them to preview
  again. That is the intended trade.
