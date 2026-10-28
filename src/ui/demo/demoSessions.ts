// The demo's simulated agent sessions: a seed that shows every state on first load, and an in-memory stand-in for the
// dashboard's session manager. Nothing is started and nothing leaves the page; a reload starts over.
//
// All of it is invented, like the rest of the sample (see sampleData.ts): every repository, change, branch and path
// comes from the sample, and terminal output comes from the hand-written transcripts.
import { blockedReason } from "../../shared/dependencies.ts";
import { availableActions, DEFAULT_EDITOR, isChangeless, isConsole, isIntegration, OPEN_SESSION_STATES, projectConsoleSessions, repoAgentEnabled, type ChangeSession, type Config, type ConsoleSession, type IntegrationSession, type ProjectConsoleLike, type ProjectConsoleSession, type Session, type SessionAction, type AutoMergePromptResult, type PromptResult, type SessionWorktree, type ShipResult, SHIPPABLE_WORK, type StartResult, type Snapshot, type WorkStatus, type Worktree } from "../../shared/types.ts";
import { sessionBranch } from "../../shared/sessionBranch.ts";
import { ApiError, type TerminalConnection, type TerminalHandlers } from "../api.ts";
import { DEMO_AGENT, DEMO_ROOT } from "./sampleData.ts";
import { type Clock, type Playback, type Position, playTranscript, positionAfter, TRANSCRIPTS, type TranscriptName, workAfter } from "./transcripts.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;


/** Fast-forward has no recording of its own: the demo plays its first phase, the draft. */
const transcriptOf = (action: SessionAction): TranscriptName => (action === "fastForward" ? "draft" : action);

/** Same names the dashboard uses for a session's worktree and branch. */
const worktreeName = (action: SessionAction, change: string) => (action === "archive" ? `archive-${change}` : change);
export const sessionWorktreePath = (repoId: string, name: string) => `${DEMO_ROOT.replace(/\/[^/]+$/, "")}/.spec-control/worktrees/${repoId}/${name}`;
/** The main console's default folder, as the dashboard would place it under the demo's home. */
export const DEMO_CONSOLE_DIR = `${DEMO_ROOT.replace(/\/[^/]+$/, "")}/.spec-control/console`;
const NOT_A_CHANGE = "this is the main console, which belongs to no change";
const NOT_A_CHANGE_INTEGRATING = "this session is setting a repository up for OpenSpec, so it belongs to no change";
const NOT_A_CHANGE_PROJECT = "this is the project's console, which belongs to no change";
const notAChange = (session: Session) => (isIntegration(session) ? NOT_A_CHANGE_INTEGRATING : session.projectConsole ? NOT_A_CHANGE_PROJECT : NOT_A_CHANGE);

interface Seed {
  repo: string;
  change: string;
  action: SessionAction;
  transcript: TranscriptName;
  /** How long ago the session started. */
  startedAgo: number;
  /** For sessions that ended: how long ago, and what the worktree looks like now. Absent = still running. */
  ended?: { ago: number; work: WorkStatus; failed?: string };
  /** The agent's hooks report through its state file: while it sits at a question, the badge shows its waiting report. */
  reports?: boolean;
}

// One of everything the UI distinguishes, spread over the sample's repositories.
const SEEDS: Seed[] = [
  // started a minute and a half ago, with several minutes of recording still ahead of it
  { repo: "atlas-api", change: "add-rate-limiting", action: "implement", transcript: "implement", startedAgo: 1.5 * MINUTE },
  { repo: "harbor-web", change: "keyboard-shortcuts", action: "implement", transcript: "implementAsking", startedAgo: 12 * MINUTE },
  // the same question, from an agent whose hooks report it: its badge shows the agent's waiting report
  { repo: "lantern-infra", change: "centralize-log-shipping", action: "implement", transcript: "implementAsking", startedAgo: 30 * MINUTE, reports: true },
  { repo: "lantern-infra", change: "pin-terraform-providers", action: "implement", transcript: "implement", startedAgo: 4 * HOUR, ended: { ago: 3 * HOUR, work: { state: "uncommitted", count: 3 } } },
  { repo: "harbor-web", change: "dark-mode-tokens", action: "implement", transcript: "implement", startedAgo: 2 * DAY + 2 * HOUR, ended: { ago: 2 * DAY, work: { state: "unpushed", count: 2, base: "origin/main" } } },
  // Pushed, and the default branch has moved under it since: the conflict badge and Resolve conflicts on first load.
  {
    repo: "quill-docs",
    change: "versioned-api-reference",
    action: "implement",
    transcript: "implement",
    startedAgo: 6 * HOUR,
    ended: { ago: 5 * HOUR, work: { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["src/router/table.ts", "src/router/table.test.ts"] } } },
  },
  // Shipped, and its pull request #479 is ready: the card recommends Merge, which opens this session's console.
  { repo: "atlas-api", change: "paginate-list-endpoints", action: "implement", transcript: "implement", startedAgo: 1 * DAY + 3 * HOUR, ended: { ago: 1 * DAY, work: { state: "pushed", base: "origin/main" } } },
  // Shipped, and #311's checks fail: the card recommends Implement so the agent fixes them. Beside them, #57's checks
  // still run, so `biometric-login` waits, and #305 conflicts, so `dark-mode-tokens` recommends Resolve conflicts.
  { repo: "harbor-web", change: "redesign-settings-page", action: "implement", transcript: "implement", startedAgo: 7 * HOUR, ended: { ago: 6 * HOUR, work: { state: "pushed", base: "origin/main" } } },
  { repo: "atlas-api", change: "deprecate-v1-auth", action: "archive", transcript: "archive", startedAgo: 1 * DAY, ended: { ago: 23 * HOUR, work: { state: "merged", base: "origin/main" } } },
  { repo: "lantern-infra", change: "cost-allocation-tags", action: "draft", transcript: "draft", startedAgo: 50 * MINUTE, ended: { ago: 45 * MINUTE, work: { state: "clean", base: "origin/main" } } },
  { repo: "ember-mobile", change: "offline-sync-queue", action: "implement", transcript: "implement", startedAgo: 20 * MINUTE, ended: { ago: 20 * MINUTE, work: { state: "missing" }, failed: "could not create the worktree: the branch is checked out elsewhere" } },
];
/** A worktree whose session record is gone: the archive worktree of a change that is archived by now. */
const ORPHAN = { repo: "atlas-api", change: "add-health-endpoint", action: "archive" as SessionAction, work: { state: "unpushed", count: 1, base: "origin/main" } as WorkStatus, ago: 3 * DAY };

interface DemoSession {
  session: Session;
  name: string;
  transcript: TranscriptName;
  startedAtMs: number;
  /** Set once the terminal has been opened; until then the position follows from the elapsed time. */
  position?: Position;
  /** The worktree's status before the milestones of the steps from `workFrom` on are applied. */
  work: WorkStatus;
  /** Milestones before this step are already part of `work` (a session seeded as ended has all of them in it). */
  workFrom: number;
  lastActivityMs: number;
  removed?: boolean;
  reports?: boolean;
}

export interface DemoSessionsOptions {
  now(): number;
  getConfig(): Config;
  getSnapshot(): Snapshot;
  /** Repositories still waiting to be set up for OpenSpec; only these can be integrated. */
  integratable(): { path: string }[];
  /** The transcript reached its end, which in the demo is what the marker appearing means: track the repository. */
  onIntegrated?(path: string): void;
  clock?: Clock;
}

export function createDemoSessions({ now, getConfig, getSnapshot, integratable, onIntegrated, clock }: DemoSessionsOptions) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const started = now();
  let counter = 0;
  const sample = getSnapshot();
  const repoOf = (name: string) => {
    const repo = sample.repos.find((r) => r.name === name);
    if (!repo) throw new Error(`demo seed names an unknown repository: ${name}`);
    return repo;
  };

  /** A change whose branch is already checked out in one of the sample's worktrees is worked on there (adopted). */
  const placeFor = (repoId: string, change: string, action: SessionAction) => {
    const branch = sessionBranch(action, change);
    const lives = getSnapshot().repos.find((r) => r.id === repoId)?.changes.find((c) => c.name === change && !c.archived)?.checkout;
    const adopted = action !== "archive" && lives !== undefined && !lives.isMain && lives.branch === branch;
    return { branch, adopted, path: adopted ? lives.path : sessionWorktreePath(repoId, worktreeName(action, change)) };
  };

  const sessions: DemoSession[] = SEEDS.map((seed) => {
    const repo = repoOf(seed.repo);
    const place = placeFor(repo.id, seed.change, seed.action);
    const createdAt = started - seed.startedAgo;
    const endedAt = seed.ended ? started - seed.ended.ago : undefined;
    const steps = TRANSCRIPTS[seed.transcript];
    const position = seed.ended ? { index: steps.length, waiting: false } : positionAfter(steps, seed.startedAgo);
    // a question that has been sitting there: the last output is the question itself
    const quietSince = position.waiting ? createdAt + steps.slice(0, position.index + 1).reduce((t, s) => t + (s.after ?? 0), 0) : started - 5_000;
    return {
      name: worktreeName(seed.action, seed.change),
      transcript: seed.transcript,
      startedAtMs: createdAt,
      position: seed.ended ? position : undefined,
      work: seed.ended?.work ?? { state: "clean", base: "origin/main" },
      workFrom: seed.ended ? steps.length : 0,
      lastActivityMs: endedAt ?? quietSince,
      reports: seed.reports,
      session: {
        id: `demo-${++counter}`,
        repoId: repo.id,
        change: seed.change,
        action: seed.action,
        agentId: DEMO_AGENT.id,
        agentName: DEMO_AGENT.name,
        state: seed.ended?.failed ? "failed" : seed.ended ? "exited" : "running",
        exitCode: seed.ended && !seed.ended.failed ? 0 : undefined,
        error: seed.ended?.failed,
        worktreePath: place.path,
        adopted: place.adopted || undefined,
        branch: place.branch,
        createdAt: iso(createdAt),
        updatedAt: iso(endedAt ?? quietSince),
        lastOutputAt: seed.ended?.failed ? undefined : iso(endedAt ?? quietSince),
        resumable: !seed.ended?.failed,
      },
    };
  });

  const orphanRepo = repoOf(ORPHAN.repo);
  const orphans: SessionWorktree[] = [
    {
      repoId: orphanRepo.id,
      name: worktreeName(ORPHAN.action, ORPHAN.change),
      path: sessionWorktreePath(orphanRepo.id, worktreeName(ORPHAN.action, ORPHAN.change)),
      change: ORPHAN.change,
      action: ORPHAN.action,
      branch: sessionBranch(ORPHAN.action, ORPHAN.change),
      work: ORPHAN.work,
      lastActivityAt: iso(started - ORPHAN.ago),
    },
  ];

  const playing = new Map<string, { playback: Playback; handlers: TerminalHandlers }>();

  const find = (id: string) => {
    const found = sessions.find((s) => s.session.id === id);
    if (!found) throw new ApiError(404, "unknown session");
    return found;
  };
  const requireEnabled = () => {
    if (!getConfig().agentSessions.enabled) throw new ApiError(403, "agent sessions are disabled");
  };

  /** Where a session's transcript stands right now, and what its worktree looks like because of it. */
  const positionOf = (s: DemoSession): Position => s.position ?? positionAfter(TRANSCRIPTS[s.transcript], now() - s.startedAtMs);
  const workOf = (s: DemoSession): WorkStatus => {
    if (s.removed || s.session.state === "failed") return { state: "missing" };
    const steps = TRANSCRIPTS[s.transcript];
    return workAfter(steps.slice(s.workFrom), Math.max(0, positionOf(s).index - s.workFrom), s.work) ?? s.work;
  };

  const removable = (work: WorkStatus, adopted?: boolean): { removable: boolean; reason?: string } => {
    if (adopted) return { removable: false, reason: "this worktree was not created by the dashboard (the session adopted it), so it is kept" };
    if (work.state === "uncommitted") return { removable: false, reason: "the worktree has uncommitted changes" };
    if (work.state === "unpushed") return { removable: false, reason: `${work.count ?? 1} commit(s) exist only on this worktree's branch` };
    if (work.state === "missing") return { removable: false, reason: "worktree no longer exists" };
    return { removable: true };
  };

  const end = (s: DemoSession, exitCode = 0) => {
    // The transcript reached its end, which in the demo is the marker appearing: the repository becomes tracked.
    if (isIntegration(s.session) && exitCode === 0 && s.session.state === "running") onIntegrated?.(s.session.folder);
    // what the transcript did to the worktree stays; the transcript itself is over
    s.work = workOf(s);
    s.workFrom = TRANSCRIPTS[s.transcript].length;
    s.position = { index: TRANSCRIPTS[s.transcript].length, waiting: false };
    s.session.state = "exited";
    s.session.exitCode = exitCode;
    s.session.updatedAt = iso(now());
    s.lastActivityMs = now();
  };

  const play = (s: DemoSession, handlers: TerminalHandlers, continuing: boolean) => {
    const playback = playTranscript(TRANSCRIPTS[s.transcript], {
      from: s.session.state === "running" ? positionOf(s) : { index: TRANSCRIPTS[s.transcript].length, waiting: false },
      continuing,
      clock,
      values: { change: s.session.change ?? "", branch: s.session.branch ?? "", path: s.session.worktreePath },
      handlers: {
        ...handlers,
        onExit: () => {
          end(s);
          handlers.onExit();
        },
      },
      onProgress: (position) => {
        s.position = position;
        s.session.lastOutputAt = iso(now());
        s.lastActivityMs = now();
      },
    });
    playing.set(s.session.id, { playback, handlers });
    return playback;
  };

  /** Starts another transcript in a session, on the terminal that is open for it (if one is). */
  const run = (s: DemoSession, transcript: TranscriptName) => {
    s.work = workOf(s);
    s.workFrom = 0;
    s.transcript = transcript;
    s.startedAtMs = now();
    s.position = { index: 0, waiting: false };
    s.session.state = "running";
    s.session.exitCode = undefined;
    s.session.updatedAt = iso(now());
    s.lastActivityMs = now();
    const open = playing.get(s.session.id);
    if (open) {
      open.playback.close();
      play(s, open.handlers, true);
    }
  };

  /** Seeded transcripts play on in the background while nobody watches them: unless one sits at a question, it printed just now. */
  const printing = (s: DemoSession) => s.session.state === "running" && !s.position && !positionOf(s).waiting;
  /** An agent that reports, sitting at a question: its report was written when the question appeared. */
  const reportsWaiting = (s: DemoSession) => s.reports === true && s.session.state === "running" && positionOf(s).waiting;
  const listed = (s: DemoSession): Session => {
    if (printing(s)) return { ...s.session, lastOutputAt: iso(now() - 5_000) };
    return reportsWaiting(s) ? { ...s.session, waitingReportedAt: iso(s.lastActivityMs) } : s.session;
  };

  const worktrees = (): SessionWorktree[] => [
    ...sessions
      .filter((s): s is DemoSession & { session: ChangeSession } => !isChangeless(s.session) && workOf(s).state !== "missing")
      .map((s) => ({
        repoId: s.session.repoId,
        name: s.name,
        path: s.session.worktreePath,
        change: s.session.change,
        action: s.session.action,
        branch: s.session.branch,
        work: workOf(s),
        lastActivityAt: iso(printing(s) ? now() - 5_000 : s.lastActivityMs),
        sessionId: s.session.id,
      })),
    ...orphans,
  ];

  return {
    /** Worktrees `git worktree list` would report for a repository because of its sessions. */
    gitWorktrees(repoId: string): Worktree[] {
      return worktrees()
        .filter((w) => w.repoId === repoId && !sessions.find((s) => s.session.id === w.sessionId)?.session.adopted)
        .map((w) => ({ path: w.path, branch: w.branch }));
    },

    list() {
      const enabled = getConfig().agentSessions.enabled;
      return {
        sessions: enabled ? sessions.map(listed) : [],
        agents: [{ id: DEMO_AGENT.id, name: DEMO_AGENT.name, available: true, path: "/home/demo/bin/demo-agent" }],
        // The demo looks at no machine, so it claims no preset as found: Settings offers them unmarked.
        presets: [],
        worktrees: enabled ? worktrees() : [],
        // Reported as found so Open in editor is visible and enabled; pressing it says the demo opens no editor.
        editor: { command: [...DEFAULT_EDITOR], found: true },
      };
    },

    open(repoId: string, change: string, action: SessionAction): StartResult {
      requireEnabled();
      const repo = getConfig().repos.find((r) => r.id === repoId);
      if (!repo) throw new ApiError(404, "unknown repository");
      if (!repo.enabled) throw new ApiError(409, "the repository is not tracked");
      const scanned = getSnapshot().repos.find((r) => r.id === repoId);
      if (!scanned?.ok) throw new ApiError(409, "the repository's last scan failed");
      const snapshot = scanned.changes.find((c) => c.name === change && !c.archived);
      if (!snapshot) throw new ApiError(404, "unknown change");
      const heldBack = action === "implement" ? blockedReason(snapshot) : action === "fastForward" ? blockedReason(snapshot, "Fast-forward") : undefined;
      if (heldBack) throw new ApiError(400, heldBack);
      if (!availableActions(snapshot).includes(action)) throw new ApiError(400, `"${action}" is not available for this change in its current stage`);
      const existing = sessions.find((s) => s.session.repoId === repoId && s.session.change === change && s.session.state === "running");
      if (existing) return { ...existing.session, autoMerge: false };

      const place = placeFor(repoId, change, action);
      const at = now();
      const created: DemoSession = {
        name: worktreeName(action, change),
        transcript: transcriptOf(action),
        startedAtMs: at,
        position: { index: 0, waiting: false },
        work: { state: "clean", base: "origin/main" },
        workFrom: 0,
        lastActivityMs: at,
        session: {
          id: `demo-${++counter}`,
          repoId,
          change,
          action,
          agentId: DEMO_AGENT.id,
          agentName: DEMO_AGENT.name,
          state: "running",
          worktreePath: place.path,
          adopted: place.adopted || undefined,
          branch: place.branch,
          createdAt: iso(at),
          updatedAt: iso(at),
          lastOutputAt: iso(at),
          resumable: true,
        },
      };
      // a fresh session takes over the worktree an ended one left behind
      for (const old of sessions) if (old.session.worktreePath === place.path && old.session.state !== "running") created.work = workOf(old);
      sessions.unshift(created);
      // The recording's agent archives nothing real, so its prompt never carries the docs auto-merge instruction either.
      return { ...created.session, autoMerge: false };
    },

    /**
     * Setting a repository up for OpenSpec: the demo agent in that folder, one at a time, playing the integrate
     * recording. It has no worktree and no branch, exactly as the dashboard's does.
     */
    openIntegration(path: string): IntegrationSession {
      requireEnabled();
      if (!integratable().some((r) => r.path === path)) throw new ApiError(404, "this folder is not a repository waiting to be set up for OpenSpec");
      const running = sessions.find((s) => isIntegration(s.session) && s.session.folder === path && s.session.state === "running")?.session;
      if (running && isIntegration(running)) return running;
      const at = now();
      const session: IntegrationSession = {
        id: `demo-${++counter}`,
        integration: true,
        folder: path,
        agentId: DEMO_AGENT.id,
        agentName: DEMO_AGENT.name,
        state: "running",
        worktreePath: path,
        inPlace: true,
        createdAt: iso(at),
        updatedAt: iso(at),
        lastOutputAt: iso(at),
        resumable: true,
      };
      sessions.unshift({ name: path.split("/").pop() ?? path, transcript: "integrate", startedAtMs: at, position: { index: 0, waiting: false }, work: { state: "missing" }, workFrom: 0, lastActivityMs: at, session });
      return session;
    },

    /** A project's console: one per project, in its folder, playing the console recording; a running setup session is it. */
    openProjectConsole(repoId: string): ProjectConsoleLike {
      requireEnabled();
      const repo = getConfig().repos.find((r) => r.id === repoId);
      if (!repo) throw new ApiError(404, "unknown repository");
      if (!repo.enabled) throw new ApiError(409, "the repository is not tracked");
      if (!repoAgentEnabled(repo)) throw new ApiError(403, "agent sessions are switched off for this repository");
      const running = projectConsoleSessions(
        sessions.map((s) => s.session),
        repo,
      ).find((s) => OPEN_SESSION_STATES.includes(s.state));
      if (running) return running;
      const at = now();
      const session: ProjectConsoleSession = {
        id: `demo-${++counter}`,
        projectConsole: true,
        repoId,
        folder: repo.path,
        agentId: DEMO_AGENT.id,
        agentName: DEMO_AGENT.name,
        state: "running",
        worktreePath: repo.path,
        inPlace: true,
        createdAt: iso(at),
        updatedAt: iso(at),
        lastOutputAt: iso(at),
        resumable: true,
      };
      sessions.unshift({ name: repo.name, transcript: "console", startedAtMs: at, position: { index: 0, waiting: false }, work: { state: "missing" }, workFrom: 0, lastActivityMs: at, session });
      return session;
    },

    /** The main console: one at a time, in the demo's console folder, playing the console recording. */
    openConsole(): ConsoleSession {
      requireEnabled();
      const running = sessions.find((s) => isConsole(s.session) && s.session.state === "running")?.session;
      if (running && isConsole(running)) return running;
      const at = now();
      const session: ConsoleSession = {
        id: `demo-${++counter}`,
        console: true,
        agentId: DEMO_AGENT.id,
        agentName: DEMO_AGENT.name,
        state: "running",
        worktreePath: DEMO_CONSOLE_DIR,
        createdAt: iso(at),
        updatedAt: iso(at),
        lastOutputAt: iso(at),
        resumable: true,
      };
      sessions.unshift({ name: "console", transcript: "console", startedAtMs: at, position: { index: 0, waiting: false }, work: { state: "missing" }, workFrom: 0, lastActivityMs: at, session });
      return session;
    },

    terminal(id: string, handlers: TerminalHandlers): TerminalConnection {
      const s = find(id);
      const playback = play(s, handlers, false);
      return {
        send: (message) => playback.send(message),
        close: () => {
          playing.get(id)?.playback.close();
          playing.delete(id);
        },
      };
    },

    resume(id: string): Session {
      requireEnabled();
      const s = find(id);
      if (sessions.some((o) => o !== s && o.session.worktreePath === s.session.worktreePath && o.session.state === "running")) throw new ApiError(409, "another session is running in this worktree");
      run(s, "resume");
      return s.session;
    },

    ship(id: string): ShipResult {
      const s = find(id);
      if (isChangeless(s.session)) throw new ApiError(409, notAChange(s.session));
      const work = workOf(s);
      if (!SHIPPABLE_WORK.includes(work.state)) throw new ApiError(409, `there is nothing to ship (${work.state})`);
      run(s, "ship");
      // The recording's agent ships nothing real, so its prompt never carries the docs auto-merge instruction.
      return { ...s.session, submitted: true, autoMerge: false };
    },

    resolveConflicts(id: string): PromptResult {
      const s = find(id);
      if (isChangeless(s.session)) throw new ApiError(409, notAChange(s.session));
      const work = workOf(s);
      if (!work.conflicts) throw new ApiError(409, `this branch has no conflicts to resolve (${work.state})`);
      run(s, "resolveConflicts");
      return { ...s.session, submitted: true };
    },

    prompt(id: string, action: SessionAction): AutoMergePromptResult {
      requireEnabled();
      const s = find(id);
      if (isChangeless(s.session)) throw new ApiError(409, notAChange(s.session));
      if (s.session.state !== "running") throw new ApiError(409, "the session is not running");
      // Every action reaches the change's one session, Archive included; `open` already returns that session for any
      // action, so the recording has no way to show two consoles for one change either.
      // Sent with one activation, as in the dashboard: the recording's agent takes the prompt up straight away.
      s.session.action = action;
      run(s, transcriptOf(action));
      return { ...s.session, submitted: true, autoMerge: false };
    },

    status(id: string) {
      const s = find(id);
      if (isChangeless(s.session)) throw new ApiError(409, notAChange(s.session));
      const work = workOf(s);
      return { ...removable(work, s.session.adopted), work };
    },

    close(id: string, removeWorktree: boolean) {
      const s = find(id);
      const open = playing.get(id);
      if (s.session.state === "running") {
        open?.playback.close();
        end(s, 0);
        open?.handlers.onExit();
        open?.handlers.onClose();
        playing.delete(id);
      }
      if (!removeWorktree || isChangeless(s.session)) return { session: s.session };
      const worktree = removable(workOf(s), s.session.adopted);
      if (worktree.removable) s.removed = true;
      return { session: s.session, worktree };
    },

    removeWorktree(repoId: string, name: string) {
      if (!getConfig().repos.some((r) => r.id === repoId)) throw new ApiError(404, "unknown repository");
      const path = sessionWorktreePath(repoId, name);
      if (sessions.some((s) => s.session.worktreePath === path && s.session.state === "running")) throw new ApiError(409, "a session is running in this worktree");
      const owner = sessions.find((s) => s.session.worktreePath === path && !s.removed);
      const orphan = orphans.findIndex((w) => w.path === path);
      if (!owner && orphan < 0) throw new ApiError(404, "unknown worktree");
      const result = removable(owner ? workOf(owner) : orphans[orphan].work, owner?.session.adopted);
      if (result.removable && owner) owner.removed = true;
      if (result.removable && !owner) orphans.splice(orphan, 1);
      return result;
    },

    delete(id: string) {
      const s = find(id);
      if (s.session.state === "running") throw new ApiError(409, "close the session first");
      sessions.splice(sessions.indexOf(s), 1);
      // the record is gone, the worktree is not: it is still reported, and its card keeps the work badge
      const work = workOf(s);
      if (!isChangeless(s.session) && work.state !== "missing" && !s.session.adopted) {
        orphans.push({ repoId: s.session.repoId, name: s.name, path: s.session.worktreePath, change: s.session.change, action: s.session.action, branch: s.session.branch, work, lastActivityAt: iso(s.lastActivityMs) });
      }
      return { deleted: true };
    },
  };
}
