# Tasks

## 1. Integration (server)

- [ ] 1.1 Add `confirmedAt?: string` to `IntegrationSession` and a manager method that sets and persists it; verify with a test in `test/integration.test.ts` that the field survives a restart of the session manager
- [ ] 1.2 Make `confirmPendingIntegrations` check running integration sessions without `confirmedAt` only, and record `confirmedAt` on the first check that finds the marker; make `onIntegrationEnded` check only a session without `confirmedAt`; verify with `test/integration.test.ts` "a forgotten integrated project stays forgotten" (ended session, marker present, config emptied, discovery run: config stays empty, folder is a candidate)
- [ ] 1.3 Verify the running-session case with `test/integration.test.ts` "forgetting while the setup agent still runs": marker written, discovery adds the folder, the repository is removed from the config, discovery runs again, config stays empty
- [ ] 1.4 Keep "the folder is re-checked when the session ends, and again on every discovery run" passing, renamed to say running sessions; verify with `bun test test/integration.test.ts`

## 2. Setup wizard (UI)

- [ ] 2.1 Stop clearing `unchecked` after a save; verify with `test/setupWizardUi.test.ts` "an unchecked project stays unchecked after a refused clone and after Back", where a second Continue tracks nothing more
- [ ] 2.2 Record `clone.path` from each accepted clone response in `continueWorkspaceStep`; verify with `test/setupState.test.ts` "clone paths are the server's" (typed root differs in case from the server's canonical path) and a `test/setupWizardUi.test.ts` case that the Done step lists such a clone with its failure and Retry
- [ ] 2.3 Block Continue with "Still looking for projects…" while discovery runs; verify with `test/setupWizardUi.test.ts` "Continue waits for discovery", including that removing a root and continuing at once tracks no candidate under it

## 3. Check

- [ ] 3.1 Run `bun run check`
