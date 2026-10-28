# Tasks

## 1. Scanner follow-up

- [x] 1.1 Give `Scanner.trigger()` the dirty flag and one shared follow-up promise (design D1): a trigger while a scan runs returns `{ started: false, done }` resolving with the follow-up's snapshot, which reads the configuration afresh; verify with `test/scanner.test.ts` — a repository enabled while another is being scanned is in the snapshot `done` resolves with, three triggers during one scan start exactly one follow-up, and no two `scanAll` runs ever overlap
- [x] 1.2 Verify that every caller that promises a rescan gets it with a test in `test/api.test.ts` that enables a repository through `PUT /api/config` while a slow scan is in flight and then sees it in `GET /api/state` without another trigger
- [x] 1.3 Make `POST /api/scan` queue the follow-up and keep `{ started }` (design D2); verify with `test/api.test.ts` for both answers
- [x] 1.4 Replace the retry loops of `createInRepos` (`src/ui/newChangeForm.tsx`) and the issue import (`src/ui/importIssuesState.ts`) with one scan request; verify with `test/newChangeByLabel.test.ts` and `test/importIssuesState.test.ts` that one `scan` call is made after the creates, also when it answers `{ started: false }`

## 2. Shutdown

- [x] 2.1 Add `forceKill()` to the terminal in `src/server/sessions/terminal.ts`, and teach `test/fixtures/fake-agent.ts` to ignore `SIGHUP` when asked; verify with a `test/terminalSessions.test.ts` case that the forced kill ends such an agent
- [x] 2.2 Make `SessionManager.shutdown()` wait for each agent's `exited` up to `KILL_GRACE_MS`, force every survivor and wait up to one more second before ending the sessions (design D3); verify with `test/terminalSessions.test.ts` — after `shutdown()` resolves, the pid of an agent that ignores `SIGHUP` no longer exists and its session is recorded as ended because the dashboard was stopped
- [x] 2.3 Add `ActivityLog.idle()` (design D4); verify with `test/activityLog.test.ts` that it resolves only after an append queued before it is on disk, and also when that append failed
- [x] 2.4 Await `sessions.shutdown()`, then `activity.idle()`, before `process.exit` in `src/server/index.ts`; verify with a test that runs the shutdown path against a temporary home with one running fake-agent session and finds its session-ended line in `activity.jsonl`

## 3. Home migration

- [x] 3.1 Write `migration.json` right after the rename with every step pending, and after each step (design D5), with the dropped snapshot as a `cache` step; verify with `test/homeMigration.test.ts` by injecting a failure that aborts after the rename and after the link step, then running `migrateHome` again and finding the link, the rewritten session records and the repaired worktree records
- [x] 3.2 Verify the retry of steps that were never attempted is idempotent with `test/homeMigration.test.ts`: a record listing every step pending over a home where some already ran leaves the finished ones byte for byte unchanged and ends with no pending steps
- [x] 3.3 Verify the start-up line and the environment check describe a resumed migration with `test/startupMigration.test.ts`

## 4. Wrap-up

- [ ] 4.1 Run `bun run check`, and run `bun run build` then stop `dist/spec-control` with `SIGTERM` while a session whose agent ignores `SIGHUP` runs, confirming no agent process remains
