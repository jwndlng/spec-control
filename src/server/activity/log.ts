// The activity log (design: add-activity-feed D5, activity-log-retention). Append-only JSON Lines in the dashboard
// home, bounded by age and by compaction, tolerant when read. History only: nothing but the feed reads it, and a failure here never fails a scan.
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pageEvents, retained, type ActivityQuery } from "../../shared/activity.ts";
import { ACTIVITY_KINDS, type ActivityEvent, type ActivityKind, type ActivityPage } from "../../shared/types.ts";
import { activityLogPath } from "../paths.ts";

/** Entries kept in memory and after a compaction. */
export const KEEP_ENTRIES = 2000;
/** The file is compacted once it has grown beyond this many lines. */
export const COMPACT_ABOVE_LINES = 5000;
/** While running, entries that aged out are removed from the file at most this often (when events are recorded). */
export const AGE_COMPACT_EVERY_MS = 60 * 60 * 1000;
export { MAX_PAGE, type ActivityQuery as PageQuery } from "../../shared/activity.ts";

function parseLine(line: string): ActivityEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    const value = JSON.parse(line) as Partial<ActivityEvent>;
    if (value?.v !== 1 || typeof value.id !== "string" || typeof value.at !== "string" || typeof value.repoId !== "string") return undefined;
    if (!ACTIVITY_KINDS.includes(value.kind as ActivityKind)) return undefined;
    return value as ActivityEvent;
  } catch {
    return undefined; // a torn or foreign line is skipped, never fatal
  }
}

export class ActivityLog {
  /** In detection order, oldest first; at most KEEP_ENTRIES, and none older than the retention window when last pruned. */
  private entries: ActivityEvent[] = [];
  private lines = 0;
  /** The file ends in a torn line (a write was cut off): the next append must start on a line of its own. */
  private unterminated = false;
  private queue: Promise<void> = Promise.resolve();
  private warned = false;
  /** Entries pruned from memory for their age that may still be in the file. */
  private agedOut = 0;
  private lastCompactedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly path = activityLogPath(),
    private readonly now: () => number = Date.now,
  ) {}

  /** Reads what is there and compacts a file that has outgrown what is kept. Never throws. */
  async load(): Promise<void> {
    let raw = "";
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      // no log yet
    }
    this.unterminated = raw.length > 0 && !raw.endsWith("\n");
    const lines = raw.split("\n");
    this.lines = lines.filter((l) => l.trim()).length;
    const parsed = lines.map(parseLine).filter((e): e is ActivityEvent => e !== undefined);
    const recent = retained(parsed, this.now());
    this.entries = recent.slice(-KEEP_ENTRIES);
    // Unparseable lines alone are no reason to rewrite: a newer version's lines survive a downgrade until a real compaction.
    const upTo = this.entries;
    if (recent.length < parsed.length || this.lines > KEEP_ENTRIES) await this.enqueue(() => this.compact(upTo));
  }

  /** Records events. Resolves when they are on disk (or the attempt failed — which is only reported). */
  append(incoming: readonly ActivityEvent[]): Promise<void> {
    const now = this.now();
    // An event that happened before the window (caught up after a long absence) is not recorded at all.
    const events = retained(incoming, now);
    if (events.length === 0) return this.queue;
    this.prune(now);
    this.entries = [...this.entries, ...events].slice(-KEEP_ENTRIES);
    // What this job may compact to: the entries up to its own events. `entries` is replaced, never changed in place,
    // so appends queued behind it cannot reach this array — they write their own events afterwards, exactly once.
    const upTo = this.entries;
    const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
    return this.enqueue(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, this.unterminated ? `\n${text}` : text, "utf8");
      this.unterminated = false;
      this.lines += events.length;
      if (this.lines > COMPACT_ABOVE_LINES || (this.agedOut > 0 && now - this.lastCompactedAt >= AGE_COMPACT_EVERY_MS)) await this.compact(upTo);
    });
  }

  /** Drops entries from memory that have aged out; the file follows at the next compaction. */
  private prune(now: number): void {
    const kept = retained(this.entries, now);
    this.agedOut += this.entries.length - kept.length;
    this.entries = kept;
  }

  /** Rewrites the file as `upTo` — the entries as they stood when the job was queued — without those aged out. */
  private async compact(upTo: readonly ActivityEvent[]): Promise<void> {
    const now = this.now();
    this.prune(now);
    const kept = retained(upTo, now);
    const tmp = `${this.path}.${process.pid}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tmp, kept.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
    await rename(tmp, this.path);
    this.lines = kept.length;
    this.unterminated = false;
    this.agedOut = 0;
    this.lastCompactedAt = this.now();
  }

  /** One writer at a time; a failed write is reported once and never propagates. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((err) => {
      if (!this.warned) console.warn("could not write the activity log:", err instanceof Error ? err.message : err);
      this.warned = true;
    });
    return this.queue;
  }

  /** Only what is within the window right now, even before the next prune; reading never writes. */
  page(query: ActivityQuery = {}): ActivityPage {
    const now = this.now();
    return pageEvents(retained(this.entries, now), query, now);
  }
}
