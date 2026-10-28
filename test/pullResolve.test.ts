// Resolve and pull: the only thing the dashboard removes from a tracked repository, and only after it has re-proved the
// whole claim (openspec/specs/repository-pull: "Change leftovers blocking a pull are resolved on confirmation").
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { backupDirName, pullBackupsDir, PullBusyError, pullRepository, resolvePullRepository } from "../src/server/pull.ts";
import type { PullBlockingFile, PullResolve, PullResult, RepoConfig } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";
import { commitFiles, type Monorepo, monorepo } from "./monorepoHelpers.ts";
import { type Fixture, fixture, git, localChange, remoteChange, remoteCommits } from "./pullHelpers.ts";

setDefaultTimeout(60_000);

let cleanup: () => Promise<void>;
const bases: string[] = [];
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(async () => {
  for (const b of bases) await rm(b, { recursive: true, force: true });
  await cleanup();
});

async function make(): Promise<Fixture> {
  const f = await fixture();
  bases.push(f.base);
  return f;
}
const config = (f: Fixture) => newRepoConfig(f.repo, true);
const pull = (f: Fixture) => pullRepository(config(f));
const resolve = (f: Fixture, claim: PullResolve, options?: { beforeRetry?: () => void | Promise<void> }) => resolvePullRepository(config(f), claim, options);
const head = (dir: string) => git(dir, "rev-parse", "HEAD");
const status = (dir: string) => git(dir, "status", "--porcelain");
const read = (f: Fixture, path: string) => readFile(join(f.repo, ...path.split("/")), "utf8");
const tracked = (f: Fixture, path: string) => git(f.repo, "ls-files", "--error-unmatch", "--", path);

/** Everything the resolve must leave alone when it refuses: HEAD, the index byte for byte, and every file's content. */
async function untouched(f: Fixture): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = { head: head(f.repo), status: status(f.repo), index: (await readFile(join(f.repo, ".git", "index"))).toString("base64") };
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await visit(p);
      else snapshot[relative(f.repo, p)] = await readFile(p, "utf8");
    }
  };
  await visit(f.repo);
  return snapshot;
}

/** The change the dashboard created here, merged upstream with a different prompt: the everyday blocked pull. */
async function blocked(f: Fixture, options: { stage?: boolean; extra?: boolean } = {}): Promise<PullResult> {
  await remoteChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "the prompt as it was merged\n" });
  if (options.extra) await remoteCommits(f, 1, "app.txt");
  await localChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "the prompt as it was typed here\n" }, options.stage ?? true);
  await writeFile(join(f.repo, "notes.txt"), "an edit of my own that nothing incoming touches\n");
  return pull(f);
}

const backups = async (f: Fixture): Promise<string[]> => {
  const root = join(pullBackupsDir(), backupDirName(config(f).id));
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await visit(p);
      else out.push(p);
    }
  };
  await visit(root).catch(() => {});
  return out.sort();
};

test("a staged, identical marker and a differing prompt: confirmed, replaced, the local prompt kept as a copy", async () => {
  const f = await make();
  const refused = await blocked(f);
  expect(refused.resolvable).toBeDefined();
  const claim = refused.resolvable as PullResolve;

  const resolved = await resolve(f, claim);
  expect(resolved).toMatchObject({ fetched: false, update: "fast-forwarded", commits: 1 });
  expect(resolved.resolved).toEqual([
    { path: "openspec/changes/add-login/.openspec.yaml", copy: undefined },
    { path: "openspec/changes/add-login/prompt.md", copy: expect.stringContaining(join("pull-backups", backupDirName(config(f).id))) },
  ]);
  // the files are the incoming ones, and tracked
  expect(await read(f, "openspec/changes/add-login/prompt.md")).toBe("the prompt as it was merged\n");
  expect(tracked(f, "openspec/changes/add-login/prompt.md")).toBe("openspec/changes/add-login/prompt.md");
  expect(head(f.repo)).toBe(head(f.other));
  // the unrelated edit is still there, and nothing is left staged
  expect(await read(f, "notes.txt")).toBe("an edit of my own that nothing incoming touches\n");
  expect(status(f.repo)).toBe("M notes.txt"); // the helper trims; nothing of the change is left staged
  expect(git(f.repo, "log", "--oneline", "--merges")).toBe("");
  // the copy holds the local bytes, under the dashboard's home and nowhere else
  const copy = resolved.resolved?.[1].copy as string;
  expect(await readFile(copy, "utf8")).toBe("the prompt as it was typed here\n");
  expect(copy.startsWith(`${process.env.SPEC_CONTROL_HOME}/`)).toBe(true);
  expect(await backups(f)).toEqual([copy]);
});

test("leftovers that were never staged resolve the same way, and need no copy when they are identical", async () => {
  const f = await make();
  await remoteChange(f, "add-billing", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "same on both sides\n" });
  await localChange(f, "add-billing", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "same on both sides\n" }, false);
  const refused = await pull(f);
  expect(refused.blocking?.every((b) => b.kind === "leftover" && b.differs === false && b.staged === undefined)).toBe(true);

  const resolved = await resolve(f, refused.resolvable as PullResolve);
  expect(resolved).toMatchObject({ update: "fast-forwarded", commits: 1 });
  expect(resolved.resolved).toEqual([
    { path: "openspec/changes/add-billing/.openspec.yaml", copy: undefined },
    { path: "openspec/changes/add-billing/prompt.md", copy: undefined },
  ]);
  expect(status(f.repo)).toBe("");
  expect(tracked(f, "openspec/changes/add-billing/prompt.md")).toBe("openspec/changes/add-billing/prompt.md");
  expect(await backups(f)).toEqual([]); // nothing differed, so nothing was copied
});

test("a staged version that is a third state of its own is copied too", async () => {
  const f = await make();
  await remoteChange(f, "add-login", { "prompt.md": "the merged prompt\n" });
  await localChange(f, "add-login", { "prompt.md": "the staged prompt\n" });
  await writeFile(join(f.repo, "openspec", "changes", "add-login", "prompt.md"), "edited again after staging\n");
  const refused = await pull(f);
  expect(refused.blocking).toMatchObject([{ kind: "leftover", differs: true }]);

  const resolved = await resolve(f, refused.resolvable as PullResolve);
  expect(resolved.update).toBe("fast-forwarded");
  const copy = resolved.resolved?.[0].copy as string;
  expect(await readFile(copy, "utf8")).toBe("edited again after staging\n");
  expect(await readFile(`${copy}.staged`, "utf8")).toBe("the staged prompt\n");
  expect(await read(f, "openspec/changes/add-login/prompt.md")).toBe("the merged prompt\n");
});

test("a leftover edited after the offer: refused, and the repository is byte for byte as it was", async () => {
  const f = await make();
  const claim = (await blocked(f)).resolvable as PullResolve;
  await writeFile(join(f.repo, "openspec", "changes", "add-login", "prompt.md"), "changed my mind after confirming\n");
  const before = await untouched(f);

  const refused = await resolve(f, claim);
  expect(refused).toMatchObject({ fetched: false, update: "refused" });
  expect(refused.reason).toContain("no longer the ones that were shown");
  expect(refused.resolved).toBeUndefined();
  expect(refused.resolvable?.files).toHaveLength(2); // the offer is remade for what is there now
  expect(await untouched(f)).toEqual(before);
  expect(await backups(f)).toEqual([]);
});

test("an upstream that moved on: refused, nothing touched", async () => {
  const f = await make();
  const claim = (await blocked(f)).resolvable as PullResolve;
  await remoteCommits(f, 1, "app.txt");
  git(f.repo, "fetch", "-q");
  const before = await untouched(f);

  const refused = await resolve(f, claim);
  expect(refused.reason).toContain("the upstream moved on");
  expect(await untouched(f)).toEqual(before);
  expect(await backups(f)).toEqual([]);
});

test("a claim with a file too many, one too few, or one the dashboard did not create: refused, nothing touched", async () => {
  const f = await make();
  const claim = (await blocked(f, { extra: true })).resolvable as PullResolve;
  const before = await untouched(f);

  const oneTooFew = { ...claim, files: claim.files.slice(1) };
  const oneTooMany = { ...claim, files: [...claim.files, { ...claim.files[0], path: "openspec/changes/add-login/design.md" }] };
  for (const bad of [oneTooFew, oneTooMany]) {
    const refused = await resolve(f, bad);
    expect([bad.files.length, refused.update, refused.reason]).toEqual([bad.files.length, "refused", expect.stringContaining("no longer the ones that were shown")]);
  }
  expect(await untouched(f)).toEqual(before);

  // …and a real local edit among them withdraws the offer altogether: a claim naming it changes nothing
  await writeFile(join(f.repo, "app.txt"), "my own edit\n");
  const withWork = await pull(f);
  expect(withWork.resolvable).toBeUndefined();
  const withEdit = await untouched(f);
  const refused = await resolve(f, { ...claim, files: [...claim.files, { path: "app.txt", kind: "leftover", differs: true, incoming: claim.files[0].incoming, worktree: claim.files[0].worktree }] });
  expect(refused.update).toBe("refused");
  expect(refused.reason).toContain("not a change leftover");
  expect(refused.resolvable).toBeUndefined();
  expect(await untouched(f)).toEqual(withEdit);
  expect(await backups(f)).toEqual([]);
});

test("a retried fast-forward that is still refused puts every leftover back, staged as it was, and keeps the copies", async () => {
  const f = await make();
  const claim = (await blocked(f, { extra: true })).resolvable as PullResolve;
  const before = await untouched(f);

  // An overlapping edit that appears only after the leftovers are gone: exactly the race the put-back exists for.
  const refused = await resolve(f, claim, { beforeRetry: () => writeFile(join(f.repo, "app.txt"), "an edit that lands in the window\n") });
  expect(refused).toMatchObject({ fetched: false, update: "refused" });
  expect(refused.reason).toContain("would be overwritten");
  expect(refused.hint).toContain("The listed files are back as they were.");
  expect(refused.hint).toContain(join("pull-backups", backupDirName(config(f).id)));
  expect(refused.resolved).toBeUndefined();

  // the leftovers are back with their content and their staged state; only the test's own edit is new
  const after = await untouched(f);
  expect(after["app.txt"]).toBe("an edit that lands in the window\n");
  expect(await read(f, "openspec/changes/add-login/prompt.md")).toBe("the prompt as it was typed here\n");
  expect(status(f.repo).split("\n").filter((l) => l.includes("openspec/changes/add-login")).sort()).toEqual([
    "A  openspec/changes/add-login/.openspec.yaml",
    "A  openspec/changes/add-login/prompt.md",
  ]);
  expect(head(f.repo)).toBe(before.head);
  expect(await backups(f)).toHaveLength(1); // the copy of the differing prompt is kept
});

test("resolving joins the same one-at-a-time lock as a pull", async () => {
  const f = await make();
  const claim = (await blocked(f)).resolvable as PullResolve;
  const first = resolve(f, claim, { beforeRetry: () => new Promise((r) => setTimeout(r, 400)) });
  await new Promise((r) => setTimeout(r, 100));
  await expect(resolve(f, claim)).rejects.toBeInstanceOf(PullBusyError);
  expect((await first).update).toBe("fast-forwarded");
});

test("a repository id never becomes a path of its own", () => {
  expect(backupDirName("/w/acme/alpha-infra")).toBe("_w_acme_alpha-infra");
  expect(backupDirName("..")).toBe("repo");
  expect(backupDirName("")).toBe("repo");
  expect(backupDirName("a".repeat(200))).toHaveLength(120);
});

test("hooks do not run for the leftover removal, the fast-forward or anything else of a Resolve and pull", async () => {
  const f = await make();
  const refused = await blocked(f);
  const log = await installRepoHooks(f.repo);
  expect(await resolve(f, refused.resolvable as PullResolve)).toMatchObject({ update: "fast-forwarded", commits: 1 });
  expect(tracked(f, "openspec/changes/add-login/prompt.md")).toBe("openspec/changes/add-login/prompt.md");
  expect(await hookLog(log)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// A project in a subfolder of its repository (repository-pull: "Blocking files are classified from a project in a
// subfolder"): paths are relative to the top level and read and touched that way.
// ---------------------------------------------------------------------------------------------------------------------

const TOOLS_CHANGE = "packages/tools/openspec/changes/add-login";

/** The monorepo's `packages/tools` with `add-login` created and staged here, and merged upstream with another prompt. */
async function blockedSubfolder(): Promise<{ m: Monorepo; repo: RepoConfig; refused: PullResult }> {
  const m = await monorepo();
  bases.push(m.base);
  await commitFiles(m.other, { [`${TOOLS_CHANGE}/.openspec.yaml`]: "schema: spec-driven\n", [`${TOOLS_CHANGE}/prompt.md`]: "the prompt as it was merged\n" });
  git(m.other, "push", "-q");
  await mkdir(join(m.top, TOOLS_CHANGE), { recursive: true });
  await writeFile(join(m.top, TOOLS_CHANGE, ".openspec.yaml"), "schema: spec-driven\n");
  await writeFile(join(m.top, TOOLS_CHANGE, "prompt.md"), "the prompt as it was typed here\n");
  git(m.project(), "add", "--", "openspec/changes/add-login/");
  const repo = newRepoConfig(m.project(), true);
  return { m, repo, refused: await pullRepository(repo) };
}

test("in a subfolder project, a staged leftover is listed from the top level, offered and resolved", async () => {
  const { m, repo, refused } = await blockedSubfolder();
  expect(refused.blocking).toMatchObject([
    { path: `${TOOLS_CHANGE}/.openspec.yaml`, kind: "leftover", differs: false },
    { path: `${TOOLS_CHANGE}/prompt.md`, kind: "leftover", differs: true },
  ]);
  expect(refused.resolvable).toBeDefined();

  const resolved = await resolvePullRepository(repo, refused.resolvable as PullResolve);
  expect(resolved).toMatchObject({ update: "fast-forwarded", commits: 1 });
  expect(await readFile(join(m.top, TOOLS_CHANGE, "prompt.md"), "utf8")).toBe("the prompt as it was merged\n");
  expect(git(m.top, "status", "--porcelain")).toBe("");
  const copy = resolved.resolved?.find((r) => r.path.endsWith("prompt.md"))?.copy as string;
  expect(await readFile(copy, "utf8")).toBe("the prompt as it was typed here\n");
});

test("in a subfolder project, the same relative path at the top level is local work and is never touched", async () => {
  const m = await monorepo();
  bases.push(m.base);
  await commitFiles(m.other, { "openspec/changes/add-login/prompt.md": "merged at the top\n", [`${TOOLS_CHANGE}/prompt.md`]: "merged in tools\n" });
  git(m.other, "push", "-q");
  for (const [path, content] of [
    ["openspec/changes/add-login/prompt.md", "typed at the top\n"],
    [`${TOOLS_CHANGE}/prompt.md`, "typed in tools\n"],
  ]) {
    await mkdir(join(m.top, path, ".."), { recursive: true });
    await writeFile(join(m.top, path), content);
  }
  git(m.top, "add", "-A");
  const before = { head: git(m.top, "rev-parse", "HEAD"), status: git(m.top, "status", "--porcelain"), index: await readFile(join(m.top, ".git", "index")) };
  const repo = newRepoConfig(m.project(), true);

  const refused = await pullRepository(repo);
  expect(refused.blocking).toMatchObject([
    { path: "openspec/changes/add-login/prompt.md", kind: "local-work" },
    { path: `${TOOLS_CHANGE}/prompt.md`, kind: "leftover" },
  ]);
  expect(refused.resolvable).toBeUndefined();

  // A claim that calls the top-level file a leftover is refused as well, and nothing moves.
  const leftover = refused.blocking?.[1] as PullBlockingFile;
  const claim: PullResolve = {
    upstream: git(m.top, "rev-parse", "origin/main"),
    files: [{ ...leftover, path: "openspec/changes/add-login/prompt.md" }, leftover],
  };
  expect(await resolvePullRepository(repo, claim)).toMatchObject({ update: "refused" });
  expect({ head: git(m.top, "rev-parse", "HEAD"), status: git(m.top, "status", "--porcelain"), index: await readFile(join(m.top, ".git", "index")) }).toEqual(before);
  expect(await readFile(join(m.top, "openspec/changes/add-login/prompt.md"), "utf8")).toBe("typed at the top\n");
  expect(await readFile(join(m.top, TOOLS_CHANGE, "prompt.md"), "utf8")).toBe("typed in tools\n");
  expect(await readdir(pullBackupsDir()).catch(() => [])).not.toContain(backupDirName(repo.id));
});
