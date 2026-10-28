// Executable git hooks that append their name to a log file: a test that runs a dashboard writer and then finds the log
// empty has proved no hook ran.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** The hooks git fires for the commands the dashboard writes with. */
export const LOGGED_HOOKS = ["reference-transaction", "post-index-change", "post-checkout", "post-merge", "pre-auto-gc", "post-rewrite"] as const;

/** Writes each hook into `dir` (created if missing); each appends `<name>\n` to `log`. */
export async function writeHooks(dir: string, log: string, names: readonly string[] = LOGGED_HOOKS): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of names) {
    const file = join(dir, name);
    await writeFile(file, `#!/bin/sh\necho ${name} >> '${log}'\n`);
    await chmod(file, 0o755);
  }
}

/** Installs the hooks in the repository at `repo` (its common hooks folder, so its worktrees share them); returns the log. */
export async function installRepoHooks(repo: string, names: readonly string[] = LOGGED_HOOKS): Promise<string> {
  const proc = Bun.spawnSync(["git", "rev-parse", "--git-common-dir"], { cwd: repo });
  const common = proc.stdout.toString().trim();
  const gitDir = isAbsolute(common) ? common : join(repo, common);
  const log = join(gitDir, "hook-log.txt");
  await writeHooks(join(gitDir, "hooks"), log, names);
  await clearHookLog(log);
  return log;
}

export async function clearHookLog(log: string): Promise<void> {
  await writeFile(log, "");
}

/** The hooks that ran since the log was last cleared, in order. */
export async function hookLog(log: string): Promise<string[]> {
  try {
    return (await readFile(log, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
