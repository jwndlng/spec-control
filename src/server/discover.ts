import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { DiscoveredRepo, DiscoverResult, FrameworkId, IntegratableRepo, RepoConfig } from "../shared/types.ts";
import { assignRepoId, newRepoConfig, repoNameFromPath } from "./config.ts";
import { detectFramework, skippedDirs } from "./frameworks/registry.ts";
import { normalizeRemote, originUrl } from "./git.ts";
import { canonicalPath } from "./paths.ts";

export const DEFAULT_MAX_DEPTH = 4;
const REMOTE_LOOKUPS = 8;
export const IGNORED_DIRS = new Set(["node_modules", ".git", ".venv", "target", "dist"]);

/** Whether some registered framework's project marker is in `dir` — and, once it appears, an integration that worked. */
export async function isSpecProject(dir: string): Promise<boolean> {
  return (await detectFramework(dir)) !== undefined;
}

/** A linked git worktree has a `.git` *file* (pointing at the main repo) instead of a directory. */
async function isLinkedWorktree(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, ".git"))).isFile();
  } catch {
    return false;
  }
}

/** At or below one of the (canonical) ignore paths; whole segments only, so `/w/repos` does not cover `/w/repos-extra`. */
function isIgnored(dir: string, ignorePaths: string[]): boolean {
  return ignorePaths.some((p) => dir === p || dir.startsWith(p.endsWith(sep) ? p : p + sep));
}

async function hasOwnGitDir(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

interface Walk {
  maxDepth: number;
  /** Project folder → the framework whose marker it has. */
  found: Map<string, FrameworkId>;
  integratable: Set<string>;
  ignorePaths: string[];
  /** Every framework's own tree: never a place to look for projects. */
  skipDirs: Set<string>;
}

async function walk(dir: string, depth: number, w: Walk): Promise<void> {
  if (isIgnored(dir, w.ignorePaths)) return;
  const framework = await detectFramework(dir);
  if (framework) {
    // Worktrees mirror their main repo's changes; listing them would show every change twice.
    if (!(await isLinkedWorktree(dir))) w.found.set(dir, framework.id);
    // Anything nested inside a repo (fixtures, vendored copies, in-repo worktrees) is not a project of its own.
    return;
  }
  // A git repository without the marker: a candidate for integration. The walk deliberately keeps descending — stopping
  // here would change which projects are reported. Containers are dropped afterwards, once the projects are known.
  if ((await hasOwnGitDir(dir)) && !(await isLinkedWorktree(dir))) w.integratable.add(dir);
  if (depth >= w.maxDepth) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: skip silently, the root itself was checked by the caller
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || w.skipDirs.has(entry.name)) continue;
    await walk(join(dir, entry.name), depth + 1, w);
  }
}

/**
 * Finds directories carrying a registered framework's project marker (for OpenSpec `openspec/config.yaml`) under each
 * root, up to `maxDepth` levels down. Roots are canonicalised first and the walk never follows symlinks, so every
 * reported path is canonical and a directory is reported once however the roots were spelled. Errors name the root as
 * the user typed it. `frameworks` maps each reported path to the framework whose marker it has. `cloning` are folders
 * a GitHub clone is still writing (`githubClone.ts`): skipped like ignore paths, since a half-written `.git` would read
 * as integratable and a half-written tree as anything at all.
 */
export async function findSpecProjects(
  roots: string[],
  maxDepth = DEFAULT_MAX_DEPTH,
  ignorePaths: string[] = [],
  cloning: string[] = [],
): Promise<{ paths: string[]; frameworks: Map<string, FrameworkId>; integratable: string[]; errors: DiscoverResult["errors"] }> {
  const w: Walk = { maxDepth, found: new Map(), integratable: new Set(), ignorePaths: [...ignorePaths, ...cloning].map(canonicalPath), skipDirs: skippedDirs() };
  const errors: DiscoverResult["errors"] = [];
  for (const root of roots) {
    const abs = canonicalPath(root);
    try {
      if (!(await stat(abs)).isDirectory()) {
        errors.push({ root, message: "not a directory" });
        continue;
      }
    } catch {
      errors.push({ root, message: "does not exist" });
      continue;
    }
    await walk(abs, 0, w);
  }
  const projects = new Set(w.found.keys());
  return { paths: [...projects].sort(), frameworks: w.found, integratable: withoutContainers(w.integratable, projects), errors };
}

/**
 * A directory that holds a spec project below it is a container, not a project waiting to be set up: a monorepo
 * with one OpenSpec package offers the package, not the monorepo.
 */
function withoutContainers(integratable: Set<string>, projects: Set<string>): string[] {
  const inside = (dir: string) => {
    const prefix = dir.endsWith(sep) ? dir : dir + sep;
    for (const project of projects) if (project.startsWith(prefix)) return true;
    return false;
  };
  return [...integratable].filter((dir) => !inside(dir)).sort();
}

/**
 * Integratable paths that are not configured yet. A repository already in the config is never offered: it is tracked,
 * whatever state its `openspec/` tree is in.
 */
export function toIntegratable(known: RepoConfig[], paths: string[]): IntegratableRepo[] {
  const knownPaths = new Set(known.map((r) => canonicalPath(r.path)));
  const taken = known.map((r) => r.id);
  return paths
    .filter((path) => !knownPaths.has(path))
    .map((path) => ({ id: assignRepoId(path, taken), path, name: repoNameFromPath(path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Found paths that are not configured yet, as untracked repos. Known repos
 * (enabled or not) are never candidates, so user choices survive re-discovery.
 */
export function toCandidates(known: RepoConfig[], paths: string[], frameworks?: Map<string, FrameworkId>): DiscoveredRepo[] {
  const knownPaths = new Set(known.map((r) => canonicalPath(r.path)));
  // The id each candidate would be added with, so Enable and Settings store exactly what discovery reported.
  const taken = known.map((r) => r.id);
  return paths
    .filter((path) => !knownPaths.has(path))
    .map((path) => {
      const framework = frameworks?.get(path);
      const repo = newRepoConfig(path, false, taken);
      return framework ? { ...repo, framework } : repo;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Normalised `origin` per repository path, at most `REMOTE_LOOKUPS` git calls at a time. A failed lookup means "no remote". */
async function remotesOf(paths: string[]): Promise<Map<string, string>> {
  const remotes = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      // Inside a bigger repository git would answer with that repository's remote: sibling projects of a monorepo are not clones.
      const url = (await hasOwnGitDir(path)) ? await originUrl(path).catch(() => undefined) : undefined;
      const remote = url ? normalizeRemote(url) : undefined;
      if (remote) remotes.set(path, remote);
    }
  };
  await Promise.all(Array.from({ length: Math.min(REMOTE_LOOKUPS, paths.length) }, worker));
  return remotes;
}

/** Marks candidates that share their `origin` with another known repository, tracked or candidate. Informational only. */
export async function withSameRemote(known: RepoConfig[], candidates: DiscoveredRepo[]): Promise<DiscoveredRepo[]> {
  const all = [...known.map((repo) => ({ repo, tracked: true })), ...candidates.map((repo) => ({ repo, tracked: false }))];
  const remotes = await remotesOf(all.map((e) => e.repo.path));
  return candidates.map((candidate) => {
    const remote = remotes.get(candidate.path);
    const others = remote ? all.filter((e) => e.repo.path !== candidate.path && remotes.get(e.repo.path) === remote) : [];
    if (others.length === 0) return candidate;
    return { ...candidate, sameRemoteAs: others.map((e) => ({ name: e.repo.name, path: e.repo.path, tracked: e.tracked })) };
  });
}

/** `cloning`: target folders of clones still running, reported in neither result until they have finished. */
export async function discoverRepos(known: RepoConfig[], roots: string[], ignorePaths: string[] = [], cloning: string[] = []): Promise<DiscoverResult> {
  const { paths, frameworks, integratable, errors } = await findSpecProjects(roots, DEFAULT_MAX_DEPTH, ignorePaths, cloning);
  return { candidates: await withSameRemote(known, toCandidates(known, paths, frameworks)), integratable: toIntegratable(known, integratable), errors };
}
