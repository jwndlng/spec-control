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
