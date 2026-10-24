// Session manager (design.md D15–D17). A session is an agent CLI running in a terminal inside the change's own git
// worktree. The manager creates the worktree, starts the process, keeps a scrollback for late or returning viewers,
// fans output out to attached terminals and takes their input. It does not interpret what the agent prints.
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { blockedReason } from "../../shared/dependencies.ts";
import { availableActions, changeSessions, pastDraftingReason, isChangeless, isConsole, isIntegration, isProjectConsole, OPEN_SESSION_STATES, projectConsoleSessions, repoAgentEnabled, SESSION_ACTIONS, SHIPPABLE_WORK, type AgentAvailability, type ChangeSession, type Config, type ConsoleSession, type IntegrationSession, type ProjectConsoleLike, type ProjectConsoleSession, type ChangeSnapshot, type RepoPullRequests, type RepoSnapshot, type Session, type SessionAction, type SessionWorktree, type Snapshot, type WorkStatus, type MergeAsked, type PromptResult, type PullRequest, type RepoConfig, type ShipResult, type AutoMergePromptResult, type StartResult } from "../../shared/types.ts";
import { isProposalSession, proposalBranch, receivingSession, sessionBranch } from "../../shared/sessionBranch.ts";
import { isBranchName, isCleaningUp } from "../cleanup.ts";
import { isDismissing } from "../dismissChange.ts";
import { canonicalPath, worktreesDir } from "../paths.ts";
import { CHANGE_NAME } from "../source.ts";
import { agentEnv, agentFor, availability, carryOverPrompt, consoleAgentOf, defaultAgentOf, presetAvailability, integratePrompt, launchCommand, launchWithoutPrompt, mergePrompt, openingPrompt, resolveConflictsPrompt, shipPrompt } from "./agents.ts";
import { consoleFolderProblem, prepareConsoleFolder } from "./consoleFolder.ts";
import type { SessionActivity } from "../activity/events.ts";
import { isBusy } from "../keepAwake.ts";
import { readReport, STATE_FILE_ENV, terminalRepliesOnly, type Report, type ReportedState } from "./reportedState.ts";
import { SessionStore } from "./store.ts";
import { submitText, validSubmission, type SubmitOptions } from "./submit.ts";
import { spawnTerminal, type TerminalProcess } from "./terminal.ts";
import { baseRef, headCommit, listWorktrees, readWorkStatus, shipsOnlyOpenSpec, WORKTREE_NAME } from "./workStatus.ts";
import { currentBranch, defaultBranch } from "../git.ts";
import { frameworkById } from "../frameworks/registry.ts";
import { conflictSignal } from "../../shared/conflictSignal.ts";
import { linkedPullRequest } from "../../shared/pullRequestLink.ts";
import { mergeReady, pullRequestReadiness, readinessDetail } from "../../shared/pullRequestReadiness.ts";
import { checkWorktreeRemovable, copyChangeIfMissing, ensureWorktree, implementStartPoint, linkedWorktreeOf, NoCommitError, removeWorktree, UnknownBranchError, type Removable } from "./worktree.ts";

export const SCROLLBACK_BYTES = 1024 * 1024;
const TYPE_PROMPT_DELAY_MS = 1500;
const OUTPUT_STAMP_MS = 5000;
/**
 * How long output after a resize or after input the dashboard passed on is taken for the agent answering it — a redraw,
 * an echo — rather than for work: relayed and kept, but not stamped as the last output (agent-sessions spec, at most 3 s).
 */
export const ECHO_WINDOW_MS = 2000;
const WORKTREES_TTL_MS = 15_000;

export class SessionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Archiving gets a worktree of its own: the implementation worktree of the same change may still exist, on an old base.
 * So does a Draft session that ships its proposal (`proposal`), so that Implement, which reuses a worktree by name, never
 * lands on the proposal's branch.
 */
export function worktreeName(action: SessionAction, change: string, { proposal = false }: { proposal?: boolean } = {}): string {
  if (action === "archive") return `archive-${change}`;
  return action === "draft" && proposal ? `docs-${change}` : change;
}

export { sessionBranch };

const NOT_A_CHANGE = "this is the main console, which belongs to no change";
const NOT_A_CHANGE_INTEGRATING = "this session is setting a repository up for OpenSpec, so it belongs to no change";
const NOT_A_CHANGE_PROJECT = "this is the project's console, which belongs to no change";
const notAChange = (session: Session) => (isIntegration(session) ? NOT_A_CHANGE_INTEGRATING : isProjectConsole(session) ? NOT_A_CHANGE_PROJECT : NOT_A_CHANGE);

/** An adopted worktree was created outside the dashboard; removing it is its owner's call, however clean it is. */
const NOT_OURS: Removable = { removable: false, reason: "this worktree was not created by the dashboard (the session adopted it), so it is kept" };

/** Keeps the last `limit` bytes of terminal output, for viewers that attach later. */
export class Scrollback {
  private chunks: Uint8Array[] = [];
  private size = 0;
  constructor(private readonly limit = SCROLLBACK_BYTES) {}

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) this.size -= (this.chunks.shift() as Uint8Array).length;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

type Viewer = (chunk: Uint8Array) => void;

interface Live {
  proc?: TerminalProcess;
  scrollback: Scrollback;
  viewers: Set<Viewer>;
  lastStamp: number;
  /** When the process was started: a report written before that belongs to an earlier run. */
  startedAt: number;
  /** Until when output is the echo of a resize or of input, not activity (`ECHO_WINDOW_MS`). */
  echoUntil: number;
  /** When the user last gave the session input — not counting the replies a browser terminal sends by itself. */
  lastUserInputAt: number;
  /** The report read last from the state file, kept so an unchanged file is not read again. */
  report?: Report & { size: number };
  /** The word of that report while it is current (see `readReports`); keep-awake's input, never the badge's. */
  current?: ReportedState;
  /** Tail of the submissions to this terminal: they run one after another so text and Enter never interleave. */
  submitting?: Promise<unknown>;
}

export interface ManagerDeps {
  getConfig: () => Config;
  getSnapshot: () => Snapshot;
  store?: SessionStore;
  /** Test seam; the real delay gives an agent time to draw its prompt before text is typed into it. */
  typePromptDelayMs?: number;
  /** Test seam for `ECHO_WINDOW_MS`. */
  echoWindowMs?: number;
  /** Test seam for how long a submission waits for its echo and before Enter. */
  submitTimings?: SubmitOptions;
  /** Told when a session starts, ends or ships, for the activity feed. Never consulted for any decision. */
  onActivity?: (session: ChangeSession, activity: SessionActivity) => void;
  /** Told when an integration session has ended, so its folder can be re-checked for the marker. */
  onIntegrationEnded?: (session: IntegrationSession) => void;
  /** Told after a session's agent started (or failed to) and after one ended, so keep-awake re-evaluates at once. */
  onRunningChanged?: () => void;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private live = new Map<string, Live>();
  /** `end` started by an exit handler and not finished yet: its writes are what `close` and `shutdown` must wait for. */
  private ending = new Map<string, Promise<void>>();
  private readonly store: SessionStore;
  private worktreeCache?: { at: number; list: Promise<SessionWorktree[]> };
  /** Sessions being ended because their auto-merge pull request merged: their end is reported once, as that. */
  private autoEnding = new Set<string>();
  /** Sessions the automatic Merge is deciding about: taken before the first await, so two queries send once (D4). */
  private merging = new Set<string>();

  constructor(private readonly deps: ManagerDeps) {
    this.store = deps.store ?? new SessionStore();
  }

  /** Loads stored sessions. A terminal cannot outlive the dashboard, so anything recorded as running has ended. */
  async init(): Promise<void> {
    for (const session of await this.store.loadAll()) {
      this.sessions.set(session.id, session);
      if (session.state === "running") await this.end(session, null, "the dashboard was restarted while this session was running");
    }
  }

  agents(): AgentAvailability[] {
    return availability(this.deps.getConfig());
  }

  /** Presets that are not configured yet, marked with whether their executable was found (Settings). */
  presets(): AgentAvailability[] {
    return presetAvailability(this.deps.getConfig());
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new SessionError(404, "unknown session");
    return session;
  }

  /**
   * `pullRequests` is the repository's cached pull-request list as the server holds it; only Resolve conflicts
   * (`resolveConflicts: true`) reads it, and nothing in the request can name a branch or a pull request instead.
   */
  async open(input: { repoId?: unknown; change?: unknown; action?: unknown; carryOver?: unknown; resolveConflicts?: unknown }, pullRequests?: RepoPullRequests): Promise<StartResult> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    if (typeof input.change !== "string" || !CHANGE_NAME.test(input.change)) throw new SessionError(400, "invalid change name");
    if (input.resolveConflicts === true) return this.openToResolve(input.repoId, input.change, pullRequests);
    if (!SESSION_ACTIONS.includes(input.action as SessionAction)) throw new SessionError(400, "unknown action");
    const change = input.change;
    const action = input.action as SessionAction;
    // Carry-over is an archive session with a prompt of its own (stale-changes spec); nothing else carries anything over.
    const carryOver = input.carryOver === true;
    if (carryOver && action !== "archive") throw new SessionError(400, "only an archive session can carry an archive over");

    const repo = config.repos.find((r) => r.id === input.repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repo.enabled) throw new SessionError(409, "the repository is not tracked");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    const scanned = this.deps.getSnapshot().repos.find((r) => r.id === repo.id);
    if (!scanned?.ok) throw new SessionError(409, "the repository's last scan failed");
    if (isCleaningUp(repo.id)) throw new SessionError(409, "a cleanup of this repository is running");
    if (isDismissing(repo.id, change)) throw new SessionError(409, "this change is being dismissed");
    const snapshot = scanned.changes.find((c) => c.name === change && !c.archived);
    if (!snapshot) throw new SessionError(404, "unknown change");
    // The commit and branch come from this server's own scan, never from the request.
    const stranded = carryOver ? snapshot.strandedArchive : undefined;
    if (carryOver && !stranded) throw new SessionError(409, "the last scan found no archive of this change stranded on a branch");
    // Fast-forward implements too, so a blocked change is refused with the same named reason as Implement.
    const heldBack = action === "implement" ? blockedReason(snapshot) : action === "fastForward" ? blockedReason(snapshot, "Fast-forward") : action === "draft" && !stranded ? pastDraftingReason(snapshot) : undefined;
    if (heldBack) throw new SessionError(400, heldBack);
    // A stranded archive exists whatever the change's stage on the main checkout; that is the whole point of carrying it over.
    if (!stranded && !availableActions(snapshot).includes(action)) throw new SessionError(400, `"${action}" is not available for this change in its current stage`);

    // One open session per change, whatever the action: a change never has two consoles, and Archive is no exception.
    // Nothing is typed here — a starter for a change whose agent is up goes through `prompt`, which reports whether
    // the text was submitted; returning the session keeps a double-clicked starter from opening or typing anything
    // twice. `list()` is newest first, so a process that still holds two running sessions from before this rule
    // returns the one the user started last. In-place sessions need this as much as worktrees do: their working
    // directory is the repository folder itself, which no per-worktree rule would have kept a second agent out of.
    // The one exception is a session drafting the proposal on its own branch: it takes only Draft, so implementing gets
    // a session of its own next to it rather than continuing on the proposal's branch (ship-proposals-as-docs-prs).
    const existing = receivingSession(changeSessions(this.list()), repo.id, change, action);
    if (existing) return { ...existing, autoMerge: false };
    // A tracked folder without git is a supported repository, it just cannot be isolated: the agent runs in the folder
    // itself. So does a git repository with no commit yet, which has nothing to branch a worktree from. Decided from the
    // scan, never by letting a git command fail — see the agent-sessions spec.
    const inPlace = scanned.isGit === false || scanned.noCommit === true;
    // In place the change session would share the folder with the project's console or another change: one agent per folder.
    if (inPlace) {
      if (this.runningInFolder(repo.path).some(isProjectConsole)) throw new SessionError(409, "the project's console is running in this folder; end it first");
      this.refuseOtherAgentInFolder(repo.path);
    }

    const agent = agentFor(config, repo);
    if (!agent) throw new SessionError(503, "no agent is configured");
    const record = this.recordInstruction(repo.id, change, action);
    let prompt = stranded ? carryOverPrompt(change, stranded, scanned.defaultBranch) : openingPrompt(agent, action, change, { convention: repo.prTitleConvention, record });
    if (!prompt) throw new SessionError(400, `${agent.name} has no "${action}" prompt configured`);
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);

    // Decided once, now: switching docs auto-merge later never moves a session to another branch (D1).
    const proposal = action === "draft" && !inPlace && repo.agent?.autoMergeDocs === true;
    const now = new Date().toISOString();
    const session: ChangeSession = {
      id: randomUUID(),
      repoId: repo.id,
      change,
      action,
      agentId: agent.id,
      agentName: agent.name,
      state: "running",
      worktreePath: inPlace ? repo.path : join(worktreesDir(), repo.id, worktreeName(action, change, { proposal })),
      ...(inPlace ? { inPlace: true } : { branch: sessionBranch(action, change, { proposal }) }),
      createdAt: now,
      updatedAt: now,
      resumable: agent.resumeCommand !== undefined,
    };
    if (!inPlace) {
      const branch = session.branch as string;
      try {
        // The change's branch is often already checked out in the worktree where the change was started; git would
        // refuse a second one, so the session works there. Archiving always gets a worktree and branch of its own.
        const elsewhere = action === "archive" ? undefined : await linkedWorktreeOf(repo.path, branch);
        if (elsewhere && elsewhere !== session.worktreePath) {
          session.worktreePath = elsewhere;
          session.adopted = true;
        } else {
          // Implementation builds on a proposal that has not merged yet, never on its branch (D4).
          const startPoint = action === "implement" || action === "validate" ? await implementStartPoint(repo.path, change, proposalBranch(change)) : undefined;
          await ensureWorktree(repo.path, session.worktreePath, branch, { startPoint });
        }
        // The change may live only in some other worktree (on another branch), not in the main checkout.
        await copyChangeIfMissing(snapshot.checkout?.path ?? repo.path, session.worktreePath, change);
      } catch (err) {
        throw new SessionError(err instanceof NoCommitError ? 409 : 500, err instanceof Error ? err.message : String(err));
      }
    }
    // Decided once the worktree exists, so a leftover archive branch with code in it is seen (archive-auto-merge-docs D4).
    const autoMerge = await this.docsAutoMerge(repo, session, action);
    if (autoMerge) {
      prompt = stranded ? carryOverPrompt(change, stranded, scanned.defaultBranch, { autoMerge, record }) : (openingPrompt(agent, action, change, { autoMerge, proposal: autoMerge, convention: repo.prTitleConvention, record }) as string);
      session.autoMergeAskedAt = new Date().toISOString();
    }
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    const launch = launchCommand(agent, prompt);
    this.start(session, launch.argv, agentEnv(agent, process.env), launch.typed);
    if (session.state === "running") this.report(session, { kind: "session-started", action, agentName: session.agentName });
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { ...session, autoMerge };
  }

  /**
   * The record instruction of the repository's framework for a session doing `action` on `change`: the archive branch's
   * for an archive session, the implementation branch's for every other (agent-sessions: "An agent asked to open a pull
   * request is asked to record its branch"). Decided here from the session, never from the request or the agent's output.
   */
  private recordInstruction(repoId: string, change: string, action: SessionAction): string | undefined {
    const scanned = this.deps.getSnapshot().repos.find((r) => r.id === repoId);
    return frameworkById(scanned?.framework)?.recordInstruction?.({ change, archive: action === "archive" });
  }

  /**
   * Whether an Archive prompt for this session gets the archive auto-merge instruction, or a Draft prompt the proposal
   * instruction — the latter only in a session on the proposal branch (ship-proposals-as-docs-prs D2): the project opted
   * in, the session has a worktree, and read-only git proves it holds nothing outside `openspec/` — nothing at all
   * included, since such a worktree starts empty. Any other action, an in-place session or any doubt is `false`.
   */
  private async docsAutoMerge(repo: RepoConfig, session: ChangeSession, action: SessionAction): Promise<boolean> {
    if (action === "draft" ? !isProposalSession(session) : action !== "archive") return false;
    if (session.inPlace || repo.agent?.autoMergeDocs !== true) return false;
    return shipsOnlyOpenSpec(session.worktreePath, await baseRef(repo.path), { allowEmpty: true });
  }

  /**
   * The main console: the console agent (the profile chosen for it, else the default), without a prompt, in the console
   * folder — no repository, no change, no worktree, no git. One at a time: while one runs, it is returned instead of
   * starting another.
   */
  async openConsole(): Promise<{ session: ConsoleSession; created: boolean }> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    const running = this.list().find((s): s is ConsoleSession => isConsole(s) && s.state === "running");
    if (running) return { session: running, created: false };
    const agent = consoleAgentOf(config);
    if (!agent) throw new SessionError(503, "no agent is configured");
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);
    let prepared: ReturnType<typeof prepareConsoleFolder>;
    try {
      prepared = prepareConsoleFolder(config);
    } catch (err) {
      throw new SessionError(409, `the console folder could not be created: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (prepared.problem) throw new SessionError(409, prepared.problem);
    const now = new Date().toISOString();
    const session: ConsoleSession = {
      id: randomUUID(),
      console: true,
      agentId: agent.id,
      agentName: agent.name,
      state: "running",
      worktreePath: prepared.folder.path,
      createdAt: now,
      updatedAt: now,
      resumable: agent.resumeCommand !== undefined,
    };
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    this.start(session, launchWithoutPrompt(agent), agentEnv(agent, process.env));
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { session, created: true };
  }

  /**
   * Setting a repository up for OpenSpec: the default agent with the `integrate` prompt, **in place** in the
   * repository's main checkout — no worktree, no branch and no git command, because the marker the agent writes has to
   * land where discovery looks for it. Whether the folder may be integrated at all is decided before this is called
   * (`integration.ts`); here it is only ever one at a time per folder.
   */
  async openIntegration(folder: string): Promise<{ session: IntegrationSession; created: boolean }> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    const running = this.list().find((s): s is IntegrationSession => isIntegration(s) && s.folder === folder && OPEN_SESSION_STATES.includes(s.state));
    if (running) return { session: running, created: false };
    const agent = defaultAgentOf(config);
    if (!agent) throw new SessionError(503, "no agent is configured");
    const prompt = integratePrompt(agent);
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);
    const now = new Date().toISOString();
    const session: IntegrationSession = {
      id: randomUUID(),
      integration: true,
      folder,
      agentId: agent.id,
      agentName: agent.name,
      state: "running",
      worktreePath: folder,
      inPlace: true,
      createdAt: now,
      updatedAt: now,
      resumable: agent.resumeCommand !== undefined,
    };
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    const launch = launchCommand(agent, prompt);
    this.start(session, launch.argv, agentEnv(agent, process.env), launch.typed);
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { session, created: true };
  }

  /**
   * A project's console: the project's agent, without a prompt, **in place** in the tracked folder — for a git
   * repository its main checkout — with no worktree, no branch and no git command (project-console spec). One per
   * project: a running one is returned, and so is a running integration session in the folder, which is the agent
   * that set the project up. Not refused for a failed scan: the console is where a broken repository gets repaired.
   */
  async openProjectConsole(repoId: string): Promise<{ session: ProjectConsoleLike; created: boolean }> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    const repo = config.repos.find((r) => r.id === repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repo.enabled) throw new SessionError(409, "the repository is not tracked");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    await this.checkProjectFolder(repo.path);
    const folder = canonicalPath(repo.path);
    const running = projectConsoleSessions(this.list(), { id: repo.id, path: folder }).find((s) => OPEN_SESSION_STATES.includes(s.state));
    if (running) return { session: running, created: false };
    this.refuseOtherAgentInFolder(folder);
    const agent = agentFor(config, repo);
    if (!agent) throw new SessionError(503, "no agent is configured");
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);
    const now = new Date().toISOString();
    const session: ProjectConsoleSession = {
      id: randomUUID(),
      projectConsole: true,
      repoId: repo.id,
      folder,
      agentId: agent.id,
      agentName: agent.name,
      state: "running",
      worktreePath: folder,
      inPlace: true,
      createdAt: now,
      updatedAt: now,
      resumable: agent.resumeCommand !== undefined,
    };
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    this.start(session, launchWithoutPrompt(agent), agentEnv(agent, process.env));
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { session, created: true };
  }

  /** Running sessions whose working directory is `folder`, compared as canonical paths. */
  private runningInFolder(folder: string): Session[] {
    const path = canonicalPath(folder);
    return this.list().filter((s) => s.state === "running" && canonicalPath(s.worktreePath) === path);
  }

  /** One agent per folder: an in-place change session (a folder without git, a repository with no commit) keeps any other agent out. */
  private refuseOtherAgentInFolder(folder: string, except?: string): void {
    const other = this.runningInFolder(folder).find((s) => s.id !== except);
    if (!other) return;
    if (other.change) throw new SessionError(409, `a session for the change ${other.change} is running in this folder; end it first`);
    throw new SessionError(409, "another session is running in this folder");
  }

  private async checkProjectFolder(path: string): Promise<void> {
    const info = await stat(path).catch(() => undefined);
    if (!info) throw new SessionError(409, `the project folder ${path} does not exist`);
    if (!info.isDirectory()) throw new SessionError(409, `the project folder ${path} is not a directory`);
  }

  /**
   * Every session worktree with what became of its work. Cached briefly (the UI polls) and shared while in flight;
   * anything that changes a worktree's state drops the cache. With the feature off, no git runs at all.
   */
  worktrees(): Promise<SessionWorktree[]> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) return Promise.resolve([]);
    const cached = this.worktreeCache;
    if (cached && Date.now() - cached.at < WORKTREES_TTL_MS) return cached.list;
    const list = listWorktrees(config.repos, changeSessions(this.list()));
    this.worktreeCache = { at: Date.now(), list };
    list.catch(() => {
      if (this.worktreeCache?.list === list) this.worktreeCache = undefined;
    });
    return list;
  }

  /** Real paths (as git lists worktrees) of the worktrees a session is running in; repository cleanup keeps those. */
  async runningWorktreePaths(): Promise<Set<string>> {
    const paths = this.list().filter((s) => s.state === "running").map((s) => realpath(s.worktreePath).catch(() => s.worktreePath));
    return new Set(await Promise.all(paths));
  }

  /** Whether a session for the change is open; dismissing the change waits for it to end. */
  hasOpenSession(repoId: string, change: string): boolean {
    return changeSessions(this.list()).some((s) => s.repoId === repoId && s.change === change && OPEN_SESSION_STATES.includes(s.state));
  }

  forgetWorktrees(): void {
    this.worktreeCache = undefined;
  }

  /** Checks shared by everything that starts an agent again in an existing session's worktree. */
  private async prepareRestart(session: ChangeSession) {
    const { agent, config } = this.prepareAgainAnywhere(session);
    const running = this.runningInFolder(session.worktreePath).find((s) => s.id !== session.id);
    if (running) throw new SessionError(409, isProjectConsole(running) ? "the project's console is running in this folder; end it first" : "another session is running in this worktree");
    const repo = config.repos.find((r) => r.id === session.repoId);
    if (!repo) throw new SessionError(409, "the repository is no longer configured");
    if (isCleaningUp(repo.id)) throw new SessionError(409, "a cleanup of this repository is running");
    if (isDismissing(repo.id, session.change)) throw new SessionError(409, "this change is being dismissed");
    return { agent, repo };
  }

  /** What starting any session's agent again needs, repository or not. */
  private prepareAgainAnywhere(session: Session) {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    const agent = config.agentSessions.agents.find((a) => a.id === session.agentId);
    if (!agent) throw new SessionError(409, "this session's agent is no longer configured");
    return { agent, config };
  }

  /** An integration's folder is the repository itself: nothing to re-create, only that nothing else is running in it. */
  private prepareIntegrationRestart(session: IntegrationSession) {
    const { agent } = this.prepareAgainAnywhere(session);
    if (this.list().some((s) => s.id !== session.id && s.worktreePath === session.worktreePath && s.state === "running")) throw new SessionError(409, "another session is running in this folder");
    return { agent };
  }

  /** A project console runs in the tracked folder: nothing to re-create, only that it still exists and nothing else runs there. */
  private async prepareProjectConsoleRestart(session: ProjectConsoleSession) {
    const { agent, config } = this.prepareAgainAnywhere(session);
    const repo = config.repos.find((r) => r.id === session.repoId);
    if (!repo?.enabled) throw new SessionError(409, "the repository is no longer tracked");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    await this.checkProjectFolder(session.worktreePath);
    this.refuseOtherAgentInFolder(session.worktreePath, session.id);
    return { agent };
  }

  /** The console's folder is its own: no worktree to re-create, no git — only that it still is a usable folder. */
  private async prepareConsoleRestart(session: ConsoleSession) {
    const { agent, config } = this.prepareAgainAnywhere(session);
    if (this.list().some((s) => s.id !== session.id && isConsole(s) && s.state === "running")) throw new SessionError(409, "another console is running");
    const problem = consoleFolderProblem(session.worktreePath, config);
    if (problem) throw new SessionError(409, problem);
    return { agent };
  }

  private async restart(session: Session, repoPath: string | undefined, argv: string[], env: Record<string, string>, typed?: string): Promise<void> {
    // An in-place session runs in the repository folder, the console in its own: no worktree to re-create, no git to ask.
    if (!isChangeless(session) && !session.inPlace && repoPath !== undefined) {
      const branch = session.branch as string;
      try {
        // An adopted worktree is not ours to re-create: if its owner removed it, the session has nowhere to continue.
        if (!session.adopted) await ensureWorktree(repoPath, session.worktreePath, branch, { fromRemote: session.pullRequest !== undefined });
        else if ((await linkedWorktreeOf(repoPath, branch)) !== session.worktreePath) throw new Error(`the adopted worktree ${session.worktreePath} no longer exists`);
      } catch (err) {
        throw new SessionError(err instanceof NoCommitError || err instanceof UnknownBranchError ? 409 : 500, err instanceof Error ? err.message : String(err));
      }
    }
    session.state = "running";
    session.exitCode = undefined;
    session.error = undefined;
    await this.touch(session);
    this.start(session, argv, env, typed);
    if (session.state === "running" && !isChangeless(session)) this.report(session, { kind: "session-started", action: session.action, agentName: session.agentName, resumed: true });
  }

  /**
   * Asks the agent to commit, push and open a pull request; the dashboard does none of that itself. A running agent
   * gets the prompt typed into its terminal; an ended one is started again in the worktree, continuing its
   * conversation when it can, so it still knows what it did.
   */
  async ship(id: string): Promise<ShipResult> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(409, notAChange(session));
    if (session.inPlace) throw new SessionError(400, "this session runs in a folder that is not a git repository — there is no branch to commit or push");
    const { agent, repo } = await this.prepareRestart(session);
    const { work } = await readWorkStatus(repo.path, session.worktreePath);
    if (!SHIPPABLE_WORK.includes(work.state)) throw new SessionError(409, `there is nothing to ship (${work.state})`);
    // Asked now, never taken from a status the UI holds: only an opted-in project, and only provably docs-only work.
    const autoMerge = repo.agent?.autoMergeDocs === true && (await shipsOnlyOpenSpec(session.worktreePath, await baseRef(repo.path)));
    const record = this.recordInstruction(repo.id, session.change, session.action);
    const prompt = shipPrompt(agent, session.change, { autoMerge, convention: repo.prTitleConvention, record });
    this.forgetWorktrees();
    const proc = this.live.get(id)?.proc;
    if (session.state === "running" && proc) {
      if (autoMerge) this.askedForAutoMerge(session);
      const { submitted } = await this.submit(id, prompt);
      this.report(session, { kind: "session-shipped", submitted });
      return { ...session, submitted, autoMerge };
    }
    const launch = agent.resumeCommand ? { argv: [...agent.resumeCommand], typed: prompt } : launchCommand(agent, prompt);
    if (!Bun.which(launch.argv[0])) throw new SessionError(503, `${agent.name} was not found (${launch.argv[0]})`);
    if (autoMerge) session.autoMergeAskedAt = new Date().toISOString(); // saved by `restart`
    await this.restart(session, repo.path, launch.argv, agentEnv(agent, process.env), launch.typed);
    this.report(session, { kind: "session-shipped", submitted: true });
    // Handed to a starting agent (as its argument, or submitted once it has started); the terminal shows how that went.
    return { ...session, submitted: true, autoMerge };
  }

  /**
   * Asks the agent to make its branch merge into the base again (design D3). Deliberately shaped like `ship()` rather
   * than sharing a helper with it: both are load-bearing, their refusals are specified one by one, and fifteen
   * duplicated lines are cheaper to review than a parameterised abstraction over two callers.
   *
   * The dashboard resolves nothing itself — it merges, rebases, checks out, commits and pushes nothing. It hands over
   * a prompt; the agent works under its own permission prompts.
   */
  async resolveConflicts(id: string, pullRequests?: RepoPullRequests): Promise<PromptResult> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(409, notAChange(session));
    if (session.inPlace) throw new SessionError(400, "this session runs in a folder that is not a git repository — there is no branch to merge");
    const { agent, repo } = await this.prepareRestart(session);
    // Re-read rather than trust the snapshot: the base or the branch may have moved since the user saw the badge.
    const { work, branch } = await readWorkStatus(repo.path, session.worktreePath);
    const pr = this.openPullRequestOf(session.repoId, session.change, pullRequests);
    // The pull request's own branch or nothing: an agent on another branch would push its fix where no pull request is.
    const onBranch = branch ?? session.branch;
    if (pr && onBranch !== pr.head) throw new SessionError(409, `this session works on ${onBranch ?? "no branch"}, but pull request #${pr.number} is on ${pr.head}`);
    const signal = conflictSignal([{ branch: onBranch, work, head: await headCommit(session.worktreePath) }], pr, pullRequests?.fetchedAt);
    if (!signal) throw new SessionError(409, `this branch has no conflicts to resolve (${work.state}${pr ? `, and GitHub reports #${pr.number} as ${pr.mergeable ?? "unknown"}` : ""})`);
    const prompt = resolveConflictsPrompt(agent, session.change, pr);
    this.forgetWorktrees();
    const proc = this.live.get(id)?.proc;
    if (session.state === "running" && proc) {
      const { submitted } = await this.submit(id, prompt);
      this.report(session, { kind: "session-conflicts-resolve", submitted });
      return { ...session, submitted };
    }
    const launch = agent.resumeCommand ? { argv: [...agent.resumeCommand], typed: prompt } : launchCommand(agent, prompt);
    if (!Bun.which(launch.argv[0])) throw new SessionError(503, `${agent.name} was not found (${launch.argv[0]})`);
    await this.restart(session, repo.path, launch.argv, agentEnv(agent, process.env), launch.typed);
    this.report(session, { kind: "session-conflicts-resolve", submitted: true });
    return { ...session, submitted: true };
  }

  /** The change's linked pull request when it is open, by the shared link rule, from the server's own list only. */
  private openPullRequestOf(repoId: string, change: string, pullRequests: RepoPullRequests | undefined): PullRequest | undefined {
    const snapshot = this.deps
      .getSnapshot()
      .repos.find((r) => r.id === repoId)
      ?.changes.find((c) => c.name === change && !c.archived);
    if (!snapshot || !pullRequests || pullRequests.repoId !== repoId) return undefined;
    const pr = linkedPullRequest(snapshot, [pullRequests]);
    return pr?.state === "open" ? pr : undefined;
  }

  /**
   * Resolve conflicts for a change, decided before anything is created (resolve-pr-conflicts D2): into the change's
   * running session or its session worktree when that is on the pull request's head branch, else in a new worktree on
   * that head branch. The branch, number and base come from the cached list through the shared link rule; nothing in the
   * request can choose them. The dashboard fetches nothing and runs no `gh` for it.
   */
  private async openToResolve(repoId: unknown, change: string, pullRequests: RepoPullRequests | undefined): Promise<StartResult> {
    const config = this.deps.getConfig();
    const repo = config.repos.find((r) => r.id === repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repo.enabled) throw new SessionError(409, "the repository is not tracked");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    const scanned = this.deps.getSnapshot().repos.find((r) => r.id === repo.id);
    if (!scanned?.ok) throw new SessionError(409, "the repository's last scan failed");
    if (isCleaningUp(repo.id)) throw new SessionError(409, "a cleanup of this repository is running");
    if (isDismissing(repo.id, change)) throw new SessionError(409, "this change is being dismissed");
    const snapshot = scanned.changes.find((c) => c.name === change && !c.archived);
    if (!snapshot) throw new SessionError(404, "unknown change");
    if (scanned.isGit === false || scanned.noCommit === true) throw new SessionError(409, "this repository's sessions run in its folder, with no branch to resolve conflicts on");

    const pr = this.openPullRequestOf(repo.id, change, pullRequests);
    const sessions = changeSessions(this.list()).filter((s) => s.repoId === repo.id && s.change === change && !s.inPlace);
    // A proposal session may run beside the implementation's: the one on the pull request's branch comes first.
    const open = sessions.filter((s) => OPEN_SESSION_STATES.includes(s.state));
    const running = open.find((s) => pr !== undefined && s.branch === pr.head) ?? open[0];
    const trees = await this.changeTrees(repo, change, sessions);
    const signal = conflictSignal(trees, pr, pullRequests?.fetchedAt);
    if (!signal) throw new SessionError(409, `there are no conflicts to resolve for this change${pr ? ` (GitHub reports #${pr.number} as ${pr.mergeable ?? "unknown"})` : ""}`);

    // One session per change: a running one is where the prompt goes, if it is on the right branch.
    if (running) {
      const tree = trees.find((t) => t.path === running.worktreePath);
      const branch = tree?.branch ?? running.branch;
      if (pr && branch !== pr.head) throw new SessionError(409, `a session for this change is running on ${branch ?? "no branch"}, not on ${pr.head}, the branch of pull request #${pr.number}`);
      return { ...(await this.resolveConflicts(running.id, pullRequests)), autoMerge: false };
    }
    // An existing worktree on the right branch: the latest session in it is started again there, as Ship would.
    const recorded = signal.worktree && sessions.find((s) => s.worktreePath === signal.worktree?.path);
    if (recorded) return { ...(await this.resolveConflicts(recorded.id, pullRequests)), autoMerge: false };
    if (!pr || !signal.github) throw new SessionError(409, "there are no conflicts to resolve for this change");
    return this.startOnHeadBranch(repo, scanned, snapshot, pr, signal.worktree?.path);
  }

  /** The change's session worktrees as they are now — both names, plus any adopted one a session records — read-only. */
  private async changeTrees(repo: RepoConfig, change: string, sessions: readonly ChangeSession[]) {
    const paths = new Set([join(worktreesDir(), repo.id, worktreeName("implement", change)), join(worktreesDir(), repo.id, worktreeName("archive", change)), ...sessions.map((s) => s.worktreePath)]);
    const read = await Promise.all(
      [...paths].map(async (path) => {
        const { work, branch } = await readWorkStatus(repo.path, path);
        return work.state === "missing" ? undefined : { path, branch, work, head: await headCommit(path) };
      }),
    );
    return read.filter((t) => t !== undefined);
  }

  /** A new session for the change on its open pull request's head branch: a worktree created or adopted, nothing else. */
  private async startOnHeadBranch(repo: RepoConfig, scanned: RepoSnapshot, snapshot: ChangeSnapshot, pr: PullRequest, existing: string | undefined): Promise<StartResult> {
    const change = snapshot.name;
    const head = pr.head;
    // A missing answer refuses like a fork: refusing is safe until the next refresh says otherwise (design D4).
    if (pr.isCrossRepository !== false) throw new SessionError(409, `pull request #${pr.number} cannot be resolved here: its branch is in a fork`);
    if (!isBranchName(head)) throw new SessionError(409, `pull request #${pr.number} names a head branch the dashboard does not check out`);
    const defaults = scanned.defaultBranch ?? (await defaultBranch(repo.path));
    if (head === defaults) throw new SessionError(409, `pull request #${pr.number} is from ${head}, the default branch`);
    if (head === (await currentBranch(repo.path))) throw new SessionError(409, `${head} is checked out in the main checkout, which the dashboard never switches; resolve it there`);
    // A worktree already on the head branch whose session record is gone is used as it is, under its own name.
    const action: SessionAction = existing ? (existing === join(worktreesDir(), repo.id, worktreeName("archive", change)) ? "archive" : "implement") : head === sessionBranch("archive", change) ? "archive" : "implement";
    const path = existing ?? join(worktreesDir(), repo.id, worktreeName(action, change));
    // The worktree for that action exists but is on another branch: the user removes it or works there.
    if (!existing && (await stat(path).catch(() => undefined))) {
      const { branch } = await readWorkStatus(repo.path, path);
      throw new SessionError(409, `the worktree ${path} is on ${branch ?? "no branch"}, not on ${head}; remove it or resolve the conflicts there`);
    }

    const config = this.deps.getConfig();
    const agent = agentFor(config, repo);
    if (!agent) throw new SessionError(503, "no agent is configured");
    const prompt = resolveConflictsPrompt(agent, change, pr);
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);

    const now = new Date().toISOString();
    const session: ChangeSession = {
      id: randomUUID(),
      repoId: repo.id,
      change,
      action,
      agentId: agent.id,
      agentName: agent.name,
      state: "running",
      worktreePath: path,
      branch: head,
      pullRequest: pr.number,
      createdAt: now,
      updatedAt: now,
      resumable: agent.resumeCommand !== undefined,
    };
    try {
      // Checked out in a worktree made outside the dashboard, with no session in it: the session works there.
      const elsewhere = await linkedWorktreeOf(repo.path, head);
      if (elsewhere && elsewhere !== path) {
        if (this.runningInFolder(elsewhere).length > 0) throw new SessionError(409, `another session is running in ${elsewhere}, where ${head} is checked out`);
        session.worktreePath = elsewhere;
        session.adopted = true;
      } else {
        await ensureWorktree(repo.path, path, head, { fromRemote: true });
      }
      await copyChangeIfMissing(snapshot.checkout?.path ?? repo.path, session.worktreePath, change);
    } catch (err) {
      if (err instanceof SessionError) throw err;
      throw new SessionError(err instanceof NoCommitError || err instanceof UnknownBranchError ? 409 : 500, err instanceof Error ? err.message : String(err));
    }
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    const launch = launchCommand(agent, prompt);
    this.start(session, launch.argv, agentEnv(agent, process.env), launch.typed);
    if (session.state === "running") {
      this.report(session, { kind: "session-started", action, agentName: session.agentName });
      this.report(session, { kind: "session-conflicts-resolve", submitted: true });
    }
    this.forgetWorktrees();
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { ...session, autoMerge: false };
  }

  /**
   * The next step of a change, in the session that is already running for it: the starter's prompt is submitted to the
   * terminal under the rules for text sent on the user's behalf — typed, then Enter as a separate key press only once
   * the agent has shown the text, so a selection menu is never confirmed.
   *
   * Every action the change's stage allows may be sent, Archive included — it is how a completed change is archived
   * without ending the agent that worked on it — and the action the session was started with restricts nothing. The
   * prompt runs where that session runs: the change's own worktree, or the folder itself for a repository without
   * git. Nothing is created and no git command that writes runs for it — only Archive's read-only docs-only check, in
   * a project with Docs auto-merge on; what the agent then does there is the agent's own doing.
   */
  async prompt(id: string, input: { action?: unknown }): Promise<AutoMergePromptResult> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(409, notAChange(session));
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    if (!SESSION_ACTIONS.includes(input.action as SessionAction)) throw new SessionError(400, "unknown action");
    const action = input.action as SessionAction;
    const proc = this.live.get(id)?.proc;
    if (session.state !== "running" || !proc) throw new SessionError(409, "the session is not running");
    const change = this.deps
      .getSnapshot()
      .repos.find((r) => r.id === session.repoId)
      ?.changes.find((c) => c.name === session.change && !c.archived);
    if (!change) throw new SessionError(404, "unknown change");
    const heldBack = action === "implement" ? blockedReason(change) : action === "fastForward" ? blockedReason(change, "Fast-forward") : action === "draft" ? pastDraftingReason(change) : undefined;
    if (heldBack) throw new SessionError(400, heldBack);
    if (!availableActions(change).includes(action)) throw new SessionError(400, `"${action}" is not available for this change in its current stage`);
    const agent = config.agentSessions.agents.find((a) => a.id === session.agentId);
    if (!agent || !openingPrompt(agent, action, session.change)) throw new SessionError(400, `${session.agentName} has no "${action}" prompt configured`);
    // The proposal's session drafts and nothing else: implementing there would put code into the proposal pull request.
    if (action !== "draft" && isProposalSession(session)) throw new SessionError(409, `this session drafts the proposal on ${session.branch}; start "${action}" as a session of its own`);
    // Archive sent here runs where this session runs — often an Implement worktree with code in it, which the check sees.
    const repo = config.repos.find((r) => r.id === session.repoId);
    const autoMerge = repo !== undefined && (await this.docsAutoMerge(repo, session, action));
    const record = this.recordInstruction(session.repoId, session.change, action);
    const text = openingPrompt(agent, action, session.change, { autoMerge, proposal: autoMerge, convention: repo?.prTitleConvention, record }) as string;
    // The recorded action is what the user asked for, whether or not the agent's terminal echoed the prompt in time.
    session.action = action;
    if (autoMerge) session.autoMergeAskedAt = new Date().toISOString();
    this.touchLater(session);
    const { submitted } = await this.submit(id, text);
    return { ...session, submitted, autoMerge };
  }

  /** Records that this session's prompt just carried the docs auto-merge instruction (auto-merge-cleanup D1); the latest wins. */
  private askedForAutoMerge(session: ChangeSession): void {
    session.autoMergeAskedAt = new Date().toISOString();
    this.touchLater(session);
  }

  /**
   * A pull-request query for `repoId` has completed: every session of that repository whose prompt carried the docs
   * auto-merge instruction and whose pull request the list shows merged since is ended, and its worktree removed under the same
   * checks as the end-session dialog (auto-merge-cleanup D3, D4). Decided from the list and read-only git only — no
   * query, no fetch, and the branch is kept for repository cleanup. Once a session carries `autoEnded` it never
   * matches again, so seeing the same merged pull request twice changes nothing.
   */
  async endMergedAutoMerge(repoId: string, pullRequests: readonly PullRequest[]): Promise<void> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) return;
    const repo = config.repos.find((r) => r.id === repoId);
    if (repo?.agent?.autoMergeDocs !== true) return;
    for (const session of changeSessions(this.list())) {
      if (session.repoId !== repoId || session.inPlace || session.adopted || !session.autoMergeAskedAt || session.autoEnded || this.autoEnding.has(session.id)) continue;
      const askedAt = Date.parse(session.autoMergeAskedAt);
      const merged = pullRequests.find((pr) => pr.state === "merged" && pr.head === session.branch && pr.mergedAt !== undefined && Date.parse(pr.mergedAt) > askedAt);
      if (!merged) continue;
      // Taken before the first await, so a second query settling meanwhile cannot end the same session again.
      this.autoEnding.add(session.id);
      try {
        // Nothing left to end or remove: the user already ended the session and removed its worktree.
        if (session.state !== "running" && !(await stat(session.worktreePath).catch(() => undefined))) continue;
        const { worktree } = await this.close(session.id, { removeWorktree: true });
        const gone = worktree?.reason === "worktree no longer exists";
        const removed = worktree?.removable === true || gone;
        session.autoEnded = { pr: merged.number, at: new Date().toISOString(), removed, ...(removed || !worktree?.reason ? {} : { reason: worktree.reason }) };
        await this.touch(session);
        this.report(session, { kind: "session-auto-ended", pr: merged.number, removed, ...(session.autoEnded.reason ? { reason: session.autoEnded.reason } : {}) });
      } finally {
        this.autoEnding.delete(session.id);
      }
    }
  }

  /**
   * Asks the agent to merge its session's ready pull request (agent-merges-docs-prs D1, D4): the third prompt-only
   * action, next to Ship and Resolve conflicts, offered with or without docs auto-merge. `pullRequests` is the
   * repository's last good list as the server holds it — the number and the head commit come from there, never from
   * the request. The dashboard merges nothing, runs no `gh` or git and starts no agent for it: an ended session is
   * resumed by the user first. Whether the pull request merged is learned only from a later query.
   */
  async merge(id: string, pullRequests: readonly PullRequest[]): Promise<PromptResult> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(409, notAChange(session));
    if (session.inPlace) throw new SessionError(400, "this session runs in a folder that is not a git repository — there is no pull request to merge");
    const { agent } = this.prepareAgainAnywhere(session);
    if (session.state !== "running" || !this.live.get(id)?.proc) throw new SessionError(409, "the session is not running; resume it to merge");
    const pr = pullRequests.find((p) => p.state === "open" && p.head === session.branch);
    if (!pr) throw new SessionError(409, "this session's branch has no open pull request in the last pull-request list");
    const readiness = pullRequestReadiness(pr);
    if (!readiness?.ready) throw new SessionError(409, `pull request #${pr.number} is not ready to merge (${readiness ? readinessDetail(readiness) : "unknown"})`);
    if (!pr.headOid) throw new SessionError(409, `the pull-request list names no head commit for #${pr.number}; refresh it first`);
    const prompt = mergePrompt(agent, session.change, { pr: pr.number, head: pr.headOid });
    return this.sendMerge(session, prompt, { pr: pr.number, head: pr.headOid, by: "user" });
  }

  /**
   * Records the Merge prompt before anything is typed, then submits it and reports what came of it. The record is what
   * keeps a second query from sending it again and keeps the board watching until the pull request merges or moves.
   */
  private async sendMerge(session: ChangeSession, prompt: string, target: Pick<MergeAsked, "pr" | "head" | "by">): Promise<PromptResult> {
    const asked: MergeAsked = { ...target, at: new Date().toISOString(), submitted: false };
    session.mergeAsked = asked;
    await this.touch(session);
    const { submitted } = await this.submit(session.id, prompt).catch(() => ({ submitted: false }));
    if (session.mergeAsked === asked) {
      asked.submitted = submitted;
      this.touchLater(session);
    }
    this.report(session, { kind: "session-merge", pr: target.pr, by: target.by, submitted });
    return { ...session, submitted };
  }

  /**
   * A pull-request query for `repoId` has completed with a good list: each running session whose agent was given the
   * docs auto-merge instruction, and whose open pull request is ready, docs-only and at the commit its worktree has
   * checked out — a worktree that holds only OpenSpec documents — is sent the Merge prompt, once per pull request and
   * head commit (agent-merges-docs-prs D3, D4). Decided from the list and read-only git only: no query, no fetch, no
   * timer, and no agent is started, resumed or restarted for it.
   */
  async requestReadyMerges(repoId: string, pullRequests: readonly PullRequest[]): Promise<void> {
    const enabled = () => {
      const config = this.deps.getConfig();
      const repo = config.repos.find((r) => r.id === repoId);
      return config.agentSessions.enabled && repo?.agent?.autoMergeDocs === true ? { config, repo } : undefined;
    };
    if (!enabled()) return;
    const askedFor = (session: ChangeSession, pr: PullRequest) => session.mergeAsked?.pr === pr.number && session.mergeAsked.head === pr.headOid;
    for (const session of changeSessions(this.list())) {
      if (session.repoId !== repoId || session.inPlace || session.adopted || !session.autoMergeAskedAt || session.autoEnded || session.action === "fastForward") continue;
      if (session.state !== "running" || !this.live.get(session.id)?.proc || this.merging.has(session.id)) continue;
      const pr = pullRequests.find((p) => p.state === "open" && p.head === session.branch);
      if (!pr || !mergeReady(pr) || askedFor(session, pr)) continue;
      // Taken before the first await, so a second query settling meanwhile cannot send the same prompt again.
      this.merging.add(session.id);
      try {
        const now = enabled();
        if (!now) continue;
        if (pr.base !== (await defaultBranch(now.repo.path))) continue;
        // GitHub's file list loses the source side of a rename: the worktree, at exactly that commit, has the last word.
        if ((await headCommit(session.worktreePath)) !== pr.headOid) continue;
        if (!(await shipsOnlyOpenSpec(session.worktreePath, await baseRef(now.repo.path)))) continue;
        const agent = this.deps.getConfig().agentSessions.agents.find((a) => a.id === session.agentId);
        if (!agent || !enabled() || session.state !== "running" || !this.live.get(session.id)?.proc || askedFor(session, pr)) continue;
        const prompt = mergePrompt(agent, session.change, { pr: pr.number, head: pr.headOid as string });
        await this.sendMerge(session, prompt, { pr: pr.number, head: pr.headOid as string, by: "dashboard" });
      } finally {
        this.merging.delete(session.id);
      }
    }
  }

  /** For worktrees whose session record is gone; the path is built here, never taken from the request. */
  async removeWorktreeByName(input: { repoId?: unknown; name?: unknown }): Promise<Removable> {
    if (typeof input.name !== "string" || !WORKTREE_NAME.test(input.name)) throw new SessionError(400, "invalid worktree name");
    const repo = this.deps.getConfig().repos.find((r) => r.id === input.repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    const path = join(worktreesDir(), repo.id, input.name);
    if (this.list().some((s) => s.worktreePath === path && s.state === "running")) throw new SessionError(409, "a session is running in this worktree");
    const { work } = await readWorkStatus(repo.path, path);
    if (work.state === "missing") throw new SessionError(404, "unknown worktree");
    this.forgetWorktrees();
    return removeWorktree(repo.path, path, work.state === "merged");
  }

  /** Continues the agent's latest conversation in the session's worktree, in the same session record. */
  async resume(id: string): Promise<Session> {
    const session = this.get(id);
    if (session.state === "running") return session;
    const { agent, repoPath } = isConsole(session)
      ? { ...(await this.prepareConsoleRestart(session)), repoPath: undefined }
      : isIntegration(session)
        ? { ...this.prepareIntegrationRestart(session), repoPath: undefined }
        : isProjectConsole(session)
          ? { ...(await this.prepareProjectConsoleRestart(session)), repoPath: undefined }
          : await this.prepareRestart(session).then(({ agent, repo }) => ({ agent, repoPath: repo.path }));
    if (!agent.resumeCommand) throw new SessionError(400, "this agent has no resume command configured");
    if (!Bun.which(agent.resumeCommand[0])) throw new SessionError(503, `${agent.name} was not found (${agent.resumeCommand[0]})`);
    await this.restart(session, repoPath, [...agent.resumeCommand], agentEnv(agent, process.env));
    return session;
  }

  private start(session: Session, argv: string[], env: Record<string, string>, typed?: string): void {
    const live: Live = { scrollback: this.live.get(session.id)?.scrollback ?? new Scrollback(), viewers: this.live.get(session.id)?.viewers ?? new Set(), lastStamp: 0, startedAt: 0, echoUntil: 0, lastUserInputAt: 0 };
    // A report never outlives the process that wrote it: whatever an earlier run left is gone before this one starts.
    const stateFile = this.store.statePath(session.id);
    rmSync(stateFile, { force: true });
    delete session.waitingReportedAt;
    env = { ...env, [STATE_FILE_ENV]: stateFile };
    live.startedAt = Date.now();
    this.live.set(session.id, live);
    let proc: TerminalProcess;
    try {
      proc = spawnTerminal({ argv, cwd: session.worktreePath, env, onData: (chunk) => this.onOutput(session, live, chunk) });
    } catch (err) {
      session.state = "failed";
      session.error = `could not start the agent: ${err instanceof Error ? err.message : String(err)}`;
      this.touchLater(session);
      this.report(session, { kind: "session-ended", error: session.error });
      this.runningChanged();
      return;
    }
    live.proc = proc;
    this.runningChanged();
    if (typed) {
      // Submitted, not written blind: an agent that opens with a dialog instead of a prompt must not get an Enter.
      const timer = setTimeout(() => live.proc === proc && void this.submit(session.id, typed).catch(() => {}), this.deps.typePromptDelayMs ?? TYPE_PROMPT_DELAY_MS);
      (timer as { unref?: () => void }).unref?.();
    }
    void proc.exited.then((code) => {
      if (live.proc !== proc) return;
      live.proc = undefined;
      // Kept, not dropped: `state` turns `exited` before the record is written, so only this promise says when it is.
      // Best effort like `touchLater`: a failed write must not become an unhandled rejection.
      const ended = this.end(session, code).catch(() => undefined);
      this.ending.set(session.id, ended);
      void ended.then(() => this.ending.get(session.id) === ended && this.ending.delete(session.id));
    });
  }

  private onOutput(session: Session, live: Live, chunk: Uint8Array): void {
    live.scrollback.push(chunk);
    for (const viewer of live.viewers) viewer(chunk);
    const now = Date.now();
    if (now < live.echoUntil) return; // the agent answering a resize or input: shown, but not activity
    session.lastOutputAt = new Date(now).toISOString();
    if (now - live.lastStamp > OUTPUT_STAMP_MS) {
      live.lastStamp = now;
      this.touchLater(session);
    }
  }

  /** Output for the next moment is the agent answering what the dashboard just passed on (see `ECHO_WINDOW_MS`). */
  private expectEcho(live: Live, userInput: boolean): void {
    const now = Date.now();
    live.echoUntil = now + (this.deps.echoWindowMs ?? ECHO_WINDOW_MS);
    if (userInput) live.lastUserInputAt = now;
  }

  /**
   * Reads every running session's state file and sets `waitingReportedAt` while its report is a current `waiting` —
   * written after the process started and after the user's latest input. Run before the sessions are listed, so the
   * list is as fresh as its poll; nothing reads the files while nobody looks.
   */
  async readReports(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        const live = this.live.get(session.id);
        if (session.state !== "running" || !live?.proc) {
          delete session.waitingReportedAt;
          return;
        }
        const report = await readReport(this.store.statePath(session.id), live.report);
        live.report = report;
        const current = report && report.mtimeMs > live.startedAt && report.mtimeMs > live.lastUserInputAt ? report : undefined;
        live.current = current?.state;
        if (current?.state === "waiting") session.waitingReportedAt = new Date(current.mtimeMs).toISOString();
        else delete session.waitingReportedAt;
      }),
    );
  }

  private async end(session: Session, exitCode: number | null, error?: string): Promise<void> {
    session.state = "exited";
    delete session.waitingReportedAt;
    this.runningChanged();
    session.exitCode = exitCode;
    if (error) session.error = error;
    this.forgetWorktrees();
    const live = this.live.get(session.id);
    if (live) await this.store.saveOutput(session.id, live.scrollback.bytes()).catch(() => undefined);
    await this.touch(session);
    if (!this.autoEnding.has(session.id)) this.report(session, { kind: "session-ended", ...(exitCode === null ? {} : { exitCode }), ...(error ? { error } : {}) });
    if (isIntegration(session)) {
      try {
        this.deps.onIntegrationEnded?.(session);
      } catch {
        // re-checking the marker is best effort; discovery checks it again anyway
      }
    }
    for (const viewer of live?.viewers ?? []) viewer(new Uint8Array()); // an empty chunk tells viewers the process ended
  }

  /** Whether any session runs at all: keep-awake's periodic evaluation exists only while one does. */
  anyRunning(): boolean {
    return this.list().some((s) => s.state === "running" && this.live.get(s.id)?.proc !== undefined);
  }

  /**
   * How many sessions are busy at `now` (openspec/specs/keep-awake): every kind counts, and only the time of the last
   * output that counts as activity and the agent's current report decide — never what the agent printed.
   */
  busyCount(now = Date.now()): number {
    return this.list().filter((session) => {
      const live = this.live.get(session.id);
      const lastOutputAt = session.lastOutputAt === undefined ? undefined : Date.parse(session.lastOutputAt);
      return isBusy({ running: session.state === "running" && live?.proc !== undefined, lastOutputAt, current: live?.current }, now);
    }).length;
  }

  private runningChanged(): void {
    try {
      this.deps.onRunningChanged?.();
    } catch {
      // keep-awake is a convenience; it must never get in a session's way
    }
  }

  /** The activity log is about changes; the consoles and integrations belong to none, so none of them is reported. */
  private report(session: Session, activity: SessionActivity): void {
    if (isChangeless(session)) return;
    try {
      this.deps.onActivity?.(session, activity);
    } catch {
      // the feed is history only; it must never get in a session's way
    }
  }

  /**
   * Attaches a viewer: returns what the terminal has shown so far and then streams new output. For an ended session
   * the stored tail is returned and nothing follows.
   */
  async attach(id: string, viewer: Viewer): Promise<{ scrollback: Uint8Array; detach: () => void }> {
    const session = this.get(id);
    const live = this.live.get(id);
    if (!live) return { scrollback: await this.store.readOutput(session.id), detach: () => {} };
    live.viewers.add(viewer);
    return { scrollback: live.scrollback.bytes(), detach: () => live.viewers.delete(viewer) };
  }

  /** Keystrokes from a viewer. Input that is only the terminal's own replies (focus, cursor reports) is not the user's. */
  write(id: string, data: string): void {
    const live = this.live.get(id);
    if (!live?.proc) return;
    this.expectEcho(live, !terminalRepliesOnly(data));
    live.proc.write(data);
  }

  /**
   * Sends text on the user's behalf: typed, and submitted with a separate Enter only once the agent's terminal has
   * shown it (see submit.ts). Keystrokes never come through here — they go through `write`, unobserved.
   */
  submit(id: string, text: unknown): Promise<{ submitted: boolean }> {
    const session = this.get(id);
    if (!validSubmission(text)) throw new SessionError(400, "only plain text of at most 4096 characters can be submitted");
    const live = this.live.get(id);
    const proc = live?.proc;
    if (session.state !== "running" || !live || !proc) throw new SessionError(409, "the session is not running");
    const run = async () => {
      if (live.proc !== proc) return { submitted: false };
      return submitText(
        {
          write: (data) => {
            if (live.proc !== proc) return;
            this.expectEcho(live, true);
            proc.write(data);
          },
          onOutput: (listener) => {
            live.viewers.add(listener);
            return () => live.viewers.delete(listener);
          },
        },
        text,
        this.deps.submitTimings,
      );
    };
    const result = (live.submitting ?? Promise.resolve()).then(run, run);
    live.submitting = result.catch(() => {});
    return result;
  }

  /** Follows a viewer's size. The redraw it provokes is not activity, and a resize is never the user answering. */
  resize(id: string, cols: number, rows: number): void {
    const live = this.live.get(id);
    if (!live?.proc) return;
    this.expectEcho(live, false);
    live.proc.resize(cols, rows);
  }

  /** Ends the agent (as closing its terminal window would) and optionally removes the worktree when that is safe. */
  async close(id: string, options: { removeWorktree?: boolean } = {}): Promise<{ session: Session; worktree?: Removable }> {
    const session = this.get(id);
    const proc = this.live.get(id)?.proc;
    if (proc) {
      proc.kill();
      await proc.exited;
      // `end` runs from the exit handler; wait for the state it writes
      for (let i = 0; i < 50 && session.state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
      await this.ending.get(id);
    }
    let worktree: Removable | undefined;
    if (isChangeless(session)) {
      // None has a worktree of its own: ending it ends the agent and nothing else.
    } else if (options.removeWorktree && session.adopted) {
      worktree = NOT_OURS;
    } else if (options.removeWorktree) {
      const repo = this.deps.getConfig().repos.find((r) => r.id === session.repoId);
      worktree = repo ? await removeWorktree(repo.path, session.worktreePath, await this.isMerged(repo.path, session)) : { removable: false, reason: "the repository is no longer configured" };
      this.forgetWorktrees();
    }
    return { session, worktree };
  }

  private async isMerged(repoPath: string, session: ChangeSession): Promise<boolean> {
    return (await readWorkStatus(repoPath, session.worktreePath)).work.state === "merged";
  }

  /** Read now, not from the list's cache: the end-session dialog warns on the strength of it. */
  async worktreeStatus(id: string): Promise<Removable & { work: WorkStatus }> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(409, notAChange(session));
    const repo = this.deps.getConfig().repos.find((r) => r.id === session.repoId);
    const work: WorkStatus = repo ? (await readWorkStatus(repo.path, session.worktreePath)).work : { state: "missing" };
    if (session.adopted) return { ...NOT_OURS, work };
    return { ...(await checkWorktreeRemovable(session.worktreePath, work.state === "merged")), work };
  }

  async remove(id: string): Promise<void> {
    const session = this.get(id);
    if (session.state === "running") throw new SessionError(409, "close the session first");
    await this.store.delete(id);
    this.sessions.delete(id);
    this.live.delete(id);
  }

  /** Dashboard shutdown: terminals cannot outlive it, so every agent is ended and its output tail kept. */
  async shutdown(): Promise<void> {
    await Promise.all(
      this.list()
        .filter((s) => s.state === "running")
        .map(async (session) => {
          const live = this.live.get(session.id);
          const proc = live?.proc;
          if (live) live.proc = undefined; // the exit handler must not overwrite the reason
          proc?.kill();
          await this.end(session, null, "the dashboard was stopped while this session was running");
        }),
    );
    // Nothing of ours may still be writing once shutdown has returned (the caller may remove the directory next) —
    // including an `end` an exit handler started, whose writes are queued only as it goes.
    await Promise.all(this.ending.values());
    await this.store.idle();
  }

  /**
   * Bookkeeping nobody waits for (the timestamp of the latest output, a recorded action). It is best effort: a failed
   * write must not surface as an unhandled rejection, which would take the whole dashboard down over a timestamp.
   * Anything that matters is saved by a caller that awaits `touch` and sees the error.
   */
  private touchLater(session: Session): void {
    void this.touch(session).catch(() => undefined);
  }

  private async touch(session: Session): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.store.saveMeta(session);
  }
}
