# Proposal

## Why

A review of the session manager found ways a session's start, end or prompt can go wrong in ways the specs already
forbid or never considered. Two of them are severe:

- **One prompt can stop the dashboard and every agent.** When a profile has no `{prompt}` argument, or an ended session
  is resumed through its resume command for **Ship** or **Resolve conflicts**, the prompt is typed after start-up from a
  timer (`start` in `src/server/sessions/manager.ts`). `submit` is not `async` and throws `SessionError` synchronously
  when `validSubmission` refuses the text, so the timer's `.catch` never sees it: the exception escapes, Bun exits with
  code 1, and every running agent is killed. A configured prompt with a line break is enough (the prompt schema allows
  multi-line prompts; `compose` collapses whitespace only in the additional instructions), and so is a composed prompt
  over 4096 characters. On a running session the same refusal comes back as a 400 from Ship, a sent action or Resolve
  conflicts — after `session.action` or `autoMergeAskedAt` was already changed, although nothing was typed.
- **A worktree can be removed under a running agent.** `close(..., { removeWorktree })` and `endMergedAutoMerge` never
  check whether another session runs in the worktree (`removeWorktreeByName` does). A session ended with its worktree
  kept, whose worktree a new session of the change then reuses, is matched once its auto-merge pull request merges,
  and `git worktree remove` deletes the directory the second agent works in. The end dialog's "remove worktree" for the
  first session does the same. "Worktree clean-up is offered only when safe" already says a worktree MUST NOT be removed
  while a session is running in it.

And five smaller ones:

- **Starting is not atomic.** `open`, `resume` and the restart behind Ship and Resolve conflicts check "one session per
  change" and "one session per worktree" synchronously, then await git before the session is registered or running. Two
  concurrent opens of Implement after a kept worktree start two agents in one worktree; two concurrent resumes start two
  processes for one session, and the first is orphaned — still alive after the session is ended.
- **A reused worktree is never checked.** `ensureWorktree` reuses any existing directory in which
  `rev-parse --is-inside-work-tree` is true. It does not check that it is a worktree of this repository, nor that it is on
  the session's branch: after Resolve conflicts left worktree `<change>` on `feat/<change>-v2`, Implement reuses it and
  records `feat/<change>`; an empty leftover directory inside a home folder that is itself a git repository passes too.
- **A merged pull request is matched by branch name alone.** `endMergedAutoMerge` ends a session for any merged pull
  request whose head is the session's branch, including one from a fork or one into another base — unlike
  `requestReadyMerges`, which checks the base, and Resolve conflicts, which refuses forks.
- **The console and Integrate can share a folder.** The console folder is refused only inside a tracked repository, and
  `openIntegration` does not call `refuseOtherAgentInFolder`, so the console and an integration session can run in one
  folder; once integration succeeds the console sits in a tracked repository's main checkout.
- **`{prompt}` inside an argument is not substituted literally.** `arg.replaceAll("{prompt}", prompt)` in
  `launchCommand` interprets `$&`, `` $` `` and `$'` in the prompt, so a prompt containing them reaches the agent
  altered (the Antigravity preset passes its prompt as `--prompt-interactive={prompt}`).

## What Changes

- **A typed prompt is made typable, and checked, before anything happens.** A prompt the dashboard types is typed as
  one line, every run of whitespace collapsed to one space as the Merge prompt already is. Its typed form is checked
  against the submission rules before an agent is started or restarted and before the session's action or auto-merge
  record is changed; a prompt that still cannot be typed refuses the request with a reason and changes nothing.
  `SessionManager.submit` reports a refusal as a rejected promise, never a synchronous throw, and nothing the dashboard
  types on a timer can end the dashboard.
- **A worktree is removed only when no other session runs in it**, for the end dialog and for a merged auto-merge pull
  request alike. The ended session keeps the reason, as for any other check that keeps the worktree.
- **Starting a change's session is one at a time.** Every start of a change session — open, Resolve conflicts on a
  head branch, resume, and the restart behind Ship and Resolve conflicts — and every removal of that change's session
  worktree waits for any other one in progress for the same change, then makes its checks afresh. A second open
  returns the first one's session; a second resume finds it running.
- **A reused worktree must be this repository's, on the session's branch.** A new session reuses an existing directory
  only when read-only git proves it is a linked worktree of the repository on the session's branch, and refuses
  otherwise with a reason naming what it found. A session started again in its own worktree only needs it to be the
  repository's.
- **A merged pull request ends only its own session**: not from a fork, and into the default branch as known locally —
  the rules the ready-merge already applies.
- **The console and Integrate never share a folder with another agent.** Opening or resuming the console is refused
  while another agent runs in its folder, or an integration runs in a folder that holds it; Integrate is refused while
  another session runs in the folder or below it.
- **`{prompt}` is substituted literally** wherever it stands in an argument.
- No new git subcommand (`symbolic-ref`, `rev-parse --git-common-dir` are read-only and already listed), no new write to
  a repository, no network access, no API route; invariants 1–7 are unchanged.

## Non-goals

- Raising or lowering the 4096-character submission limit, or changing how text is typed into a terminal — that is
  `archive-button-wrong-text`.
- A process-wide `uncaughtException` handler: it would hide the next bug of this kind instead of making it impossible.
- Removing a worktree that is kept because another session runs in it once that session ends: its own end dialog, or
  repository cleanup, decides that.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: typed prompts are checked before anything starts or is recorded; removal waits for no other
  session; starts are serialised per change; reused worktrees are verified; merged pull requests match only their own
  session; `{prompt}` is literal.
- `main-console`: the console never shares its folder with another agent.
- `repo-integration`: Integrate never shares a folder with another agent.

## Order and overlaps

- `archive-button-wrong-text` modifies "Text sent on the user's behalf is submitted only after the agent showed it" and
  changes `submitText` in `src/server/sessions/submit.ts` (typing in pieces). This change adds a requirement of its own
  instead of modifying that one, and leaves `submit.ts` alone: the whitespace collapse lives in `agents.ts`, the
  up-front check reuses `validSubmission` unchanged, and the async refusal is in `SessionManager.submit`
  (`manager.ts`). The two land in either order; the 4096-character limit is the same in both.
- `one-console-per-change` also changes `src/server/sessions/manager.ts` (`open` ending the proposal session first,
  `resume`, `requestReadyMerges`). Its end-first open ends a session from inside `open`; the per-change start lock of
  this change must let that happen (ending without removing a worktree does not take the lock, see design D3).
- `start-editor-in-worktree` touches `manager.ts` only to resolve a session's folder; no conflict expected.

## Impact

- `src/server/sessions/manager.ts`: `submit` rejects instead of throwing; typed-prompt check before `start`/`restart`
  and before `session.action`/`autoMergeAskedAt` change in `open`, `prompt`, `ship`, `resolveConflicts`, `resume`;
  per-change start lock; other-session check in `close` and `endMergedAutoMerge`; fork and base check in
  `endMergedAutoMerge`; folder checks in `openConsole`, `prepareConsoleRestart` and `openIntegration`.
- `src/server/sessions/agents.ts`: `typedForm` (one-line form of a typed prompt) used by `launchCommand`; literal
  `{prompt}` replacement.
- `src/server/sessions/worktree.ts`: `ensureWorktree` verifies a reused directory (`rev-parse --git-common-dir`,
  `symbolic-ref --quiet HEAD`) with an option for the session's own restart.
- `src/ui/changelog.ts`: What's new entry.
- Tests: `test/terminalSessions.test.ts`, `test/sessionPrompt.test.ts`, `test/shipAutoMerge.test.ts`,
  `test/autoMergeCleanup.test.ts`, `test/worktree.test.ts`, `test/agents.test.ts`, `test/consoleSession.test.ts`,
  `test/integration.test.ts`, with `test/fixtures/fake-agent.ts` and `test/fixtures/fake-gh.ts` as they are.
- No API, config schema, UI layout or invariant change; no CLAUDE.md change.
