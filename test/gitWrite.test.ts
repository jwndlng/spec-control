import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { emptyHooksDir, gitWrite } from "../src/server/gitWrite.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { clearHookLog, hookLog, installRepoHooks, writeHooks } from "./hookHelpers.ts";
import { git } from "./pullHelpers.ts";

let home: string;
let cleanup: () => Promise<void>;
const bases: string[] = [];
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
beforeAll(async () => {
  ({ home, cleanup } = await useTempHome());
});
afterEach(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
});
afterAll(async () => {
  for (const b of bases) await rm(b, { recursive: true, force: true });
  await cleanup();
});

/** A repository with one commit on `main` and a merged branch `feat/old` to delete. */
async function repository(): Promise<{ base: string; repo: string }> {
  const base = await realpath(await tempDir("osd-gitwrite-"));
  bases.push(base);
  const repo = join(base, "alpha-infra");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "app.txt"), "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "branch", "feat/old");
  return { base, repo };
}

/** `branch -D`, `add`, `worktree add` and `worktree remove`, each through `gitWrite`, each expected to succeed. */
async function writeEverything(base: string, repo: string): Promise<void> {
  expect((await gitWrite(repo, ["branch", "-D", "--", "feat/old"])).ok).toBe(true);
  await writeFile(join(repo, "new.txt"), "new\n");
  expect((await gitWrite(repo, ["add", "--", "new.txt"])).ok).toBe(true);
  const worktree = join(base, "worktrees", "add-login");
  expect((await gitWrite(repo, ["worktree", "add", "-b", "feat/add-login", worktree, "HEAD"])).ok).toBe(true);
  expect((await gitWrite(repo, ["worktree", "remove", worktree])).ok).toBe(true);
  expect(git(repo, "branch", "--list", "feat/old")).toBe("");
  expect(git(repo, "diff", "--cached", "--name-only")).toBe("new.txt");
}

test("the empty hooks folder lives under the home, and is the one the clone uses", async () => {
  const dir = await emptyHooksDir();
  expect(dir).toBe(join(home, "clone-hooks"));
  expect(await readdir(dir)).toEqual([]);
});

test("the repository's own hooks never run for a gitWrite", async () => {
  const { base, repo } = await repository();
  const log = await installRepoHooks(repo);
  // The control: plain git runs them, so an empty log below means something.
  git(repo, "branch", "feat/control");
  git(repo, "branch", "-D", "feat/control");
  expect(await hookLog(log)).toContain("reference-transaction");
  await clearHookLog(log);

  await writeEverything(base, repo);
  expect(await hookLog(log)).toEqual([]);
});

test("the user's global hooks folder never runs either", async () => {
  const { base, repo } = await repository();
  const hooks = join(base, "global-hooks");
  const log = join(base, "global-hook-log.txt");
  await writeHooks(hooks, log);
  const config = join(base, "gitconfig");
  await writeFile(config, `[core]\n\thooksPath = ${hooks}\n`);
  process.env.GIT_CONFIG_GLOBAL = config;
  git(repo, "branch", "feat/control");
  expect(await hookLog(log)).toContain("reference-transaction");
  await clearHookLog(log);

  await writeEverything(base, repo);
  expect(await hookLog(log)).toEqual([]);
});

test("a failing command reports git's reason and never throws", async () => {
  const { repo } = await repository();
  const result = await gitWrite(repo, ["branch", "-D", "--", "no-such-branch"]);
  expect(result.ok).toBe(false);
  expect(result.err).toContain("no-such-branch");
  expect((await gitWrite(join(repo, "missing"), ["add", "--", "x"])).ok).toBe(false);
});

// ---- the source scan: no writing subcommand is spawned except through gitWrite ----

const SERVER = join(import.meta.dir, "..", "src", "server");

/** Subcommands that write to a repository, with the arguments that make an otherwise reading one write. */
const WRITING: Record<string, ((rest: string[]) => boolean) | true> = {
  fetch: true,
  merge: true,
  rm: true,
  add: true,
  mv: true,
  commit: true,
  push: true,
  pull: true,
  reset: true,
  restore: true,
  checkout: true,
  switch: true,
  stash: true,
  rebase: true,
  "cherry-pick": true,
  revert: true,
  clean: true,
  apply: true,
  am: true,
  gc: true,
  maintenance: true,
  "update-ref": true,
  "update-index": true,
  init: true,
  clone: true,
  branch: (rest) => rest.some((a) => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream-to|unset-upstream)/.test(a)),
  tag: (rest) => rest.some((a) => /^-(d|a|s|f)$|^--delete/.test(a)),
  worktree: (rest) => rest[0] !== "list",
};
/** Callees that are the helper itself, or a module's one-line wrapper around it. */
const WRITERS = new Set(["gitWrite", "writeGit"]);
/** The two writers with requirements of their own (dashboard-api): `git init` of a new project and the GitHub clone. */
const OWN_INVOCATIONS: Record<string, string[]> = { "createProject.ts": ["init"], "githubClone.ts": ["clone"] };

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** The leading string tokens of an array literal starting at `at` (`[`), up to the first token that is not a string. */
function leadingStrings(src: string, at: number): string[] {
  const tokens: string[] = [];
  const re = /\s*("([^"\\]|\\.)*"|`[^`$]*(\$\{[^}]*\}[^`$]*)*`)\s*(,|\])/y;
  re.lastIndex = at + 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    tokens.push(m[1].slice(1, -1));
    if (m[4] === "]") break;
  }
  return tokens;
}

/** The subcommand and what follows it, skipping `git`, `-c <setting>` pairs and `--git-dir=…`. */
function subcommandOf(tokens: string[]): { sub?: string; rest: string[] } {
  let i = tokens[0] === "git" ? 1 : 0;
  while (i < tokens.length) {
    if (tokens[i] === "-c") i += 2;
    else if (tokens[i].startsWith("--git-dir=") || tokens[i].startsWith("-C")) i += 1;
    else break;
  }
  return { sub: tokens[i], rest: tokens.slice(i + 1) };
}

function writingSpawns(): string[] {
  const offenders: string[] = [];
  for (const file of serverFiles(SERVER)) {
    const name = relative(SERVER, file);
    if (name === "gitWrite.ts") continue;
    const src = readFileSync(file, "utf8");
    for (let at = src.indexOf("["); at >= 0; at = src.indexOf("[", at + 1)) {
      const tokens = leadingStrings(src, at);
      if (tokens.length === 0) continue;
      const { sub, rest } = subcommandOf(tokens);
      const rule = sub === undefined ? undefined : WRITING[sub];
      if (!rule || (rule !== true && !rule(rest))) continue;
      // A `git` argv of its own is allowed only where its requirement says so.
      if (tokens[0] === "git" && OWN_INVOCATIONS[name]?.includes(sub as string)) continue;
      const line = src.slice(src.lastIndexOf("\n", at) + 1, at);
      const callee = /(\w+)\([^()]*$/.exec(line)?.[1];
      if (callee && WRITERS.has(callee) && tokens[0] !== "git") continue;
      offenders.push(`${name}:${src.slice(0, at).split("\n").length} ${callee ?? "?"}([${tokens.join(", ")}])`);
    }
  }
  return offenders;
}

test("no writing git subcommand is spawned anywhere but through gitWrite", () => {
  expect(writingSpawns()).toEqual([]);
});

test("the scan catches a writer that bypasses gitWrite", () => {
  const sample = 'await git(repo.path, ["branch", "-D", "--", name]);\nawait git(cwd, ["-c", "gc.auto=0", "fetch", "--quiet", remote]);\nawait gitWrite(cwd, ["add", "--", dir]);\nawait git(cwd, ["worktree", "list", "--porcelain"]);';
  const found: string[] = [];
  for (let at = sample.indexOf("["); at >= 0; at = sample.indexOf("[", at + 1)) {
    const { sub, rest } = subcommandOf(leadingStrings(sample, at));
    const rule = sub === undefined ? undefined : WRITING[sub];
    if (rule && (rule === true || rule(rest))) found.push(`${/(\w+)\([^()]*$/.exec(sample.slice(sample.lastIndexOf("\n", at) + 1, at))?.[1]}:${sub}`);
  }
  expect(found).toEqual(["git:branch", "git:fetch", "gitWrite:add"]);
});
