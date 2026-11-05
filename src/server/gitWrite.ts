// The one way the dashboard runs a git command that writes to a tracked repository (dashboard-api: "Writing git commands
// run no hooks and ignore configuration that would widen them"). Every writer of invariant 1 — the pull's and automatic
// fetch's `fetch`, the fast-forward `merge`, the leftover `rm --cached` and restoring `add`, the create-change and
// dismissal `add`, `branch -D` and the `worktree` commands — goes through `gitWrite`; `test/gitWrite.test.ts` fails on a
// writing subcommand spawned anywhere else. `git init` of a new project and the GitHub clone keep their own invocations.
//
// `core.hooksPath` replaces the repository's `.git/hooks`, the user's global hooks folder and a template's hooks in one
// setting, so pointing it at a folder known to be empty means no hook can run. Automatic maintenance is off: a click (or
// a timer) must not turn into a repack. Options that pin a command's effect against configuration (`--no-autostash`,
// `--no-prune`) are the caller's, because they belong to the command.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dashboardHome } from "./paths.ts";

/** An empty directory under the home that `core.hooksPath` points at: no hook — not even a template's — can run. */
export async function emptyHooksDir(): Promise<string> {
  const dir = join(dashboardHome(), "clone-hooks");
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface GitWriteResult {
  ok: boolean;
  /** stdout, trimmed. */
  out: string;
  /** stdout exactly as git wrote it. */
  rawOut: string;
  err: string;
  timedOut: boolean;
}

export interface GitWriteOptions {
  /** Added to `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` over the server's own environment. */
  env?: Record<string, string | undefined>;
  /** Killed after this long; no limit when absent. */
  timeoutMs?: number;
}

/** The `-c` settings every writing command runs with, in front of its own arguments. */
export function writeSettings(hooksDir: string): string[] {
  return ["-c", `core.hooksPath=${hooksDir}`, "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
}

/** `https://user:secret@host/…` must never reach the browser or logs. */
export function maskCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@");
}

/** SSH environment that prevents interactive prompts. */
function batchSshEnv(): Record<string, string> {
  return process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

/** Stages all changes and commits in the worktree with hooks disabled and author fallback if none configured. */
export async function commitWorktreeAll(cwd: string, message: string, options: GitWriteOptions = {}): Promise<GitWriteResult> {
  const addRes = await gitWrite(cwd, ["add", "--all"], options);
  if (!addRes.ok) {
    return { ...addRes, err: maskCredentials(addRes.err) };
  }
  let commitRes = await gitWrite(cwd, ["commit", "--no-verify", "-m", message], options);
  if (!commitRes.ok && /user\.name|user\.email|author identity unknown|tell me who you are|empty ident name/i.test(commitRes.err)) {
    const fallbackEnv = {
      ...options.env,
      GIT_AUTHOR_NAME: "Spec Control",
      GIT_AUTHOR_EMAIL: "spec-control@localhost",
      GIT_COMMITTER_NAME: "Spec Control",
      GIT_COMMITTER_EMAIL: "spec-control@localhost",
    };
    commitRes = await gitWrite(
      cwd,
      ["-c", "user.name=Spec Control", "-c", "user.email=spec-control@localhost", "commit", "--no-verify", "-m", message],
      { ...options, env: fallbackEnv }
    );
  }
  return { ...commitRes, err: maskCredentials(commitRes.err) };
}

/** Pushes the worktree's HEAD to branch on remote with hooks disabled, batch SSH, and masked credentials. */
export async function pushWorktreeBranch(
  cwd: string,
  branch: string,
  remote = "origin",
  options: GitWriteOptions = {}
): Promise<GitWriteResult> {
  const env = { ...batchSshEnv(), ...options.env };
  const res = await gitWrite(cwd, ["push", "--no-verify", "--set-upstream", remote, `HEAD:refs/heads/${branch}`], {
    ...options,
    env,
  });
  return { ...res, err: maskCredentials(res.err) };
}

/** Runs git cherry-pick on commit in the worktree with hooks disabled and masked credentials. */
export async function cherryPickWorktreeCommit(
  cwd: string,
  commit: string,
  options: GitWriteOptions = {}
): Promise<GitWriteResult> {
  const fallbackEnv = {
    ...options.env,
    GIT_AUTHOR_NAME: "Spec Control",
    GIT_AUTHOR_EMAIL: "spec-control@localhost",
    GIT_COMMITTER_NAME: "Spec Control",
    GIT_COMMITTER_EMAIL: "spec-control@localhost",
  };
  let res = await gitWrite(cwd, ["cherry-pick", commit], { ...options, env: fallbackEnv });
  if (!res.ok && /user\.name|user\.email|author identity unknown|tell me who you are|empty ident name/i.test(res.err)) {
    res = await gitWrite(
      cwd,
      ["-c", "user.name=Spec Control", "-c", "user.email=spec-control@localhost", "cherry-pick", commit],
      { ...options, env: fallbackEnv }
    );
  }
  return { ...res, err: maskCredentials(res.err) };
}

/** Aborts an in-progress cherry-pick in the worktree with hooks disabled. */
export async function abortWorktreeCherryPick(cwd: string, options: GitWriteOptions = {}): Promise<GitWriteResult> {
  const res = await gitWrite(cwd, ["cherry-pick", "--abort"], options);
  return { ...res, err: maskCredentials(res.err) };
}

/** git without a shell, a prompt or stdin, with no hooks and no automatic maintenance. Never throws. */
export async function gitWrite(cwd: string, args: string[], options: GitWriteOptions = {}): Promise<GitWriteResult> {
  let hooks: string;
  try {
    hooks = await emptyHooksDir();
  } catch (e) {
    // Without the empty folder there is no way to keep hooks from running, so nothing runs.
    return { ok: false, out: "", rawOut: "", err: `the empty hooks folder could not be made: ${String(e)}`, timedOut: false };
  }
  let timedOut = false;
  try {
    const proc = Bun.spawn(["git", ...writeSettings(hooks), ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...options.env },
    });
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, options.timeoutMs);
    try {
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { ok: code === 0 && !timedOut, out: out.trim(), rawOut: out, err: err.trim(), timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, out: "", rawOut: "", err: String(e), timedOut };
  }
}
