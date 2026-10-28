// Session manager (design.md D15–D17). A session is an agent CLI running in a terminal inside the change's own git
// worktree. The manager creates the worktree, starts the process, keeps a scrollback for late or returning viewers,
// fans output out to attached terminals and takes their input. It does not interpret what the agent prints.
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { blockedReason } from "../../shared/dependencies.ts";
import { availableActions, changeSessions, pastDraftingReason, isChangeless, isConsole, isIntegration, isProjectConsole, OPEN_SESSION_STATES, projectConsoleSessions, repoAgentEnabled, SESSION_ACTIONS, SHIPPABLE_WORK, type AgentAvailability, type AgentProfile, type ChangeSession, type Config, type ConsoleSession, type IntegrationSession, type ProjectConsoleLike, type ProjectConsoleSession, type ChangeSnapshot, type RepoPullRequests, type RepoSnapshot, type Session, type SessionAction, type SessionWorktree, type Snapshot, type WorkStatus, type MergeAsked, type PromptResult, type PullRequest, type RepoConfig, type ShipResult, type AutoMergePromptResult, type StartResult } from "../../shared/types.ts";
import { isEndedProposalSession, isProposalSession, proposalBranch, receivingSession, runningProposalSession, sessionBranch } from "../../shared/sessionBranch.ts";
import { isBranchName, isCleaningUp } from "../cleanup.ts";
import { isDismissing } from "../dismissChange.ts";
import { canonicalPath, worktreesDir } from "../paths.ts";
import { CHANGE_NAME } from "../source.ts";
import { agentEnv, agentFor, availability, carryOverPrompt, consoleAgentOf, defaultAgentOf, presetAvailability, integratePrompt, launchCommand, launchWithoutPrompt, mergePrompt, openingPrompt, removeDuplicatePrompt, resolveConflictsPrompt, resumeLaunch, shipPrompt, typedForm, type Launch } from "./agents.ts";
import { consoleFolderProblem, prepareConsoleFolder } from "./consoleFolder.ts";
import { editorArgv, EditorError, editorCommand, editorFound, openEditor } from "./editor.ts";
import type { SessionActivity } from "../activity/events.ts";
import { isBusy } from "../keepAwake.ts";
import { readReport, STATE_FILE_ENV, terminalRepliesOnly, type Report, type ReportedState } from "./reportedState.ts";
import { SessionStore } from "./store.ts";
import { submitText, validSubmission, type SubmitOptions } from "./submit.ts";
import { KILL_GRACE_MS, spawnTerminal, type TerminalProcess } from "./terminal.ts";
import { baseRef, headCommit, listWorktrees, readWorkStatus, shipsOnlyOpenSpec, WORKTREE_NAME } from "./workStatus.ts";
import { currentBranch, defaultBranch, hasLocalBranch, worktrees as listCheckouts } from "../git.ts";
import { frameworkById } from "../frameworks/registry.ts";
import { conflictSignal } from "../../shared/conflictSignal.ts";
import { linkedPullRequest } from "../../shared/pullRequestLink.ts";
import { mergeReady, pullRequestReadiness, readinessDetail } from "../../shared/pullRequestReadiness.ts";
import { checkWorktreeRemovable, copyChangeIfMissing, ensureWorktree, implementStartPoint, linkedWorktreeOf, NoCommitError, removeWorktree, UnknownBranchError, WorktreeMismatchError, type Removable } from "./worktree.ts";

export const SCROLLBACK_BYTES = 1024 * 1024;
const TYPE_PROMPT_DELAY_MS = 1500;
const OUTPUT_STAMP_MS = 5000;
/**
 * How long output after a resize or after input the dashboard passed on is taken for the agent answering it — a redraw,
 * an echo — rather than for work: relayed and kept, but not stamped as the last output (agent-sessions spec, at most 3 s).
 */
export const ECHO_WINDOW_MS = 2000;
const WORKTREES_TTL_MS = 15_000;
/** How long shutdown waits for an agent it sent `SIGKILL` before reporting it and going on. */
const FORCED_EXIT_WAIT_MS = 1000;

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

/** The steps that may end a running proposal session to start: never Draft, which goes into it, and never Fast-forward. */
const ENDS_PROPOSAL: readonly SessionAction[] = ["implement", "validate", "archive"];

const NOT_A_CHANGE = "this is the main console, which belongs to no change";
const NOT_A_CHANGE_INTEGRATING = "this session is setting a repository up for OpenSpec, so it belongs to no change";
const NOT_A_CHANGE_PROJECT = "this is the project's console, which belongs to no change";
const notAChange = (session: Session) => (isIntegration(session) ? NOT_A_CHANGE_INTEGRATING : isProjectConsole(session) ? NOT_A_CHANGE_PROJECT : NOT_A_CHANGE);

/** An adopted worktree was created outside the dashboard; removing it is its owner's call, however clean it is. */
const NOT_OURS: Removable = { removable: false, reason: "this worktree was not created by the dashboard (the session adopted it), so it is kept" };

/** Another session works in the worktree being removed: it is kept, however clean it is (harden-session-lifecycle D4). */
const RUNNING_HERE: Removable = { removable: false, reason: "a session is running in this worktree" };

/**
 * The one-line form of a prompt the dashboard types, checked against the rules for submitted text before anything is
 * started, restarted or recorded for it (harden-session-lifecycle D1). A prompt that cannot be typed refuses the request.
 */
function typable(prompt: string): string {
  const typed = typedForm(prompt);
  if (validSubmission(typed as unknown)) return typed;
  const why = typed.length > 4096 ? `it is ${typed.length} characters long as one line, and at most 4096 can be typed` : typed.length === 0 ? "it is empty" : "it holds a control character";
  throw new SessionError(400, `the prompt cannot be typed into the agent's terminal: ${why}`);
}

/** How a prompt reaches the agent — as an argument, or typed after start-up through `resume` or a command without `{prompt}`. */
function checkedLaunch(agent: AgentProfile, prompt: string, resume?: string[]): Launch {
  const launch = resume ? { argv: resume, typed: prompt } : launchCommand(agent, prompt);
  return launch.typed === undefined ? launch : { ...launch, typed: typable(launch.typed) };
}

/** Whether `path` is `folder` or lies inside it; both canonical. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);
}

/** A running session as a refusal names it. */
function describeSession(session: Session): string {
  if (isConsole(session)) return "the main console";
  if (isIntegration(session)) return `the integration of ${session.folder}`;
  if (isProjectConsole(session)) return "the project's console";
  return `a session for the change ${session.change}`;
}

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
  /** Per `repoId` and change, the tail of its starts and worktree removals: one at a time (harden-session-lifecycle D3). */
  private changeLocks = new Map<string, Promise<unknown>>();

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

  /**
   * Records that an integration session's folder was confirmed and saves it. Returns false when it already was, or the
   * session is unknown: each integration session confirms its folder at most once.
   */
  async recordIntegrationConfirmed(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || !isIntegration(session) || session.confirmedAt !== undefined) return false;
    session.confirmedAt = new Date().toISOString();
    await this.touch(session);
    return true;
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
  open(input: { repoId?: unknown; change?: unknown; action?: unknown; carryOver?: unknown; removeDuplicate?: unknown; resolveConflicts?: unknown; endProposal?: unknown }, pullRequests?: RepoPullRequests): Promise<StartResult> {
    // Taken before anything is awaited; every check runs inside it, so a second open finds the session the first started.
    return this.withChangeLock(input.repoId, input.change, () => this.openNow(input, pullRequests));
  }

  /**
   * Runs `run` once every start or worktree removal of the same change that began earlier has settled (D3). Not
   * re-entrant: what runs inside calls the `…Now` variants. A rejection releases the lock like a result.
   */
  private withChangeLock<T>(repoId: unknown, change: unknown, run: () => Promise<T>): Promise<T> {
    const key = `${String(repoId)}\0${String(change)}`;
    const result = (this.changeLocks.get(key) ?? Promise.resolve()).then(run, run);
    const tail = result.catch(() => undefined);
    this.changeLocks.set(key, tail);
    void tail.then(() => this.changeLocks.get(key) === tail && this.changeLocks.delete(key));
    return result;
  }

  /** `run` under the change lock of session `id` when it is a change session; any other kind runs as it is. */
  private lockedFor<T>(id: string, run: () => Promise<T>): Promise<T> {
    const session = this.sessions.get(id);
    return session && !isChangeless(session) ? this.withChangeLock(session.repoId, session.change, run) : run();
  }

  private async openNow(input: { repoId?: unknown; change?: unknown; action?: unknown; carryOver?: unknown; removeDuplicate?: unknown; resolveConflicts?: unknown; endProposal?: unknown }, pullRequests?: RepoPullRequests): Promise<StartResult> {
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
    // So is removing a duplicate after archive: the archive's missing half, a deletion under openspec/.
    const removeDuplicate = input.removeDuplicate === true;
    if (removeDuplicate && action !== "archive") throw new SessionError(400, "only an archive session can remove a duplicate after archive");
    if (removeDuplicate && carryOver) throw new SessionError(400, "carry over and remove duplicate are separate sessions");
    // Ending the proposal session first is only ever asked for explicitly, and only for the steps that follow a proposal.
    if (input.endProposal !== undefined && typeof input.endProposal !== "boolean") throw new SessionError(400, "endProposal must be a boolean");
    const endProposal = input.endProposal === true;
    if (endProposal && !ENDS_PROPOSAL.includes(action)) throw new SessionError(400, `"${action}" does not end the proposal session`);

    const repo = config.repos.find((r) => r.id === input.repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repo.enabled) throw new SessionError(409, "the repository is not tracked");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    const scanned = this.deps.getSnapshot().repos.find((r) => r.id === repo.id);
    if (!scanned?.ok) throw new SessionError(409, "the repository's last scan failed");
    if (isCleaningUp(repo.id)) throw new SessionError(409, "a cleanup of this repository is running");
    if (isDismissing(repo.id, change)) throw new SessionError(409, "this change is being dismissed");
    // A duplicate is usually shown as its archived card; it is the one card that may start a session.
    const snapshot = removeDuplicate ? scanned.changes.find((c) => c.name === change && c.duplicate) : scanned.changes.find((c) => c.name === change && !c.archived);
    if (removeDuplicate && !snapshot) throw new SessionError(409, "the last scan found no duplicate of this change next to its archive");
    if (!snapshot) throw new SessionError(404, "unknown change");
    // The archive directory and the differing paths come from this server's own scan, never from the request.
    const duplicate = removeDuplicate ? snapshot.duplicate : undefined;
    // The commit and branch come from this server's own scan, never from the request.
    const stranded = carryOver ? snapshot.strandedArchive : undefined;
    if (carryOver && !stranded) throw new SessionError(409, "the last scan found no archive of this change stranded on a branch");
    // Fast-forward implements too, so a blocked change is refused with the same named reason as Implement.
    const heldBack = action === "implement" ? blockedReason(snapshot) : action === "fastForward" ? blockedReason(snapshot, "Fast-forward") : action === "draft" && !stranded ? pastDraftingReason(snapshot) : undefined;
    if (heldBack) throw new SessionError(400, heldBack);
    // A stranded archive exists whatever the change's stage on the main checkout; that is the whole point of carrying it over.
    if (!stranded && !duplicate && !availableActions(snapshot).includes(action)) throw new SessionError(400, `"${action}" is not available for this change in its current stage`);

    // One open session per change, whatever the action: a change never has two consoles, and Archive is no exception.
    // Nothing is typed here — a starter for a change whose agent is up goes through `prompt`, which reports whether
    // the text was submitted; returning the session keeps a double-clicked starter from opening or typing anything
    // twice. `list()` is newest first, so a process that still holds two running sessions from before this rule
    // returns the one the user started last. In-place sessions need this as much as worktrees do: their working
    // directory is the repository folder itself, which no per-worktree rule would have kept a second agent out of.
    // A session drafting the proposal on its own branch takes only Draft: every other action is refused while it runs,
    // unless the request asks to end it first (one-console-per-change D1, D2).
    const existing = receivingSession(changeSessions(this.list()), repo.id, change, action);
    // Removing a duplicate starts fresh from the default branch: any open session for the change is refused instead.
    if (duplicate && this.list().some((s) => s.repoId === repo.id && s.change === change && OPEN_SESSION_STATES.includes(s.state))) {
      throw new SessionError(409, "a session for this change is running; end it first");
    }
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

    const layout = frameworkById(scanned.framework)?.layout;
    if (duplicate) {
      if (inPlace || !layout) throw new SessionError(409, "a duplicate after archive is removed on a branch of its own");
      await this.refuseOldArchiveBranch(repo.path, change);
    }

    const agent = agentFor(config, repo);
    if (!agent) throw new SessionError(503, "no agent is configured");
    const record = this.recordInstruction(repo.id, change, action);
    const fixedPrompt = (options: { autoMerge?: boolean; record?: string } = {}) =>
      stranded ? carryOverPrompt(change, stranded, scanned.defaultBranch, options) : duplicate && layout ? removeDuplicatePrompt(change, duplicate, layout, scanned.defaultBranch, options) : undefined;
    let prompt = fixedPrompt() ?? openingPrompt(agent, action, change, { convention: repo.prTitleConvention, record });
    if (!prompt) throw new SessionError(400, `${agent.name} has no "${action}" prompt configured`);
    if (!Bun.which(agent.command[0])) throw new SessionError(503, `${agent.name} was not found (${agent.command[0]}); install it or change its command in Settings`);
    // Every refusal above came first, so a refused request has ended nothing.
    await this.endProposalFirst(repo.id, change, action, endProposal);

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
          await ensureWorktree(repo.path, session.worktreePath, branch, { startPoint, verify: "branch" });
        }
        // The change may live only in some other worktree (on another branch), not in the main checkout. A duplicate is
        // on the default branch the worktree was made from; nothing is copied into it.
        if (!duplicate) await copyChangeIfMissing(snapshot.checkout?.path ?? repo.path, session.worktreePath, change);
      } catch (err) {
        throw new SessionError(err instanceof NoCommitError || err instanceof WorktreeMismatchError ? 409 : 500, err instanceof Error ? err.message : String(err));
      }
    }
    // Decided once the worktree exists, so a leftover archive branch with code in it is seen (archive-auto-merge-docs D4).
    const autoMerge = await this.docsAutoMerge(repo, session, action);
    if (autoMerge) {
      prompt = fixedPrompt({ autoMerge, record }) ?? (openingPrompt(agent, action, change, { autoMerge, proposal: autoMerge, convention: repo.prTitleConvention, record }) as string);
      session.autoMergeAskedAt = new Date().toISOString();
    }
    // Final only now: refused before the session is registered; a worktree just made stays, as any without a record.
    const launch = checkedLaunch(agent, prompt);
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
    this.start(session, launch.argv, agentEnv(agent, process.env), launch.typed);
    if (session.state === "running") this.report(session, { kind: "session-started", action, agentName: session.agentName });
    for (const removed of await this.store.prune(this.list())) this.sessions.delete(removed);
    return { ...session, autoMerge };
  }

  /**
   * A running proposal session keeps every other session of its change out (one-console-per-change D1). With the explicit
   * ask it is ended as End session ends it — its worktree and branch kept whatever their state, because its pull request
   * may still be open and its worktree is what the merge checks read (D2) — and the new session opens once it has ended.
   */
  private async endProposalFirst(repoId: string, change: string, action: SessionAction, endProposal: boolean): Promise<void> {
    const proposal = runningProposalSession(changeSessions(this.list()), repoId, change);
    if (!proposal) return;
    if (!endProposal) throw new SessionError(409, `the proposal of ${change} is being drafted on ${proposal.branch} in a running session; end it first, or start "${action}" from its console`);
    await this.close(proposal.id);
    if (this.get(proposal.id).state === "running") throw new SessionError(409, `the proposal session on ${proposal.branch} did not end; nothing was started`);
  }

  /**
   * A remove-duplicate session needs a fresh `chore/archive-<name>` from the default branch: an existing one, usually the
   * merged branch of the original archive, would be checked out as it is (remove-duplicate-archived-changes D3).
   */
  private async refuseOldArchiveBranch(repoPath: string, change: string): Promise<void> {
    const branch = sessionBranch("archive", change);
    const onIt = (await listCheckouts(repoPath)).some((w) => w.branch === branch);
    if (onIt || (await hasLocalBranch(repoPath, branch))) {
      throw new SessionError(409, `the branch ${branch} still exists; Clean up leftovers… removes it once it is merged`);
    }
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
    this.refuseConsoleFolderShared(prepared.folder.path);
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
    this.refuseAgentInOrBelow(folder);
    const agent = defaultAgentOf(config);
    if (!agent) throw new SessionError(503, "no agent is configured");
    const launch = checkedLaunch(agent, integratePrompt(agent));
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

  /**
   * The console never shares its folder (harden-session-lifecycle D7): refused while another agent runs in it, or an
   * integration runs in a folder that is or holds it — once that succeeds, the console would sit in a tracked repository.
   */
  private refuseConsoleFolderShared(folder: string, except?: string): void {
    const path = canonicalPath(folder);
    const other = this.list().find((s) => s.id !== except && s.state === "running" && !isConsole(s) && (canonicalPath(s.worktreePath) === path || (isIntegration(s) && within(path, canonicalPath(s.worktreePath)))));
    if (other) throw new SessionError(409, `${describeSession(other)} is running in the console folder; end it first`);
  }

  /** Integrate never shares a folder (D7): refused while any other session runs in `folder` or a folder inside it. */
  private refuseAgentInOrBelow(folder: string, except?: string): void {
    const path = canonicalPath(folder);
    const other = this.list().find((s) => s.id !== except && s.state === "running" && within(canonicalPath(s.worktreePath), path));
    if (!other) return;
    const where = canonicalPath(other.worktreePath) === path ? "in this folder" : `in ${other.worktreePath}, inside this folder`;
    throw new SessionError(409, `${describeSession(other)} is running ${where}; end it first`);
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
    // One running session per change: an ended one is not started again beside another (one-console-per-change D4).
    if (session.state !== "running") {
      const other = changeSessions(this.list()).find((s) => s.id !== session.id && s.repoId === session.repoId && s.change === session.change && s.state === "running");
      if (other) throw new SessionError(409, `another session of ${session.change} is running on ${other.branch ?? "its folder"}; end it first`);
    }
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
    this.refuseAgentInOrBelow(session.worktreePath, session.id);
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
    this.refuseConsoleFolderShared(session.worktreePath, session.id);
    return { agent };
  }

  private async restart(session: Session, repoPath: string | undefined, argv: string[], env: Record<string, string>, typed?: string): Promise<void> {
    // An in-place session runs in the repository folder, the console in its own: no worktree to re-create, no git to ask.
    if (!isChangeless(session) && !session.inPlace && repoPath !== undefined) {
      const branch = session.branch as string;
      try {
        // An adopted worktree is not ours to re-create: if its owner removed it, the session has nowhere to continue.
        // Its own worktree only has to be the repository's: the agent may have checked out another branch there (D5).
        if (!session.adopted) await ensureWorktree(repoPath, session.worktreePath, branch, { fromRemote: session.pullRequest !== undefined, verify: "repository" });
        else if ((await linkedWorktreeOf(repoPath, branch)) !== session.worktreePath) throw new Error(`the adopted worktree ${session.worktreePath} no longer exists`);
      } catch (err) {
        throw new SessionError(err instanceof NoCommitError || err instanceof UnknownBranchError || err instanceof WorktreeMismatchError ? 409 : 500, err instanceof Error ? err.message : String(err));
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
  ship(id: string): Promise<ShipResult> {
    return this.lockedFor(id, () => this.shipNow(id));
  }

  private async shipNow(id: string): Promise<ShipResult> {
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
      const typed = typable(prompt);
      if (autoMerge) this.askedForAutoMerge(session);
      const { submitted } = await this.submit(id, typed);
      this.report(session, { kind: "session-shipped", submitted });
      return { ...session, submitted, autoMerge };
    }
    const launch = checkedLaunch(agent, prompt, resumeLaunch(agent));
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
  resolveConflicts(id: string, pullRequests?: RepoPullRequests): Promise<PromptResult> {
    return this.lockedFor(id, () => this.resolveConflictsNow(id, pullRequests));
  }

  private async resolveConflictsNow(id: string, pullRequests?: RepoPullRequests): Promise<PromptResult> {
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
      const { submitted } = await this.submit(id, typable(prompt));
      this.report(session, { kind: "session-conflicts-resolve", submitted });
      return { ...session, submitted };
    }
    const launch = checkedLaunch(agent, prompt, resumeLaunch(agent));
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
      return { ...(await this.resolveConflictsNow(running.id, pullRequests)), autoMerge: false };
    }
    // An existing worktree on the right branch: the latest session in it is started again there, as Ship would.
    const recorded = signal.worktree && sessions.find((s) => s.worktreePath === signal.worktree?.path);
    if (recorded) return { ...(await this.resolveConflictsNow(recorded.id, pullRequests)), autoMerge: false };
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
    const launch = checkedLaunch(agent, resolveConflictsPrompt(agent, change, pr));
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
        await ensureWorktree(repo.path, path, head, { fromRemote: true, verify: "branch" });
      }
      await copyChangeIfMissing(snapshot.checkout?.path ?? repo.path, session.worktreePath, change);
    } catch (err) {
      if (err instanceof SessionError) throw err;
      throw new SessionError(err instanceof NoCommitError || err instanceof UnknownBranchError || err instanceof WorktreeMismatchError ? 409 : 500, err instanceof Error ? err.message : String(err));
    }
    this.sessions.set(session.id, session);
    await this.store.saveMeta(session);
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
    // Checked before the action or the auto-merge record changes: a prompt that cannot be typed changes nothing (D1).
    const text = typable(openingPrompt(agent, action, session.change, { autoMerge, proposal: autoMerge, convention: repo?.prTitleConvention, record }) as string);
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
    const candidate = (session: ChangeSession) => session.repoId === repoId && !session.inPlace && !session.adopted && session.autoMergeAskedAt !== undefined && !session.autoEnded && !this.autoEnding.has(session.id);
    if (!changeSessions(this.list()).some(candidate)) return;
    // Only the session's own pull request: not from a fork — an unknown answer counts as one — and into the default
    // branch as known locally, read once per call (D6), as the ready-merge and Resolve conflicts already require.
    const base = await defaultBranch(repo.path);
    if (base === undefined) return;
    for (const session of changeSessions(this.list())) {
      if (!candidate(session)) continue;
      const askedAt = Date.parse(session.autoMergeAskedAt as string);
      const merged = pullRequests.find((pr) => pr.state === "merged" && pr.isCrossRepository === false && pr.base === base && pr.head === session.branch && pr.mergedAt !== undefined && Date.parse(pr.mergedAt) > askedAt);
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
    // Its own branch's pull request first; else the proposal's, handed over once the proposal session ended (D3).
    const own = pullRequests.find((p) => p.state === "open" && p.head === session.branch);
    const handed = own ? undefined : await this.handedOverProposal(session);
    const pr = own ?? pullRequests.find((p) => handed !== undefined && p.state === "open" && p.head === handed.branch);
    if (!pr) throw new SessionError(409, "this session's branch has no open pull request in the last pull-request list");
    const readiness = pullRequestReadiness(pr);
    if (!readiness?.ready) throw new SessionError(409, `pull request #${pr.number} is not ready to merge (${readiness ? readinessDetail(readiness) : "unknown"})`);
    if (!pr.headOid) throw new SessionError(409, `the pull-request list names no head commit for #${pr.number}; refresh it first`);
    const prompt = mergePrompt(agent, session.change, { pr: pr.number, head: pr.headOid, proposal: handed !== undefined });
    return this.sendMerge(handed ?? session, session, prompt, { pr: pr.number, head: pr.headOid, by: "user" });
  }

  /**
   * The ended proposal session whose pull request `session` receives (one-console-per-change D3): `session` is the
   * change's only running session, has a worktree of its own, and the proposal session's worktree still exists — the
   * merge checks read it. The most recent one when there are several.
   */
  private async handedOverProposal(session: ChangeSession): Promise<ChangeSession | undefined> {
    if (session.inPlace || session.adopted || isProposalSession(session)) return undefined;
    const mine = changeSessions(this.list()).filter((s) => s.repoId === session.repoId && s.change === session.change);
    const running = mine.filter((s) => s.state === "running" && this.live.get(s.id)?.proc);
    if (running.length !== 1 || running[0].id !== session.id) return undefined;
    for (const proposal of mine.filter(isEndedProposalSession)) {
      if (await stat(proposal.worktreePath).catch(() => undefined)) return proposal;
    }
    return undefined;
  }

  /**
   * Records the Merge prompt on `recordOn` before anything is typed, then submits it to `sendTo` and reports what came of
   * it. The record is what keeps a second query from sending it again and keeps the board watching until the pull
   * request merges or moves. The two differ only for a proposal pull request handed to the change's running session.
   */
  private async sendMerge(recordOn: ChangeSession, sendTo: ChangeSession, prompt: string, target: Pick<MergeAsked, "pr" | "head" | "by">): Promise<PromptResult> {
    const asked: MergeAsked = { ...target, at: new Date().toISOString(), submitted: false };
    recordOn.mergeAsked = asked;
    await this.touch(recordOn);
    const { submitted } = await this.submit(sendTo.id, prompt).catch(() => ({ submitted: false }));
    if (recordOn.mergeAsked === asked) {
      asked.submitted = submitted;
      this.touchLater(recordOn);
    }
    this.report(sendTo, { kind: "session-merge", pr: target.pr, by: target.by, submitted });
    return { ...sendTo, submitted };
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
    const runs = (session: ChangeSession | undefined): session is ChangeSession => session?.state === "running" && this.live.get(session.id)?.proc !== undefined;
    const sessions = changeSessions(this.list());
    // The session the prompt goes to: the session itself while it runs; for an ended proposal session, the change's only
    // running session, if it has a worktree of its own (one-console-per-change D3). Asked again after every await.
    const receiver = (session: ChangeSession): ChangeSession | undefined => {
      if (session.state === "running") return runs(session) ? session : undefined;
      if (!isEndedProposalSession(session)) return undefined;
      const running = changeSessions(this.list()).filter((s) => s.repoId === session.repoId && s.change === session.change && runs(s));
      return running.length === 1 && !running[0].inPlace && !running[0].adopted ? running[0] : undefined;
    };
    for (const session of sessions) {
      if (session.repoId !== repoId || session.inPlace || session.adopted || !session.autoMergeAskedAt || session.autoEnded || session.action === "fastForward") continue;
      if (!receiver(session) || this.merging.has(session.id)) continue;
      const pr = pullRequests.find((p) => p.state === "open" && p.head === session.branch);
      if (!pr || !mergeReady(pr) || askedFor(session, pr)) continue;
      // Taken before the first await, so a second query settling meanwhile cannot send the same prompt again.
      this.merging.add(session.id);
      try {
        const now = enabled();
        if (!now) continue;
        if (pr.base !== (await defaultBranch(now.repo.path))) continue;
        // GitHub's file list loses the source side of a rename: the worktree, at exactly that commit, has the last word.
        // An ended proposal session's worktree is read just the same; a removed one fails here and counts as not holding.
        if ((await headCommit(session.worktreePath)) !== pr.headOid) continue;
        if (!(await shipsOnlyOpenSpec(session.worktreePath, await baseRef(now.repo.path)))) continue;
        const to = receiver(session);
        const agent = to && this.deps.getConfig().agentSessions.agents.find((a) => a.id === to.agentId);
        if (!to || !agent || !enabled() || askedFor(session, pr)) continue;
        const prompt = mergePrompt(agent, session.change, { pr: pr.number, head: pr.headOid as string, proposal: to !== session });
        await this.sendMerge(session, to, prompt, { pr: pr.number, head: pr.headOid as string, by: "dashboard" });
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

  /** The editor command in effect and whether its executable is found, for the session list (editor-launch). */
  editor(): { command: string[]; found: boolean } {
    const command = editorCommand(this.deps.getConfig().agentSessions);
    return { command, found: editorFound(command) };
  }

  /**
   * Open in editor for a change session: its working directory — the worktree, or the tracked folder of an in-place
   * session — from the session record. Running or ended alike; the session itself is not touched.
   */
  async openEditor(id: string): Promise<{ started: true; command: string[] }> {
    const session = this.get(id);
    if (isChangeless(session)) throw new SessionError(400, notAChange(session));
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    const repo = config.repos.find((r) => r.id === session.repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    return this.startEditor(session.worktreePath);
  }

  /** Open in editor for a session worktree, by name, resolved from the server's own session worktree list. */
  async openWorktreeEditor(input: { repoId?: unknown; name?: unknown }): Promise<{ started: true; command: string[] }> {
    const config = this.deps.getConfig();
    if (!config.agentSessions.enabled) throw new SessionError(403, "agent sessions are disabled");
    if (typeof input.name !== "string" || !WORKTREE_NAME.test(input.name)) throw new SessionError(400, "invalid worktree name");
    const repo = config.repos.find((r) => r.id === input.repoId);
    if (!repo) throw new SessionError(404, "unknown repository");
    if (!repoAgentEnabled(repo)) throw new SessionError(403, "agent sessions are switched off for this repository");
    const worktree = (await this.worktrees()).find((w) => w.repoId === repo.id && w.name === input.name);
    if (!worktree) throw new SessionError(404, "unknown worktree");
    return this.startEditor(worktree.path);
  }

  private async startEditor(folder: string): Promise<{ started: true; command: string[] }> {
    const argv = editorArgv(this.deps.getConfig().agentSessions, folder);
    try {
      await openEditor(argv, folder);
    } catch (err) {
      if (err instanceof EditorError) throw new SessionError(err.status, err.message);
      throw err;
    }
    return { started: true, command: argv };
  }

  /** Continues the agent's latest conversation in the session's worktree, in the same session record. */
  resume(id: string): Promise<Session> {
    return this.lockedFor(id, () => this.resumeNow(id));
  }

  private async resumeNow(id: string): Promise<Session> {
    const session = this.get(id);
    if (session.state === "running") return session;
    const { agent, repoPath } = isConsole(session)
      ? { ...(await this.prepareConsoleRestart(session)), repoPath: undefined }
      : isIntegration(session)
        ? { ...this.prepareIntegrationRestart(session), repoPath: undefined }
        : isProjectConsole(session)
          ? { ...(await this.prepareProjectConsoleRestart(session)), repoPath: undefined }
          : await this.prepareRestart(session).then(({ agent, repo }) => ({ agent, repoPath: repo.path }));
    const resume = resumeLaunch(agent);
    if (!resume) throw new SessionError(400, "this agent has no resume command configured");
    if (!Bun.which(resume[0])) throw new SessionError(503, `${agent.name} was not found (${resume[0]})`);
    await this.restart(session, repoPath, resume, agentEnv(agent, process.env));
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
   * shown it (see submit.ts). Keystrokes never come through here — they go through `write`, unobserved. `async`, so a
   * refusal is always a rejected promise: thrown synchronously from the typed-prompt timer it would end the dashboard.
   */
  async submit(id: string, text: unknown): Promise<{ submitted: boolean }> {
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
      // Under the change's lock, so a start reusing the worktree cannot slip in between the check and the removal (D4).
      worktree = await this.withChangeLock(session.repoId, session.change, () => this.removeSessionWorktree(session));
    }
    return { session, worktree };
  }

  /** The ended session's worktree, removed when it is safe — and never while another session runs in it. */
  private async removeSessionWorktree(session: ChangeSession): Promise<Removable> {
    if (this.runningInFolder(session.worktreePath).some((s) => s.id !== session.id)) return RUNNING_HERE;
    const repo = this.deps.getConfig().repos.find((r) => r.id === session.repoId);
    const removed = repo ? await removeWorktree(repo.path, session.worktreePath, await this.isMerged(repo.path, session)) : { removable: false, reason: "the repository is no longer configured" };
    this.forgetWorktrees();
    return removed;
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

  /**
   * Dashboard shutdown: terminals cannot outlive it, so every agent is ended and its output tail kept. Each agent gets
   * the hang-up and up to `KILL_GRACE_MS` to exit; every survivor is then killed and given one more second (design
   * D3), because the process exits right after this returns and the terminal's own `SIGKILL` timer would never fire.
   */
  async shutdown(): Promise<void> {
    const running = this.list().filter((s) => s.state === "running");
    const procs: TerminalProcess[] = [];
    for (const session of running) {
      const live = this.live.get(session.id);
      const proc = live?.proc;
      if (live) live.proc = undefined; // the exit handler must not overwrite the reason
      if (!proc) continue;
      proc.kill();
      procs.push(proc);
    }
    const exitedWithin = (proc: TerminalProcess, ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        void proc.exited.then(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    const graceful = await Promise.all(procs.map((proc) => exitedWithin(proc, KILL_GRACE_MS)));
    const forced = procs.filter((_, i) => !graceful[i]);
    for (const proc of forced) proc.forceKill();
    const gone = await Promise.all(forced.map((proc) => exitedWithin(proc, FORCED_EXIT_WAIT_MS)));
    forced.forEach((proc, i) => {
      if (!gone[i]) console.error(`agent process ${proc.pid} is still running after SIGKILL`);
    });
    await Promise.all(running.map((session) => this.end(session, null, "the dashboard was stopped while this session was running")));
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
