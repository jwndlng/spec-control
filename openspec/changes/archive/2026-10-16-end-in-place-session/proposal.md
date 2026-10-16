# Proposal

## Why

**End session** cannot be confirmed for a change session that runs in place. The dialog keeps its confirm button
disabled until a worktree status has arrived. For an in-place session there is no worktree, so the status is never
asked for and the button never becomes enabled. This affects a session in a folder without git and a session in a git
repository with no commit yet, which is how every **New project** starts. The only way out is to quit the agent from
its terminal and then delete the record. The bug came in when in-place sessions were added (`fc8a6aa`) to a dialog
written for worktrees only (`d3919cb`).

The same dialog also offers **also pull** for an in-place session in a git repository with no commit. The spec says
such a session has no pull offer (`agent-sessions`, the in-place case for a repository with no commit), and a pull
there has no upstream to fast-forward from.

## What Changes

- The End session dialog's confirm button (**End session** while running, **Done** once ended) is enabled for an
  in-place session as soon as the dialog opens. A worktree session still waits for its worktree status, as it does
  today.
- The dialog offers to pull only for a session that has a worktree. An in-place session, with or without git, gets no
  pull offer.
- No server change: `POST` close of an in-place session already ends the agent and removes nothing.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `agent-sessions`: adds a requirement that ending an in-place change session can always be confirmed, with no
  worktree check and no pull offer.

## Impact

- `src/ui/endSessionDialog.tsx`: the confirm button's disabled condition and the pull offer.
- `src/ui/sessionState.ts`: a small pure helper for "can the dialog confirm yet", and `pullOffer` takes the session
  into account.
- `test/workStatusUi.test.ts`: unit tests for both.
- No change to the Help (`src/ui/helpContent.tsx`), which does not describe the in-place dialog.
