// Setting a repository up for OpenSpec (repo-integration spec). The dashboard writes nothing in the repository: the
// user's agent runs `openspec init` under its own permission prompts, which invariant 1 already covers ("starting the
// user's agent … is not a write by the dashboard"). All this module decides is *when that worked* — `openspec/config.yaml`
// on disk, never anything the agent printed — and it then tracks the repository, a write to `~/.spec-control/` only.
import { integrateUnavailable, isIntegration, type Config, type IntegrationSession } from "../shared/types.ts";
import { availableName } from "../shared/nameHints.ts";
import { newRepoConfig, updateConfig } from "./config.ts";
import { discoverRepos, isSpecProject } from "./discover.ts";
import { canonicalPath } from "./paths.ts";
import { SessionError, type SessionManager } from "./sessions/manager.ts";

/** The part of the app the integration flow needs. `AppState` satisfies it; declared here so there is no import cycle. */
export interface IntegrationState {
  config: Config;
  scanner: { trigger: () => { started: boolean } };
  sessions?: SessionManager;
  /** Clones still running are not offered for integration until they have finished. */
  githubClones?: { runningPaths(): string[] };
}

/** Canonical paths discovery currently reports as waiting for OpenSpec. A fresh walk: "currently" is the whole point. */
async function integratablePaths(state: IntegrationState): Promise<Set<string>> {
  const { integratable } = await discoverRepos(state.config.repos, state.config.scanRoots, state.config.ignorePaths, state.githubClones?.runningPaths());
  return new Set(integratable.map((r) => r.path));
}

/**
 * Starts the default agent in a repository that does not use OpenSpec yet — in place, in its main checkout, with no
 * worktree, no branch and no git command. One integration per folder: while one runs it is returned instead.
 */
export async function startIntegration(state: IntegrationState, input: { path?: unknown }): Promise<{ session: IntegrationSession; created: boolean }> {
  const sessions = state.sessions;
  if (!sessions) throw new SessionError(403, "agent sessions are not available");
  const unavailable = integrateUnavailable(state.config, sessions.agents());
  // The global reasons first: they are what the row already says, and none of them depends on the folder.
  if (unavailable === "agent sessions are disabled") throw new SessionError(403, unavailable);
  if (typeof input.path !== "string" || !input.path.trim()) throw new SessionError(404, NOT_INTEGRATABLE);
  const folder = canonicalPath(input.path);
  if (!(await integratablePaths(state)).has(folder)) throw new SessionError(404, NOT_INTEGRATABLE);
  if (unavailable) throw new SessionError(503, unavailable);
  return sessions.openIntegration(folder);
}

const NOT_INTEGRATABLE = "this folder is not a repository waiting to be set up for OpenSpec";

/**
 * The marker decides, nothing else: when `openspec/config.yaml` is in the folder, the repository is tracked with
 * `enabled: true` and its default name, and a scan starts so it reaches the board. Returns whether it was added.
 */
export async function confirmIntegration(state: IntegrationState, folder: string): Promise<boolean> {
  const path = canonicalPath(folder);
  if (!(await isSpecProject(path))) return false;
  // Checked again inside the write: a concurrent Enable or an earlier confirmation may have added it meanwhile.
  const { previous, saved } = await updateConfig(state, (current) => {
    if (current.repos.some((r) => canonicalPath(r.path) === path)) return undefined;
    const repo = newRepoConfig(path, true);
    const named = { ...repo, name: availableName(repo, current.repos.map((r) => r.name)) };
    return { ...current, repos: [...current.repos, named] };
  });
  if (saved === previous) return false;
  state.scanner.trigger();
  return true;
}

/**
 * Checks an integration session's folder, once: the first check that finds the marker records `confirmedAt` on the
 * session — whether or not this check is the one that adds the repository — and a confirmed session is never checked
 * again, so a project the user forgets stays forgotten. Returns whether the repository was added.
 */
export async function confirmIntegrationSession(state: IntegrationState, session: IntegrationSession): Promise<boolean> {
  if (session.confirmedAt !== undefined) return false;
  if (!(await isSpecProject(canonicalPath(session.folder)))) return false;
  // Only the call that records the confirmation goes on; a concurrent check of the same session stops here.
  if (!(await state.sessions?.recordIntegrationConfirmed(session.id))) return false;
  return confirmIntegration(state, session.folder);
}

/**
 * Re-checks the folder of every integration session that still runs and has not been confirmed. Called on each
 * discovery run, so a marker written while the agent is still going is noticed as soon as the user looks; an ended
 * session was checked once when it ended and is not checked again.
 */
export async function confirmPendingIntegrations(state: IntegrationState): Promise<void> {
  const pending = (state.sessions?.list() ?? []).filter((s): s is IntegrationSession => isIntegration(s) && s.state === "running" && s.confirmedAt === undefined);
  for (const session of pending) await confirmIntegrationSession(state, session);
}
