// Stale changes (openspec/specs/stale-changes): work that already landed while the board still shows something
// unfinished. Two cases, both decided with read-only git and never a remote, and both looking only at a change's
// **branches**, named exactly (`changeBranches`):
//
// - a **stranded archive**: an active change whose archive a branch holds, but neither the main checkout nor the
//   default branch does — the agent archived on a branch that had already merged and opened no new pull request;
// - an **archived and merged** change: the default branch holds its archive, and a worktree, a branch or the main
//   checkout's copy of its directory is left over and merged (`staleLeftovers`).
//
// Nothing here writes anything; the cleanup that acts on it lives in `cleanup.ts`.
import { lstat, readdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { sessionBranch } from "../shared/sessionBranch.ts";
import {
  isChangeless,
  isProjectConsole,
  type KeptLeftover,
  type Session,
  type StaleLeftover,
  type StaleLeftovers,
  type StaleMainFile,
  type StrandedArchive,
  UNCOMMITTED_LISTED,
  type Worktree,
} from "../shared/types.ts";
import { isBranchName } from "./branchName.ts";
import type { ChangesLayout } from "./source.ts";
import { baseRef, contentIsInBase } from "./sessions/base.ts";

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
const TIMEOUT_MS = 10_000;
/** Branches inspected per change; the archive must match the exact name, so more would only cost time. */
export const MAX_CANDIDATE_BRANCHES = 4;

/** `input`, when given, is written to git's standard input (`cat-file --batch`). */
async function git(cwd: string, args: string[], input?: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: input === undefined ? "ignore" : "pipe", env: { ...process.env, ...ENV } });
    if (input !== undefined && proc.stdin && typeof proc.stdin !== "number") {
      proc.stdin.write(input);
      await proc.stdin.end();
    }
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    try {
      const out = await new Response(proc.stdout).text();
      return (await proc.exited) === 0 ? out : undefined;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return undefined;
  }
}

/** What stale detection needs of a dashboard session record: never its output, only where it ran and on what. */
export interface SessionHint {
  change?: string;
  branch?: string;
  worktreePath: string;
  running: boolean;
}

/** The hints of a repository's sessions: change sessions and the project console (which runs in the main checkout). */
export function sessionHints(sessions: readonly Session[], repoId: string): SessionHint[] {
  return sessions
    .filter((s) => (isChangeless(s) ? isProjectConsole(s) && s.repoId === repoId : s.repoId === repoId))
    .map((s) => ({ ...(isChangeless(s) ? {} : { change: s.change }), ...(s.branch ? { branch: s.branch } : {}), worktreePath: s.worktreePath, running: s.state === "running" }));
}

/** The branches recorded in a change's metadata (`spec-control.branch`, `spec-control.archive-branch`), when known. */
export interface RecordedBranches {
  branch?: string;
  archiveBranch?: string;
}

/**
 * The change's branches, exactly (stale-changes: "A change's branches are named exactly"): the recorded ones, the
 * dashboard's own session branches, and the branch of every session record for the change. De-duplicated; a name git
 * would not accept is dropped. Never a containment match.
 */
export function changeBranches(change: string, recorded: RecordedBranches | undefined, sessions: readonly SessionHint[]): string[] {
  const names = [
    recorded?.branch,
    recorded?.archiveBranch,
    sessionBranch("implement", change),
    sessionBranch("archive", change),
    ...sessions.filter((s) => s.change === change).map((s) => s.branch),
  ];
  return [...new Set(names.filter((n): n is string => isBranchName(n)))];
}

/**
 * The `spec-control:` block of a change's `.openspec.yaml`: `branch` and `archive-branch`, each one plain or quoted
 * value. Anything else in the file, and a value that is not a branch name, is ignored.
 */
export function parseRecordedBranches(text: string): RecordedBranches | undefined {
  const out: RecordedBranches = {};
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^spec-control:\s*(#.*)?$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (!/^\s+\S/.test(line)) {
      if (line.trim() === "") continue;
      break;
    }
    const m = /^\s+(branch|archive-branch):\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const value = m[2] ?? m[3] ?? m[4];
    if (!isBranchName(value)) continue;
    if (m[1] === "branch") out.branch = value;
    else out.archiveBranch = value;
  }
  return out.branch || out.archiveBranch ? out : undefined;
}

/**
 * The recorded branches of each archive directory on `ref`, read in one `cat-file --batch` (read-only). Paths are given
 * as `./…` so that git resolves them from the project's folder, as the layout's are.
 */
async function recordedOnRef(cwd: string, ref: string, archiveDir: string, dirs: readonly string[]): Promise<Map<string, RecordedBranches>> {
  const found = new Map<string, RecordedBranches>();
  if (dirs.length === 0) return found;
  const out = await git(cwd, ["cat-file", "--batch"], dirs.map((d) => `${ref}:./${archiveDir}/${d}/.openspec.yaml\n`).join(""));
  if (out === undefined) return found;
  // `<oid> blob <size>\n<content>\n` per found object, `<name> missing\n` otherwise. Sizes are in bytes.
  const bytes = Buffer.from(out);
  let at = 0;
  for (const dir of dirs) {
    const eol = bytes.indexOf(10, at);
    if (eol < 0) break;
    const header = bytes.subarray(at, eol).toString();
    at = eol + 1;
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!m) continue;
    const size = Number(m[1]);
    const recorded = parseRecordedBranches(bytes.subarray(at, at + size).toString());
    at += size + 1;
    if (recorded) found.set(dir, recorded);
  }
  return found;
}

/** `YYYY-MM-DD` of an archive directory named for `change`, or undefined when it is another change's. */
export function archiveDate(dir: string, change: string): string | undefined {
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(dir)?.[1];
  return date && dir.slice(date.length + 1) === change ? date : undefined;
}

/** The newest archive directory of `change` among `dirs`. Dates sort as text. */
function newestArchive(dirs: readonly string[], change: string): { dir: string; date: string } | undefined {
  let best: { dir: string; date: string } | undefined;
  for (const dir of dirs) {
    const date = archiveDate(dir, change);
    if (date && (!best || date > best.date)) best = { dir, date };
  }
  return best;
}

/** Entries of the archive directory in `ref`'s tree, relative to `cwd` as `ls-tree` resolves them; [] when it has none. */
async function archiveEntries(cwd: string, ref: string, archiveDir: string): Promise<string[] | undefined> {
  const out = await git(cwd, ["ls-tree", "--name-only", "-z", ref, "--", `${archiveDir}/`]);
  if (out === undefined) return undefined;
  return out
    .split("\0")
    .filter(Boolean)
    .map((path) => path.slice(path.lastIndexOf("/") + 1));
}

export interface ActiveChange {
  name: string;
  /** `YYYY-MM-DD` the change was created, when known. */
  created?: string;
  /** The branches its metadata records, when the snapshot carries them. */
  recorded?: RecordedBranches;
}

interface Candidate {
  /** Full ref name, as handed to git. */
  ref: string;
  /** As shown: `feat/x` or `origin/feat/x`. */
  short: string;
  local: boolean;
}

/** Local and remote-tracking branches, never a remote's `HEAD`. */
async function listBranches(repoPath: string): Promise<Candidate[] | undefined> {
  const out = await git(repoPath, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  if (out === undefined) return undefined;
  const branches: Candidate[] = [];
  for (const ref of out.split("\n").filter(Boolean)) {
    if (ref.startsWith("refs/heads/")) branches.push({ ref, short: ref.slice("refs/heads/".length), local: true });
    else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) branches.push({ ref, short: ref.slice("refs/remotes/".length), local: false });
  }
  return branches;
}

/**
 * The stranded archives of `changes`, by change name (stale-changes: "A change whose archive is stranded on a branch is
 * reported"). `archivedOnMain` is the newest archive date per name in the main checkout; `defaultBranch` is the default
 * branch's name (`main`), which is never a candidate, locally or on a remote. Only the change's branches are read
 * (`changeBranches`); a remote-tracking one matches by its name without the remote. Runs in the project's folder, so every
 * path is relative to it, as the layout's are.
 */
export async function findStrandedArchives(
  repoPath: string,
  layout: ChangesLayout,
  changes: readonly ActiveChange[],
  archivedOnMain: ReadonlyMap<string, string>,
  defaultBranch: string | undefined,
  sessions: readonly SessionHint[] = [],
): Promise<Map<string, StrandedArchive>> {
  const found = new Map<string, StrandedArchive>();
  const archiveDir = layout.archiveDir;
  if (!archiveDir || changes.length === 0) return found;
  const branches = await listBranches(repoPath);
  if (!branches?.length) return found;
  const base = await baseRef(repoPath);
  // An archive the default branch already has is the pull's business, not a carry-over.
  const onBase = base ? ((await archiveEntries(repoPath, base, archiveDir)) ?? []) : [];
  const isDefault = (c: Candidate) => defaultBranch !== undefined && (c.local ? c.short === defaultBranch : c.short.slice(c.short.indexOf("/") + 1) === defaultBranch);

  const unprefixed = (c: Candidate) => (c.local ? c.short : c.short.slice(c.short.indexOf("/") + 1));

  for (const change of changes) {
    const own = new Set(changeBranches(change.name, change.recorded, sessions));
    const candidates = branches
      .filter((c) => own.has(unprefixed(c)) && !isDefault(c))
      .sort((a, b) => Number(b.local) - Number(a.local) || a.short.localeCompare(b.short))
      .slice(0, MAX_CANDIDATE_BRANCHES);
    if (candidates.length === 0) continue;
    const covered = [archivedOnMain.get(change.name) ?? "", newestArchive(onBase, change.name)?.date ?? ""].reduce((a, b) => (a > b ? a : b));
    const hits = await Promise.all(
      candidates.map(async (candidate) => {
        const archive = newestArchive((await archiveEntries(repoPath, candidate.ref, archiveDir)) ?? [], change.name);
        if (!archive || covered >= archive.date) return undefined;
        // Created after that archive: a new change reusing the name, which the old archive says nothing about.
        if (change.created && change.created > archive.date) return undefined;
        const commit = (await git(repoPath, ["log", "-1", "--format=%H", candidate.ref, "--", `${archiveDir}/${archive.dir}`]))?.trim();
        if (!commit || !/^[0-9a-f]{40}$/.test(commit)) return undefined;
        return { candidate, archive, commit };
      }),
    );
    // Newest archive first, then the local branch, then the name — `candidates` is already in the last two orders.
    const best = hits.filter((h) => h !== undefined).sort((a, b) => b.archive.date.localeCompare(a.archive.date))[0];
    if (best) found.set(change.name, { branch: best.candidate.short, archive: best.archive.dir, commit: best.commit });
  }
  return found;
}


// ---------------------------------------------------------------------------------------------------------------------
// Archived and merged (stale-changes: "A change that is archived and merged is stale"). Once the default branch holds a
// change's archive, a worktree or local branch on one of its branches that is merged, and the main checkout's copy of
// its directory that was never committed there, are left over. Uncommitted files do not save a merged leftover; they
// are listed with it, and the cleanup copies them before anything goes.
// ---------------------------------------------------------------------------------------------------------------------

export interface StaleInput {
  repoPath: string;
  layout: ChangesLayout;
  /** The default branch's local name; never a leftover. */
  defaultBranch?: string;
  /** `git worktree list`, main checkout included. */
  worktrees: readonly Worktree[];
  /** Active changes by name: a newer change reusing the name has no leftovers; its record names branches too. */
  active: ReadonlyMap<string, ActiveChange>;
  /** Newest archive date per name in the main checkout, to tell whether Pull still brings the archive. */
  archivedOnMain: ReadonlyMap<string, string>;
  sessions: readonly SessionHint[];
  /** The dashboard's worktrees folder for this repository (real path): what lies below it is `managed`. */
  managedRoot?: string;
  /** Only this change (a preview); every change archived on the default branch otherwise. */
  only?: string;
  /** Real path of a worktree whose session is being ended: judged as if it no longer ran. */
  ending?: string;
}

async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Paths of `git status --porcelain=v1 -z`, both sides of a rename, from the top level. */
function porcelainPaths(out: string): string[] {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") paths.push(fields[++i] ?? "");
  }
  return paths.filter(Boolean);
}

/** Whether `ref` holds no work `base` lacks: every commit in it, or every file it changed with the same content there. */
async function isMerged(repoPath: string, base: string, ref: string): Promise<{ merged: boolean; ahead?: number }> {
  const ahead = (await git(repoPath, ["rev-list", "--count", `${base}..${ref}`]))?.trim();
  if (ahead === undefined) throw new Error("rev-list failed");
  if (ahead === "0") return { merged: true };
  return (await contentIsInBase(repoPath, base, ref)) ? { merged: true } : { merged: false, ahead: Number(ahead) };
}

/** Every file below `dir`, relative to it, without following symbolic links. */
async function filesBelow(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await filesBelow(dir, path)));
    else out.push(path);
  }
  return out;
}

/**
 * The main checkout's `openspec/changes/<name>/` when none of its files is in `HEAD`: its files with their content
 * hashes (`hash-object` without `-w`) and whether the index has them. Undefined when there is no such directory or any
 * of it is committed.
 */
export async function mainCheckoutCopy(repoPath: string, dir: string): Promise<StaleMainFile[] | undefined> {
  const info = await lstat(join(repoPath, dir)).catch(() => undefined);
  if (!info?.isDirectory()) return undefined;
  const committed = await git(repoPath, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", `${dir}/`]);
  if (committed === undefined || committed.replace(/\0/g, "") !== "") return undefined;
  const files = (await filesBelow(join(repoPath, dir))).sort();
  if (files.length === 0) return undefined;
  const [hashes, indexed] = await Promise.all([
    git(repoPath, ["hash-object", "--", ...files.map((f) => `${dir}/${f}`)]),
    git(repoPath, ["ls-files", "-z", "--", `${dir}/`]),
  ]);
  if (hashes === undefined || indexed === undefined) return undefined;
  const lines = hashes.trim().split("\n");
  if (lines.length !== files.length) return undefined;
  const staged = new Set(indexed.split("\0").filter(Boolean));
  return files.map((path, i) => ({ path, hash: lines[i], staged: staged.has(`${dir}/${path}`) }));
}

/**
 * The stale and kept leftovers of every change the default branch has archived, by change name — only changes with at
 * least one leftover of either kind. Read-only git, no remote; a git failure for one leftover leaves it out.
 */
export async function staleLeftovers(input: StaleInput): Promise<Map<string, StaleLeftovers>> {
  const found = new Map<string, StaleLeftovers>();
  const { repoPath, layout } = input;
  const archiveDir = layout.archiveDir;
  if (!archiveDir) return found;
  const base = await baseRef(repoPath);
  if (!base) return found;

  // The newest archive per change on the default branch.
  const archives = new Map<string, { dir: string; date: string }>();
  for (const dir of (await archiveEntries(repoPath, base, archiveDir)) ?? []) {
    const date = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(dir);
    if (!date) continue;
    const name = date[2];
    if (input.only !== undefined && name !== input.only) continue;
    const known = archives.get(name);
    if (!known || date[1] > known.date) archives.set(name, { dir, date: date[1] });
  }
  // A newer change reusing the name: the old archive says nothing about it.
  for (const [name, { date }] of archives) {
    const created = input.active.get(name)?.created;
    if (created && created > date) archives.delete(name);
  }
  if (archives.size === 0) return found;

  const mainTop = input.worktrees.find((w) => w.isMain);
  const mainBranch = mainTop?.branch;
  const linked = input.worktrees.filter((w) => !w.isMain && !w.bare && !w.prunable);
  const refsOut = await git(repoPath, ["for-each-ref", "--format=%(refname:short)%00%(objectname)", "refs/heads"]);
  const localBranches = new Map<string, string>();
  for (const line of (refsOut ?? "").split("\n").filter(Boolean)) {
    const [name, commit] = line.split("\0");
    if (name !== input.defaultBranch && name !== mainBranch) localBranches.set(name, commit);
  }
  const candidateBranches = localBranches.size > 0 || linked.length > 0;
  const recorded = candidateBranches ? await recordedOnRef(repoPath, base, archiveDir, [...archives.values()].map((a) => a.dir)) : new Map<string, RecordedBranches>();

  const running = new Set(await Promise.all(input.sessions.filter((s) => s.running).map((s) => real(s.worktreePath))));
  if (input.ending) running.delete(input.ending);
  const sessionPaths = new Map<string, string[]>();
  for (const s of input.sessions) if (s.change) sessionPaths.set(s.change, [...(sessionPaths.get(s.change) ?? []), await real(s.worktreePath)]);
  const mainRunning = running.has(await real(repoPath)) || (mainTop !== undefined && running.has(await real(mainTop.path)));
  const prefix = ((await git(repoPath, ["rev-parse", "--show-prefix"]))?.trim() ?? "").replace(/\/+$/, "");
  const top = prefix ? `${prefix}/` : "";

  for (const [name, archive] of archives) {
    const leftovers: StaleLeftover[] = [];
    const kept: KeptLeftover[] = [];
    if (candidateBranches) {
      const own = new Set(changeBranches(name, { ...recorded.get(archive.dir), ...input.active.get(name)?.recorded }, input.sessions));
      const ownPaths = new Set(sessionPaths.get(name) ?? []);
      const inside = (path: string) => {
        const changeDir = `${top}${layout.changesDir}/${name}/`;
        const archived = `${top}${archiveDir}/`;
        if (path.startsWith(changeDir)) return true;
        if (!path.startsWith(archived)) return false;
        const rest = path.slice(archived.length);
        return rest.includes("/") && archiveDate(rest.split("/")[0], name) !== undefined;
      };

      for (const w of linked) {
        const path = await real(w.path);
        if (!(w.branch ? own.has(w.branch) : ownPaths.has(path))) continue;
        try {
          if (running.has(path)) {
            kept.push({ kind: "worktree", id: w.path, reason: "an agent session is running in it" });
            continue;
          }
          const managed = input.managedRoot !== undefined && path.startsWith(input.managedRoot + sep);
          if (w.locked && !managed) {
            kept.push({ kind: "worktree", id: w.path, reason: `it is locked${w.lockReason ? ` (${w.lockReason})` : ""}` });
            continue;
          }
          const commit = (await git(w.path, ["rev-parse", "--verify", "--quiet", "HEAD"]))?.trim();
          if (!commit) continue;
          const merged = await isMerged(repoPath, base, commit);
          if (!merged.merged) {
            kept.push({ kind: "worktree", id: w.path, reason: `it holds ${merged.ahead} commit(s) the default branch lacks` });
            continue;
          }
          const status = await git(w.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
          if (status === undefined) continue;
          const paths = porcelainPaths(status);
          const listed = paths.slice(0, UNCOMMITTED_LISTED);
          leftovers.push({
            kind: "worktree",
            path: w.path,
            ...(w.branch ? { branch: w.branch } : {}),
            commit,
            uncommitted: listed,
            uncommittedCount: paths.length,
            outside: paths.filter((p) => !inside(p)).slice(0, UNCOMMITTED_LISTED),
            managed,
          });
        } catch {
          // A git failure leaves this one out.
        }
      }

      const checkedOut = new Set(input.worktrees.map((w) => w.branch).filter(Boolean));
      for (const [branch, commit] of localBranches) {
        if (!own.has(branch) || checkedOut.has(branch)) continue;
        try {
          const merged = await isMerged(repoPath, base, commit);
          if (merged.merged) leftovers.push({ kind: "branch", name: branch, commit });
          else kept.push({ kind: "branch", id: branch, reason: `it holds ${merged.ahead} commit(s) the default branch lacks` });
        } catch {
          // A git failure leaves this one out.
        }
      }
    }

    const dir = `${layout.changesDir}/${name}`;
    const files = await mainCheckoutCopy(repoPath, dir).catch(() => undefined);
    if (files) {
      if (mainRunning) kept.push({ kind: "main", id: dir, reason: "an agent session is running in the main checkout" });
      else leftovers.push({ kind: "main", dir, files });
    }

    // A preview of one change reports its archive even with nothing left over: the archive is what it re-checks.
    if (leftovers.length > 0 || kept.length > 0 || input.only !== undefined) {
      const onMain = input.archivedOnMain.get(name);
      found.set(name, { archive: archive.dir, pulled: onMain !== undefined && onMain >= archive.date, leftovers, kept });
    }
  }
  return found;
}
