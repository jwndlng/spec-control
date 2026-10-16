# Design

## Context

The server already holds everything the decision needs, in `SessionManager` (`src/server/sessions/manager.ts`):

- `session.lastOutputAt`, set live in `onOutput()` for output that counts as activity (the echo window after a resize or
  input passed on is excluded).
- The agent's reported state, read by `readReports()` from `SPEC_CONTROL_STATE_FILE`, current only when written after
  the process started and after `live.lastUserInputAt`. Today `readReports()` keeps only `waitingReportedAt`, and it runs
  only inside `GET /api/sessions` — nothing reads the files while nobody looks.

The badge itself (`sessionBadge()` in `src/ui/sessionState.ts`) is computed in the browser with a 20-second silence
threshold. Keep-awake is a separate, server-side decision with a longer window; it does not change the badge.

## Goals / Non-Goals

**Goals:**
- A pure, unit-testable decision `isBusy(session, now)` and a small holder that owns at most one `caffeinate` child.
- Release as soon as it is safe: immediately on the last session's end or the setting turning off, within a minute of
  going idle otherwise.
- Crash safety without a cleanup step: `caffeinate -w <pid>` ends with the server.

**Non-Goals:**
- Linux / Windows backends. The holder is behind a tiny interface (`start()`, `stop()`) so a later change can add
  `systemd-inhibit`, but no abstraction for a second platform is built now.
- Showing keep-awake on cards, the session panel or the desktop app's menu bar. Settings only.

## Decisions

**`caffeinate -i -w <process.pid>` as a child process, not a native API.** It is part of macOS at a fixed path, needs no
FFI (which would also have to work in the compiled binary), and `-w` gives us "ends when the server ends" for free —
including SIGKILL and crashes, where no shutdown hook runs. `-i` prevents idle system sleep only; we deliberately do not
pass `-d` (display), `-s` (system sleep on AC, which also blocks some lid-close sleeps on AC) or `-u`. Alternatives:
IOKit `IOPMAssertionCreateWithName` via `bun:ffi` — the same assertion held in-process, but FFI has to be proven in the
compiled binary and gives no user-visible gain over the system tool; Electrobun power APIs in the
desktop app — would leave the CLI uncovered and give the desktop app a role invariant 4's "thin shell" rule avoids.

**Spawn exactly like the other non-agent children:** `Bun.spawn(["/usr/bin/caffeinate", "-i", "-w", String(pid)],
{ cwd: home, stdin: "ignore", stdout: "ignore", stderr: "ignore" })`, absolute path (no `PATH` lookup), no shell. The
binary path is injectable (`KeepAwakeDeps.command`) so tests run a fake.

**Busy = running ∧ (current report `working` ∨ (no current report ∧ activity within 5 min)).** A current `waiting` report
releases at once — the agent has told us it is idle. Five minutes rather than the badge's 20 seconds because agents run
silent tool calls (a test suite, a build) for minutes; releasing the machine then is exactly the failure this change
fixes. A forgotten idle session holds the machine at most about six minutes. Alternatives: "any running session"
(simplest, but a session left open overnight would keep a laptop awake on battery indefinitely); the badge's 20 s
(releases during every silent tool call).

**`readReports()` keeps the current report, not only `waitingReportedAt`.** It stores the current report's word on the
live record (`live.current: ReportedState | undefined`), and `SessionManager.busyCount(now)` applies `isBusy` to every
session. The badge logic is unchanged: `waitingReportedAt` is still derived exactly as today.

**Evaluation points.** `KeepAwake.evaluate()` is called (1) from `GET /api/sessions` after `readReports()`, (2) by a
`SessionManager` callback `onRunningChanged` fired when a session starts and when it ends, (3) from
`afterConfigChange` in `api.ts`, and (4) by an unref'd 60-second interval that exists only while at least one session
runs and the feature is enabled and available; the interval calls `readReports()` first so a `waiting`/`working` report
is honoured without a browser open. Ending a session stops `caffeinate` synchronously in that callback when nothing
else is busy — that is the "at once" in the spec.

**Restart after an unexpected exit is rate-limited** to once a minute (`lastStartAt`), so a `caffeinate` that dies at
once (e.g. a sandbox refusing it) cannot become a spawn loop.

**Availability** is `process.platform === "darwin"` and `/usr/bin/caffeinate` being an executable file, checked once at
startup (`access(X_OK)`); the platform is injectable for tests.

**Status on `GET /api/sessions`** (`keepAwake: { available, enabled, active, sessions }`) rather than a new route: the
Settings page and the session list already poll it, and adding a field needs no new same-origin surface. The demo's
synthetic sessions response omits it; the UI treats a missing field as "say nothing".

**Setting** follows `updateCheck` exactly: `keepAwake: z.boolean().optional().transform(on => on === false ? false :
undefined)`, `Config.keepAwake?: false`, toggle `on={draft.keepAwake !== false}`. It lives in the Agent sessions section,
under the existing switches, and is shown even while agent sessions are disabled (it then simply never has anything to
hold).

## Risks / Trade-offs

- [A long silent tool call beyond five minutes without a `working` report lets the Mac sleep] → Users who wire
  `SPEC_CONTROL_STATE_FILE` hooks get exact behaviour; the hint text mentions it; the window is a constant easy to tune.
- [Battery drain while an agent loops printing output for hours] → Bounded by the agent actually running; the user can
  switch the setting off; display sleep and lid-close sleep still work.
- [`caffeinate` missing or killed by the user] → Reported unavailable / restarted at most once a minute; nothing fails.
- [Tests must never hold a real assertion] → The command is injected; the default is used only by `index.ts`, and the
  tests assert on a fake script's recorded argv and lifetime.

## Migration Plan

None: absent key means on; older binaries ignore nothing because `keepAwake: false` is only written by this version, and
an older version reading it drops the unknown key on its next save (same as `updateCheck` when it was introduced).
