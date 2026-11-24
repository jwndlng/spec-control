## Why

Starting Archive in an implementation session can reuse its existing pull request. The timeline can then show the same pull request under both phases and make the archive look shipped.

## What Changes

- Ask the user to merge an open implementation pull request before starting Archive.
- Keep each pull request and Ship result in its own checkpoint, including when historical delivery records overlap.

## Impact

- Session startup and shipping in `src/server/sessions/manager.ts`
- Delivery API, shared pull request matching, change details and session controls
- Lifecycle, session, and session-control regression tests, Help, and What's new
