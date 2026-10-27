# Design

## Context

Text the dashboard types goes through `SessionManager.submit`, which checks it with `validSubmission` (no control
character, at most 4096 characters) and queues it for `submitText`. A typed opening prompt — a profile without
`{prompt}`, or a resume command handed a Ship or Resolve conflicts prompt — is submitted from a `setTimeout` in `start`
with `void this.submit(...).catch(() => {})`. Because `submit` is a plain function that throws before it returns a
promise, a refused text throws inside the timer callback, which Bun treats as fatal.

Session starts (`open`, `openToResolve`, `resume`, `restart` via `ship`/`resolveConflicts`) check for running sessions
first and register or mark the session running only after awaiting git. Removal (`close` with `removeWorktree`,
`endMergedAutoMerge`) checks safety of the worktree's contents, never who else is in it.

## Decisions

### D1. A typed prompt is one line, and checked where it is composed

`typedForm(text)` in `agents.ts` collapses every run of whitespace to one space and trims, exactly as `mergePrompt`
already does for its whole text. `launchCommand` returns the typed form as `typed`; `prompt`, `ship` and
`resolveConflicts` send the typed form to a running session. A line break in a typed prompt would at best submit the
first line early, so collapsing it loses nothing the agent could have received. A prompt passed as an argument keeps
its line breaks: an argument carries them faithfully.

Each caller then checks the typed form with `validSubmission` — the same rule, unchanged — before it changes anything:
before `restart`/`start`, before `session.action = action`, before `askedForAutoMerge`/`autoMergeAskedAt`. A refusal
is a 400 naming why (a control character, or the length after collapsing). Where the prompt is final only after the
worktree exists (`open` decides auto-merge in the worktree), the check runs after that and before the session is
registered; the worktree it created is kept like any session worktree without a record, and removable from the
project's worktree list.

Rejected: a length limit on prompts in the configuration. The composed length depends on the change name, the
auto-merge and record instructions and the additional instructions, so a config-time limit could never be exact.

### D2. `submit` never throws synchronously

`submit` becomes `async`, so every refusal is a rejected promise. The typed-prompt timer keeps its `.catch`, which now
actually catches. With D1 the timer can only meet a refusal when the session ended between start and typing; that is
harmless. No global `uncaughtException` handler is added (see proposal Non-goals).

### D3. One start per change at a time

`SessionManager` keeps a promise chain per `repoId + change` (`startLock`). It is taken, before the first await, by
`open`, `openToResolve` and every `restart` of a change session (resume, Ship, Resolve conflicts), and by the worktree
removal step of `close` and `endMergedAutoMerge`. Each holder re-runs its checks after acquiring it, so a second
concurrent open sees the session the first registered and returns it, and a second resume sees `running` and returns.
Ending a session without removing a worktree does not take the lock, which keeps `one-console-per-change`'s end-first
open (it ends the proposal session from inside `open`) from waiting on itself. A rejection releases the lock.

Rejected: an in-flight set that refuses the second request with 409. A double-click would then show an error for the
very case the existing rule answers by returning the running session.

### D4. Removal refuses while another session is in the worktree

`close` and `endMergedAutoMerge` refuse removal, with reason `a session is running in this worktree`, when any session
other than the one being ended is running in `worktreePath` (canonical paths, as `runningInFolder` compares) — the
check `removeWorktreeByName` already makes. The check runs under the lock of D3, so a start reusing the worktree cannot
slip in between. For `endMergedAutoMerge` the ended session records `autoEnded` with `removed: false` and that reason;
"Seen again" keeps holding, and the worktree is left to the other session's own end or to repository cleanup.

### D5. A reused directory is verified

`ensureWorktree` gains `verify: "branch" | "repository"`. For an existing directory it requires, read-only:
`git rev-parse --git-common-dir` in the directory resolving to the repository's common directory (both canonical), and,
for `"branch"`, `git symbolic-ref --quiet HEAD` equal to `refs/heads/<branch>`. `open` and `openToResolve` pass
`"branch"`; `restart` passes `"repository"`, because a session started again in its own worktree may legitimately be
on the branch its agent switched to, which work status already reports from git. A failed check throws with a reason
naming the branch or repository found, mapped to 409; nothing is created or removed.

### D6. A merged pull request must be the session's own

`endMergedAutoMerge` additionally requires `isCrossRepository === false` and `base` equal to the default branch as known
locally (`defaultBranch(repo.path)`, read once per call), as `requestReadyMerges` and `openToResolve` do. A pull request
whose list entry lacks `isCrossRepository` does not match.

### D7. Console and Integrate check the folder

`openConsole` and `prepareConsoleRestart` refuse while any other session runs with a working directory equal to the
console folder, or an integration session runs in a folder that is or contains it. `openIntegration` refuses while any
session runs in the folder or below it (the console folder lying inside the repository being integrated), with a reason
naming that session. All comparisons on canonical paths, all in the manager, before any await that precedes
registration.

### D8. `{prompt}` is replaced by a function

`arg.replaceAll("{prompt}", () => prompt)`: a replacer function's result is inserted literally.

## Risks / Trade-offs

- [A user's multi-line prompt typed as one line reads differently to the agent] → it could never have been typed
  correctly before; as an argument it is unchanged.
- [A worktree the agent switched to another branch can no longer be reused by a new session] → refused with a reason;
  the user ends and removes it or works in it through its own session.
- [The start lock delays a second start by one git round trip] → only for the same change.
