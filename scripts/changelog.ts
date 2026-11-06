import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface ChangelogEntry {
  id: string;
  date: string;
  title: string;
  summary: string;
  /** Preserves the pre-migration order where present; new same-day entries fall back to id order. */
  order?: number;
}

const ID = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function validateEntries(entries: readonly ChangelogEntry[], filenames: ReadonlyMap<string, string> = new Map()): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    const filename = filenames.get(entry.id);
    if (filename && basename(filename, ".json") !== entry.id) throw new Error(`${filename}: filename does not match id ${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    const match = ID.exec(entry.id);
    if (!match) throw new Error(`${entry.id}: id is not <YYYY-MM-DD>-<kebab-case-slug>`);
    if (!validDate(entry.date)) throw new Error(`${entry.id}: invalid date ${entry.date}`);
    if (match[1] !== entry.date) throw new Error(`${entry.id}: id does not start with the entry's date ${entry.date}`);
    if (!entry.title.trim()) throw new Error(`${entry.id}: empty title`);
    if (!entry.summary.trim()) throw new Error(`${entry.id}: empty summary`);
    if (entry.order !== undefined && (!Number.isInteger(entry.order) || entry.order < 0)) throw new Error(`${entry.id}: invalid order`);
  }
}

export function sortEntries(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
}

export async function loadChangelog(directory: string): Promise<ChangelogEntry[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const entries: ChangelogEntry[] = [];
  const filenames = new Map<string, string>();
  for (const filename of files) {
    const entry = JSON.parse(await readFile(join(directory, filename), "utf8")) as ChangelogEntry;
    entries.push(entry);
    filenames.set(entry.id, filename);
  }
  validateEntries(entries, filenames);
  return sortEntries(entries);
}
