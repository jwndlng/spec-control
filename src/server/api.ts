import { ACTIVITY_KINDS, AUTO_FETCH_SECONDS, type ActivityKind } from "../shared/types.ts";
import { availableName } from "../shared/nameHints.ts";
import { labelKey } from "../shared/labels.ts";
import { withAutoFetch, withPrTitleConvention, withRepoAgent } from "../shared/repoSettings.ts";
import { MAX_PAGE, type ActivityLog, type PageQuery } from "./activity/log.ts";
import { isTimeZone, pageEvents } from "../shared/activity.ts";
import type { AutoFetchSeconds, CleanupSelection, Config, DiscoverResult, PullBlockingFile, PullRequestsResponse, PullResult, PullResolve, RepoConfig, RepoSnapshot, ScanTriggerResult, SharedConfigApplyResult, SharedConfigAssignment, SharedConfigPreview, UpdateStatus } from "../shared/types.ts";
import type { AutoFetcher } from "./autoFetch.ts";
import { applyCleanup, CleanupBusyError, previewCleanup } from "./cleanup.ts";
import { changeDirFor, listArtifactFiles, readArtifactFile } from "./artifacts.ts";
import { consoleFolderProblem } from "./sessions/consoleFolder.ts";
import { createWorkspaceFolder, type FolderPickerContext, FolderPickerBusyError, folderPickerContext, markSetupDone, pickFolder, setupState } from "./setup.ts";
import { NewFolderError } from "./newFolder.ts";
import { ConfigValidationError, newRepoConfig, repoId, updateConfig, validateConfig, validateIgnorePaths, validateScanRoots } from "./config.ts";
import { createChange } from "./createChange.ts";
import { createProject, CreateProjectError } from "./createProject.ts";
import { dismissChange, DismissError, isDismissableName, previewDismiss } from "./dismissChange.ts";
import { discoverRepos } from "./discover.ts";
import { environmentReport } from "./environment.ts";
import { confirmIntegration, confirmPendingIntegrations, startIntegration } from "./integration.ts";
import { githubRepoFromRemote, listGithubRepos } from "./gh.ts";
import { originUrl } from "./git.ts";
import { GithubClones } from "./githubClone.ts";
import { isGithubOwner } from "../shared/github.ts";
import { MAX_BLOCKING_FILES, PullBusyError, pullAll, pullRepository, resolvePullRepository } from "./pull.ts";
import { Issues } from "./issues.ts";
import { PullRequests, type RepoTarget } from "./pullRequests.ts";
import type { Scanner } from "./scanner.ts";
import { applyTo, EMPTY_SHARED_CONFIG, loadSharedConfig, previewFor, SharedConfigValidationError, saveSharedConfig } from "./sharedConfig.ts";
import { SessionError, type SessionManager } from "./sessions/manager.ts";
import { LocalRepoSource } from "./source.ts";
import { frameworkById } from "./frameworks/registry.ts";
import type { UpdateChecker } from "./updateCheck.ts";
import { VERSION } from "./version.ts";
import { whichOnPath } from "./paths.ts";

export interface AppState {
  config: Config;
  scanner: Scanner;
  /** Absent in contexts that never run agent sessions (some tests); the routes then answer 403. */
  sessions?: SessionManager;
  /** History for the Activity view. Absent in contexts that record none; the endpoint then answers with an empty feed. */
  activity?: ActivityLog;
  /** Cached pull-request lists; created on first use, so a state without one still serves the endpoints. */
  pullRequests?: PullRequests;
  /** Issue queries in flight; created on first use. Holds no list between requests. */
  issues?: Issues;
  /** The auto-fetch schedule. Absent in contexts that never fetch on their own (tests, unless they bring one). */
  autoFetcher?: AutoFetcher;
  /** The update check (openspec/specs/update-notice). Absent in contexts that never check; the endpoints then report it off. */
  updateChecker?: UpdateChecker;
  /** Where the setup's folder dialog is looked up; absent means this machine's. Tests point it at a fake picker. */
  folderPicker?: FolderPickerContext;
  /** Clones of Add from GitHub since the dashboard started; created on first use, kept in memory only. */
  githubClones?: GithubClones;
}

/** The part of Bun's server object the handler needs: upgrading the terminal request to a WebSocket. */
export interface ServerLike {
  upgrade(req: Request, options: { data: unknown }): boolean;
}

export interface AppOptions {
  state: AppState;
  /** The built single-page UI; served for every non-API path. */
  indexHtml: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * `GET /api/version`: what a program on the port has to answer to be taken for a Spec Control (the desktop app asks
 * before it starts or attaches to a server). Reads nothing and starts nothing, so it is safe to answer while starting.
 */
function versionResponse(req: Request): Response | undefined {
  if ((req.method === "GET" || req.method === "HEAD") && new URL(req.url).pathname === "/api/version") return json({ name: "spec-control", version: VERSION });
  return undefined;
}

/** What the server answers before the scanner and sessions are ready: its version, and "starting" for everything else. */
export function startingFetchHandler(req: Request): Response {
  return versionResponse(req) ?? new Response("Spec Control is starting", { status: 503, headers: { "retry-after": "1" } });
}

function enabledIds(config: Config): string {
  return config.repos.filter((r) => r.enabled).map((r) => r.id).sort().join(",");
}

async function putConfig(state: AppState, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  let next: Config;
  try {
    next = validateConfig(body);
  } catch (err) {
    if (err instanceof ConfigValidationError) return json({ error: err.message, issues: err.issues }, 400);
    throw err;
  }
  // Checked on save only (loading must survive a folder deleted since); opening the console checks it again.
  const consoleProblem = next.agentSessions.consoleDir ? consoleFolderProblem(next.agentSessions.consoleDir, next) : undefined;
  if (consoleProblem) return json({ error: `invalid config: agentSessions.consoleDir: ${consoleProblem}`, issues: [`agentSessions.consoleDir: ${consoleProblem}`] }, 400);
  // `setup` is the server's, not the client's: a Settings tab holding an older copy can neither end nor restart setup.
  const { previous, saved } = await updateConfig(state, (current) => ({ ...next, setup: current.setup }));
  afterConfigChange(state, previous);
  return json(saved);
}

/** What every config write starts: a fresh `origin` lookup, and a scan when the interval or the enabled set changed. */
function afterConfigChange(state: AppState, previous: Config): void {
  // A repository may have been added, removed or re-pointed: look its `origin` up again when it is next projected.
  state.pullRequests?.forgetOrigins();
  // An auto-fetch setting, or the set of enabled repositories, may have changed: re-arm at once, without fetching.
  state.autoFetcher?.plan();
  // Check for new versions may have been turned off (cancel the planned check at once) or on (plan the next one).
  state.updateChecker?.plan();
  if (state.config.pollIntervalSeconds !== previous.pollIntervalSeconds) {
    state.scanner.start(); // reschedules and kicks off a scan
  } else if (enabledIds(state.config) !== enabledIds(previous)) {
    state.scanner.trigger();
  }
}

/** A tracking request's `path`, absolute after `~` expansion and canonical; `undefined` when it is not one. */
function requestedPath(body: Record<string, unknown>): string | undefined {
  if (typeof body.path !== "string" || !body.path.trim()) return undefined;
  try {
    return validateIgnorePaths([body.path])[0];
  } catch {
    return undefined;
  }
}

const NOT_A_CANDIDATE = "this folder is not a repository discovery offers for tracking";

/**
 * Enable on the projects overview: re-enables a configured repository, or adds one that discovery over the saved roots
 * and ignore paths offers as a candidate — nothing the user could not have seen there. Only the dashboard's config is
 * written.
 */
async function postTrackRepo(state: AppState, req: Request): Promise<Response> {
  const path = requestedPath(await readJson(req));
  if (!path) return json({ error: "path must be an absolute path" }, 400);
  const id = repoId(path);
  // Slow and read-only, so it runs before the write is queued; the write re-checks only what can change meanwhile.
  const candidate = state.config.repos.some((r) => r.id === id)
    ? undefined
    : (await discoverRepos(state.config.repos, state.config.scanRoots, state.config.ignorePaths, state.githubClones?.runningPaths())).candidates.find((c) => c.id === id);
  const { previous, saved } = await updateConfig(state, (current) => {
    if (current.repos.some((r) => r.id === id)) return { ...current, repos: current.repos.map((r) => (r.id === id ? { ...r, enabled: true } : r)) };
    if (!candidate) throw new TrackingError(404, NOT_A_CANDIDATE);
    const repo = newRepoConfig(candidate.path, true);
    const named = {
      ...repo,
      name: availableName(
        repo,
        current.repos.map((r) => r.name),
      ),
    };
    return { ...current, repos: [...current.repos, named].sort((x, y) => x.path.localeCompare(y.path)) };
  });
  afterConfigChange(state, previous);
  return json(saved);
}

/** Enable and Disable of a configured repository; its name and everything else stay. */
async function postRepoEnabled(state: AppState, req: Request, id: string): Promise<Response> {
  const { enabled } = await readJson(req);
  if (typeof enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  const { previous, saved } = await updateConfig(state, (current) => {
    if (!current.repos.some((r) => r.id === id)) throw new TrackingError(404, "repository not found");
    return { ...current, repos: current.repos.map((r) => (r.id === id ? { ...r, enabled } : r)) };
  });
  afterConfigChange(state, previous);
  return json(saved);
}

/** Ignore on the projects overview: one more ignore path. Configured repositories are untouched, as ever. */
async function postIgnorePath(state: AppState, req: Request): Promise<Response> {
  const path = requestedPath(await readJson(req));
  if (!path) return json({ error: "path must be an absolute path" }, 400);
  const { previous, saved } = await updateConfig(state, (current) =>
    current.ignorePaths.includes(path) ? undefined : { ...current, ignorePaths: [...current.ignorePaths, path] },
  );
  afterConfigChange(state, previous);
  return json(saved);
}

/**
 * One configured repository changed by `change`, under the serialised writer. The repository is looked up in the
 * config as the previous write left it, so a request racing a Forget gets a 404 instead of bringing the entry back.
 */
async function updateRepo(state: AppState, id: string, change: (repo: RepoConfig) => RepoConfig | undefined): Promise<Response> {
  const { previous, saved } = await updateConfig(state, (current) => {
    const repo = current.repos.find((r) => r.id === id);
    if (!repo) throw new TrackingError(404, "repository not found");
    const next = change(repo);
    return next === undefined ? undefined : { ...current, repos: current.repos.map((r) => (r.id === id ? next : r)) };
  });
  afterConfigChange(state, previous);
  return json(saved);
}

/** Rename on the projects overview. Display only: the id, the path and every other setting stay. */
async function postRepoName(state: AppState, req: Request, id: string): Promise<Response> {
  const { name } = await readJson(req);
  if (typeof name !== "string" || !name.trim()) return json({ error: "name must not be empty" }, 400);
  return updateRepo(state, id, (repo) => ({ ...repo, name: name.trim() }));
}

/**
 * The project's agent-session toggle and agent picker on the overview. A repository without agent settings is included
 * (`repoAgentEnabled`), so the first change starts from `{ enabled: true }`; `agentId: null` means the default agent.
 */
async function postRepoAgent(state: AppState, req: Request, id: string): Promise<Response> {
  const body = await readJson(req);
  const { enabled, agentId, autoMergeDocs } = body;
  if (enabled === undefined && agentId === undefined && autoMergeDocs === undefined) return json({ error: "send enabled, agentId or autoMergeDocs" }, 400);
  if (enabled !== undefined && typeof enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  if (agentId !== undefined && agentId !== null && typeof agentId !== "string") return json({ error: "agentId must be an agent id or null" }, 400);
  if (autoMergeDocs !== undefined && typeof autoMergeDocs !== "boolean") return json({ error: "autoMergeDocs must be true or false" }, 400);
  return updateRepo(state, id, (repo) => {
    if (typeof agentId === "string" && !state.config.agentSessions.agents.some((a) => a.id === agentId)) throw new TrackingError(400, `unknown agent ${agentId}`);
    return withRepoAgent(repo, { enabled, agentId, autoMergeDocs });
  });
}

/** The project's PR titles picker on the overview: `conventional-commits` sets the convention, `null` removes the key. */
async function postRepoPrTitleConvention(state: AppState, req: Request, id: string): Promise<Response> {
  const { convention } = await readJson(req);
  if (convention !== null && convention !== "conventional-commits") return json({ error: "convention must be conventional-commits or null" }, 400);
  return updateRepo(state, id, (repo) => withPrTitleConvention(repo, convention));
}

/**
 * The project's Auto fetch drop-down on the overview, in seconds: an offered interval sets it, `0` saves Off, and the
 * default (every minute) removes the key, so a configuration only records a departure from the default.
 */
async function postRepoAutoFetch(state: AppState, req: Request, id: string): Promise<Response> {
  const { seconds } = await readJson(req);
  if (seconds !== 0 && !AUTO_FETCH_SECONDS.includes(seconds as AutoFetchSeconds)) return json({ error: `seconds must be one of ${AUTO_FETCH_SECONDS.join(", ")} or 0 for off` }, 400);
  return updateRepo(state, id, (repo) => withAutoFetch(repo, seconds as AutoFetchSeconds | 0));
}

/** The project's labels dialog on the overview: either list replaced, an empty one removed, validated as in a `PUT`. */
async function postRepoLabels(state: AppState, req: Request, id: string): Promise<Response> {
  const body = await readJson(req);
  const lists = (["labels", "hiddenLabels"] as const).filter((key) => body[key] !== undefined);
  if (lists.length === 0) return json({ error: "send labels or hiddenLabels" }, 400);
  for (const key of lists) {
    const value = body[key];
    if (!Array.isArray(value) || value.some((l) => typeof l !== "string")) return json({ error: `${key} must be a list of labels` }, 400);
  }
  return updateRepo(state, id, (repo) => {
    const next: RepoConfig = { ...repo };
    for (const key of lists) {
      const value = body[key] as string[];
      if (value.length) next[key] = value;
      else delete next[key];
    }
    return next;
  });
}

/**
 * A label's colour, chosen in a project's labels dialog and shared by every repository: `hue: null` is Auto and removes
 * the entry, and the last removal drops the key, so a config never gains an empty map. The label rules are the schema's.
 */
async function postLabelColor(state: AppState, req: Request): Promise<Response> {
  const { label, hue } = await readJson(req);
  if (typeof label !== "string") return json({ error: "label must be a string" }, 400);
  if (hue !== null && !(Number.isInteger(hue) && (hue as number) >= 0 && (hue as number) <= 359)) return json({ error: "hue must be null or a whole number from 0 to 359" }, 400);
  const key = labelKey(label.trim());
  const { previous, saved } = await updateConfig(state, (current) => {
    const colors = { ...current.labelColors };
    if (hue === null) {
      if (!Object.hasOwn(colors, key)) return undefined;
      delete colors[key];
    } else colors[key] = hue as number;
    const { labelColors: _, ...rest } = current;
    return Object.keys(colors).length ? { ...rest, labelColors: colors } : rest;
  });
  afterConfigChange(state, previous);
  return json(saved);
}

/** "Don't show this warning again" in the Fast-forward dialog, and its way back: one setting, saved at once. */
async function postFastForwardWarning(state: AppState, req: Request): Promise<Response> {
  const { show } = await readJson(req);
  if (typeof show !== "boolean") return json({ error: "show must be true or false" }, 400);
  const { previous, saved } = await updateConfig(state, (current) => ({ ...current, agentSessions: { ...current.agentSessions, confirmFastForward: show } }));
  afterConfigChange(state, previous);
  return json(saved);
}

/** Forget on the overview: only a repository the user disabled, so a stale tab cannot drop one still managed. */
async function postRepoForget(state: AppState, id: string): Promise<Response> {
  const { previous, saved } = await updateConfig(state, (current) => {
    const repo = current.repos.find((r) => r.id === id);
    if (!repo) throw new TrackingError(404, "repository not found");
    if (repo.enabled) throw new TrackingError(409, "disable the repository before forgetting it");
    return { ...current, repos: current.repos.filter((r) => r.id !== id) };
  });
  afterConfigChange(state, previous);
  return json(saved);
}

class TrackingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The refusals of the tracking routes as responses: a malformed body, an unknown repository, a path not offered. */
async function tracking(route: () => Promise<Response>): Promise<Response> {
  try {
    return await route();
  } catch (err) {
    if (err instanceof TrackingError || err instanceof SessionError) return json({ error: err.message }, err.status);
    if (err instanceof ConfigValidationError) return json({ error: err.message, issues: err.issues }, 400);
    throw err;
  }
}

/**
 * Read-only: walks the roots and honours the ignore paths from the body (the UI's unsaved draft) or, where the body
 * has none, the saved ones. Never touches `state.config`.
 */
async function postDiscover(state: AppState, req: Request): Promise<Response> {
  let roots = state.config.scanRoots;
  let ignorePaths = state.config.ignorePaths;
  const text = await req.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const draft = body as { scanRoots?: unknown; ignorePaths?: unknown } | null;
    try {
      if (draft?.scanRoots !== undefined) roots = validateScanRoots(draft.scanRoots);
      if (draft?.ignorePaths !== undefined) ignorePaths = validateIgnorePaths(draft.ignorePaths);
    } catch (err) {
      if (err instanceof ConfigValidationError) return json({ error: err.message, issues: err.issues }, 400);
      throw err;
    }
  }
  // A marker written while an agent was still going is noticed here: the folder becomes a tracked repository rather
  // than being offered again. Read-only towards repositories; the only write is to the dashboard's own config.
  await confirmPendingIntegrations(state);
  const result: DiscoverResult = await discoverRepos(state.config.repos, roots, ignorePaths, state.githubClones?.runningPaths());
  return json(result);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new SessionError(400, "body must be JSON");
  }
}

/**
 * The terminal WebSocket is the most sensitive endpoint: whoever holds it types into an agent on this machine.
 * A WebSocket handshake is a GET that browsers allow cross-origin and that carries no preflight, so the JSON guard
 * does not apply; instead the handshake must carry the dashboard's own Origin (browsers always send one and pages
 * cannot forge it) and address a loopback host name (DNS rebinding).
 */
export function webSocketRefusal(req: Request): string | undefined {
  const url = new URL(req.url);
  if (!LOOPBACK_HOSTS.has(url.hostname)) return "request must be addressed to a loopback host name";
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return "cross-site requests are not allowed";
  const origin = req.headers.get("origin");
  const from = origin && URL.canParse(origin) ? new URL(origin) : undefined;
  if (!(from?.protocol === "http:" && LOOPBACK_HOSTS.has(from.hostname) && from.port === url.port)) return "origin is not the dashboard";
  return undefined;
}

export interface TerminalSocketData {
  sessionId: string;
  detach?: () => void;
}

/** Minimal shape of Bun's ServerWebSocket that the handlers use. */
interface TerminalSocket {
  data: TerminalSocketData;
  send(data: string | Uint8Array): unknown;
  close(code?: number, reason?: string): void;
}

/**
 * Wire format: server → client binary frames are raw terminal output (first the scrollback), and one text frame
 * `{"type":"exit"}` when the process ends; client → server text frames are `{"type":"input","data":…}` (keystrokes,
 * passed on unobserved), `{"type":"resize","cols":…,"rows":…}` and `{"type":"submit","data":…}` — text sent on the
 * user's behalf, answered to that socket with `{"type":"submitted","ok":…}` (`false`: typed, but Enter was withheld).
 */
export function createWebSocketHandlers(state: AppState) {
  return {
    async open(ws: TerminalSocket) {
      const sessions = state.sessions;
      if (!sessions) return ws.close(1011, "agent sessions are not available");
      try {
        const { scrollback, detach } = await sessions.attach(ws.data.sessionId, (chunk) => {
          if (chunk.length === 0) ws.send(JSON.stringify({ type: "exit" }));
          else ws.send(chunk);
        });
        ws.data.detach = detach;
        if (scrollback.length > 0) ws.send(scrollback);
        if (sessions.get(ws.data.sessionId).state !== "running") ws.send(JSON.stringify({ type: "exit" }));
      } catch {
        ws.close(1008, "unknown session");
      }
    },
    message(ws: TerminalSocket, message: string | Uint8Array) {
      if (typeof message !== "string" || !state.sessions) return;
      let parsed: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (parsed.type === "input" && typeof parsed.data === "string") state.sessions.write(ws.data.sessionId, parsed.data);
      else if (parsed.type === "submit") {
        const answer = (ok: boolean) => ws.send(JSON.stringify({ type: "submitted", ok }));
        try {
          state.sessions.submit(ws.data.sessionId, parsed.data).then(
            (result) => answer(result.submitted),
            () => answer(false),
          );
        } catch {
          answer(false); // not running, or not plain text
        }
      }
      else if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") state.sessions.resize(ws.data.sessionId, parsed.cols, parsed.rows);
    },
    close(ws: TerminalSocket) {
      ws.data.detach?.();
    },
  };
}

/** Opens the main console, or returns the one that is running. Mutating, so the same-origin guard has run already. */
async function consoleRoute(state: AppState): Promise<Response> {
  if (!state.sessions) return json({ error: "agent sessions are not available" }, 403);
  try {
    const { session, created } = await state.sessions.openConsole();
    return json(session, created ? 201 : 200);
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * Opens a tracked project's console, or returns the one running for it — or the integration session still running in
 * its folder, which is the agent that set the project up. Mutating, so the same-origin guard has run already.
 */
async function projectConsoleRoute(state: AppState, repoId: string): Promise<Response> {
  if (!state.sessions) return json({ error: "agent sessions are not available" }, 403);
  try {
    const { session, created } = await state.sessions.openProjectConsole(repoId);
    return json(session, created ? 201 : 200);
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/** Starts an integration session for one integratable repository, or returns the one running for it. Mutating. */
async function integrationRoute(state: AppState, req: Request): Promise<Response> {
  if (!state.sessions) return json({ error: "agent sessions are not available" }, 403);
  try {
    const { session, created } = await startIntegration(state, await readJson(req));
    return json(session, created ? 201 : 200);
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/** New project (project-creation spec): one folder in a workspace root, `git init`, then an integration session. */
async function projectRoute(state: AppState, req: Request): Promise<Response> {
  try {
    return json(await createProject(state, await readJson(req)), 201);
  } catch (err) {
    if (err instanceof CreateProjectError || err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

async function sessionRoutes(state: AppState, req: Request, url: URL, server?: ServerLike): Promise<Response> {
  const sessions = state.sessions;
  if (!sessions) return json({ error: "agent sessions are not available" }, 403);
  const [, , , id, sub] = url.pathname.split("/"); // /api/sessions/<id>/<sub>
  try {
    if (!id) {
      if (req.method === "GET") {
        await sessions.readReports(); // what the agents reported, as fresh as this request
        return json({ sessions: sessions.list(), agents: sessions.agents(), presets: sessions.presets(), worktrees: await sessions.worktrees() });
      }
      if (req.method === "POST") return json(await sessions.open(await readJson(req)), 201);
    } else if (!sub) {
      if (req.method === "GET") return json(sessions.get(id));
      if (req.method === "DELETE") {
        await sessions.remove(id);
        return json({ deleted: true });
      }
    } else if (req.method === "GET" && sub === "terminal") {
      sessions.get(id); // 404 before upgrading
      const refusal = webSocketRefusal(req);
      if (refusal) return json({ error: refusal }, 403);
      // After a successful upgrade Bun expects no response at all; the signature stays `Response` for every other caller.
      if (server?.upgrade(req, { data: { sessionId: id } satisfies TerminalSocketData })) return undefined as unknown as Response;
      return json({ error: "expected a WebSocket upgrade" }, 426);
    } else if (req.method === "GET" && sub === "worktree") {
      return json(await sessions.worktreeStatus(id));
    } else if (req.method === "POST") {
      if (sub === "resume") return json(await sessions.resume(id));
      if (sub === "ship") return json(await sessions.ship(id));
      if (sub === "resolve-conflicts") return json(await sessions.resolveConflicts(id));
      if (sub === "prompt") return json(await sessions.prompt(id, await readJson(req)));
      if (sub === "close") return json(await sessions.close(id, { removeWorktree: (await readJson(req)).removeWorktree === true }));
    }
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
  return json({ error: "not found" }, 404);
}

async function getSharedConfig(): Promise<Response> {
  return json((await loadSharedConfig()) ?? EMPTY_SHARED_CONFIG);
}

/** Saving never writes to a repository; it only makes the next scan report which repositories are out of date. */
async function putSharedConfig(state: AppState, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  try {
    const saved = await saveSharedConfig(body);
    state.scanner.trigger();
    return json(saved);
  } catch (err) {
    if (err instanceof SharedConfigValidationError) return json({ error: err.message, issues: err.issues }, 400);
    throw err;
  }
}

interface Selection {
  repoId: string;
  /** Undefined when the id is not an enabled repository of the dashboard config, or its framework has no shared config. */
  repo?: RepoConfig;
  /** Why the repository is refused when `repo` is undefined. */
  refusal: string;
  profileIds: string[];
}

/**
 * Resolves the requested assignments against the enabled repositories of the dashboard config. A request only ever
 * names ids; the path that preview and apply touch always comes from the config.
 */
async function selection(state: AppState, req: Request): Promise<Selection[] | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const assignments = (body as { assignments?: unknown } | null)?.assignments;
  const valid = (a: unknown): a is SharedConfigAssignment =>
    typeof a === "object" && a !== null && typeof (a as SharedConfigAssignment).repoId === "string" && Array.isArray((a as SharedConfigAssignment).profileIds) && (a as SharedConfigAssignment).profileIds.every((id) => typeof id === "string");
  if (!Array.isArray(assignments) || !assignments.every(valid)) return json({ error: "assignments must be a list of { repoId, profileIds }" }, 400);
  const enabled = new Map(state.config.repos.filter((r) => r.enabled).map((r) => [r.id, r]));
  const byRepo = new Map(assignments.map((a) => [a.repoId, a])); // last one wins for a repeated repository
  // Shared profiles live in a framework's own config file; a repository whose framework has none is not offered them.
  const framework = new Map(state.scanner.snapshot.repos.map((r) => [r.id, frameworkById(r.framework)]));
  return [...byRepo.values()].map((a) => {
    const repo = enabled.get(a.repoId);
    if (repo && framework.has(a.repoId) && !framework.get(a.repoId)?.sharedConfigFile) return { repoId: a.repoId, repo: undefined, profileIds: a.profileIds, refusal: NO_SHARED_CONFIG };
    return { repoId: a.repoId, repo, profileIds: a.profileIds, refusal: NOT_TRACKED };
  });
}

const NOT_TRACKED = "not an enabled repository in the dashboard config";
const NO_SHARED_CONFIG = "this repository's spec framework has no config file for shared profiles";

async function postSharedConfigPreview(state: AppState, req: Request): Promise<Response> {
  const selected = await selection(state, req);
  if (selected instanceof Response) return selected;
  const shared = (await loadSharedConfig()) ?? EMPTY_SHARED_CONFIG;
  const previews: SharedConfigPreview[] = [];
  for (const { repoId, repo, profileIds, refusal } of selected) {
    previews.push(repo ? await previewFor(repo, shared, profileIds) : { repoId, current: { unreadable: true, applied: [] }, before: "", after: "", refusal });
  }
  return json({ previews });
}

/** The one API route that writes to tracked repositories: only `openspec/config.yaml`, only its managed sections. */
async function postSharedConfigApply(state: AppState, req: Request): Promise<Response> {
  const selected = await selection(state, req);
  if (selected instanceof Response) return selected;
  const shared = (await loadSharedConfig()) ?? EMPTY_SHARED_CONFIG;
  const results: SharedConfigApplyResult[] = [];
  for (const { repoId, repo, profileIds, refusal } of selected) {
    results.push(repo ? await applyTo(repo, shared, profileIds) : { repoId, result: "refused", reason: refusal });
  }
  state.scanner.trigger();
  return json({ results });
}

const ARTIFACT_ROUTE = /^\/api\/repos\/([^/]+)\/changes\/([^/]+)\/(artifacts|file)$/;
const FILE_ERROR_STATUS = { "bad-path": 400, "not-found": 404, "too-large": 413 } as const;

/**
 * Read-only artifact list and single-file read for the change detail view. The request names a repository id, a
 * change name and a relative path; the directory always comes from the config and `listChanges()`.
 */
async function artifactRoutes(state: AppState, url: URL, match: RegExpExecArray): Promise<Response> {
  let repoId: string;
  let changeName: string;
  try {
    repoId = decodeURIComponent(match[1]);
    changeName = decodeURIComponent(match[2]);
  } catch {
    return json({ error: "malformed URL encoding" }, 400);
  }
  const repo = state.config.repos.find((r) => r.enabled && r.id === repoId);
  if (!repo) return json({ error: NOT_TRACKED }, 404);
  // The board shows a change's leading copy, which may live in a linked worktree: read where the scanner read. The
  // checkout path is the scanner's (from `git worktree list`), never the request's.
  const scanned = state.scanner.snapshot.repos.find((r) => r.id === repo.id);
  const checkout = scanned?.changes.find((c) => c.name === changeName)?.checkout;
  const source = new LocalRepoSource(checkout && !checkout.isMain ? checkout.path : repo.path);
  // The module the scan read the repository with; one that is no longer registered has no changes to offer.
  const framework = frameworkById(scanned?.framework);
  if (!framework) return json({ error: "unknown change" }, 404);
  const found = await changeDirFor(source, changeName, framework);
  if (!found.ok) return found.reason === "invalid-name" ? json({ error: "invalid change name" }, 400) : json({ error: "unknown change" }, 404);
  if (match[3] === "artifacts") return json(await listArtifactFiles(source, repo.id, found.entry, framework));
  const result = await readArtifactFile(source, found.entry.dir, url.searchParams.get("path"));
  return result.ok ? json(result.file) : json({ error: result.message }, FILE_ERROR_STATUS[result.reason]);
}

/**
 * The one API route that writes into a tracked repository outside `openspec/config.yaml`: creates
 * `openspec/changes/<name>/` with its schema marker and, if given, `prompt.md`, `depends-on.yaml` and `issue.yaml`, then stages that
 * directory. Refused
 * for any reason means nothing was written and no git was run; the create itself is atomic (exclusive-create), so
 * two concurrent requests cannot both succeed. A staging failure is reported (`staged: false`), never a failure.
 */
async function postCreateChange(state: AppState, req: Request, repoId: string): Promise<Response> {
  const repo = state.config.repos.find((r) => r.id === repoId);
  if (!repo) return json({ error: "unknown repository" }, 404);
  if (!repo.enabled) return json({ error: "repository is disabled" }, 409);
  const scanned = state.scanner.snapshot.repos.find((r) => r.id === repoId);
  if (!scanned || !scanned.ok) return json({ error: "repository has not been successfully scanned" }, 409);
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
  const name = body.name;
  const prompt = body.prompt;
  if (typeof name !== "string") return json({ error: "name must be a string" }, 400);
  if (prompt !== undefined && prompt !== null && typeof prompt !== "string") return json({ error: "prompt must be a string" }, 400);
  const framework = frameworkById(scanned.framework);
  if (!framework) return json({ error: "repository has not been successfully scanned" }, 409);
  const result = await createChange(repo.path, name, typeof prompt === "string" ? prompt : undefined, body.dependsOn, body.issue, framework);
  if (!result.ok) {
    const status = result.reason === "invalid-name" || result.reason === "invalid-prompt" || result.reason === "invalid-dependencies" || result.reason === "invalid-issue" ? 400 : result.reason === "not-writable" || result.reason === "not-on-github" || result.reason === "no-openspec-dir" || result.reason === "duplicate-active" || result.reason === "duplicate-archived" ? 409 : 500;
    return json({ error: result.message }, status);
  }
  state.scanner.trigger();
  return json({ name: result.name, staged: result.staged }, 201);
}

/** A repository a change may be dismissed from: configured, enabled, successfully scanned; git is not required. */
function dismissTarget(state: AppState, repoId: string, name: string): { repo: RepoConfig; scanned: RepoSnapshot } | Response {
  const repo = state.config.repos.find((r) => r.id === repoId);
  if (!repo) return json({ error: "unknown repository" }, 404);
  if (!repo.enabled) return json({ error: "repository is disabled" }, 409);
  const scanned = state.scanner.snapshot.repos.find((r) => r.id === repoId);
  if (!scanned?.ok) return json({ error: "repository has not been successfully scanned" }, 409);
  if (!isDismissableName(name)) return json({ error: "invalid change name" }, 400);
  return { repo, scanned };
}

/** Read-only: what dismissing the change would delete. */
async function getDismiss(state: AppState, repoId: string, name: string): Promise<Response> {
  const target = dismissTarget(state, repoId, name);
  if (target instanceof Response) return target;
  try {
    return json(await previewDismiss(target.repo, target.scanned, name));
  } catch (err) {
    if (err instanceof DismissError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * The one route that deletes a change directory: `openspec/changes/<name>/` of the main checkout, after re-checking it
 * is exactly what the user confirmed, then stages that removal. A refusal deletes nothing and runs no writing git.
 */
async function postDismiss(state: AppState, req: Request, repoId: string, name: string): Promise<Response> {
  const target = dismissTarget(state, repoId, name);
  if (target instanceof Response) return target;
  try {
    const body = await readJson(req);
    if (typeof body.fingerprint !== "string" || !body.fingerprint) return json({ error: "expected { fingerprint: string }" }, 400);
    const sessions = state.sessions;
    const result = await dismissChange(target.repo, target.scanned, name, body.fingerprint, () => sessions?.hasOpenSession(repoId, name) ?? false);
    state.scanner.trigger();
    return json(result);
  } catch (err) {
    if (err instanceof DismissError) return json({ error: err.message }, err.status);
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * Repositories the pull action may run in: tracked, scanned without error, and git. The path comes from the config —
 * a request only ever names an id.
 */
function pullable(state: AppState): RepoConfig[] {
  const scanned = new Map(state.scanner.snapshot.repos.map((r) => [r.id, r]));
  return state.config.repos.filter((r) => r.enabled && scanned.get(r.id)?.ok === true && scanned.get(r.id)?.isGit === true);
}

const BLOB_ID = /^[0-9a-f]{40,64}$/;
const MAX_PATH_LENGTH = 1024;

/** A repository-relative path that can only mean one file inside the repository. */
function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > MAX_PATH_LENGTH) return false;
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function blockingFile(value: unknown): PullBlockingFile | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { path, kind, differs, incoming, staged, worktree } = value as Record<string, unknown>;
  if (!safeRelativePath(path)) return undefined;
  if (kind !== "leftover" && kind !== "local-work") return undefined;
  if (differs !== undefined && typeof differs !== "boolean") return undefined;
  for (const id of [incoming, staged, worktree]) if (id !== undefined && !(typeof id === "string" && BLOB_ID.test(id))) return undefined;
  return { path, kind, differs: differs as boolean | undefined, incoming: incoming as string | undefined, staged: staged as string | undefined, worktree: worktree as string | undefined };
}

/**
 * Shape only. Whether these paths really are unchanged change leftovers is decided by the pull action itself, which
 * re-determines all of it: nothing here is trusted beyond being a well-formed claim.
 */
function pullResolve(value: unknown): PullResolve | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { upstream, files } = value as Record<string, unknown>;
  if (typeof upstream !== "string" || !BLOB_ID.test(upstream)) return undefined;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_BLOCKING_FILES) return undefined;
  const parsed = files.map(blockingFile);
  if (parsed.some((f) => f === undefined)) return undefined;
  const paths = new Set(parsed.map((f) => (f as PullBlockingFile).path));
  if (paths.size !== parsed.length) return undefined;
  return { upstream, files: parsed as PullBlockingFile[] };
}

/**
 * The one route that contacts a remote and updates a main checkout — and only because the user asked for it. With a
 * `resolve` body it runs Resolve and pull instead, which fetches nothing and removes only what it re-proves.
 */
async function postPull(state: AppState, req: Request, repoId: string): Promise<Response> {
  const repo = pullable(state).find((r) => r.id === repoId);
  if (!repo) return json({ error: "not a tracked, successfully scanned git repository" }, 404);
  // A plain pull still posts nothing at all, so an empty body is not an error.
  const text = await req.text();
  let resolve: PullResolve | undefined;
  if (text.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const claim = typeof body === "object" && body !== null ? (body as Record<string, unknown>).resolve : undefined;
    if (claim !== undefined) {
      resolve = pullResolve(claim);
      if (!resolve) return json({ error: "resolve must name an upstream commit and the blocking files exactly as they were offered" }, 400);
    }
  }
  try {
    const result = resolve ? await resolvePullRepository(repo, resolve) : await pullRepository(repo);
    afterFetch(state, [result]);
    return json(result);
  } catch (err) {
    if (err instanceof PullBusyError) return json({ error: err.message }, 409);
    throw err;
  }
}

/** After a pull: it is the repositories' latest fetch, and a moved base can turn a work status into `merged`. */
function afterFetch(state: AppState, results: PullResult[]): void {
  for (const result of results) state.autoFetcher?.notePull(result);
  state.sessions?.forgetWorktrees();
  state.scanner.trigger();
}

async function postPullAll(state: AppState): Promise<Response> {
  const results = await pullAll(pullable(state));
  afterFetch(state, results);
  return json({ results });
}

/** The repository cleanup is offered for, or the response refusing it — decided before any git runs. */
function cleanupTarget(state: AppState, repoId: string): RepoConfig | Response {
  const repo = state.config.repos.find((r) => r.id === repoId);
  if (!repo) return json({ error: "unknown repository" }, 404);
  if (!pullable(state).includes(repo)) return json({ error: "not a tracked, successfully scanned git repository" }, 409);
  return repo;
}

const MAX_CLEANUP_ITEMS = 1000;

/** Shape only: whether each item is the repository's own and still safe is decided by the cleanup itself. */
function cleanupSelection(body: Record<string, unknown>): CleanupSelection | undefined {
  const { worktrees, prune, branches } = body;
  if (!Array.isArray(worktrees) || !worktrees.every((w) => typeof w === "string")) return undefined;
  if (typeof prune !== "boolean") return undefined;
  if (!Array.isArray(branches) || !branches.every((b) => typeof b?.name === "string" && typeof b.commit === "string" && /^[0-9a-f]{40,64}$/.test(b.commit))) return undefined;
  if (worktrees.length + branches.length > MAX_CLEANUP_ITEMS) return undefined;
  return { worktrees, prune, branches: branches.map((b) => ({ name: b.name, commit: b.commit })) };
}

async function getCleanup(state: AppState, repoId: string): Promise<Response> {
  const repo = cleanupTarget(state, repoId);
  if (repo instanceof Response) return repo;
  return json(await previewCleanup(repo, (await state.sessions?.runningWorktreePaths()) ?? new Set()));
}

/** Removes worktrees and deletes branches the user selected and confirmed; the only route that deletes a branch. */
async function postCleanup(state: AppState, req: Request, repoId: string): Promise<Response> {
  const repo = cleanupTarget(state, repoId);
  if (repo instanceof Response) return repo;
  try {
    const selection = cleanupSelection(await readJson(req));
    if (!selection) return json({ error: "expected { worktrees: string[], prune: boolean, branches: { name, commit }[] }" }, 400);
    const result = await applyCleanup(repo, selection, (await state.sessions?.runningWorktreePaths()) ?? new Set());
    state.sessions?.forgetWorktrees();
    state.scanner.trigger();
    return json(result);
  } catch (err) {
    if (err instanceof CleanupBusyError) return json({ error: err.message }, 409);
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * Pull requests are read for every enabled repository — a folder without git or without a GitHub `origin` is reported
 * as unavailable rather than left out. `isGit` comes from the scan, never from letting a git command fail.
 */
function pullRequestTargets(state: AppState): RepoTarget[] {
  const scanned = new Map(state.scanner.snapshot.repos.map((r) => [r.id, r]));
  return state.config.repos.filter((r) => r.enabled).map((r) => ({ id: r.id, path: r.path, isGit: scanned.get(r.id)?.isGit === true }));
}

function pullRequestStore(state: AppState): PullRequests {
  state.pullRequests ??= new PullRequests();
  return state.pullRequests;
}

/** Read-only: the cache as it is. Starts no process and contacts nothing. */
async function getPullRequests(state: AppState): Promise<Response> {
  return json(await pullRequestStore(state).list(pullRequestTargets(state)));
}

/**
 * The only route besides the pull action that reaches a network, and only because the user opened or refreshed a
 * pull-request list, or an open board watches a pull request that is not ready yet. It runs read-only `gh` queries, writes to no repository and triggers no scan.
 */
async function postPullRequestsRefresh(state: AppState, req: Request): Promise<Response> {
  const body = await readJson(req);
  const targets = pullRequestTargets(state);
  const repoId = body.repoId;
  if (repoId !== undefined) {
    if (typeof repoId !== "string") return json({ error: "repoId must be a string" }, 400);
    if (!targets.some((t) => t.id === repoId)) return json({ error: "unknown or disabled repository" }, 404);
  }
  // The board's watch names the repositories it watches; each is checked exactly as a single `repoId` is.
  const repoIds = body.repoIds;
  if (repoIds !== undefined) {
    if (repoId !== undefined) return json({ error: "give either repoId or repoIds, not both" }, 400);
    if (!Array.isArray(repoIds) || !repoIds.every((r) => typeof r === "string")) return json({ error: "repoIds must be a list of strings" }, 400);
    if (!repoIds.every((r) => targets.some((t) => t.id === r))) return json({ error: "unknown or disabled repository" }, 404);
  }
  const response = await pullRequestStore(state).refresh(targets, { repoId: repoId as string | undefined, repoIds: repoIds as string[] | undefined, force: body.force === true });
  endMergedAutoMerge(state, response);
  return json(response);
}

/**
 * Lists a repository's open issues for the Import from issues dialog — the issue query of the issue-import spec. A POST
 * because it starts `gh`, which reaches GitHub; it is under the same-origin guard like every other POST, writes
 * nothing, keeps nothing and triggers no scan.
 */
async function postIssues(state: AppState, repoId: string): Promise<Response> {
  const target = pullRequestTargets(state).find((t) => t.id === repoId);
  if (!target) return json({ error: "unknown or disabled repository" }, 404);
  state.issues ??= new Issues();
  return json(await state.issues.list(target));
}

/**
 * A completed query is what ends a session whose auto-merge pull request merged (auto-merge-cleanup D2): handed to the
 * session manager after `gh` has finished, never waited for, and never a reason to query. Only lists that are good
 * right now count — a failed one is the last good list, which says nothing new.
 */
function endMergedAutoMerge(state: AppState, response: PullRequestsResponse): void {
  const sessions = state.sessions;
  if (!sessions) return;
  for (const repo of response.repos) {
    if (repo.status !== "ok") continue;
    void sessions.endMergedAutoMerge(repo.repoId, repo.pullRequests).catch((err) => console.warn("could not end a session whose pull request merged:", err instanceof Error ? err.message : err));
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Loopback binding does not stop a web page open in the same browser from posting to us, so every non-GET API
 * request must look like it came from our own UI (or a deliberate command-line client):
 * - JSON content type: anything else is sendable by a plain form or a no-preflight `fetch`; JSON forces a CORS
 *   preflight, which we never approve.
 * - Addressed to a loopback name: defeats DNS rebinding, where an attacker's hostname resolves to 127.0.0.1 and
 *   `Origin` and `Host` would otherwise agree with each other.
 * - `Origin`, when the browser sends one, is that same loopback origin.
 * Returns the reason for a refusal, or undefined when the request may proceed.
 */
export function crossSiteRefusal(req: Request): string | undefined {
  const url = new URL(req.url);
  if (!LOOPBACK_HOSTS.has(url.hostname)) return "request must be addressed to a loopback host name";
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return "content-type must be application/json";
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return "cross-site requests are not allowed";
  const origin = req.headers.get("origin");
  if (origin !== null) {
    // "null" (sandboxed frames, file://) and junk do not parse and are refused like any foreign origin
    const from = URL.canParse(origin) ? new URL(origin) : undefined;
    const own = from?.protocol === "http:" && LOOPBACK_HOSTS.has(from.hostname) && from.port === url.port;
    if (!own) return "origin is not the dashboard";
  }
  return undefined;
}

/** Read-only; the feed is history and never an input to anything else. */
function getActivity(state: AppState, url: URL): Response {
  const params = url.searchParams;
  const list = (name: string) => (params.get(name) ?? "").split(",").filter(Boolean);
  const query: PageQuery = {};
  if (params.has("limit")) {
    const limit = Number(params.get("limit"));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return json({ error: `limit must be an integer between 1 and ${MAX_PAGE}` }, 400);
    query.limit = limit;
  }
  const kinds = list("kinds");
  const unknown = kinds.filter((k) => !ACTIVITY_KINDS.includes(k as ActivityKind));
  if (unknown.length > 0) return json({ error: `unknown kind: ${unknown.join(", ")}` }, 400);
  query.kinds = kinds as ActivityKind[];
  query.repos = list("repos");
  if (params.has("before")) query.before = params.get("before") ?? undefined;
  if (params.has("since")) query.since = params.get("since") ?? "";
  if (params.has("tz")) {
    const tz = params.get("tz") ?? "";
    if (!isTimeZone(tz)) return json({ error: `unknown time zone: ${tz}` }, 400);
    query.tz = tz;
  }
  return json(state.activity?.page(query) ?? pageEvents([], query));
}

/** Builds the `fetch` handler for Bun.serve (design.md D8). */
async function postWorktreeRemove(state: AppState, req: Request): Promise<Response> {
  if (!state.sessions) return json({ error: "agent sessions are not available" }, 403);
  try {
    return json(await state.sessions.removeWorktreeByName(await readJson(req)));
  } catch (err) {
    if (err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/** What `GET /api/update` answers: the last check's outcome, without a request. Off where no checker runs. */
function updateStatus(state: AppState): UpdateStatus {
  return state.updateChecker?.status() ?? { enabled: false, current: VERSION, outcome: "never", available: false };
}

/** Check now: joins a check already running; refused while checks are off or the build is not a release. */
async function postUpdateCheck(state: AppState): Promise<Response> {
  const checker = state.updateChecker;
  if (!checker?.enabled()) return json({ error: "checking for new versions is turned off", ...updateStatus(state) }, 409);
  return json(await checker.check());
}

/** The setup's folder dialog (setup-wizard): waits for the user's choice; one dialog at a time. */
async function postSetupFolder(state: AppState): Promise<Response> {
  try {
    return json(await pickFolder(state.folderPicker ?? folderPickerContext()));
  } catch (err) {
    if (err instanceof FolderPickerBusyError) return json({ error: err.message }, 409);
    throw err;
  }
}

/** **Create folder** in the setup wizard's Workspace step: one empty folder; the configuration is saved by the wizard. */
async function postWorkspaceFolder(state: AppState, req: Request): Promise<Response> {
  try {
    return json({ path: await createWorkspaceFolder(state.config, (await readJson(req)).path) }, 201);
  } catch (err) {
    if (err instanceof NewFolderError || err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * The clone list, created on first use. A clone holding the project marker is tracked through the same serialised
 * write as an integration that worked — enabled, default name, scan — and nothing else about it is stored.
 */
function githubClones(state: AppState): GithubClones {
  state.githubClones ??= new GithubClones({
    config: () => state.config,
    track: async (path) => {
      const added = await confirmIntegration(state, path);
      if (added) {
        state.pullRequests?.forgetOrigins();
        state.autoFetcher?.plan();
      }
      return added;
    },
  });
  return state.githubClones;
}

/** Lower-cased `owner/name` of every configured repository whose `origin` is on github.com: those are "already added". */
async function addedGithubRepos(config: Config): Promise<Set<string>> {
  const origins = await Promise.all(config.repos.map((repo) => originUrl(repo.path).catch(() => undefined)));
  return new Set(origins.flatMap((url) => githubRepoFromRemote(url)?.toLowerCase() ?? []));
}

/**
 * Add from GitHub's list (github-repositories): one owner's repositories through the read-only `gh repo list`. A POST
 * because it starts `gh`, which reaches GitHub; it writes nothing, keeps nothing and triggers no scan.
 */
async function postGithubRepos(state: AppState, req: Request): Promise<Response> {
  const { owner } = await readJson(req);
  if (owner !== undefined && owner !== "" && !isGithubOwner(owner)) return json({ error: "the owner may only use letters, digits and single hyphens (at most 39 characters)" }, 400);
  return json(await listGithubRepos(owner || undefined, await addedGithubRepos(state.config)));
}

/** Clone on the user's confirmation: answers `202` once the folder exists, without waiting for git. */
async function postGithubClone(state: AppState, req: Request): Promise<Response> {
  try {
    return json(await githubClones(state).start(await readJson(req)), 202);
  } catch (err) {
    if (err instanceof NewFolderError || err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/** Cancel on the user's request: answers the entry once it is `cancelled`; `409` once it has an outcome. */
async function postGithubCloneCancel(state: AppState, req: Request): Promise<Response> {
  try {
    return json(await githubClones(state).cancel((await readJson(req)).id));
  } catch (err) {
    if (err instanceof NewFolderError || err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

async function postGithubCloneDismiss(state: AppState, req: Request): Promise<Response> {
  try {
    const clones = githubClones(state);
    clones.dismiss((await readJson(req)).id);
    return json({ clones: clones.list() });
  } catch (err) {
    if (err instanceof NewFolderError || err instanceof SessionError) return json({ error: err.message }, err.status);
    throw err;
  }
}

export function createFetchHandler({ state, indexHtml }: AppOptions): (req: Request, server?: ServerLike) => Promise<Response> {
  return async (req, server) => {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const refusal = crossSiteRefusal(req);
        if (refusal) return json({ error: refusal }, 403);
      }
      const version = versionResponse(req);
      if (version) return version;
      if (pathname === "/api/sessions" || pathname.startsWith("/api/sessions/")) return sessionRoutes(state, req, url, server);
      if (pathname === "/api/console" && req.method === "POST") return consoleRoute(state);
      if (pathname === "/api/integrations" && req.method === "POST") return integrationRoute(state, req);
      if (pathname === "/api/projects" && req.method === "POST") return projectRoute(state, req);
      const artifactMatch = req.method === "GET" ? ARTIFACT_ROUTE.exec(pathname) : null;
      if (artifactMatch) return artifactRoutes(state, url, artifactMatch);
      if (req.method === "POST" && pathname === "/api/worktrees/remove") return postWorktreeRemove(state, req);
      if (req.method === "GET" && pathname === "/api/state") return json(state.autoFetcher?.withOutcomes(state.scanner.snapshot) ?? state.scanner.snapshot);
      // Read-only and local (openspec/specs/environment-check): no network, nothing in a tracked repository.
      // `force` is what **Re-check** sends: the user just changed the machine, which no cache key can see.
      // `view=setup` is the wizard's System check: no per-agent checks, fixed setup verdicts.
      if (req.method === "GET" && pathname === "/api/environment") {
        const view = url.searchParams.get("view") ?? "settings";
        if (view !== "settings" && view !== "setup") return json({ error: "view must be setup or settings" }, 400);
        return json(await environmentReport(state.config, state.scanner.snapshot, { force: url.searchParams.get("force") === "1", view }));
      }
      if (req.method === "GET" && pathname === "/api/activity") return getActivity(state, url);
      if (req.method === "GET" && pathname === "/api/update") return json(updateStatus(state));
      if (req.method === "POST" && pathname === "/api/update/check") return postUpdateCheck(state);
      if (req.method === "GET" && pathname === "/api/setup") return json(await setupState(state.config, undefined, state.folderPicker));
      if (req.method === "POST" && pathname === "/api/setup/done") {
        const saved = await markSetupDone(state);
        // Automatic fetch waited for setup to end; arm it now rather than at the next scan.
        state.autoFetcher?.plan();
        return json(saved);
      }
      // A POST because it starts a process (the system's folder dialog); the body is never read.
      if (req.method === "POST" && pathname === "/api/setup/folder") return postSetupFolder(state);
      if (req.method === "POST" && pathname === "/api/setup/workspace-folder") return postWorkspaceFolder(state, req);
      if (req.method === "POST" && pathname === "/api/github/repos") return postGithubRepos(state, req);
      if (req.method === "POST" && pathname === "/api/github/clone") return postGithubClone(state, req);
      // Read-only and in memory: starts no process. `gitAvailable` is a PATH lookup, so Add from GitHub can say git is missing.
      if (req.method === "GET" && pathname === "/api/github/clones") return json({ clones: state.githubClones?.list() ?? [], gitAvailable: whichOnPath("git") !== undefined });
      if (req.method === "POST" && pathname === "/api/github/clones/cancel") return postGithubCloneCancel(state, req);
      if (req.method === "POST" && pathname === "/api/github/clones/dismiss") return postGithubCloneDismiss(state, req);
      if (req.method === "GET" && pathname === "/api/config") return json(state.config);
      if (req.method === "PUT" && pathname === "/api/config") return putConfig(state, req);
      if (req.method === "POST" && pathname === "/api/discover") return postDiscover(state, req);
      if (req.method === "POST" && pathname === "/api/repos/track") return tracking(() => postTrackRepo(state, req));
      if (req.method === "POST" && pathname === "/api/ignore-paths") return tracking(() => postIgnorePath(state, req));
      const enabledMatch = /^\/api\/repos\/([^/]+)\/enabled$/.exec(pathname);
      if (req.method === "POST" && enabledMatch) return tracking(() => postRepoEnabled(state, req, decodeURIComponent(enabledMatch[1])));
      if (req.method === "POST" && pathname === "/api/labels/color") return tracking(() => postLabelColor(state, req));
      if (req.method === "POST" && pathname === "/api/agent-sessions/fast-forward-warning") return tracking(() => postFastForwardWarning(state, req));
      const repoSetting = /^\/api\/repos\/([^/]+)\/(name|agent|labels|pr-title-convention|auto-fetch|forget)$/.exec(pathname);
      if (req.method === "POST" && repoSetting) {
        const id = decodeURIComponent(repoSetting[1]);
        if (repoSetting[2] === "name") return tracking(() => postRepoName(state, req, id));
        if (repoSetting[2] === "agent") return tracking(() => postRepoAgent(state, req, id));
        if (repoSetting[2] === "labels") return tracking(() => postRepoLabels(state, req, id));
        if (repoSetting[2] === "pr-title-convention") return tracking(() => postRepoPrTitleConvention(state, req, id));
        if (repoSetting[2] === "auto-fetch") return tracking(() => postRepoAutoFetch(state, req, id));
        return tracking(() => postRepoForget(state, id));
      }
      if (req.method === "GET" && pathname === "/api/shared-config") return getSharedConfig();
      if (req.method === "PUT" && pathname === "/api/shared-config") return putSharedConfig(state, req);
      if (req.method === "POST" && pathname === "/api/shared-config/preview") return postSharedConfigPreview(state, req);
      if (req.method === "POST" && pathname === "/api/shared-config/apply") return postSharedConfigApply(state, req);
      if (req.method === "GET" && pathname === "/api/pull-requests") return getPullRequests(state);
      if (req.method === "POST" && pathname === "/api/pull-requests/refresh") return postPullRequestsRefresh(state, req);
      if (req.method === "POST" && pathname === "/api/pull") return postPullAll(state);
      const pullOne = /^\/api\/repos\/([^/]+)\/pull$/.exec(pathname);
      if (req.method === "POST" && pullOne) return postPull(state, req, decodeURIComponent(pullOne[1]));
      const cleanupMatch = /^\/api\/repos\/([^/]+)\/cleanup$/.exec(pathname);
      if (cleanupMatch && req.method === "GET") return getCleanup(state, decodeURIComponent(cleanupMatch[1]));
      if (cleanupMatch && req.method === "POST") return postCleanup(state, req, decodeURIComponent(cleanupMatch[1]));
      const dismissMatch = /^\/api\/repos\/([^/]+)\/changes\/([^/]+)\/dismiss$/.exec(pathname);
      if (dismissMatch && req.method === "GET") return getDismiss(state, decodeURIComponent(dismissMatch[1]), decodeURIComponent(dismissMatch[2]));
      if (dismissMatch && req.method === "POST") return postDismiss(state, req, decodeURIComponent(dismissMatch[1]), decodeURIComponent(dismissMatch[2]));
      const projectConsoleMatch = /^\/api\/repos\/([^/]+)\/console$/.exec(pathname);
      if (req.method === "POST" && projectConsoleMatch) return projectConsoleRoute(state, decodeURIComponent(projectConsoleMatch[1]));
      const issuesMatch = /^\/api\/repos\/([^/]+)\/issues$/.exec(pathname);
      if (req.method === "POST" && issuesMatch) return postIssues(state, decodeURIComponent(issuesMatch[1]));
      const createChangeMatch = /^\/api\/repos\/([^/]+)\/changes$/.exec(pathname);
      if (req.method === "POST" && createChangeMatch) return postCreateChange(state, req, decodeURIComponent(createChangeMatch[1]));
      if (req.method === "POST" && pathname === "/api/scan") {
        const result: ScanTriggerResult = { started: state.scanner.trigger().started };
        return json(result);
      }
      return json({ error: "not found" }, 404);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
}
