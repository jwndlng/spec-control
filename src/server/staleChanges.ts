// Stale changes (openspec/specs/stale-changes): work that already landed while the board still shows something
// unfinished. Two cases, both decided with read-only git and never a remote:
//
// - a **stranded archive**: an active change whose archive a branch holds, but neither the main checkout nor the
//   default branch does — the agent archived on a branch that had already merged and opened no new pull request;
// - a **settled worktree**: a session worktree of a change the default branch has archived, whose commits and
//   uncommitted files that archive already covers — typically a session the dashboard's restart interrupted.
//
// Nothing here writes anything; what the user does about either goes through actions that already exist.
import type { SettledWorktree, StrandedArchive } from "../shared/types.ts";
import type { ChangesLayout } from "./source.ts";
import { baseRef, contentIsInBase } from "./sessions/base.ts";

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
const TIMEOUT_MS = 10_000;
/** Branches inspected per change; the archive must match the exact name, so more would only cost time. */
export const MAX_CANDIDATE_BRANCHES = 4;

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, ...ENV } });
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
 * branch's name (`main`), which is never a candidate, locally or on a remote. Runs in the project's folder, so every path
 * is relative to it, as the layout's are.
 */
export async function findStrandedArchives(
  repoPath: string,
  layout: ChangesLayout,
  changes: readonly ActiveChange[],
  archivedOnMain: ReadonlyMap<string, string>,
  defaultBranch: string | undefined,
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

  for (const change of changes) {
    const candidates = branches
      .filter((c) => c.short.includes(change.name) && !isDefault(c))
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

/**
 * Whether the session worktree at `worktreePath` of `change` is settled (stale-changes: "A session worktree of an
 * archived change is reported as settled"): the default branch archived the change, every commit is in it, and anything
 * uncommitted lies inside the change's own directories. The caller has made sure no session runs in it. `prefix` is the
 * project's folder inside its repository (`rev-parse --show-prefix`), because porcelain paths start at the top level.
 */
export async function settledArchive(repoPath: string, worktreePath: string, change: string, layout: ChangesLayout, prefix = ""): Promise<SettledWorktree | undefined> {
  const archiveDir = layout.archiveDir;
  if (!archiveDir) return undefined;
  const base = await baseRef(repoPath);
  if (!base) return undefined;
  const archive = newestArchive((await archiveEntries(repoPath, base, archiveDir)) ?? [], change);
  if (!archive) return undefined;
  const ahead = (await git(worktreePath, ["rev-list", "--count", `${base}..HEAD`]))?.trim();
  if (ahead === undefined) return undefined;
  if (ahead !== "0" && !(await contentIsInBase(worktreePath, base))) return undefined;
  const status = await git(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === undefined) return undefined;
  const top = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
  const own = `${top}${layout.changesDir}/${change}/`;
  const archived = `${top}${archiveDir}/`;
  const inside = (path: string) => path.startsWith(own) || (path.startsWith(archived) && archiveDate(path.slice(archived.length).split("/")[0], change) !== undefined && path.slice(archived.length).includes("/"));
  // `XY path` entries; a rename or copy is followed by its source path as an entry of its own.
  const entries = status.split("\0");
  let uncommitted = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const paths = [entry.slice(3)];
    if (entry[0] === "R" || entry[0] === "C") paths.push(entries[++i] ?? "");
    if (!paths.every(inside)) return undefined;
    uncommitted++;
  }
  return { archive: archive.dir, uncommitted };
}
