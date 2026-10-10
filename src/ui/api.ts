import type { ActivityQuery } from "../shared/activity.ts";
import type { RepoAgentPatch } from "../shared/repoSettings.ts";
import type { GithubClone, GithubClonesResponse, GithubRepoList } from "../shared/types.ts";
import type { ActivityPage, AutoMergePromptResult, ConsoleSession, ProjectConsoleLike, CleanupPreview, CleanupResult, CleanupSelection, ChangeIssueRef, CreateChangeResponse, DismissPreview, DismissResult, EnvironmentReport, EnvironmentView, FolderPickResult, PromptResult, PullRequestsResponse, PullResolve, PullResult, RepoIssues, SetupState, ShipResult, StartResult, UpdateStatus, WorkStatus } from "../shared/types.ts";
import type { AgentAvailability, AutoFetchSeconds, ArtifactFileContent, ChangeArtifacts, Config, CreateProjectResponse, DiscoverResult, IntegrationSession, PrTitleConvention, RepoConfig, ScanTriggerResult, Session, SessionAction, SessionWorktree, SharedConfig, SharedConfigApplyResult, SharedConfigAssignment, SharedConfigPreview, Snapshot } from "../shared/types.ts";
import { socketOrigin } from "./url.ts";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly issues: string[] = []) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    let message = res.statusText;
    let issues: string[] = [];
    try {
      const body = await res.json();
      message = body.error ?? message;
      issues = body.issues ?? [];
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, issues);
  }
  return res.json() as Promise<T>;
}

/** Everything the UI asks of a backend. The demo build implements it in memory, so a new operation needs both. */
/** What the agent toggle and picker change; `agentId: null` clears the project's own choice. */
export type { RepoAgentPatch } from "../shared/repoSettings.ts";

/**
 * The labels editor reports "no labels left" as a key set to `undefined` (a config never stores an empty list); on the
 * wire that is an empty list, which the route turns back into no key. Keys the patch does not have are left out.
 */
export function labelLists(patch: Pick<RepoConfig, "labels" | "hiddenLabels">): { labels?: string[]; hiddenLabels?: string[] } {
  const out: { labels?: string[]; hiddenLabels?: string[] } = {};
  for (const key of ["labels", "hiddenLabels"] as const) if (key in patch) out[key] = patch[key] ?? [];
  return out;
}

export interface Api {
  state(): Promise<Snapshot>;
  /** Read-only: a change's artifacts and their existing files. Rejects with `ApiError` 404 for an unknown repository or change. */
  changeArtifacts(repoId: string, change: string): Promise<ChangeArtifacts>;
  /** Read-only: one file of a change. `ApiError` 400 for a bad path, 404 when it is not a file of the change, 413 when too large. */
  artifactFile(repoId: string, change: string, path: string): Promise<ArtifactFileContent>;
  /** What the dashboard observed, newest first. Read-only history; nothing else depends on it. */
  activity(query?: ActivityQuery): Promise<ActivityPage>;
  config(): Promise<Config>;
  saveConfig(config: Config): Promise<Config>;
  /**
   * Enable on the projects overview, saved at once: re-enables a configured repository, or adds a discovered candidate
   * enabled with its default name. `ApiError` 404 for a path discovery does not offer.
   */
  trackRepo(path: string): Promise<Config>;
  /** Enable or Disable of a configured repository, saved at once; its name is kept. */
  setRepoEnabled(repoId: string, enabled: boolean): Promise<Config>;
  /** Ignore on the projects overview, saved at once: one more ignore path. */
  ignorePath(path: string): Promise<Config>;
  /** Rename on the projects overview, saved at once. `ApiError` 400 for a blank name. */
  renameRepo(repoId: string, name: string): Promise<Config>;
  /** A project's agent-session toggle and agent picker, saved at once; `agentId: null` means the default agent. */
  setRepoAgent(repoId: string, patch: RepoAgentPatch): Promise<Config>;
  /** A project's labels dialog, saved at once: either list replaced, an empty one removed. */
  setRepoLabels(repoId: string, patch: Pick<RepoConfig, "labels" | "hiddenLabels">): Promise<Config>;
  /** A project's PR titles picker, saved at once; `null` means no convention. */
  setRepoPrTitleConvention(repoId: string, convention: PrTitleConvention | null): Promise<Config>;
  /** The project's Auto fetch drop-down, saved at once; `null` is Off. `ApiError` 400 for an interval not offered. */
  setRepoAutoFetch(repoId: string, seconds: AutoFetchSeconds | 0): Promise<Config>;
  /** A label's colour from a labels dialog, saved at once for every repository; `hue: null` is Auto. `ApiError` 400 when refused. */
  setLabelColor(label: string, hue: number | null): Promise<Config>;
  /** Whether Fast-forward asks for confirmation first, saved at once. */
  setFastForwardWarning(show: boolean): Promise<Config>;
  /** Forget on a disabled entry, saved at once. `ApiError` 409 for an enabled repository. */
  forgetRepo(repoId: string): Promise<Config>;
  /** Read-only; pass the draft roots and ignore paths to discover against unsaved edits. */
  discover(scanRoots?: string[], ignorePaths?: string[]): Promise<DiscoverResult>;
  scan(): Promise<ScanTriggerResult>;
  /**
   * What this machine is missing (openspec/specs/environment-check). Read-only and local: it contacts no network and
   * reads nothing in a tracked repository, so a configured credential is never proved to be valid. `view: "setup"` is
   * the setup wizard's view: no per-agent checks and fixed setup verdicts.
   */
  environment(force?: boolean, view?: EnvironmentView): Promise<EnvironmentReport>;
  /** Whether the setup wizard is pending, and the home folders worth offering as roots (setup-wizard). Read-only. */
  setup(): Promise<SetupState>;
  /** Opens the system's folder dialog on the server's machine and waits for the user's choice; saves nothing. */
  pickFolder(): Promise<FolderPickResult>;
  /** Finish or Skip setup: clears the pending flag and returns the saved configuration. */
  markSetupDone(): Promise<Config>;
  /**
   * **Create folder** in the setup wizard: one new, empty folder; the configuration is not changed. `ApiError` 400, 404
   * (parent missing) or 409 (exists, or in a tracked repository, an ignore path or the home) with the reason.
   */
  createWorkspaceFolder(path: string): Promise<{ path: string }>;
  /**
   * One owner's GitHub repositories through the read-only `gh repo list` — the signed-in account's without `owner`.
   * Reaches GitHub, so it is only called when Add from GitHub opens, its owner changes or its Refresh is activated.
   */
  listGithubRepos(owner?: string): Promise<GithubRepoList>;
  /** Starts cloning `repo` into `<root>/<name>`; resolves once the folder exists. `ApiError` with the reason when refused. */
  cloneGithub(repo: string, root: string, name: string): Promise<GithubClone>;
  /** Read-only, in memory: the clones since the dashboard started, and whether git is on this machine. */
  githubClones(): Promise<GithubClonesResponse>;
  /** Cancels a queued or running clone; answers its entry once it is `cancelled`. */
  cancelGithubClone(id: string): Promise<GithubClone>;
  /** Drops a finished clone's entry; the folder is never touched. */
  dismissGithubClone(id: string): Promise<{ clones: GithubClone[] }>;
  /** What the server last learned about newer releases (openspec/specs/update-notice). Contacts no network. */
  updateStatus(): Promise<UpdateStatus>;
  /** **Check now**: the server asks for the latest release and answers the new status. `ApiError` 409 while checks are off. */
  checkForUpdate(): Promise<UpdateStatus>;
  /**
   * Creates a new change directory in the repository: `openspec/changes/<name>/` with the schema marker and, when a
   * non-empty prompt is given, `prompt.md`, with dependencies `depends-on.yaml`, and for an imported issue `issue.yaml`.
   * Atomic; a duplicate name is refused with `409`.
   */
  createChange(repoId: string, name: string, prompt?: string, dependsOn?: string[], issue?: ChangeIssueRef): Promise<CreateChangeResponse>;
  /**
   * The repository's open GitHub issues, through the GitHub CLI's read-only `gh issue list`. Reaches GitHub, so it is
   * only ever called when the user opens the Import from issues dialog or activates its Refresh.
   */
  listIssues(repoId: string): Promise<RepoIssues>;
  /**
   * Fetches the repository's remote and fast-forwards its main checkout when that is safe. The only operation that
   * makes the dashboard contact a remote; it never runs unless the user asks.
   */
  pullRepo(repoId: string): Promise<PullResult>;
  pullAll(): Promise<{ results: PullResult[] }>;
  /**
   * Confirms Resolve and pull for one repository: posts the offer back unchanged. Fetches nothing; the server
   * re-determines every blocking file and refuses unless its own answer is still this one.
   */
  resolvePull(repoId: string, resolve: PullResolve): Promise<PullResult>;
  /** Read-only: the cached pull-request lists. Contacts no network host and starts no process. */
  pullRequests(): Promise<PullRequestsResponse>;
  /**
   * Refreshes the pull-request lists through the GitHub CLI — the only call besides a pull that reaches a network,
   * and only ever from a Refresh control or from opening a pull-request list whose cache is stale.
   */
  refreshPullRequests(options?: { repoId?: string; repoIds?: string[]; force?: boolean }): Promise<PullRequestsResponse>;
  /** The pull-request lists are made up (the demo): opening a board then never asks for a refresh. */
  readonly syntheticPullRequests?: boolean;
  /** Read-only: the repository's worktrees, stale worktree records and branches, each removable or kept with a reason. */
  cleanupPreview(repoId: string): Promise<CleanupPreview>;
  /** Removes what the user selected and confirmed, re-checking each item; the only call that deletes a branch. */
  cleanup(repoId: string, selection: CleanupSelection): Promise<CleanupResult>;
  /** Read-only: what dismissing the change would delete, file by file, and whether git could restore each. */
  dismissPreview(repoId: string, change: string): Promise<DismissPreview>;
  /**
   * Deletes the change's directory from the main checkout and stages that removal — only when it is still what the
   * preview with `fingerprint` showed; `ApiError` 409 otherwise. The only call that deletes a change.
   */
  dismissChange(repoId: string, change: string, fingerprint: string): Promise<DismissResult>;
  sharedConfig(): Promise<SharedConfig>;
  /** Stores the profiles in the dashboard home; never writes to a repository. */
  saveSharedConfig(config: SharedConfig): Promise<SharedConfig>;
  previewSharedConfig(assignments: SharedConfigAssignment[]): Promise<{ previews: SharedConfigPreview[] }>;
  /** The one call that writes to tracked repositories: the managed sections of `openspec/config.yaml`. */
  applySharedConfig(assignments: SharedConfigAssignment[]): Promise<{ results: SharedConfigApplyResult[] }>;

  /** Agent sessions (optional feature): an agent CLI in a terminal, one per change. */
  sessions(): Promise<{ sessions: Session[]; agents: AgentAvailability[]; presets: AgentAvailability[]; worktrees: SessionWorktree[] }>;
  openSession(repoId: string, change: string, action: SessionAction): Promise<StartResult>;
  /** Opens the main console, or returns the one that is running. */
  openConsole(): Promise<ConsoleSession>;
  /**
   * Opens a tracked project's console — in place in its folder, without a prompt — or returns the one running for it,
   * which may be the integration session that set the project up.
   */
  openProjectConsole(repoId: string): Promise<ProjectConsoleLike>;
  /**
   * Starts an agent in a repository that does not use OpenSpec yet, to set it up — in that folder, with no worktree
   * and no branch. Returns the one already running for the folder if there is one. `ApiError` 404 when the folder is
   * not offered for integration, 403/400/503 when the action is unavailable.
   */
  startIntegration(path: string): Promise<IntegrationSession>;
  /**
   * Creates `<root>/<name>`, runs `git init` in it and starts the integration session there. `ApiError` with the
   * server's reason when refused; a refusal created nothing.
   */
  createProject(root: string, name: string): Promise<CreateProjectResponse>;
  /** Continues the agent's latest conversation in the session's worktree. */
  resumeSession(id: string): Promise<Session>;
  /** Asks the session's agent to commit, push and open a pull request. */
  shipSession(id: string): Promise<ShipResult>;
  resolveConflicts(id: string): Promise<PromptResult>;
  /** For a worktree whose session record is gone; refused unless that is safe. */
  removeWorktree(repoId: string, name: string): Promise<{ removable: boolean; reason?: string }>;
  /** Ends the agent if it is running; removes the worktree only when asked and safe. */
  closeSession(id: string, removeWorktree: boolean): Promise<{ session: Session; worktree?: { removable: boolean; reason?: string } }>;
  deleteSession(id: string): Promise<{ deleted: boolean }>;
  /** Whether the worktree could be removed, and its work status read at this moment (not from the list's cache). */
  worktreeStatus(id: string): Promise<{ removable: boolean; reason?: string; work?: WorkStatus }>;
  /** Sends a starter's prompt to the running session's terminal, under the rules for text sent on the user's behalf. */
  promptSession(id: string, action: SessionAction): Promise<AutoMergePromptResult>;
  /**
   * The byte stream of a session's terminal. Part of this interface — not a WebSocket opened by the view — so that a
   * backend without a server (the demo) can stand in for it.
   */
  openTerminal(id: string, handlers: TerminalHandlers): TerminalConnection;
}

export interface TerminalHandlers {
  onOpen(): void;
  /** Raw terminal output, to be written to the terminal view as it is. */
  onData(bytes: Uint8Array): void;
  /** The agent's process ended. */
  onExit(): void;
  /** The answer to a `submit` message: whether Enter was pressed. Answers arrive in the order of the submissions. */
  onSubmitted(ok: boolean): void;
  onClose(): void;
}

export type TerminalMessage =
  | { type: "input"; data: string }
  /** Typed, and sent with Enter only once the agent's terminal has shown the text; answered with `onSubmitted`. */
  | { type: "submit"; data: string }
  | { type: "resize"; cols: number; rows: number };

export interface TerminalConnection {
  /** Dropped while the connection is not open. */
  send(message: TerminalMessage): void;
  close(): void;
}

export function activityQueryString(query: ActivityQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.before) params.set("before", query.before);
  if (query.repos?.length) params.set("repos", query.repos.join(","));
  if (query.kinds?.length) params.set("kinds", query.kinds.join(","));
  if (query.since !== undefined) params.set("since", query.since);
  if (query.tz) params.set("tz", query.tz);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const httpApi: Api = {
  state: () => call<Snapshot>("/api/state"),
  changeArtifacts: (repoId, change) => call<ChangeArtifacts>(`/api/repos/${encodeURIComponent(repoId)}/changes/${encodeURIComponent(change)}/artifacts`),
  artifactFile: (repoId, change, path) => call<ArtifactFileContent>(`/api/repos/${encodeURIComponent(repoId)}/changes/${encodeURIComponent(change)}/file?path=${encodeURIComponent(path)}`),
  activity: async (query = {}) => {
    try {
      return await call<ActivityPage>(`/api/activity${activityQueryString(query)}`);
    } catch (err) {
      // A zone the server's runtime does not know: days in UTC beat no feed at all.
      if (!query.tz || !(err instanceof ApiError) || err.status !== 400) throw err;
      return call<ActivityPage>(`/api/activity${activityQueryString({ ...query, tz: undefined })}`);
    }
  },
  config: () => call<Config>("/api/config"),
  saveConfig: (config) => call<Config>("/api/config", { method: "PUT", body: JSON.stringify(config) }),
  trackRepo: (path) => call<Config>("/api/repos/track", { method: "POST", body: JSON.stringify({ path }) }),
  setRepoEnabled: (repoId, enabled) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) }),
  ignorePath: (path) => call<Config>("/api/ignore-paths", { method: "POST", body: JSON.stringify({ path }) }),
  renameRepo: (repoId, name) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/name`, { method: "POST", body: JSON.stringify({ name }) }),
  setRepoAgent: (repoId, patch) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/agent`, { method: "POST", body: JSON.stringify(patch) }),
  // An absent list is sent as an empty one: the route removes the key, which is what "no labels left" means.
  setRepoLabels: (repoId, patch) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/labels`, { method: "POST", body: JSON.stringify(labelLists(patch)) }),
  setRepoPrTitleConvention: (repoId, convention) =>
    call<Config>(`/api/repos/${encodeURIComponent(repoId)}/pr-title-convention`, { method: "POST", body: JSON.stringify({ convention }) }),
  setRepoAutoFetch: (repoId, seconds) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/auto-fetch`, { method: "POST", body: JSON.stringify({ seconds }) }),
  setLabelColor: (label, hue) => call<Config>("/api/labels/color", { method: "POST", body: JSON.stringify({ label, hue }) }),
  setFastForwardWarning: (show) => call<Config>("/api/agent-sessions/fast-forward-warning", { method: "POST", body: JSON.stringify({ show }) }),
  forgetRepo: (repoId) => call<Config>(`/api/repos/${encodeURIComponent(repoId)}/forget`, { method: "POST", body: "{}" }),
  discover: (scanRoots, ignorePaths) =>
    call<DiscoverResult>("/api/discover", { method: "POST", body: scanRoots || ignorePaths ? JSON.stringify({ scanRoots, ignorePaths }) : undefined }),
  scan: () => call<ScanTriggerResult>("/api/scan", { method: "POST" }),
  environment: (force, view) => {
    const params = new URLSearchParams();
    if (force) params.set("force", "1");
    if (view && view !== "settings") params.set("view", view);
    const query = params.toString();
    return call<EnvironmentReport>(`/api/environment${query ? `?${query}` : ""}`);
  },
  setup: () => call<SetupState>("/api/setup"),
  pickFolder: () => call<FolderPickResult>("/api/setup/folder", { method: "POST", body: "{}" }),
  markSetupDone: () => call<Config>("/api/setup/done", { method: "POST", body: "{}" }),
  createWorkspaceFolder: (path) => call<{ path: string }>("/api/setup/workspace-folder", { method: "POST", body: JSON.stringify({ path }) }),
  listGithubRepos: (owner) => call<GithubRepoList>("/api/github/repos", { method: "POST", body: JSON.stringify(owner ? { owner } : {}) }),
  cloneGithub: (repo, root, name) => call<GithubClone>("/api/github/clone", { method: "POST", body: JSON.stringify({ repo, root, name }) }),
  githubClones: () => call<GithubClonesResponse>("/api/github/clones"),
  cancelGithubClone: (id) => call<GithubClone>("/api/github/clones/cancel", { method: "POST", body: JSON.stringify({ id }) }),
  dismissGithubClone: (id) => call<{ clones: GithubClone[] }>("/api/github/clones/dismiss", { method: "POST", body: JSON.stringify({ id }) }),
  updateStatus: () => call<UpdateStatus>("/api/update"),
  checkForUpdate: () => call<UpdateStatus>("/api/update/check", { method: "POST" }),
  createChange: (repoId, name, prompt, dependsOn, issue) =>
    call<CreateChangeResponse>(`/api/repos/${encodeURIComponent(repoId)}/changes`, {
      method: "POST",
      body: JSON.stringify({ name, ...(prompt !== undefined && prompt !== "" ? { prompt } : {}), ...(dependsOn?.length ? { dependsOn } : {}), ...(issue ? { issue } : {}) }),
    }),
  listIssues: (repoId) => call<RepoIssues>(`/api/repos/${encodeURIComponent(repoId)}/issues`, { method: "POST" }),
  pullRepo: (repoId) => call<PullResult>(`/api/repos/${encodeURIComponent(repoId)}/pull`, { method: "POST" }),
  pullAll: () => call<{ results: PullResult[] }>("/api/pull", { method: "POST" }),
  resolvePull: (repoId, resolve) => call<PullResult>(`/api/repos/${encodeURIComponent(repoId)}/pull`, { method: "POST", body: JSON.stringify({ resolve }) }),
  pullRequests: () => call<PullRequestsResponse>("/api/pull-requests"),
  refreshPullRequests: (options = {}) => call<PullRequestsResponse>("/api/pull-requests/refresh", { method: "POST", body: JSON.stringify(options) }),
  cleanupPreview: (repoId) => call<CleanupPreview>(`/api/repos/${encodeURIComponent(repoId)}/cleanup`),
  cleanup: (repoId, selection) => call<CleanupResult>(`/api/repos/${encodeURIComponent(repoId)}/cleanup`, { method: "POST", body: JSON.stringify(selection) }),
  dismissPreview: (repoId, change) => call<DismissPreview>(`/api/repos/${encodeURIComponent(repoId)}/changes/${encodeURIComponent(change)}/dismiss`),
  dismissChange: (repoId, change, fingerprint) =>
    call<DismissResult>(`/api/repos/${encodeURIComponent(repoId)}/changes/${encodeURIComponent(change)}/dismiss`, { method: "POST", body: JSON.stringify({ fingerprint }) }),
  sharedConfig: () => call<SharedConfig>("/api/shared-config"),
  saveSharedConfig: (config) => call<SharedConfig>("/api/shared-config", { method: "PUT", body: JSON.stringify(config) }),
  previewSharedConfig: (assignments) => call<{ previews: SharedConfigPreview[] }>("/api/shared-config/preview", { method: "POST", body: JSON.stringify({ assignments }) }),
  applySharedConfig: (assignments) => call<{ results: SharedConfigApplyResult[] }>("/api/shared-config/apply", { method: "POST", body: JSON.stringify({ assignments }) }),
  sessions: () => call<{ sessions: Session[]; agents: AgentAvailability[]; presets: AgentAvailability[]; worktrees: SessionWorktree[] }>("/api/sessions"),
  openSession: (repoId, change, action) => call<StartResult>("/api/sessions", { method: "POST", body: JSON.stringify({ repoId, change, action }) }),
  openConsole: () => call<ConsoleSession>("/api/console", { method: "POST" }),
  openProjectConsole: (repoId) => call<ProjectConsoleLike>(`/api/repos/${encodeURIComponent(repoId)}/console`, { method: "POST" }),
  startIntegration: (path) => call<IntegrationSession>("/api/integrations", { method: "POST", body: JSON.stringify({ path }) }),
  createProject: (root, name) => call<CreateProjectResponse>("/api/projects", { method: "POST", body: JSON.stringify({ root, name }) }),
  resumeSession: (id) => call<Session>(`/api/sessions/${id}/resume`, { method: "POST" }),
  shipSession: (id) => call<ShipResult>(`/api/sessions/${id}/ship`, { method: "POST" }),
  resolveConflicts: (id) => call<PromptResult>(`/api/sessions/${id}/resolve-conflicts`, { method: "POST" }),
  removeWorktree: (repoId, name) => call("/api/worktrees/remove", { method: "POST", body: JSON.stringify({ repoId, name }) }),
  closeSession: (id, removeWorktree) => call(`/api/sessions/${id}/close`, { method: "POST", body: JSON.stringify({ removeWorktree }) }),
  deleteSession: (id) => call<{ deleted: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
  worktreeStatus: (id) => call<{ removable: boolean; reason?: string; work?: WorkStatus }>(`/api/sessions/${id}/worktree`),
  promptSession: (id, action) => call<AutoMergePromptResult>(`/api/sessions/${id}/prompt`, { method: "POST", body: JSON.stringify({ action }) }),
  openTerminal: (id, handlers) => {
    const socket = new WebSocket(terminalSocketUrl(id));
    socket.binaryType = "arraybuffer";
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        const frame = JSON.parse(event.data) as { type?: string; ok?: boolean };
        if (frame.type === "exit") handlers.onExit();
        else if (frame.type === "submitted") handlers.onSubmitted(frame.ok === true);
      } else {
        handlers.onData(new Uint8Array(event.data as ArrayBuffer));
      }
    };
    socket.onclose = () => handlers.onClose();
    return {
      send: (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
      close: () => socket.close(),
    };
  },
};

let current: Api = httpApi;

/** Chosen once by the entry point, before the first render. */
export function setApi(impl: Api): void {
  current = impl;
}

/** What components import; forwards to the implementation the entry point chose (HTTP unless told otherwise). */
export const api: Api = {
  state: () => current.state(),
  changeArtifacts: (...args) => current.changeArtifacts(...args),
  artifactFile: (...args) => current.artifactFile(...args),
  activity: (query) => current.activity(query),
  config: () => current.config(),
  saveConfig: (config) => current.saveConfig(config),
  trackRepo: (path) => current.trackRepo(path),
  setRepoEnabled: (...args) => current.setRepoEnabled(...args),
  ignorePath: (path) => current.ignorePath(path),
  renameRepo: (...args) => current.renameRepo(...args),
  setRepoAgent: (...args) => current.setRepoAgent(...args),
  setRepoLabels: (...args) => current.setRepoLabels(...args),
  setRepoPrTitleConvention: (...args) => current.setRepoPrTitleConvention(...args),
  setRepoAutoFetch: (...args) => current.setRepoAutoFetch(...args),
  setLabelColor: (...args) => current.setLabelColor(...args),
  setFastForwardWarning: (...args) => current.setFastForwardWarning(...args),
  forgetRepo: (repoId) => current.forgetRepo(repoId),
  discover: (scanRoots, ignorePaths) => current.discover(scanRoots, ignorePaths),
  scan: () => current.scan(),
  environment: (force, view) => current.environment(force, view),
  setup: () => current.setup(),
  pickFolder: () => current.pickFolder(),
  markSetupDone: () => current.markSetupDone(),
  createWorkspaceFolder: (path) => current.createWorkspaceFolder(path),
  listGithubRepos: (owner) => current.listGithubRepos(owner),
  cloneGithub: (...args) => current.cloneGithub(...args),
  githubClones: () => current.githubClones(),
  cancelGithubClone: (id) => current.cancelGithubClone(id),
  dismissGithubClone: (id) => current.dismissGithubClone(id),
  updateStatus: () => current.updateStatus(),
  checkForUpdate: () => current.checkForUpdate(),
  createChange: (...args) => current.createChange(...args),
  listIssues: (repoId) => current.listIssues(repoId),
  pullRepo: (repoId) => current.pullRepo(repoId),
  pullAll: () => current.pullAll(),
  resolvePull: (...args) => current.resolvePull(...args),
  pullRequests: () => current.pullRequests(),
  refreshPullRequests: (options) => current.refreshPullRequests(options),
  get syntheticPullRequests() {
    return current.syntheticPullRequests;
  },
  cleanupPreview: (...args) => current.cleanupPreview(...args),
  cleanup: (...args) => current.cleanup(...args),
  dismissPreview: (...args) => current.dismissPreview(...args),
  dismissChange: (...args) => current.dismissChange(...args),
  sharedConfig: () => current.sharedConfig(),
  saveSharedConfig: (config) => current.saveSharedConfig(config),
  previewSharedConfig: (assignments) => current.previewSharedConfig(assignments),
  applySharedConfig: (assignments) => current.applySharedConfig(assignments),
  sessions: (...args) => current.sessions(...args),
  openSession: (...args) => current.openSession(...args),
  openConsole: () => current.openConsole(),
  openProjectConsole: (repoId) => current.openProjectConsole(repoId),
  startIntegration: (path) => current.startIntegration(path),
  createProject: (...args) => current.createProject(...args),
  resumeSession: (...args) => current.resumeSession(...args),
  shipSession: (...args) => current.shipSession(...args),
  resolveConflicts: (...args) => current.resolveConflicts(...args),
  removeWorktree: (...args) => current.removeWorktree(...args),
  closeSession: (...args) => current.closeSession(...args),
  deleteSession: (...args) => current.deleteSession(...args),
  worktreeStatus: (...args) => current.worktreeStatus(...args),
  promptSession: (...args) => current.promptSession(...args),
  openTerminal: (...args) => current.openTerminal(...args),
};

/** Where the terminal of a session is served: a WebSocket on the dashboard's own host. */
export function terminalSocketUrl(id: string): string {
  return `${socketOrigin()}/api/sessions/${id}/terminal`;
}
