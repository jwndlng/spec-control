// The base a branch is compared with, and whether its content is already there. Read-only git, never a remote. A leaf
// module: the scan reaches it through the stale-change checks, so it must not import anything that imports the scanner.
const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
const MAX_COMPARED_FILES = 500;

/** `raw` keeps the output as git wrote it: a `-z` list must not lose a file name's leading space. */
async function git(cwd: string, args: string[], raw = false): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, ...ENV } });
    const out = await new Response(proc.stdout).text();
    return { ok: (await proc.exited) === 0, out: raw ? out : out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/** The default branch as the repository locally knows it; without a remote, whatever the main checkout is on. */
export async function baseRef(repoPath: string): Promise<string | undefined> {
  const remoteHead = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.ok && remoteHead.out) return remoteHead.out;
  const head = await git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return head.ok && head.out ? head.out : undefined;
}

/**
 * Squash and rebase merges leave the branch's commits unreachable from the base, so content is compared instead: every
 * file `ref` changed since it forked from `base` has the same content in `base`. `cwd` is a worktree, the repository or
 * a project in a subfolder of it: the changed files are named from the top level, both sides of a rename included, and
 * compared at that same top-level path taken literally, so the answer does not depend on `cwd`, `diff.relative`,
 * `diff.renames` or an external diff driver.
 */
export async function contentIsInBase(cwd: string, base: string, ref = "HEAD"): Promise<boolean> {
  const changed = await git(cwd, ["diff", "--name-only", "-z", "--no-relative", "--no-renames", `${base}...${ref}`], true);
  if (!changed.ok) return false;
  const files = changed.out.split("\0").filter(Boolean);
  if (files.length > MAX_COMPARED_FILES) return false;
  if (files.length === 0) return true;
  const specs = files.map((file) => `:(top,literal)${file}`);
  return (await git(cwd, ["diff", "--quiet", "--no-relative", "--no-ext-diff", "--no-textconv", base, ref, "--", ...specs])).ok;
}
