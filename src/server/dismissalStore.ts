import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dismissalsPath } from "./paths.ts";

export interface DismissalRecord {
  repoId: string;
  name: string;
  identity: string;
  created?: string;
  createdAt: string;
  dismissedAt: string;
}

const validCreated = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
const fallback = (repoId: string, name: string) => `fallback:${createHash("sha256").update(`${repoId}\0${name}`).digest("hex")}`;
const withCreation = (created: string) => `created:${created}`;
const parse = (raw: string): DismissalRecord[] => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is DismissalRecord => !!entry && typeof entry === "object" && typeof entry.repoId === "string" && typeof entry.name === "string" && typeof entry.identity === "string" && typeof entry.createdAt === "string" && typeof entry.dismissedAt === "string" && (entry.created === undefined || validCreated(entry.created)));
  } catch { return []; }
};

async function read(): Promise<DismissalRecord[]> {
  try { return parse(await readFile(dismissalsPath(), "utf8")); } catch { return []; }
}

let writing: Promise<unknown> = Promise.resolve();
async function update<T>(change: (records: DismissalRecord[]) => { records: DismissalRecord[]; result: T }): Promise<T> {
  const next = writing.then(async () => {
    const current = await read();
    const updated = change(current);
    const path = dismissalsPath();
    if (updated.records !== current) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(updated.records, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
    }
    return updated.result;
  });
  writing = next.catch(() => undefined);
  return next;
}

/** Creation metadata is accepted only in the framework's validated ISO-date shape. */
export function dismissalIdentity(repoId: string, name: string, created?: string): string {
  return validCreated(created) ? withCreation(created) : fallback(repoId, name);
}

function matching(records: DismissalRecord[], repoId: string, name: string, created?: string): DismissalRecord | undefined {
  const candidates = records.filter((r) => r.repoId === repoId && r.name === name);
  const exact = candidates.find((r) => validCreated(created) ? r.identity === withCreation(created) : r.identity === fallback(repoId, name));
  if (exact) return exact;
  const oldUnknown = candidates.find((r) => r.identity === fallback(repoId, name));
  // A later, validated creation date proves that this name now belongs to a new incarnation.
  if (oldUnknown && validCreated(created) && created > oldUnknown.dismissedAt.slice(0, 10)) return undefined;
  if (oldUnknown && validCreated(created)) return oldUnknown;
  return undefined;
}

export async function currentIdentity(repoId: string, name: string, created?: string): Promise<string> {
  const records = await read();
  return matching(records, repoId, name, created)?.identity ?? dismissalIdentity(repoId, name, created);
}

export async function isDismissed(repoId: string, name: string, created?: string): Promise<boolean> {
  return (await read()).some((r) => matching([r], repoId, name, created) !== undefined);
}

export async function listDismissals(repoId: string): Promise<DismissalRecord[]> {
  return (await read()).filter((r) => r.repoId === repoId);
}

export async function dismissIdentity(repoId: string, name: string, created: string | undefined, identity: string): Promise<DismissalRecord> {
  return update((records) => {
    const actual = matching(records, repoId, name, created)?.identity ?? dismissalIdentity(repoId, name, created);
    if (actual !== identity) throw new Error("the change identity changed; refresh and try again");
    const existing = records.find((r) => r.repoId === repoId && r.name === name && r.identity === identity);
    if (existing) return { records, result: existing };
    const now = new Date().toISOString();
    const record: DismissalRecord = { repoId, name, identity, ...(validCreated(created) ? { created } : {}), createdAt: now, dismissedAt: now };
    return { records: [...records, record], result: record };
  });
}

export async function restoreIdentity(repoId: string, name: string, identity: string): Promise<void> {
  await update((records) => {
    const next = records.filter((r) => !(r.repoId === repoId && r.name === name && r.identity === identity));
    return { records: next.length === records.length ? records : next, result: undefined };
  });
}
