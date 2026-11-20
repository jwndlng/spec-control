// Durable checkpoint records live in the dashboard home, never in tracked repositories. Writes replace one
// versioned snapshot atomically and serialize within this process; malformed or older files fail closed to empty state.
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChangeSession, Config, LifecycleDeliveryRecord, LifecycleDeliveryPhase, Snapshot } from "../shared/types.ts";
import { dashboardHome, gitExecutable } from "./paths.ts";

export const LIFECYCLE_DELIVERY_FILE = "lifecycle-delivery.json";
interface DiskState { version: 1; records: LifecycleDeliveryRecord[] }
const queues = new Map<string, Promise<unknown>>();

export function lifecycleDeliveryPath(home = dashboardHome()): string {
  return join(home, LIFECYCLE_DELIVERY_FILE);
}

function validRecord(value: unknown): value is LifecycleDeliveryRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<LifecycleDeliveryRecord>;
  return r.version === 1 && typeof r.id === "string" && typeof r.projectId === "string" &&
    typeof r.projectPath === "string" && typeof r.projectIncarnation === "string" && typeof r.change === "string" &&
    typeof r.changeIncarnation === "string" && ["proposal", "implementation", "archive"].includes(r.phase as string) &&
    Number.isSafeInteger(r.revision) && (r.revision as number) > 0 && typeof r.actionId === "string" && Number.isSafeInteger(r.completionRevision) &&
    typeof r.sessionId === "string" && typeof r.worktreePath === "string" && typeof r.branch === "string" &&
    typeof r.contentHash === "string" && typeof r.snapshotHash === "string" && ["pending", "committing", "pushing", "opening-pr", "waiting-to-merge", "merged", "blocked", "unavailable"].includes(r.state as string) &&
    (r.acceptedUnresolvedTasks === undefined || (typeof r.acceptedUnresolvedTasks === "boolean" && r.phase === "archive")) &&
    Array.isArray(r.recovery) && typeof r.createdAt === "string" && typeof r.updatedAt === "string" && Number.isSafeInteger(r.attempts);
}

/** Older schemas and malformed files carry no trusted checkpoint authority and are ignored. */
export async function readLifecycleDelivery(path = lifecycleDeliveryPath()): Promise<LifecycleDeliveryRecord[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { records?: unknown }).records)) return [];
    return (value as DiskState).records.filter(validRecord);
  } catch {
    return [];
  }
}

function serial<T>(path: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(path) ?? Promise.resolve()).then(task, task);
  queues.set(path, next.catch(() => undefined));
  return next;
}

/** Replaces the store atomically. The shared path queue prevents concurrent callers losing one another's records. */
export function writeLifecycleDelivery(records: readonly LifecycleDeliveryRecord[], path = lifecycleDeliveryPath()): Promise<void> {
  return serial(path, () => writeUnlocked(records, path));
}

async function writeUnlocked(records: readonly LifecycleDeliveryRecord[], path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify({ version: 1, records }, null, 2)}\n`;
  try {
    await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function upsertLifecycleDelivery(record: LifecycleDeliveryRecord, path = lifecycleDeliveryPath()): Promise<void> {
  await serial(path, async () => {
    const records = await readLifecycleDelivery(path);
    const next = records.filter((item) => item.id !== record.id);
    next.push(record);
    await writeUnlocked(next, path);
  });
}

/** Resolves after every write currently queued for `path`, whether it succeeded or failed. */
export async function lifecycleDeliveryIdle(path = lifecycleDeliveryPath()): Promise<void> {
  await queues.get(path);
}

export interface LifecycleEvidence {
  sessionId: string;
  actionId: string;
  action: "draft" | "implement" | "fastForward" | "archive";
  processRunning: boolean;
  completionReported: boolean;
  cleanExitFallback: boolean;
  historical: boolean;
  /** Bounded framework output evidence: all required planning artifacts are present and valid. */
  requiredArtifactsReady: boolean;
  /** Bounded task summary; implementation automation requires a verified all-checked summary. */
  tasksVerified: boolean;
  allTasksChecked: boolean;
  unresolvedArchiveAccepted?: boolean;
  /** Archive path and incarnation match this change, with no active directory remaining. */
  archiveIdentityMatches: boolean;
  activeChangeExists: boolean;
  snapshotHash: string;
  observedAt: number;
}

export interface LifecycleObservation {
  stable: boolean;
  phase?: "proposal" | "implementation" | "archive";
  snapshotHash?: string;
  acceptedUnresolvedTasks?: boolean;
  reason?: string;
}

/**
 * Only a completion signal from the current managed action (or a successful process exit fallback) can queue a phase.
 * Two identical evidence snapshots are required; first scans of pre-existing work seed no automatic delivery.
 */
export class LifecycleCoordinator {
  private snapshots = new Map<string, { hash: string; count: number }>();

  observe(evidence: LifecycleEvidence): LifecycleObservation {
    if (evidence.historical) return { stable: false, reason: "historical work is display-only" };
    if (!evidence.sessionId || !evidence.actionId || !evidence.snapshotHash) return { stable: false, reason: "managed action identity or snapshot evidence is missing" };
    if (!evidence.completionReported && !(evidence.cleanExitFallback && !evidence.processRunning))
      return { stable: false, reason: "awaiting completion of the current managed action" };
    let phase: LifecycleObservation["phase"];
    if (evidence.action === "draft") {
      phase = "proposal";
      if (!evidence.requiredArtifactsReady) return { stable: false, phase, reason: "required planning artifacts are incomplete" };
    } else if (evidence.action === "implement" || evidence.action === "fastForward") {
      phase = "implementation";
      if (!evidence.tasksVerified || !evidence.allTasksChecked) return { stable: false, phase, reason: "implementation tasks are not all verified complete" };
    } else {
      phase = "archive";
      if (!evidence.archiveIdentityMatches || evidence.activeChangeExists) return { stable: false, phase, reason: "archive identity is missing or the active change still exists" };
      if (!evidence.tasksVerified || (!evidence.allTasksChecked && !evidence.unresolvedArchiveAccepted)) return { stable: false, phase, reason: "archived tasks are not all verified complete or explicitly accepted unresolved" };
    }
    const key = `${evidence.sessionId}:${evidence.actionId}:${phase}`;
    const previous = this.snapshots.get(key);
    if (!previous || previous.hash !== evidence.snapshotHash) {
      this.snapshots.set(key, { hash: evidence.snapshotHash, count: 1 });
      return { stable: false, phase, snapshotHash: evidence.snapshotHash, reason: "waiting for a second matching snapshot" };
    }
    previous.count += 1;
    return { stable: true, phase, snapshotHash: evidence.snapshotHash, ...(phase === "archive" && evidence.unresolvedArchiveAccepted ? { acceptedUnresolvedTasks: true } : {}) };
  }

  forget(sessionId: string): void {
    for (const key of this.snapshots.keys()) if (key.startsWith(`${sessionId}:`)) this.snapshots.delete(key);
  }
}

export interface LifecycleMonitorDependencies {
  getConfig(): Config;
  getSnapshot(): Snapshot;
  listSessions(): readonly import("../shared/types.ts").Session[];
  completion(sessionId: string): import("../shared/types.ts").ManagedCompletionReport | undefined;
  readReports(): Promise<void>;
  deliver?(record: LifecycleDeliveryRecord): Promise<{ pullRequestUrl?: string; pullRequestNumber?: number }>;
  now?: () => number;
}

const MANAGED_ACTIONS = new Set(["draft", "implement", "fastForward", "archive"]);
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  const executable = gitExecutable();
  if (!executable) return undefined;
  try {
    const proc = Bun.spawn([executable, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 && Buffer.byteLength(out) <= MAX_SNAPSHOT_BYTES ? out : undefined;
  } catch {
    // Observation is best-effort; a missing Git executable or worktree must not log on every scan.
    return undefined;
  }
}

export async function lifecycleContentHash(worktreePath: string): Promise<string | undefined> {
  const [head, status, diff, untracked] = await Promise.all([
    gitOutput(worktreePath, ["rev-parse", "HEAD"]),
    gitOutput(worktreePath, ["status", "--porcelain=v1", "-z"]),
    gitOutput(worktreePath, ["diff", "--binary", "HEAD"]),
    gitOutput(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (!head || status === undefined || diff === undefined || untracked === undefined) return undefined;
  const chunks = [head, status, diff];
  let size = chunks.reduce((n, value) => n + Buffer.byteLength(value), 0);
  for (const path of untracked.split("\0").filter(Boolean)) {
    const absolute = join(worktreePath, path);
    try {
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SNAPSHOT_BYTES || size + info.size > MAX_SNAPSHOT_BYTES) return undefined;
      const bytes = await readFile(absolute);
      size += bytes.byteLength;
      chunks.push(path, createHash("sha256").update(bytes).digest("hex"));
    } catch {
      return undefined;
    }
    if (size > MAX_SNAPSHOT_BYTES) return undefined;
  }
  return createHash("sha256").update(chunks.join("\0")).digest("hex");
}

/** A proposal may publish only files for its own OpenSpec change, including already committed branch work. */
export async function lifecycleProposalScope(worktreePath: string, base: string | undefined, changeName: string) {
  if (!base) return { allowed: false, paths: [], reason: "the repository base commit cannot be verified" };
  const committed = await gitOutput(worktreePath, ["diff", "--name-only", "--no-renames", "-z", base + "...HEAD"]);
  const working = await gitOutput(worktreePath, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]);
  const untracked = await gitOutput(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (committed === undefined || working === undefined || untracked === undefined) {
    return { allowed: false, paths: [], reason: "proposal paths could not be read completely" };
  }
  const pathSet = new Set<string>();
  for (const output of [committed, working, untracked]) {
    for (const path of output.split("\0")) if (path) pathSet.add(path);
  }
  const paths = [...pathSet].sort();
  const prefix = "openspec/changes/" + changeName + "/";
  for (const path of paths) {
    if (!path.startsWith(prefix) || path.split("/").some((part) => part === ".." || part === ".")) {
      return { allowed: false, paths, reason: "proposal work includes files outside " + prefix.slice(0, -1) };
    }
    try {
      let current = worktreePath;
      const segments = path.split("/");
      for (let index = 0; index < segments.length; index++) {
        current = join(current, segments[index]);
        const info = await lstat(current);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (index < segments.length - 1 && !info.isDirectory())) {
          return { allowed: false, paths, reason: "proposal work includes a link or special file: " + path };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return { allowed: false, paths, reason: "proposal path cannot be verified: " + path };
      }
    }
  }
  return { allowed: true, paths };
}

function isChangeSession(session: import("../shared/types.ts").Session): session is ChangeSession {
  return "repoId" in session && "change" in session && "action" in session;
}

/** Poll-cycle observer: only actions created after this server started can seed automatic delivery records. */
export class LifecycleDeliveryMonitor {
  private readonly coordinator = new LifecycleCoordinator();
  private readonly existingSessionIds: Set<string>;
  private records: LifecycleDeliveryRecord[] = [];
  private started = false;
  private inFlight: Promise<void> | undefined;
  private readonly delivering = new Set<string>();
  private readonly retrying = new Set<string>();

  constructor(private readonly deps: LifecycleMonitorDependencies, private readonly path = lifecycleDeliveryPath()) {
    this.existingSessionIds = new Set(deps.listSessions().map((session) => session.id));
  }

  async init(): Promise<void> {
    if (this.started) return;
    this.records = await readLifecycleDelivery(this.path);
    this.started = true;
    const sessions = this.deps.listSessions();
    for (const record of this.records) {
      if (record.state === "blocked" && /there is nothing to ship \(merged\)/i.test(record.blocker ?? "")) {
        record.state = "merged";
        delete record.blocker;
        record.recovery = [];
        record.updatedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
        await upsertLifecycleDelivery(record, this.path);
        continue;
      }
      if (!["committing", "pushing", "opening-pr"].includes(record.state)) continue;
      const session = sessions.find((item) => item.id === record.sessionId);
      const operation = session && "shipOperation" in session ? session.shipOperation : undefined;
      if (operation?.checkpointId === record.id && operation.state === "unknown") {
        record.state = "pending";
        record.blocker = "Ship was interrupted; retry will reconcile this checkpoint against the current worktree and GitHub PR.";
      } else {
        record.state = "blocked";
        record.blocker = "Ship was interrupted without a matching persisted operation identity; verify the branch and pull request before retrying.";
      }
      record.recovery = ["retry"];
      record.updatedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
      await upsertLifecycleDelivery(record, this.path);
    }
  }

  list(projectId?: string, change?: string): LifecycleDeliveryRecord[] {
    return this.records.filter((record) => (projectId === undefined || record.projectId === projectId) && (change === undefined || record.change === change));
  }

  async retry(id: string, projectId: string, change: string): Promise<LifecycleDeliveryRecord | undefined> {
    const record = this.records.find((item) => item.id === id && item.projectId === projectId && item.change === change);
    if (!record) return undefined;
    if (this.delivering.has(id) || this.retrying.has(id)) return record;
    if (!(record.state === "blocked" || record.state === "unavailable" || record.state === "pending")) return record;
    this.retrying.add(id);
    try {
    record.state = "pending";
    delete record.blocker;
    delete record.retryAt;
    record.updatedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    await upsertLifecycleDelivery(record, this.path);
    await this.deliverRecord(record);
    return record;
    } finally {
      this.retrying.delete(id);
    }
  }

  async observe(snapshot = this.deps.getSnapshot()): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.observeSnapshot(snapshot).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async observeSnapshot(snapshot: Snapshot): Promise<void> {
    await this.init();
    await this.deps.readReports();
    const sessions = this.deps.listSessions();
    const config = this.deps.getConfig();
    for (const session of sessions) {
      if (!isChangeSession(session) || !session.managedActionId || !MANAGED_ACTIONS.has(session.action) || session.inPlace || session.adopted) continue;
      const prior = this.records.filter((record) => record.sessionId === session.id && record.actionId === session.managedActionId);
      if (this.existingSessionIds.has(session.id) && prior.length === 0) continue;
      const repoConfig = config.repos.find((repo) => repo.id === session.repoId);
      const repoSnapshot = snapshot.repos.find((repo) => repo.id === session.repoId);
      if (!repoConfig?.enabled || repoConfig.agent?.enabled === false || !repoSnapshot?.ok) continue;
      const change = repoSnapshot.changes.find((entry) => entry.name === session.change);
      if (!change) continue;
      const phase: LifecycleDeliveryPhase | undefined = session.action === "draft" ? "proposal" : session.action === "archive" ? "archive" : "implementation";
      if (!phase) continue;
      const completion = this.deps.completion(session.id);
      const completionReported = completion?.actionId === session.managedActionId && completion.phase === session.action;
      const completionRevision = completion?.revision ?? 1;
      const cleanExitFallback = session.state === "exited" && session.exitCode === 0;
      const archivePath = change.archived ? join(session.worktreePath, "openspec/changes/archive", `${change.archived}-${session.change}`) : "";
      const archiveIdentityMatches = phase === "archive" && change.archived !== undefined && await existsDirectory(archivePath);
      const activeChangeExists = await existsDirectory(join(session.worktreePath, "openspec/changes", session.change));
      const tasks = change.tasks;
      const tasksVerified = tasks !== null && tasks.total > 0 && ["done", "archived"].includes(change.stage);
      const allTasksChecked = tasks !== null && tasksVerified && tasks.done === tasks.total && (tasks.awaiting ?? 0) === 0;
      const unresolvedArchiveAccepted = phase === "archive" && tasksVerified && !allTasksChecked && session.unresolvedArchiveAcceptedActionId === session.managedActionId;
      const requiredArtifactsReady = change.stage === "ready" || change.stage === "implementing" || change.stage === "done";
      const contentHash = await lifecycleContentHash(session.worktreePath);
      if (!contentHash) continue;
      const head = await gitOutput(session.worktreePath, ["rev-parse", "HEAD"]);
      if (!head) continue;
      const stableHash = createHash("sha256").update(JSON.stringify({
        contentHash,
        stage: change.stage,
        artifacts: change.artifacts,
        tasks: change.tasks,
        archived: change.archived,
        recorded: change.recorded,
        unresolvedArchiveAccepted,
      })).digest("hex");
      const observed = this.coordinator.observe({
        sessionId: session.id,
        actionId: session.managedActionId,
        action: session.action as "draft" | "implement" | "fastForward" | "archive",
        processRunning: session.state === "running",
        completionReported,
        cleanExitFallback,
        historical: this.existingSessionIds.has(session.id) && prior.length === 0,
        requiredArtifactsReady: phase === "proposal" ? change.stage === "ready" : requiredArtifactsReady,
        tasksVerified,
        allTasksChecked,
        unresolvedArchiveAccepted,
        archiveIdentityMatches,
        activeChangeExists,
        snapshotHash: stableHash,
        observedAt: (this.deps.now ?? Date.now)(),
      });
      if (!observed.stable || !observed.phase || !observed.snapshotHash) continue;
      const projectPath = await realpath(repoConfig.path).catch(() => repoConfig.path);
      const rootCommit = await gitOutput(projectPath, ["rev-list", "--max-parents=0", "HEAD"]);
      if (!rootCommit) continue;
      const projectIncarnation = createHash("sha256").update(`${projectPath}\0${rootCommit}`).digest("hex");
      const changeIncarnation = createHash("sha256").update(`${session.change}\0${change.created ?? "unknown"}`).digest("hex");
      const previous = this.records.filter((record) => record.projectIncarnation === projectIncarnation && record.changeIncarnation === changeIncarnation && record.phase === observed.phase && record.actionId === session.managedActionId);
      const same = previous.find((record) => record.snapshotHash === observed.snapshotHash);
      if (same) {
        if (same.state === "pending" && (!same.retryAt || Date.parse(same.retryAt) <= (this.deps.now ?? Date.now)())) await this.deliverRecord(same);
        continue;
      }
      const latest = previous.sort((a, b) => b.revision - a.revision)[0];
      if (latest && latest.completionRevision >= completionRevision) {
        if (latest.state === "pending" && latest.contentHash !== contentHash) {
          latest.state = "blocked";
          latest.blocker = "worktree contents changed after the completion report; confirm a new managed action before delivering this revision";
          latest.recovery = ["resume-agent", "confirm-complete"];
          latest.updatedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
          await upsertLifecycleDelivery(latest, this.path);
        }
        continue;
      }
      const revision = Math.max(0, ...previous.map((record) => record.revision)) + 1;
      const id = createHash("sha256").update(`${projectIncarnation}\0${changeIncarnation}\0${observed.phase}\0${session.managedActionId}\0${revision}`).digest("hex");
      const record: LifecycleDeliveryRecord = {
        version: 1,
        id,
        projectId: repoConfig.id,
        projectPath,
        projectIncarnation,
        change: session.change,
        changeIncarnation,
        phase: observed.phase,
        revision,
        actionId: session.managedActionId,
        completionRevision,
        sessionId: session.id,
        worktreePath: session.worktreePath,
        branch: session.branch ?? "",
        contentHash,
        snapshotHash: observed.snapshotHash,
        head,
        state: "pending",
        recovery: ["retry", "resume-agent"],
        createdAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
        updatedAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
        attempts: 0,
        ...(observed.acceptedUnresolvedTasks ? { acceptedUnresolvedTasks: true } : {}),
      };
      this.records.push(record);
      await upsertLifecycleDelivery(record, this.path);
      await this.deliverRecord(record);
    }
  }

  private async deliverRecord(record: LifecycleDeliveryRecord): Promise<void> {
    if (!this.deps.deliver || this.delivering.has(record.id)) return;
    this.delivering.add(record.id);
    try {
      const now = (this.deps.now ?? Date.now)();
      const running: LifecycleDeliveryRecord = { ...record, state: "committing", attempts: record.attempts + 1, retryAt: undefined, updatedAt: new Date(now).toISOString(), blocker: undefined };
      await upsertLifecycleDelivery(running, this.path);
      Object.assign(record, running);
      const result = await this.deps.deliver(record);
      const updatedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
      const completed: LifecycleDeliveryRecord = {
        ...record,
        state: result.pullRequestUrl ? "waiting-to-merge" : "unavailable",
        ...(result.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
        ...(result.pullRequestNumber ? { pullRequestNumber: result.pullRequestNumber } : {}),
        ...(!result.pullRequestUrl ? { blocker: "No usable GitHub pull-request URL is available for this repository." } : {}),
        recovery: result.pullRequestUrl ? ["retry", "open-pr"] : ["retry"],
        updatedAt,
      };
      await upsertLifecycleDelivery(completed, this.path);
      Object.assign(record, completed);
    } catch (error) {
      const now = (this.deps.now ?? Date.now)();
      const message = error instanceof Error ? error.message : String(error);
      if (/there is nothing to ship \(merged\)/i.test(message)) {
        const merged: LifecycleDeliveryRecord = { ...record, state: "merged", blocker: undefined, recovery: [], updatedAt: new Date(now).toISOString() };
        delete merged.blocker;
        await upsertLifecycleDelivery(merged, this.path);
        Object.assign(record, merged);
        return;
      }
      const transient = /timed? out|temporar|network|connection|try again|rate limit|503|502|504/i.test(message);
      const retry = transient && record.attempts < 5;
      const blocked: LifecycleDeliveryRecord = {
        ...record,
        state: retry ? "pending" : "blocked",
        blocker: message,
        ...(retry ? { retryAt: new Date(now + Math.min(30 * 60_000, 2 ** record.attempts * 5_000)).toISOString() } : {}),
        recovery: ["retry", ...(record.phase === "implementation" ? ["resume-agent" as const] : [])],
        updatedAt: new Date(now).toISOString(),
      };
      await upsertLifecycleDelivery(blocked, this.path);
      Object.assign(record, blocked);
    } finally {
      this.delivering.delete(record.id);
    }
  }
}

async function existsDirectory(path: string): Promise<boolean> {
  if (!path) return false;
  try { return (await lstat(path)).isDirectory(); } catch { return false; }
}
