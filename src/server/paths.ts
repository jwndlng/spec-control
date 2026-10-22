import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, parse } from "node:path";

/** The home before the rename; only the home migration and its fallback look at it. */
export function oldDefaultHome(): string {
  return join(homedir(), ".openspec-dashboard");
}

export function newDefaultHome(): string {
  return join(homedir(), ".spec-control");
}

/** The variable that chose the home, if one did. `OPENSPEC_DASHBOARD_HOME` is deprecated and read only after `SPEC_CONTROL_HOME`. */
export function explicitHome(): { path: string; variable: "SPEC_CONTROL_HOME" | "OPENSPEC_DASHBOARD_HOME" } | undefined {
  if (process.env.SPEC_CONTROL_HOME) return { path: process.env.SPEC_CONTROL_HOME, variable: "SPEC_CONTROL_HOME" };
  if (process.env.OPENSPEC_DASHBOARD_HOME) return { path: process.env.OPENSPEC_DASHBOARD_HOME, variable: "OPENSPEC_DASHBOARD_HOME" };
  return undefined;
}

// Set for one run by a home migration that could not rename the old home, so nothing is lost. Never an environment
// variable: agents started by the dashboard must not inherit it.
let fallbackHome: string | undefined;

export function useFallbackHome(path: string | undefined): void {
  fallbackHome = path;
}

/** Base directory for config and cache; overridable for tests. */
export function dashboardHome(): string {
  return explicitHome()?.path ?? fallbackHome ?? newDefaultHome();
}

export function configPath(): string {
  return join(dashboardHome(), "config.json");
}

/** Agent session records (metadata and the stored tail of terminal output); never inside a repository. */
export function sessionsDir(): string {
  return join(dashboardHome(), "sessions");
}

/** Session worktrees live in the dashboard home, so tracked repositories never see an untracked directory. */
export function worktreesDir(): string {
  return join(dashboardHome(), "worktrees");
}

/** The main console's default working directory: dashboard-owned, so the console never starts inside a repository. */
export function consoleDir(): string {
  return join(dashboardHome(), "console");
}

export function sharedConfigPath(): string {
  return join(dashboardHome(), "shared-config.json");
}

/** History of what the dashboard observed. A log, not a cache: it cannot be rebuilt, and nothing but the feed reads it. */
export function activityLogPath(): string {
  return join(dashboardHome(), "activity.jsonl");
}

/** The last update check's time and outcome (openspec/specs/update-notice). A cache: missing means never checked. */
export function updateCheckPath(): string {
  return join(dashboardHome(), "update-check.json");
}

export function cachePath(): string {
  return join(dashboardHome(), "cache", "snapshot.json");
}

/**
 * Object store for the in-memory merges that decide a work status's conflict signal. `git merge-tree --write-tree`
 * writes the tree it produces somewhere; pointing it here (with the repository's own objects offered only as an
 * alternate) is what keeps the check a read of the tracked repository. Nothing in it is worth keeping: it is created
 * on demand and emptied on start-up.
 */
export function mergeScratchDir(): string {
  return join(dashboardHome(), "merge-scratch");
}

/** Expands a leading `~` and normalises; relative paths stay relative so validation can reject them. */
export function expandPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return normalize(p);
}

/**
 * The one spelling of a directory: `~` expanded, symlinks resolved and on-disk casing (the native realpath reports the
 * stored casing on case-insensitive volumes; the JS implementation only resolves symlinks). A path that does not exist
 * is returned normalised, so a deleted repository keeps the identity it was stored under. Relative paths stay relative
 * (never resolved against the working directory) so validation can reject them.
 */
export function canonicalPath(p: string): string {
  const expanded = expandPath(p);
  if (!isAbsolute(expanded)) return expanded;
  let resolved: string;
  try {
    resolved = realpathSync.native(expanded);
  } catch {
    resolved = expanded;
  }
  return resolved.length > parse(resolved).root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
}

/**
 * Where an executable is found on the PATH, or undefined. Deliberately passes `PATH` explicitly: `Bun.which(cmd)` uses
 * the PATH captured when the process started, so it would not see a PATH the process changed — which is exactly what a
 * test does, and what an environment check has to be able to observe.
 */
export function whichOnPath(command: string): string | undefined {
  return Bun.which(command, { PATH: process.env.PATH ?? "" }) ?? undefined;
}

/** Last fetched pull-request lists. Display-only: deleting it loses the cached lists and nothing else. */
export function pullRequestsCachePath(): string {
  return join(dashboardHome(), "pull-requests.json");
}

/** Copies of the uncommitted files of worktrees the user deleted with their branch; never pruned by the dashboard. */
export function branchBackupsDir(): string {
  return join(dashboardHome(), "branch-backups");
}
