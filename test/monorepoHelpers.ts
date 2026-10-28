// A git repository whose tracked projects sit in subfolders (`/w/acme/monorepo/packages/tools`), with a local bare
// remote and a second clone to put commits on it — the layout where git prints some paths from the top level and reads
// others from the working directory.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES, tempDir } from "./helpers.ts";
import { git } from "./pullHelpers.ts";

export interface Monorepo {
  base: string;
  remote: string;
  /** The tracked clone's top level. */
  top: string;
  /** A second clone, used to put new commits on the remote. */
  other: string;
  /** The tracked project at `rel` below the top level. */
  project: (rel?: string) => string;
}

/**
 * Every project in `projects` holds a copy of the `demo-ops` fixture and a `src/keys.ts`; the top level has a
 * `README.md` of its own. Background maintenance is off in both clones, so nothing rewrites `.git` under a test.
 */
export async function monorepo(projects: string[] = ["packages/tools"]): Promise<Monorepo> {
  const base = await tempDir("osd-mono-");
  const remote = join(base, "remote.git");
  const seed = join(base, "seed");
  await mkdir(seed);
  await writeFile(join(seed, "README.md"), "monorepo\n");
  for (const rel of projects) {
    await cp(join(FIXTURES, "demo-ops"), join(seed, rel), { recursive: true });
    await mkdir(join(seed, rel, "src"), { recursive: true });
    await writeFile(join(seed, rel, "src", "keys.ts"), "export const keys = 1;\n");
  }
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(seed, "init", "-q", "-b", "main");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", remote, "main");
  const top = join(base, "monorepo");
  const other = join(base, "other");
  git(base, "clone", "-q", remote, top);
  git(base, "clone", "-q", remote, other);
  for (const clone of [top, other]) {
    for (const [key, value] of [
      ["user.name", "t"],
      ["user.email", "t@example.invalid"],
      ["gc.auto", "0"],
      ["maintenance.auto", "false"],
    ]) {
      git(clone, "config", key, value);
    }
  }
  return { base, remote, top, other, project: (rel = projects[0]) => join(top, rel) };
}

/** Writes `files` (paths from the top level) in `cwd` and commits them there. */
export async function commitFiles(cwd: string, files: Record<string, string>, message = "edit"): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** Squash-merges `branch` into the checkout's `main` and pushes it, as a merged and deleted pull request leaves it. */
export function squashMerge(top: string, branch: string): void {
  git(top, "merge", "-q", "--squash", branch);
  git(top, "commit", "-q", "-m", `squash ${branch}`);
  git(top, "push", "-q", "origin", "main");
}
