// Session records live under ~/.spec-control/sessions/<id>/: `meta.json` (written atomically), once a session has
// ended `output.bin` with the tail of its terminal output, and `agent-state` when the agent reported its state there
// (reportedState.ts). User-only files: a terminal shows whatever the agent printed.
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OPEN_SESSION_STATES, type Session } from "../../shared/types.ts";
import { sessionsDir } from "../paths.ts";

export const KEEP_ENDED_SESSIONS = 50;
const SESSION_ID = /^[a-f0-9-]{36}$/;
const STATE_FILE = "agent-state";

export class SessionStore {
  private writes = new Map<string, Promise<unknown>>();
  private tmpCounter = 0;

  /** Writes for one session run one after another; overlapping atomic renames would otherwise trip over each other. */
  private serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (this.writes.get(id) ?? Promise.resolve()).then(task, task);
    this.writes.set(id, next.catch(() => undefined));
    return next;
  }

  /** Resolves once every write queued so far has finished, whether it succeeded or not. */
  async idle(): Promise<void> {
    await Promise.all(this.writes.values());
  }

  private dir(id: string): string {
    if (!SESSION_ID.test(id)) throw new Error(`invalid session id: ${id}`);
    return join(sessionsDir(), id);
  }

  private async writeAtomic(id: string, name: string, body: string | Uint8Array): Promise<void> {
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    const tmp = `${path}.${process.pid}.${++this.tmpCounter}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, path);
    await chmod(path, 0o600);
  }

  /** Where the agent may report its state: in the record folder, so it goes wherever the record goes. */
  statePath(id: string): string {
    return join(this.dir(id), STATE_FILE);
  }

  activityPath(id: string): string {
    return join(this.dir(id), "agent-activity");
  }

  saveMeta(session: Session): Promise<void> {
    // Snapshot now; the object keeps changing. A waiting report is only true of a running process, so it is not kept.
    const { waitingReportedAt: _, ...stored } = session;
    const body = JSON.stringify(stored, null, 2);
    return this.serial(session.id, () => this.writeAtomic(session.id, "meta.json", body));
  }

  saveOutput(id: string, output: Uint8Array): Promise<void> {
    return this.serial(id, () => this.writeAtomic(id, "output.bin", output));
  }

  async readOutput(id: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(join(this.dir(id), "output.bin")));
    } catch {
      return new Uint8Array();
    }
  }

  async loadAll(): Promise<Session[]> {
    let ids: string[];
    try {
      ids = await readdir(sessionsDir());
    } catch {
      return [];
    }
    const sessions: Session[] = [];
    for (const id of ids) {
      if (!SESSION_ID.test(id)) continue;
      try {
        const session = JSON.parse(await readFile(join(sessionsDir(), id, "meta.json"), "utf8")) as Session;
        if (typeof session.worktreePath === "string" && typeof session.agentId === "string") sessions.push(session); // skips records of the earlier, transcript-based format
      } catch {
        // unreadable record: leave it on disk, do not list it
      }
    }
    return sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: string): Promise<void> {
    await this.serial(id, () => rm(this.dir(id), { recursive: true, force: true }));
    this.writes.delete(id);
  }

  /** Keeps every running session and the newest `keep` ended ones; returns the ids it removed. */
  async prune(sessions: Session[], keep = KEEP_ENDED_SESSIONS): Promise<string[]> {
    const ended = sessions.filter((s) => !OPEN_SESSION_STATES.includes(s.state)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const removed: string[] = [];
    for (const session of ended.slice(keep)) {
      await this.delete(session.id);
      removed.push(session.id);
    }
    return removed;
  }
}
