// Starting a brand-new project (project-creation spec). The dashboard's own writes are exactly two, both outside every
// tracked repository: one new, empty folder directly inside a configured workspace root, and `git init` in it. The
// folder is then handed to an integration session, so `openspec init` is run by the user's agent under its own
// permission prompts and tracking follows the marker (`integration.ts`), exactly as for Integrate.
import { integrateUnavailable, isProjectName, type CreateProjectResponse } from "../shared/types.ts";
import type { IntegrationState } from "./integration.ts";
import { checkNewFolder, FOLDER_NAME_RULE, makeNewFolder, NewFolderError } from "./newFolder.ts";
import { canonicalPath, gitExecutable } from "./paths.ts";
import { reasonFrom } from "./pull.ts";

const GIT_INIT_TIMEOUT_MS = 10_000;

/** A refusal or failure with the HTTP status the route answers with: the placement refusals are `newFolder.ts`'s. */
export { NewFolderError as CreateProjectError };

/**
 * Variables that would point `git init` somewhere other than the new folder — set, for instance, when the dashboard
 * itself was started from a git hook. Dropped so the only repository git can create is the one in its working directory.
 */
export const REDIRECTING_GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE"];

/**
 * The one writing git command creating a project runs, in the folder just created and nowhere else. Like
 * `createChange.ts`'s runner, deliberately not `git.ts`'s: that module is read-only by contract. Resolves to git's
 * reason on failure, `undefined` on success.
 */
async function gitInit(dir: string, timeoutMs = GIT_INIT_TIMEOUT_MS): Promise<string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const key of REDIRECTING_GIT_ENV) delete env[key];
  let timedOut = false;
  try {
    const proc = Bun.spawn(["git", "init", "--quiet"], { cwd: dir, stdout: "ignore", stderr: "pipe", stdin: "ignore", env });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    try {
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (timedOut) return "git init timed out";
      return code === 0 ? undefined : reasonFrom(stderr);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return String(err);
  }
}

/**
 * Creates `<root>/<name>`, runs `git init` in it and starts an integration session there. Every precondition is checked
 * before the folder is made, so a refusal writes nothing, runs no git and starts no process.
 */
export async function createProject(state: IntegrationState, input: { root?: unknown; name?: unknown }): Promise<CreateProjectResponse> {
  const sessions = state.sessions;
  if (!sessions || !state.config.agentSessions.enabled) throw new NewFolderError(403, "agent sessions are disabled");
  if (typeof input.name !== "string" || !isProjectName(input.name)) throw new NewFolderError(400, FOLDER_NAME_RULE);
  const unavailable = integrateUnavailable(state.config, sessions.agents());
  if (unavailable) throw new NewFolderError(503, unavailable);
  // The same check `openIntegration` makes, made here first so it cannot refuse after the folder exists.
  const agent = state.config.agentSessions.agents.find((a) => a.id === state.config.agentSessions.defaultAgent);
  if (agent && !Bun.which(agent.command[0])) throw new NewFolderError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);
  if (!gitExecutable()) throw new NewFolderError(503, "git was not found on this machine");

  const { path } = await checkNewFolder(state.config, input.root, input.name);
  await makeNewFolder(path);
  const failed = await gitInit(path);
  if (failed) throw new NewFolderError(500, `git init failed in ${path}, which was left in place: ${failed}`);

  const folder = canonicalPath(path);
  const { session } = await sessions.openIntegration(folder);
  return { path: folder, session };
}
