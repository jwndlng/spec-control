# Proposal

## Why

An agent session can run for a long time without the user touching the machine — an Implement or Fast-forward session
works through its tasks while the user is away. When the Mac goes to idle sleep, the agent stops mid-turn: its
process is suspended, its network calls time out, and the user comes back to a session that did nothing for an hour.
The dashboard already knows when an agent is busy (the session badge), so it can hold the machine awake exactly for
that long — and no longer.

## What Changes

- While at least one agent session is **busy**, the server holds a macOS idle-sleep assertion by running the system's
  own `/usr/bin/caffeinate -i -w <server pid>` as a child process, and ends it as soon as no session is busy any more.
  A session is busy while it runs and either its agent's current report is `working`, or — with no current report —
  its terminal produced output that counts as activity within the last five minutes. A current `waiting` report, a
  silent terminal, an ended or failed session release it. Every kind of agent session counts (change sessions, the
  main console, project consoles, integrations).
- Only idle system sleep is prevented: the display still sleeps, closing the lid or choosing Sleep still sleeps, and
  nothing about power settings is changed or persisted. `-w` makes `caffeinate` end on its own if the server dies, so a
  crash never leaves the machine awake.
- A new global setting **Keep awake while agents work** in the Agent sessions section of Settings, on by default and
  stored as `keepAwake: false` only when switched off (like `updateCheck`). Switching it off releases the assertion
  immediately.
- The setting's hint says whether the machine is being kept awake right now and for how many sessions, and says the
  feature is unavailable on platforms other than macOS (where nothing is started).
- The state the hint shows comes from `GET /api/sessions`' existing response, extended with a small `keepAwake` field.
- Non-goals: Linux and Windows (a later change could add `systemd-inhibit` / `SetThreadExecutionState`), keeping the
  display on, preventing sleep on lid close, and per-project settings.

## Capabilities

### New Capabilities

- `keep-awake`: when the server prevents idle system sleep on behalf of busy agent sessions — what counts as busy, the
  mechanism and its limits (macOS only, idle sleep only, never outliving the server), the setting and what Settings
  shows about it.

### Modified Capabilities

- `dashboard-api`: `GET /api/sessions` additionally reports the keep-awake status (whether the feature is available,
  on, and holding the machine awake, and for how many sessions).

## Impact

- New `src/server/keepAwake.ts` (decision of "busy" as a pure function, plus the `caffeinate` child process holder),
  wired in `src/server/index.ts` (start, reconcile on the session refresh, stop on shutdown).
- `src/server/sessions/manager.ts`: expose what the decision needs (each running session's last activity and current
  report) and call back when a session starts or ends, without changing how badges are computed. Today reports are read
  only when `GET /api/sessions` is requested; while a session runs and the feature is on, keep-awake also re-reads them
  on its own timer (once a minute), which reads files under `~/.spec-control/sessions/` and writes nothing.
- `src/server/config.ts`, `src/shared/types.ts`: optional `keepAwake?: false`.
- `src/server/api.ts`: `keepAwake` status on the sessions response.
- `src/ui/settings.tsx`: the switch and its hint.
- `src/ui/changelog.ts`: a What's new entry.
- Tests: `test/keepAwake.test.ts` with a fake `caffeinate` (no real power assertion in tests).
- Invariants: no write to any repository, no network, no shell; the only new process is `/usr/bin/caffeinate`, which
  cannot modify a repository. The desktop app is unchanged — it runs the same server.
