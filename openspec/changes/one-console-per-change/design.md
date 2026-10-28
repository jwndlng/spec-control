# Design

## Context

`receivingSession` (`src/shared/sessionBranch.ts`) is the one rule the server and the board share for where an action
goes. Since `ship-proposals-as-docs-prs` it skips a session on `docs/<name>` for every action but Draft, which is what
lets a second session start beside it and what empties the proposal's Console tab once the change is `Ready`.

## Decisions

### D1 — Sequential, not side by side

The proposal keeps `docs/<name>`; only the overlap goes. A session on `docs/<name>` counts towards one running session
per change. `receivingSession` keeps returning the proposal session for Draft only, but no longer falls through to "open
a new one beside it": the server refuses any other action while it runs unless the request asks to end it first
(`endProposal: true` on the open request). The card's special case in `cardSessionControls` is removed, so a running
proposal session shows its badge and no starter like any other.

*Alternative rejected:* let Implement continue on `docs/<name>` — the proposal pull request would stop being docs-only.

### D2 — End first, explicitly, from the console only

Ending an agent is never a side effect of starting a step. Only the proposal's Console tab sends `endProposal`, and its
items say so ("End proposal session and implement"). The card cannot: it shows the badge. A request without the flag is
refused, so a stale page or a double click on an old card cannot end an agent.

The server applies all refusals first, then ends the session as End session does (hang-up, forced kill), waits for the
exit, then opens the new session. Ending keeps the worktree and branch unconditionally — no end-session dialog and no
removal choice — because the proposal pull request may be open and its worktree is what the merge checks read (D3).

**Confirmation:** none when the proposal worktree is `clean`, `pushed` or `merged`; nothing can be lost because the
worktree stays. One confirmation when it is `uncommitted` or `unpushed`: the agent has not finished shipping the
proposal, and ending it means no agent will open or update the pull request. The full end-session dialog is not used —
its main choice, removing the worktree, is not offered here.

### D3 — Who merges the proposal pull request once its session ended

Options considered:

1. **Nobody automatically** — the card shows the proposal pull request ready, Merge is a link to GitHub. Simplest, but
   the common path (write the proposal, start implementing straight away while checks run) would lose docs auto-merge,
   the reason `ship-proposals-as-docs-prs` exists.
2. **Resume the proposal session to merge** — breaks one running session per change while Implement runs.
3. **Hand it to the change's running session** — chosen.

The Merge prompt already names the pull request number and full head commit and asks for
`gh pr merge <n> --match-head-commit <sha>`, which works from any worktree of the repository. So the handover is a
re-targeting of `requestReadyMerges`: for an ended proposal session (on `docs/<name>`, auto-merge record set, not
`autoEnded`, worktree present) every existing check runs unchanged against the proposal's pull request and the
proposal's kept worktree; only the "session is running" condition becomes "exactly one session of the change runs, not
in place, not adopted", and the prompt goes there. One fixed sentence is appended, saying the pull request is the
change's proposal from `docs/<name>` and not this worktree's branch, because the default Merge prompt speaks of "this
worktree's branch". `mergeAsked` is recorded on the proposal session, so the at-most-once rule is per proposal pull
request and head commit regardless of which agent received it. The receiving panel offers the same Merge by hand.

Typing into an agent that is working is what Ship, Archive and the existing auto-merge already do; `submit.ts`'s echo
check keeps it from confirming a menu. Once merged, `endMergedAutoMerge` already handles a session the user ended
("Already ended by the user"): the clean worktree is removed, the branch kept.

### D4 — Resume

Resume of any ended session is refused while another session of the same change runs. Without it, resuming the ended
proposal session would bring back two consoles.

## Risks

- **The Merge prompt lands mid-implementation.** The agent sees a merge request between its own steps. Mitigated by the
  fixed sentence naming the branch, and the user can still merge by hand on GitHub. If this proves noisy, option 1 is a
  one-line fallback (skip the handover).
- **Sessions from before this change** with two running sessions of one change: `list()` is newest first and the
  existing rule already returns the most recent; nothing is ended on upgrade.
