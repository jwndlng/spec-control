# Proposal

## Why

Four places in setup and integration undo or ignore a choice the user just made:

- **Forget is undone for a project that came from Integrate or New project.** `confirmPendingIntegrations`
  (`src/server/integration.ts`) re-checks the folder of *every* integration session in `sessions.list()` — ended ones
  included, which are persisted and kept up to `KEEP_ENDED_SESSIONS` (50) — and it runs on every `/api/discover`. Once
  such a project is disabled and forgotten, the overview's rediscover right after Forget (`src/ui/untracked.tsx`) finds
  the marker again and `confirmIntegration` adds the folder back, enabled, under its default name. Reproduced against a
  config whose repository list was empty after Forget and one ended integration session for the folder. That breaks
  repo-discovery's "Forgotten repo becomes a candidate again" and "MUST NOT be added to the config by discovery", and
  repo-integration's "On the first check that finds the marker": it is added on every check, not only the first.
- **Unchecked projects in the setup wizard are checked again after a save.** After `continueWorkspaceStep` saved,
  `setupWizard.tsx` clears the unchecked set (`setUnchecked(new Set())`). The checked projects are tracked and leave the
  candidate list, discovery runs again over the saved roots, and the projects the user left out are listed — checked.
  A second **Continue** (after a refused clone kept the step open, or after **Back** from Agents) tracks them. That
  breaks setup-wizard's "Projects found are tracked", "SHALL NOT change any repository's … enabled state other than
  tracking the checked projects", and "Back keeps entries".
- **The Done step loses clones when a root was typed with a different spelling.** The wizard remembers its clones by
  the path it computed itself (`joinPath(root, name)` in `githubState.ts` from the root as typed, collected into
  `clonePaths` in `setupState.ts`) and the Done step keeps the clone list's entries whose `path` is in that list. The
  server's clone path is `join(canonicalPath(root), name)`. A root typed as `~/workspace` for a folder called
  `Workspace` on a case-insensitive disk, or `/tmp/acme` where `/tmp` is a symbolic link, yields different strings: the
  Done step shows neither progress nor a failure nor Retry for those clones, which breaks "A clone fails".
- **Continue can act on a stale discovery result.** While discovery runs, the step still holds the previous result and
  **Continue** is available. After the user removes an entered root, **Continue** saves the roots without it and then
  tracks the candidates of the old result one by one; one under the removed root is refused with `404` ("not a
  repository discovery offers for tracking"), and the step shows an error after a partial save.

## What Changes

- **An integration session confirms its folder at most once.** Discovery re-checks only the folders of *running*
  integration sessions; the end of a session checks its folder once more. The first check that finds the marker records
  on the session that its folder was confirmed, and a confirmed session is never checked again — so a project the user
  later disables and forgets stays forgotten, even while the agent that set it up still runs as the project's console.
  A session that ended without the marker is not re-checked: a marker written later makes the folder an ordinary
  candidate, which the user enables like any other.
- **The wizard keeps what the user left out.** The unchecked set survives a save and **Back**; a project the user
  unchecked stays unchecked for as long as the wizard is open, and a second **Continue** tracks nothing the user did
  not check.
- **The Done step finds clones by the server's path.** The wizard records the `path` each accepted clone's response
  carries — canonical, and the same for a Retry of that clone — rather than the path it built from the typed root.
- **Continue waits for discovery.** While discovery runs, **Continue** (and moving forward from the step list) is
  unavailable, saying that projects are still being looked for; it acts only on the latest result.
- No new write to a tracked repository, no new process, no network access.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `repo-integration`: "Integration is confirmed by the marker, never by the agent's word" — running sessions only on
  discovery, at most one confirmation per session; a new requirement that a forgotten project stays forgotten.
- `repo-discovery`: an integration session is never a way back into the config after Forget.
- `project-creation`: the same for a project created with New project.
- `setup-wizard`: unchecked projects are kept, clones are matched by the server's path, Continue waits for discovery.

## Impact

- `src/server/integration.ts`: `confirmPendingIntegrations` takes running, unconfirmed sessions only; `confirmIntegration`
  is called per session and records the confirmation.
- `src/server/index.ts`: `onIntegrationEnded` confirms through the per-session path.
- `src/server/sessions/manager.ts`: a way to record the confirmation on an integration session and persist it.
- `src/shared/types.ts`: `IntegrationSession.confirmedAt?: string`.
- `src/server/api.ts`: the `/api/discover` call site (unchanged in shape; listed because it calls the changed function).
- `src/ui/setupWizard.tsx`: keep `unchecked` after a save; block Continue while `discovery.running`; filter the Done
  step's clones by the recorded server paths.
- `src/ui/setupState.ts`: `continueWorkspaceStep` records `clone.path` from the clone response in `clonePaths`.
- Tests: `test/integration.test.ts`, `test/setupState.test.ts`, `test/setupWizardUi.test.ts`.

### Overlaps

- `harden-session-lifecycle` (in flight) changes `src/server/sessions/manager.ts` (`openIntegration` folder checks) and
  adds a requirement to `repo-integration`; this change touches neither that requirement nor `openIntegration`.
- `serialise-home-writes` (PR #359, open) changes `src/ui/setupState.ts`, `src/ui/setupWizard.tsx` and
  `src/server/api.ts` (revisions on config saves, retry on conflict in `continueWorkspaceStep`). Whichever lands second
  rebases onto the other; the edits are in different lines of `continueWorkspaceStep` and the wizard.
- `contain-repository-reads` (PR #371, open) changes `src/server/api.ts`, but not `/api/discover`.
- `apply-what-was-previewed` (in flight) mentions `githubState.ts` only as a pattern; this change does not edit that file.
