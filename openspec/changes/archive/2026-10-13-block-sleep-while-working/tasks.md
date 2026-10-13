# Tasks

## 1. Configuration

- [x] 1.1 Add `keepAwake?: false` to `Config` in `src/shared/types.ts` and the `keepAwake` key to `configSchema` in
  `src/server/config.ts`, stored only as `false` like `updateCheck`; verify with `test/config.test.ts` cases (absent →
  no key, `true` → no key, `false` → `false`)

## 2. Busy decision in the session manager

- [x] 2.1 In `readReports()` keep the current report's word on the live record (badge logic and `waitingReportedAt`
  unchanged); verify the existing session report tests still pass
- [x] 2.2 Add a pure `isBusy({ running, lastOutputAt, current }, now)` (5-minute window, `working` overrides silence,
  `waiting` releases) and `SessionManager.busyCount(now)` over every session kind; verify with unit tests covering
  each spec scenario (activity 1 min ago, silent 6 min, reported working + silent 20 min, reported waiting + recent
  output, ended session, console and integration sessions count)
- [x] 2.3 Add an `onRunningChanged` callback to `SessionManager` deps, fired after a session starts and after it ends;
  verify with a fake-agent test that it fires once for each

## 3. Keep-awake holder

- [x] 3.1 Create `src/server/keepAwake.ts`: `KeepAwake` with injectable `command`, `platform`, `pid`, `getConfig`,
  `busyCount`, `readReports`; `available` (darwin + executable `/usr/bin/caffeinate`), `evaluate()` starting at most one
  child `[command, "-i", "-w", pid]` without a shell, cwd in the home, stdio ignored, and ending it when nothing is busy
  or the setting is off; restart after an unexpected exit at most once a minute; `status()` for the API; `stop()`
- [x] 3.2 Run the 60-second evaluation interval (unref'd, `readReports()` first) only while a session runs and the
  feature is enabled and available; verify with fake timers that no interval exists with no running session
- [x] 3.3 Add `test/keepAwake.test.ts` with a fake `caffeinate` script recording its argv and lifetime: starts once for
  two busy sessions, ends at once when the last ends, ends when the setting turns off, never starts on `linux`, and is
  rate-limited after dying; assert the argv carries `-i -w <pid>` and nothing else

## 4. Wiring

- [x] 4.1 In `src/server/index.ts` create the `KeepAwake` after the session manager, pass `onRunningChanged`, and call
  `stop()` in `shutdown` before `process.exit`; verify by running `bun run dev`, starting a session on macOS and
  checking `pmset -g assertions` shows a `caffeinate` PreventUserIdleSystemSleep assertion, gone after closing it
- [x] 4.2 In `src/server/api.ts` call `evaluate()` after `readReports()` in `GET /api/sessions` and return
  `keepAwake: status()`, and call it from `afterConfigChange`; verify with an API test for both spec scenarios
  (busy → `active: true, sessions: 1`; `keepAwake: false` → `enabled: false, active: false`)

## 5. Settings

- [x] 5.1 Add the **Keep awake while agents work** switch to the Agent sessions section in `src/ui/settings.tsx`
  (`on={draft.keepAwake !== false}`, `update({ keepAwake: on ? undefined : false })`) with the hint from the session
  list's `keepAwake` status (kept awake for N sessions / no agent busy / macOS only, display and lid still sleep);
  say nothing when the field is missing (demo); verify with a UI test of the hint text for each status
- [x] 5.2 Add a What's new entry at the top of `src/ui/changelog.ts` for keep-awake; verify the changelog tests pass

## 6. Check

- [x] 6.1 Run `bun run check` and `bun run build`, then start `dist/spec-control` on macOS with a session to confirm the
  assertion is taken and released in the compiled binary
