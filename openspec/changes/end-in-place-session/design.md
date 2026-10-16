# Design

## Context

`EndSessionDialog` (`src/ui/endSessionDialog.tsx`) fetches `api.worktreeStatus(id)` when it opens and stores the result
in `status`. In-place sessions skip the fetch (`if (!worktreeRemovalPossible(session)) return;`), which is correct,
because there is no worktree. However, the confirm button is `disabled={busy || !status}`, so for those sessions it
stays disabled forever. The body text already handles in-place sessions (`inPlaceLeftover`); only the button and the
pull offer are wrong.

`pullOffer(repo)` decides from the repository alone (`isGit && ok`). A git repository with no commit is `isGit` and
`ok`, so its in-place sessions are offered a pull that the spec rules out.

## Goals / Non-Goals

**Goals:**
- An in-place change session can be ended and cleaned up from the dialog.
- No pull offer for in-place sessions, as the spec already requires.
- The decisions are pure functions with unit tests, like the rest of `sessionState.ts`.

**Non-Goals:**
- The project console and integration sessions, which have their own inline confirm and are not affected.
- Any server change. `closeSession(id, false)` already handles in-place sessions.
- Showing a worktree status for in-place sessions.

## Decisions

### D1: A helper decides when the dialog can confirm
Add to `src/ui/sessionState.ts`:

```ts
export function endConfirmable(session: Pick<Session, "inPlace"> | undefined, status: unknown, busy: boolean): boolean
```

It returns `!busy && (!worktreeRemovalPossible(session) || status !== undefined)`. The dialog uses
`disabled={!endConfirmable(session, status, busy)}`. "Ship instead" is unaffected: it only shows for the `danger`
severity, which needs a worktree status.

Alternative: set a placeholder status for in-place sessions inside the effect. Rejected, because it would make `status`
mean "fetched or faked" and give the removal and severity code a value that never came from the server.

### D2: The pull offer takes the session
Change the signature to `pullOffer(repo, session)` and return `offered: false` when the session is in place. The only
caller is the dialog. Deciding from `session.inPlace`, rather than the repository's current `noCommit`, covers the
scenario where the repository got its first commit while the session kept running in place. The spec says the session
stays in place for its whole life, so its dialog stays the in-place one.

## Risks / Trade-offs

- [Other callers of `pullOffer`] → A grep shows only the dialog, and the tests in `test/workStatusUi.test.ts` are
  updated alongside.
