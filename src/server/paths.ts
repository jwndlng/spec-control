import { realpathSync, statSync } from "node:fs";
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

/**
 * What decides whether macOS's `/usr/bin/git` is git. On every Mac that path is an `xcrun` placeholder: it runs the git of
 * the active developer directory, or, when there is none, asks the system to offer installing the command line
 * developer tools and fails. Replaceable for tests, which have no Mac (and must not depend on whether theirs has the
 * tools); the server always uses the defaults.
 */
export interface GitLookup {
  platform: string;
  env: Record<string, string | undefined>;
  placeholder: string;
  /** The link `xcode-select --switch` maintains. */
  selectLink: string;
  /** Where `xcode-select -p` looks when neither `DEVELOPER_DIR` nor the link names a directory, in its order. */
  developerDirs: readonly string[];
}

let gitLookupOverride: Partial<GitLookup> | undefined;

/** For tests: simulate another machine's git lookup, or `undefined` to return to this one's. */
export function useGitLookup(lookup: Partial<GitLookup> | undefined): void {
  gitLookupOverride = lookup;
}

function gitLookup(): GitLookup {
  return {
    platform: process.platform,
    env: process.env,
    placeholder: "/usr/bin/git",
    selectLink: "/var/db/xcode_select_link",
    developerDirs: ["/Applications/Xcode.app/Contents/Developer", "/Library/Developer/CommandLineTools"],
    ...gitLookupOverride,
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The active developer directory, found the way `xcode-select -p` finds it but with file-system lookups only: starting
 * `xcode-select` would be a process the environment report promises not to start.
 */
function developerDir(lookup: GitLookup): string | undefined {
  const fromEnv = lookup.env.DEVELOPER_DIR;
  let fromLink: string | undefined;
  try {
    fromLink = realpathSync(lookup.selectLink);
  } catch {
    fromLink = undefined;
  }
  const candidates = [fromEnv, fromLink, ...lookup.developerDirs].filter((dir): dir is string => Boolean(dir));
  return candidates.find(isDirectory);
}

/**
 * The first `git` on the PATH — the one every git command the dashboard runs would start — and whether it is only
 * macOS's placeholder (`placeholder: true`), which is never run to find out.
 */
export function locateGit(): { path: string; placeholder: boolean } | undefined {
  const path = whichOnPath("git");
  if (!path) return undefined;
  const lookup = gitLookup();
  if (lookup.platform !== "darwin" || realpathOrSelf(path) !== realpathOrSelf(lookup.placeholder)) return { path, placeholder: false };
  const dir = developerDir(lookup);
  return { path, placeholder: !(dir && isFile(join(dir, "usr", "bin", "git"))) };
}

/** Where git is, when it is git: the one answer every "is git there" question gets (environment-check). */
export function gitExecutable(): string | undefined {
  const git = locateGit();
  return git && !git.placeholder ? git.path : undefined;
}

/** Last fetched pull-request lists. Display-only: deleting it loses the cached lists and nothing else. */
export function pullRequestsCachePath(): string {
  return join(dashboardHome(), "pull-requests.json");
}

/** Copies of the uncommitted files of worktrees the user deleted with their branch; never pruned by the dashboard. */
export function branchBackupsDir(): string {
  return join(dashboardHome(), "branch-backups");
}
