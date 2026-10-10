# Tasks

## 1. Server: progress, queue state and Cancel

- [x] 1.1 Add `GithubClone.progress` (`phase`, `percent?`, `receivedBytes?`, `updatedAt`) and the `queued` and `cancelled` states to `src/shared/types.ts`, and a pure progress parser in `src/server/githubClone.ts` for git's `\r`/`\n`-separated `--progress` lines; unit tests cover receiving (with bytes), resolving, checkout, `remote:` lines, unknown lines and split chunks
- [x] 1.2 Run `git clone --progress` with `LC_ALL=C`, read stderr as a stream into the parser with a bounded tail for the failure reason, and coalesce updates to at most every 500 ms; `test/githubClone.test.ts` proves a clone of a local bare repository reports `receiving` and `checkout` before `tracked`, and that the failure reason is still masked
- [x] 1.3 List a job waiting for a slot as `queued` and switch it to `cloning` when git starts; discovery still leaves out both; the "third clone waits" test asserts `queued`
- [x] 1.4 Add Cancel to `GithubClones`: a queued job leaves the queue without starting git, a running one is stopped (SIGTERM, SIGKILL after 5 s), then the non-recursive `rmdir`; `cancelled` can be retried and dismissed; tests cover cancelling running and queued clones, a cancel racing a finish (`409`), and that nothing outside the target changes
- [x] 1.5 Add `POST /api/github/clones/cancel` behind `crossSiteRefusal` and allow dismissing `cancelled`; `test/githubApi.test.ts` covers `200` with `cancelled`, `409` for a finished clone, `404`, cross-site `403` with the clone still running, and progress in `GET /api/github/clones`

## 2. UI: the clone row and the store

- [x] 2.1 Add `cancelGithubClone` to `src/ui/api.ts`, poll while any clone is `queued` or `cloning`, and add pure helpers for the progress label, percentage, elapsed time and the accessible value; unit tests in `test/githubUi.test.ts`
- [x] 2.2 Add a hook-free `CloneRow` (state word, `<progress>` with phase / percent / elapsed and `aria-valuetext`, indeterminate while connecting, Cancel / Retry / Dismiss by state); component tests cover every state

## 3. UI: dialog, overview and wizard

- [x] 3.1 Rework `src/ui/addGithub.tsx` into the list and a **To clone** panel with its own `add-github-*` styles (rows with checkbox, `owner/name`, badges, description, last push; folder field and full path per choice; Clone naming the count); component tests cover the row content, the empty **To clone** panel, and that closing without Clone starts nothing
- [x] 3.2 Close the dialog once every clone is accepted and show the overview's polite, auto-hiding status; keep only refused rows on a refusal; tests cover both paths through the controller and the status text
- [x] 3.3 Use `CloneRow` in Unmanaged projects (`src/ui/untracked.tsx`) for queued, running, failed and cancelled clones, with Cancel for queued and running ones; extend `test/untrackedUi.test.ts`
- [x] 3.4 Make `continueWorkspaceStep` move on once every clone is accepted (no waiting), keep the step open only for refused starts, and list the started clones on the Done step with `CloneRow` and the Workspace card's "still running" count; extend `test/setupState.test.ts` and `test/setupWizardUi.test.ts` with the setup-wizard delta scenarios
- [x] 3.5 Update the Help (`src/ui/helpContent.tsx`) where it describes Add from GitHub or setup; `test/helpContent.test.ts` passes

## 4. Demo and verification

- [x] 4.1 Simulate progress through the phases and Cancel in `src/ui/demo/demoApi.ts`; `test/demoApi.test.ts` covers progress advancing, cancel and retry
- [x] 4.2 Run `bun run check` and `bun run build`; in `dist/spec-control` with a scratch `SPEC_CONTROL_HOME`, clone a real public repository through the API and see `receiving` progress before `tracked`, and cancel a running clone and see its folder gone
- [~] 4.3 In a browser: the setup wizard moves on at once and the Done step shows the clone's progress; the dialog closes on Clone and the overview's entry shows the progress bar and Cancel (for the user to confirm)
