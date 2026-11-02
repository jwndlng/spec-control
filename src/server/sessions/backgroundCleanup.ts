// Worktree cleanup after a session has ended, carried on in the background (cleanup-background). Ending the agent is
// the request; the cleanup the user confirmed with it is tracked here, on the session's record, so its outcome belongs
// to the session — not to whichever dialog is open when it finishes — and survives a reload. The work itself is the
// caller's: the same removal and stale cleanup, with the same re-checks, that the end-session dialog used to wait for.
import type { ChangeSession, SessionCleanup, StaleCleanupResult } from "../../shared/types.ts";
import type { Removable } from "./worktree.ts";

/** What a finished cleanup reports, before it is stamped and stored. */
export type CleanupOutcome = Pick<SessionCleanup, "worktreeRemoved" | "reason" | "stale"> & { state: "done" | "failed" };

/** A cleanup's work: resolves with its outcome; a rejection is recorded as a failure with its message. */
export type CleanupRun = () => Promise<CleanupOutcome>;

export const INTERRUPTED_REASON = "the dashboard was stopped before the cleanup finished — nothing it had not re-checked was removed; confirm the cleanup again to finish it";

/** The plain removal's answer: a worktree that is already gone counts as removed, as auto-merge cleanup counts it. */
export function removalOutcome(removed: Removable): CleanupOutcome {
  const gone = removed.removable || removed.reason === "worktree no longer exists";
  return gone ? { state: "done", worktreeRemoved: true } : { state: "failed", worktreeRemoved: false, reason: removed.reason ?? "the worktree is not safe to remove" };
}

/** A stale cleanup's answer. It ran unless it refused outright; kept and copied items are in `stale`, item by item. */
export function staleOutcome(result: StaleCleanupResult, session: Pick<ChangeSession, "worktreePath" | "branch">): CleanupOutcome {
  const worktreeRemoved = result.items.some((i) => i.kind === "worktree" && i.outcome !== "kept" && (i.id === session.worktreePath || i.branch === session.branch));
  if (result.refused !== undefined) return { state: "failed", worktreeRemoved, reason: result.refused, stale: result };
  return { state: "done", worktreeRemoved, stale: result };
}

/**
 * The background cleanups of one session manager: at most one per session at a time. `save` stores the session's
 * record; it is awaited for the `pending` record, so a cleanup is accepted only once a restart would find it.
 */
export class BackgroundCleanups {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly save: (session: ChangeSession) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** Resolves once the session's running cleanup, if any, has finished and its outcome is stored. */
  settled(id: string): Promise<void> {
    return this.running.get(id) ?? Promise.resolve();
  }

  /** Every cleanup running now, for shutdown and tests. */
  async idle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  /**
   * Records the cleanup as pending, then runs it without waiting for it. Resolves with the pending record; the
   * outcome replaces it on the session when `run` settles. The caller has checked that no cleanup runs for it.
   */
  async start(session: ChangeSession, kind: SessionCleanup["kind"], run: CleanupRun): Promise<SessionCleanup> {
    if (this.running.has(session.id)) throw new Error(`a cleanup for session ${session.id} is already running`);
    const pending: SessionCleanup = { kind, state: "pending", startedAt: this.now() };
    let release!: () => void;
    // Taken before the first await, so a second start for the same session is refused rather than run alongside.
    this.running.set(
      session.id,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      session.cleanup = pending;
      await this.save(session);
    } catch (err) {
      this.running.delete(session.id);
      release();
      throw err;
    }
    void this.finish(session, pending, run).finally(() => {
      this.running.delete(session.id);
      release();
    });
    return { ...pending };
  }

  private async finish(session: ChangeSession, pending: SessionCleanup, run: CleanupRun): Promise<void> {
    let outcome: CleanupOutcome;
    try {
      outcome = await run();
    } catch (err) {
      outcome = { state: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
    session.cleanup = { kind: pending.kind, startedAt: pending.startedAt, finishedAt: this.now(), ...outcome };
    await this.save(session).catch(() => undefined); // the record in memory still reports it until the next restart
  }

  /**
   * On start-up: a cleanup recorded as pending was cut off by the dashboard stopping. Returns whether `session` was
   * changed, so the caller saves it.
   */
  static markInterrupted(session: ChangeSession, now = new Date().toISOString()): boolean {
    if (session.cleanup?.state !== "pending") return false;
    session.cleanup = { ...session.cleanup, state: "interrupted", finishedAt: now, reason: INTERRUPTED_REASON };
    return true;
  }
}
