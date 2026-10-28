# Design

## Context

`confirmIntegration(state, folder)` adds a folder with `openspec/config.yaml` to the config when it is not there yet.
It is called from `onIntegrationEnded` (wired in `src/server/index.ts`, which `SessionManager.end` calls for an
integration session, also for sessions found running when the dashboard restarts) and, for every integration session
the manager lists, from `confirmPendingIntegrations` on each `/api/discover`. "Not there yet" is all it checks, so after
Forget it adds the folder again.

The wizard's Workspace step holds `unchecked`, `discovery` (result plus `running`), and `saved.clonePaths`.

## Decisions

### D1. One confirmation per integration session, recorded on the session

The session record gains `confirmedAt`, set (and persisted with the session) the first time a check finds the marker,
whether or not that check added the folder — a concurrent Enable may have added it first. A session with `confirmedAt`
is never checked again. Discovery checks running sessions without `confirmedAt`; the session's end checks it once if it
has none.

Rejected: only dropping ended sessions from discovery. A New project's integration session stays running as the
project's console after the marker appears (`projectConsoleSessions`), so disable and Forget while it runs would still
be undone on the next discovery.

Rejected: remembering forgotten paths in the config. Forget's contract is that the folder becomes a candidate again;
a deny list would be new state with its own way to be wrong.

### D2. A session that ended without the marker is not re-checked

If the agent ends without writing the marker and the user writes it later by hand, the folder is an ordinary candidate
on the next discovery. The user enables it with one click; the dashboard does not need to remember which ended sessions
might still turn into a project.

### D3. The unchecked set lives as long as the wizard

`unchecked` holds paths. A tracked path is no longer a candidate, so keeping it in the set is harmless; clearing it is
what re-checks the left-out projects. It is no longer cleared on save. Entered roots and roots to create are still
cleared on save, because those are now configured.

### D4. The server's path identifies a clone

`cloneGithub` resolves to the `GithubClone` the server created, whose `path` is canonical. `continueWorkspaceStep`
records that path, and the Done step filters the clone list by it. A Retry replaces the finished job with one for the
same canonical path (`GithubClones.start`), so it is found as well. Rejected: matching by clone id — a Retry gets a new
id that the wizard does not see when it is started from the Done step's own Retry.

### D5. Continue is blocked while discovery runs

The block uses the existing `continueBlocked` text, so the step list cannot move forward either. Discovery takes well
under a second on a typical root; the block is short and spares a partial save followed by an error.
