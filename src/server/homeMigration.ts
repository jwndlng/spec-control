// The one-time move of the home from its pre-rename name (openspec/specs/dashboard-api, "The home moves once from its
// old name"). One rename moves everything at once; a symbolic link at the old path keeps paths held elsewhere working;
// the absolute paths the dashboard itself stored are rewritten; and each session worktree is re-registered with its
// repository. Nothing is ever deleted or forced. Right after the rename every later step is recorded in
// `migration.json` as pending, and the record is rewritten after each step: a step that fails, or that a stopped start
// never reached, is retried on the next start (design D5). Paths are parameters so tests never touch the real `~`.
import { lstat, readdir, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { explicitHome, newDefaultHome, oldDefaultHome, useFallbackHome } from "./paths.ts";
import { repairMovedWorktree } from "./sessions/worktree.ts";

export const MIGRATION_RECORD = "migration.json";

/** The reason a step carries until it has run: a start was stopped after the rename and before it reached the step. */
export const NOT_YET_ATTEMPTED = "not yet attempted";

export type PendingStep =
  | { kind: "link"; error?: string }
  | { kind: "rewrite"; file: string; error: string }
  | { kind: "cache"; error: string }
  | { kind: "repair"; worktree: string; error: string };

interface MigrationRecord {
  migratedAt: string;
  /** Every spelling the old home had, so paths stored under any of them are rewritten. */
  from: string[];
  to: string;
  pending: PendingStep[];
}

export type MigrationOutcome =
  | { kind: "explicit" }
  | { kind: "nothing" }
  | { kind: "migrated"; from: string; to: string; pending: PendingStep[]; recordError?: string }
  /** `resumed`: the record held steps an interrupted start never reached, so this start finished moving `from` to `to`. */
  | { kind: "retried"; pending: PendingStep[]; resumed?: { from: string; to: string } }
  | { kind: "refused"; reason: string }
  | { kind: "both"; old: string };

async function lstatOrUndefined(path: string) {
  return lstat(path).catch(() => undefined);
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Atomic, like every other write in the home, and keeping the file's mode (session records are user-only). */
async function writeAtomic(path: string, body: string): Promise<void> {
  const mode = (await stat(path).catch(() => undefined))?.mode ?? 0o600;
  const tmp = `${path}.${process.pid}.migrate.tmp`;
  await writeFile(tmp, body, { mode: mode & 0o777 });
  await rename(tmp, path);
}

/** Every string that is one of `from` or lies below it, with that prefix replaced by `to`. */
function rewriteValue(value: unknown, from: string[], to: string): unknown {
  if (typeof value === "string") {
    for (const prefix of from) {
      if (value === prefix) return to;
      if (value.startsWith(prefix + sep)) return to + value.slice(prefix.length);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, from, to));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteValue(v, from, to)]));
  return value;
}

/** Rewrites a JSON file's stored paths; a file holding none is left byte for byte as it was. */
export async function rewriteJsonPaths(file: string, from: string[], to: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const before = JSON.parse(text);
  const after = rewriteValue(before, from, to);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  await writeAtomic(file, `${JSON.stringify(after, null, 2)}\n`);
}

/** The files holding paths the dashboard stored itself: `config.json` and every session record. */
async function filesWithStoredPaths(home: string): Promise<string[]> {
  const sessions = await readdir(join(home, "sessions")).catch(() => [] as string[]);
  return [join(home, "config.json"), ...sessions.map((id) => join(home, "sessions", id, "meta.json"))];
}

/** Every directory under `worktrees/<repoId>/`. Which of them are linked worktrees is for the repair to find out. */
async function worktreeDirs(home: string): Promise<string[]> {
  const root = join(home, "worktrees");
  const out: string[] = [];
  for (const repo of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!repo.isDirectory()) continue;
    for (const entry of await readdir(join(root, repo.name), { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) out.push(join(root, repo.name, entry.name));
    }
  }
  return out;
}

async function linkStep(oldHome: string, newHome: string): Promise<PendingStep | undefined> {
  // Anything already at the old path — our link, or something the user put there — is left alone.
  if (await lstatOrUndefined(oldHome)) return undefined;
  try {
    await symlink(newHome, oldHome);
    return undefined;
  } catch {
    return { kind: "link" };
  }
}

async function rewriteStep(file: string, from: string[], to: string): Promise<PendingStep | undefined> {
  try {
    await rewriteJsonPaths(file, from, to);
    return undefined;
  } catch (err) {
    return { kind: "rewrite", file, error: reason(err) };
  }
}

/** A cache, not state: the first scan writes it anew, so it is dropped rather than rewritten. */
async function cacheStep(home: string): Promise<PendingStep | undefined> {
  try {
    await rm(join(home, "cache", "snapshot.json"), { force: true });
    return undefined;
  } catch (err) {
    return { kind: "cache", error: reason(err) };
  }
}

async function repairStep(worktree: string): Promise<PendingStep | undefined> {
  if (!(await lstatOrUndefined(worktree))) return undefined; // gone: nothing left to repair
  const error = await repairMovedWorktree(worktree);
  // A directory that is no linked worktree (a work status of `missing`) has no record to repair.
  return error === undefined || error === "not a linked worktree" ? undefined : { kind: "repair", worktree, error };
}

async function readRecord(home: string): Promise<MigrationRecord | undefined> {
  try {
    return JSON.parse(await readFile(join(home, MIGRATION_RECORD), "utf8")) as MigrationRecord;
  } catch {
    return undefined;
  }
}

async function writeRecord(home: string, record: MigrationRecord): Promise<void> {
  const path = join(home, MIGRATION_RECORD);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export interface MigrationOptions {
  /** Test seam: runs after each write of the record, with what it lists as pending; throwing stops the migration there. */
  onRecorded?: (pending: readonly PendingStep[]) => void | Promise<void>;
}

/**
 * Runs the record's pending steps in order and rewrites the record after each one, listing the steps that failed and
 * those not reached yet, so a start stopped anywhere leaves the next one exactly what is left. Every step is safe to
 * run again. A record that cannot be written is no reason to stop: the step ran, and the next write may succeed.
 */
async function runRecorded(record: MigrationRecord, oldHome: string, newHome: string, options: MigrationOptions): Promise<PendingStep[]> {
  const failed: PendingStep[] = [];
  const todo = [...record.pending];
  for (let step = todo.shift(); step; step = todo.shift()) {
    let result: PendingStep | undefined;
    if (step.kind === "link") result = await linkStep(oldHome, newHome);
    else if (step.kind === "rewrite") result = await rewriteStep(step.file, record.from, record.to);
    else if (step.kind === "cache") result = await cacheStep(newHome);
    else result = await repairStep(step.worktree);
    if (result) failed.push(result);
    const pending = [...failed, ...todo];
    await writeRecord(newHome, { ...record, pending }).catch(() => undefined);
    await options.onRecorded?.(pending);
  }
  return failed;
}

/**
 * Moves `oldHome` to `newHome` when only the old one exists, or retries what an earlier migration left pending. Never
 * consults the environment: `startHomeMigration` decides whether a migration may run at all.
 */
export async function migrateHome(oldHome: string, newHome: string, options: MigrationOptions = {}): Promise<MigrationOutcome> {
  const [oldEntry, newEntry] = await Promise.all([lstatOrUndefined(oldHome), lstatOrUndefined(newHome)]);

  if (newEntry) {
    if (oldEntry?.isDirectory()) return { kind: "both", old: oldHome };
    const record = await readRecord(newHome);
    if (!record || record.pending.length === 0) return { kind: "nothing" };
    const resumed = record.pending.some((step) => step.error === NOT_YET_ATTEMPTED);
    const pending = await runRecorded(record, oldHome, newHome, options);
    return { kind: "retried", pending, ...(resumed ? { resumed: { from: record.from[0] ?? oldHome, to: record.to } } : {}) };
  }

  if (!oldEntry) return { kind: "nothing" };
  // Our own link left behind while the new home is missing (deleted by hand): moving it would make the home a link
  // to itself. A link to anywhere else is a home the user relocated, and the rename moves the link, not its target.
  if (oldEntry.isSymbolicLink() && resolve(dirname(oldHome), await readlink(oldHome)) === newHome) return { kind: "nothing" };
  // Captured before the move: a path stored under the resolved spelling has to be rewritten too.
  const from = [...new Set([oldHome, await realpath(oldHome).catch(() => oldHome)])];
  try {
    await rename(oldHome, newHome);
  } catch (err) {
    return { kind: "refused", reason: reason(err) };
  }

  // Before any later step: from here on a stopped start must leave the rest to the next one, never "nothing to do".
  const error = NOT_YET_ATTEMPTED;
  const steps: PendingStep[] = [
    { kind: "link", error },
    ...(await filesWithStoredPaths(newHome)).map((file): PendingStep => ({ kind: "rewrite", file, error })),
    { kind: "cache", error },
    ...(await worktreeDirs(newHome)).map((worktree): PendingStep => ({ kind: "repair", worktree, error })),
  ];
  const record: MigrationRecord = { migratedAt: new Date().toISOString(), from, to: newHome, pending: steps };
  // The rename cannot be undone, so a record that cannot be written is reported and the migration goes on.
  const recordError = await writeRecord(newHome, record).then(
    () => undefined,
    (err: unknown) => reason(err),
  );
  await options.onRecorded?.(steps);
  const pending = await runRecorded(record, oldHome, newHome, options);
  return { kind: "migrated", from: oldHome, to: newHome, pending, ...(recordError ? { recordError } : {}) };
}

/** What a pending step is, in words for the start-up line and the environment check. */
export function describeStep(step: PendingStep): string {
  if (step.error === NOT_YET_ATTEMPTED) {
    if (step.kind === "link") return "the link at the old home was not made yet";
    if (step.kind === "rewrite") return `${step.file} was not rewritten yet`;
    if (step.kind === "cache") return "the cached snapshot was not dropped yet";
    return `the worktree ${step.worktree} was not re-registered yet`;
  }
  if (step.kind === "link") return "the link at the old home could not be created";
  if (step.kind === "rewrite") return `${step.file} could not be rewritten: ${step.error}`;
  if (step.kind === "cache") return `the cached snapshot could not be dropped: ${step.error}`;
  return `the worktree ${step.worktree} could not be re-registered: ${step.error}`;
}

let lastOutcome: MigrationOutcome = { kind: "nothing" };

/** The outcome of this run's migration, for the environment check. */
export function migrationOutcome(): MigrationOutcome {
  return lastOutcome;
}

/** Set by `startHomeMigration`; exported so the environment check's tests can state an outcome without a migration. */
export function recordMigrationOutcome(outcome: MigrationOutcome): void {
  lastOutcome = outcome;
}

/**
 * The start-up entry: no migration when a variable chose the home; otherwise migrate or retry, and when the old home
 * could not be moved use it for this run, exactly as before.
 */
export async function startHomeMigration(oldHome = oldDefaultHome(), newHome = newDefaultHome()): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = explicitHome() ? { kind: "explicit" } : await migrateHome(oldHome, newHome);
  recordMigrationOutcome(outcome);
  useFallbackHome(outcome.kind === "refused" ? oldHome : undefined);
  return outcome;
}

/** One start-up line, or none when there is nothing to say. */
export function describeOutcome(outcome: MigrationOutcome): string[] {
  switch (outcome.kind) {
    case "migrated":
      return [
        `moved ${outcome.from} to ${outcome.to}; a link remains at the old path`,
        ...(outcome.recordError ? [`warning: the migration record could not be written (${outcome.recordError}); a start stopped now would not finish the move`] : []),
        ...outcome.pending.map((s) => `warning: ${describeStep(s)} (will retry on the next start)`),
      ];
    case "retried":
      return [
        ...(outcome.resumed ? [`finished moving ${outcome.resumed.from} to ${outcome.resumed.to}, which an earlier start was stopped in the middle of`] : []),
        ...outcome.pending.map((s) => `warning: ${describeStep(s)} (will retry on the next start)`),
      ];
    case "refused":
      return [`warning: the home could not be moved to its new name (${outcome.reason}); using the old one for now`];
    case "both":
      return [`warning: ${outcome.old} still exists next to the new home; it is no longer used`];
    default:
      return [];
  }
}
