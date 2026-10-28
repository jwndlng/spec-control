// Where a repository's files and git facts come from (design.md D3). v0 ships a local filesystem source; a remote
// source would implement the same interface. It knows no framework: where changes live is the caller's `ChangesLayout`,
// supplied by the repository's framework module (`frameworks/`).
import { closeSync, constants, type Dirent, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { LabelEntry } from "../shared/labels.ts";
import { CHANGE_NAME_PATTERN, type DuplicateAfterArchive, type StaleLeftovers, type StrandedArchive, type Worktree } from "../shared/types.ts";
import { type ActiveChange, findDuplicates, findStrandedArchives, type SessionHint, type StaleInput, staleLeftovers } from "./staleChanges.ts";
import type { ChangeMetadata } from "./frameworks/framework.ts";
import { checkoutStatus, currentBranch, defaultBranch, fetchInfo, hasCommitToBranchFrom, hasRemoteRefs, isGitRepo, lastCommitDate, localOnlyCommits, type ParsedStatus, statusPaths, subdirectory, worktrees } from "./git.ts";

export const CHANGE_NAME = CHANGE_NAME_PATTERN;
const ARCHIVE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** Where a framework keeps its change directories, relative to the project folder. */
export interface ChangesLayout {
  /** One directory per active change, e.g. `openspec/changes`. */
  changesDir: string;
  /** One `YYYY-MM-DD-<name>` directory per archived change; absent when the framework has no archive. */
  archiveDir?: string;
}

export interface ChangeDirEntry {
  name: string;
  /** Absolute directory of the change. */
  dir: string;
  /** ISO date when the entry lives under archive/. */
  archived?: string;
}

/** A file under `openspec/` that differs from HEAD; only these have a meaningful mtime (clean files get theirs from checkout). */
export interface DirtyFile {
  path: string;
  mtimeMs: number;
}

/** What is at a path, without reading it. */
export interface FileInfo {
  size: number;
  /** False for directories, sockets and the like. Symbolic links are followed. */
  isFile: boolean;
  /** The path with every symbolic link resolved. */
  realPath: string;
}

/** Every repository file a scan reads that has no smaller limit of its own (contain-repository-reads design D4). */
export const MAX_REPO_FILE_BYTES = 1024 * 1024;

export interface BoundedReadOptions {
  /** The directory whose real path the file's real path must be inside: the change directory or the checkout. */
  within: string;
  maxBytes: number;
  /** Read at most `maxBytes` and report `truncated` instead of refusing a larger file. */
  truncate?: boolean;
  /** Only an entry directly in `within` that is itself a regular file counts, never a link (design D3). */
  inPlace?: boolean;
}

export type BoundedReadFailure = "missing" | "outside" | "not-a-file" | "too-large" | "unreadable";

export type BoundedRead = { ok: true; text: string; bytes: number; truncated: boolean } | { ok: false; reason: BoundedReadFailure };

/** Why `file` was not read, for a change's or a repository's warnings; undefined for a file that simply is not there. */
export function boundedReadWarning(file: string, read: BoundedRead, maxBytes: number): string | undefined {
  if (read.ok) return undefined;
  switch (read.reason) {
    case "missing":
      return undefined;
    case "outside":
      return `${file} resolves outside its directory and was not read`;
    case "not-a-file":
      return `${file} is not a regular file and was not read`;
    case "too-large":
      return `${file} is larger than ${maxBytes} bytes and was not read`;
    case "unreadable":
      return `${file} could not be read`;
  }
}

function insideOrSame(dir: string, candidate: string): boolean {
  return candidate === dir || candidate.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/**
 * The one way a repository file is read (contain-repository-reads design D1): the real path must lie inside `within`'s,
 * the file is opened without blocking and without following a final link, `fstat` on that descriptor must report a
 * regular file — a named pipe, socket or device is refused before a byte is read — and never more than `maxBytes + 1`
 * bytes are read. The descriptor is always closed. The calls are synchronous, as the adapter's own reads of the same
 * directories are: a scan makes hundreds of these small reads, and each asynchronous step would wait its turn in the
 * thread pool; none of them can block, since nothing that is not a regular file is ever read.
 */
export async function readBounded(absPath: string, options: BoundedReadOptions): Promise<BoundedRead> {
  return readBoundedSync(absPath, options);
}

function readBoundedSync(absPath: string, options: BoundedReadOptions): BoundedRead {
  const { within, maxBytes } = options;
  let realWithin: string;
  try {
    realWithin = realpathSync(within);
  } catch {
    return { ok: false, reason: "missing" };
  }
  let target: string;
  if (options.inPlace) {
    if (resolve(dirname(absPath)) !== resolve(within)) return { ok: false, reason: "outside" };
    // Opened by its name in the real directory: O_NOFOLLOW refuses the entry when it is a link.
    target = join(realWithin, basename(absPath));
  } else {
    try {
      target = realpathSync(absPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return { ok: false, reason: "unreadable" };
      // A missing file outside says so: a path that climbs out is refused whether or not it exists.
      return { ok: false, reason: insideOrSame(resolve(within), resolve(absPath)) || insideOrSame(realWithin, resolve(absPath)) ? "missing" : "outside" };
    }
    if (!insideOrSame(realWithin, target)) return { ok: false, reason: "outside" };
  }
  let fd: number;
  try {
    fd = openSync(target, OPEN_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, reason: "missing" };
    // ELOOP (a link where O_NOFOLLOW asked for none), EISDIR and the like: not a file to read.
    return { ok: false, reason: code === "ELOOP" || code === "EISDIR" || code === "EMLINK" || code === "EFTYPE" ? "not-a-file" : "unreadable" };
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return { ok: false, reason: "not-a-file" };
    if (info.size > maxBytes && !options.truncate) return { ok: false, reason: "too-large" };
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(fd, buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    // The file may have grown since `fstat`; what was read past the limit decides.
    const truncated = length > maxBytes;
    if (truncated && !options.truncate) return { ok: false, reason: "too-large" };
    let text = new TextDecoder().decode(buffer.subarray(0, Math.min(length, maxBytes)));
    // A cut through a multi-byte character leaves a replacement character at the end.
    if (truncated) text = text.replace(/\uFFFD$/, "");
    return { ok: true, text, bytes: info.size, truncated };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
  }
}

/**
 * The first of `relDir`'s segments below `root` that is not a real directory — a symbolic link, a file, or missing —
 * checked with `lstat` one by one (contain-repository-reads design D6); undefined when every one is. `root` itself may
 * be reached through a link: the user configured it.
 */
export async function linkedSegment(root: string, relDir: string): Promise<{ segment: string; reason: "symbolic link" | "not a directory" | "missing" } | undefined> {
  const segments = relDir.split(/[\\/]+/).filter(Boolean);
  for (let i = 1; i <= segments.length; i++) {
    const segment = segments.slice(0, i).join("/");
    const info = await lstat(join(root, segment)).catch(() => undefined);
    if (!info) return { segment, reason: "missing" };
    if (info.isSymbolicLink()) return { segment, reason: "symbolic link" };
    if (!info.isDirectory()) return { segment, reason: "not a directory" };
  }
  return undefined;
}

export interface ChangeListing {
  active: ChangeDirEntry[];
  archived: ChangeDirEntry[];
  warnings: string[];
}

export interface RepoSource {
  readonly path: string;
  /** Whether `relDir`, relative to the project folder, is a directory: how a framework module claims a tracked folder. */
  exists(relDir: string): Promise<boolean>;
  /** The change directories of `layout`. `archived: false` skips the archive, which is only ever read from a main checkout. */
  listChanges(layout: ChangesLayout, options?: { archived?: boolean }): Promise<ChangeListing>;
  /** The same kind of source for another checkout of this repository (a linked worktree). */
  forCheckout(path: string): RepoSource;
  /** Modification time of one directory entry itself (not its contents), in ms; undefined when it does not exist. */
  mtimeMs(absPath: string): Promise<number | undefined>;
  /** The only way a repository file's content is read: contained, non-blocking, regular files only, capped (`readBounded`). */
  readBounded(absPath: string, options: BoundedReadOptions): Promise<BoundedRead>;
  /** Undefined when the path does not exist or a link on the way does not resolve. */
  readFileInfo(absPath: string): Promise<FileInfo | undefined>;
  /** Names of the directories directly inside `absDir`; empty when it does not exist. */
  listDirs(absDir: string): Promise<string[]>;
  /** Names and kinds of the entries directly inside `absDir`, without following symbolic links; empty on failure. */
  listEntries(absDir: string): Promise<LabelEntry[]>;
  newestMtime(dir: string): Promise<string | undefined>;
  isGit(): Promise<boolean>;
  branch(): Promise<string | undefined>;
  /** The default branch as known locally (no remote is asked); undefined when it cannot be told. */
  defaultBranch(): Promise<string | undefined>;
  /** Whether `HEAD` names a commit or `origin/HEAD` exists; false with no commit yet, undefined when it cannot be told. */
  hasCommitToBranchFrom(): Promise<boolean | undefined>;
  worktrees(): Promise<Worktree[]>;
  /** Working-tree status of one checkout; `path` must come from `worktrees()`. Undefined when it cannot be determined. */
  checkoutStatus(path: string): Promise<ParsedStatus | undefined>;
  /** Whether the repository has any remote-tracking ref. */
  hasRemoteRefs(): Promise<boolean | undefined>;
  /** Whether the repository has a remote to fetch from, and the time of its last fetch (`FETCH_HEAD`), if any. */
  fetchInfo(): Promise<{ hasRemote: boolean; lastFetchedAt?: string }>;
  /** Commits of the checkout at `path` that are on no remote-tracking ref (capped). */
  localOnlyCommits(path: string): Promise<number | undefined>;
  /** The project's directory below the git top level; empty when the project is the repository. */
  subdirectory(): Promise<string>;
  /**
   * Archives of active changes that a branch holds and neither the main checkout nor the default branch does
   * (stale-changes spec), by change name. Optional: a source without it reports none.
   */
  strandedArchives?(
    layout: ChangesLayout,
    changes: readonly ActiveChange[],
    archivedOnMain: ReadonlyMap<string, string>,
    defaultBranch: string | undefined,
    sessions?: readonly SessionHint[],
  ): Promise<Map<string, StrandedArchive>>;
  /**
   * The leftovers of changes the default branch has archived (stale-changes: "A change that is archived and merged is
   * stale"), by change name. Optional: a source without it reports none.
   */
  staleLeftovers?(input: Omit<StaleInput, "repoPath">): Promise<Map<string, StaleLeftovers>>;
  /**
   * Changes the default branch holds both as a change directory and as its archive (stale-changes: "A change committed
   * next to its archive is reported as a duplicate"), by change name. Optional: a source without it reports none.
   */
  duplicates?(
    layout: ChangesLayout,
    metadata: ChangeMetadata | undefined,
    archivedOnMain: ReadonlyMap<string, string>,
    worktrees: readonly Worktree[],
  ): Promise<Map<string, DuplicateAfterArchive>>;
  /** Committer date of the last commit touching `absPath` inside the repo. */
  lastActivity(absPath: string): Promise<string | undefined>;
  /** Modified and untracked files under `relRoot` (a framework's root, e.g. `openspec`), per git. Empty for non-git repositories or on failure. */
  dirtyFiles(relRoot: string): Promise<DirtyFile[]>;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export class LocalRepoSource implements RepoSource {
  constructor(readonly path: string) {}

  async exists(relDir: string): Promise<boolean> {
    try {
      return (await stat(join(this.path, relDir))).isDirectory();
    } catch {
      return false;
    }
  }

  forCheckout(path: string): RepoSource {
    return new LocalRepoSource(path);
  }

  async mtimeMs(absPath: string): Promise<number | undefined> {
    try {
      return (await stat(absPath)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  async listChanges(layout: ChangesLayout, { archived: withArchive = true }: { archived?: boolean } = {}): Promise<ChangeListing> {
    const active: ChangeDirEntry[] = [];
    const archived: ChangeDirEntry[] = [];
    const warnings: string[] = [];
    const changesRoot = join(this.path, layout.changesDir);
    const archiveRoot = layout.archiveDir === undefined ? undefined : join(this.path, layout.archiveDir);

    for (const name of await listDirs(changesRoot)) {
      if (join(changesRoot, name) === archiveRoot) continue;
      if (!CHANGE_NAME.test(name)) {
        warnings.push(`skipped change directory with unexpected name: ${JSON.stringify(name)}`);
        continue;
      }
      active.push({ name, dir: join(changesRoot, name) });
    }

    for (const dirName of withArchive && archiveRoot ? await listDirs(archiveRoot) : []) {
      const dir = join(archiveRoot as string, dirName);
      const match = ARCHIVE_PREFIX.exec(dirName);
      const name = match ? match[2] : dirName;
      if (!CHANGE_NAME.test(name)) {
        warnings.push(`skipped archived directory with unexpected name: ${JSON.stringify(dirName)}`);
        continue;
      }
      const date = match ? match[1] : (await this.newestMtime(dir))?.slice(0, 10);
      archived.push({ name, dir, archived: date ?? "1970-01-01" });
    }
    archived.sort((a, b) => (b.archived ?? "").localeCompare(a.archived ?? ""));
    return { active, archived, warnings };
  }

  listDirs(absDir: string): Promise<string[]> {
    return listDirs(absDir);
  }

  async listEntries(absDir: string): Promise<LabelEntry[]> {
    try {
      const entries = await readdir(absDir, { withFileTypes: true });
      // A Dirent describes the entry itself: a symbolic link is neither a file nor a directory here.
      return entries.map((e) => ({ name: e.name, kind: e.isFile() ? "file" : e.isDirectory() ? "dir" : "other" }));
    } catch {
      return [];
    }
  }

  readBounded(absPath: string, options: BoundedReadOptions): Promise<BoundedRead> {
    return readBounded(absPath, options);
  }

  async readFileInfo(absPath: string): Promise<FileInfo | undefined> {
    try {
      const realPath = await realpath(absPath);
      const info = await stat(realPath);
      return { size: info.size, isFile: info.isFile(), realPath };
    } catch {
      return undefined;
    }
  }

  async newestMtime(dir: string): Promise<string | undefined> {
    let newest = 0;
    const visit = async (d: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) {
          await visit(p);
        } else {
          try {
            newest = Math.max(newest, (await stat(p)).mtimeMs);
          } catch {
            // vanished between readdir and stat
          }
        }
      }
    };
    await visit(dir);
    return newest ? new Date(newest).toISOString() : undefined;
  }

  isGit(): Promise<boolean> {
    return isGitRepo(this.path);
  }

  branch(): Promise<string | undefined> {
    return currentBranch(this.path);
  }

  defaultBranch(): Promise<string | undefined> {
    return defaultBranch(this.path);
  }

  hasCommitToBranchFrom(): Promise<boolean | undefined> {
    return hasCommitToBranchFrom(this.path);
  }

  strandedArchives(
    layout: ChangesLayout,
    changes: readonly ActiveChange[],
    archivedOnMain: ReadonlyMap<string, string>,
    defaultBranch: string | undefined,
    sessions: readonly SessionHint[] = [],
  ): Promise<Map<string, StrandedArchive>> {
    return findStrandedArchives(this.path, layout, changes, archivedOnMain, defaultBranch, sessions);
  }

  staleLeftovers(input: Omit<StaleInput, "repoPath">): Promise<Map<string, StaleLeftovers>> {
    return staleLeftovers({ ...input, repoPath: this.path });
  }

  duplicates(
    layout: ChangesLayout,
    metadata: ChangeMetadata | undefined,
    archivedOnMain: ReadonlyMap<string, string>,
    worktrees: readonly Worktree[],
  ): Promise<Map<string, DuplicateAfterArchive>> {
    return findDuplicates(this.path, layout, metadata, archivedOnMain, worktrees);
  }

  worktrees(): Promise<Worktree[]> {
    return worktrees(this.path);
  }

  checkoutStatus(path: string): Promise<ParsedStatus | undefined> {
    return checkoutStatus(path);
  }

  hasRemoteRefs(): Promise<boolean | undefined> {
    return hasRemoteRefs(this.path);
  }

  fetchInfo(): Promise<{ hasRemote: boolean; lastFetchedAt?: string }> {
    return fetchInfo(this.path);
  }

  localOnlyCommits(path: string): Promise<number | undefined> {
    return localOnlyCommits(path);
  }

  subdirectory(): Promise<string> {
    return subdirectory(this.path);
  }

  lastActivity(absPath: string): Promise<string | undefined> {
    return lastCommitDate(this.path, relative(this.path, absPath));
  }

  async dirtyFiles(relRoot: string): Promise<DirtyFile[]> {
    const root = join(this.path, relRoot);
    const result: DirtyFile[] = [];
    for (const entry of await statusPaths(this.path, relRoot)) {
      // A deletion shows up as the mtime of the nearest directory that still exists.
      let p = entry.deleted ? dirname(entry.path) : entry.path;
      while (p.startsWith(root)) {
        try {
          result.push({ path: entry.path, mtimeMs: (await stat(p)).mtimeMs });
          break;
        } catch {
          p = dirname(p);
        }
      }
    }
    return result;
  }
}
