import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig, repoId } from "../src/server/config.ts";
import { DEFAULT_MAX_DEPTH, discoverRepos, findSpecProjects, toCandidates, toIntegratable } from "../src/server/discover.ts";
import { normalizeRemote } from "../src/server/git.ts";
import { tempDir } from "./helpers.ts";
import { git } from "./sessionHelpers.ts";

let root: string;

async function repoAt(...segments: string[]): Promise<string> {
  const dir = join(root, ...segments);
  await mkdir(join(dir, "openspec"), { recursive: true });
  await writeFile(join(dir, "openspec", "config.yaml"), "schema: spec-driven\n");
  return dir;
}

beforeAll(async () => {
  root = realpathSync.native(await tempDir()); // discovery reports canonical paths (/var → /private/var on macOS)
  await repoAt("prvt", "alpha");
  await repoAt("acme", "beta");
  await repoAt("acme", "beta", "node_modules", "pkg"); // must be ignored
  await repoAt("deep", "a", "b", "c", "d", "too-deep"); // depth 6 > 4
  await repoAt("prvt", "alpha", "test", "fixtures", "nested"); // inside a repo: not its own project
  await repoAt("prvt", "alpha-wt"); // linked worktree: .git is a file
  await writeFile(join(root, "prvt", "alpha-wt", ".git"), "gitdir: /somewhere/.git/worktrees/alpha-wt\n");
  await symlink(join(root, "prvt"), join(root, "prvt-link"));
  await repoAt("mirror", "repos", "alpha");
  await repoAt("mirror", "repos-extra", "app");

  // Repositories that do not use OpenSpec yet, under a root of their own.
  await plainRepoAt("plain", "beta-soc");
  await mkdir(join(root, "plain", "notes"), { recursive: true }); // no git, no openspec: nothing to offer
  await plainRepoAt("plain", "mono"); // a container: it holds an OpenSpec package
  await repoAt("plain", "mono", "packages", "tools");
  await mkdir(join(root, "plain", "beta-soc-wt"), { recursive: true }); // linked worktree: .git is a file
  await writeFile(join(root, "plain", "beta-soc-wt", ".git"), "gitdir: /somewhere/.git/worktrees/beta-soc-wt\n");
});

/** A git repository that does not use OpenSpec: the thing this feature offers to set up. */
async function plainRepoAt(...segments: string[]): Promise<string> {
  const dir = join(root, ...segments);
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  return dir;
}

/** A project that is its own git repository, optionally with an `origin`. */
async function clone(origin: string | undefined, ...segments: string[]): Promise<string> {
  const dir = await repoAt(...segments);
  git(dir, "init", "-q", "-b", "main");
  if (origin) git(dir, "remote", "add", "origin", origin);
  return dir;
}
afterAll(() => rm(root, { recursive: true, force: true }));

test("finds repos under multiple roots, skipping ignored dirs, nested repos, worktrees and depth limit", async () => {
  const { paths, errors } = await findSpecProjects([join(root, "prvt"), join(root, "acme"), join(root, "deep")]);
  expect(errors).toEqual([]);
  expect(paths).toEqual([join(root, "acme", "beta"), join(root, "prvt", "alpha")]);
});

test("missing root is reported but other roots still scan", async () => {
  const { paths, errors } = await findSpecProjects([join(root, "nope"), join(root, "prvt")]);
  expect(errors).toEqual([{ root: join(root, "nope"), message: "does not exist" }]);
  expect(paths).toEqual([join(root, "prvt", "alpha")]);
});

test("candidates exclude configured repos (enabled or not) and are untracked, sorted by path", () => {
  const enabled = { ...newRepoConfig("/w/alpha", true), name: "Alpha!" };
  const disabled = newRepoConfig("/w/beta", false);
  const candidates = toCandidates([enabled, disabled], ["/w/zeta", "/w/alpha", "/w/beta", "/w/gamma"]);
  expect(candidates).toEqual([newRepoConfig("/w/gamma", false), newRepoConfig("/w/zeta", false)]);
  expect(candidates[0]).toMatchObject({ name: "gamma", enabled: false });
});

test("a candidate whose path's id a configured repository holds is reported with the id Enable then stores", () => {
  // /w/acme/Tools kept the id of its former spelling after a rename; a new folder now has that spelling.
  const tools = { ...newRepoConfig("/w/acme/tools", true), id: repoId("/w/acme/Tools") };
  const [candidate] = toCandidates([tools], ["/w/acme/Tools"]);
  expect(candidate.id).not.toBe(tools.id);
  expect(candidate).toEqual(newRepoConfig("/w/acme/Tools", false, [tools.id]));
  expect(toIntegratable([tools], ["/w/acme/Tools"])[0].id).toBe(candidate.id);
  expect(toCandidates([], ["/w/acme/Tools"])[0].id).toBe(repoId("/w/acme/Tools"));
});

test("overlapping roots and a trailing slash return each repo once", async () => {
  const { paths, errors } = await findSpecProjects([root, join(root, "prvt"), `${join(root, "prvt")}/`, join(root, "prvt", ".", "alpha")]);
  expect(errors).toEqual([]);
  expect(paths.filter((p) => p.endsWith("/alpha") && p.includes("/prvt"))).toEqual([join(root, "prvt", "alpha")]);
  expect(new Set(paths).size).toBe(paths.length);
});

test("a symlinked root reports the real path once", async () => {
  const { paths } = await findSpecProjects([join(root, "prvt-link"), join(root, "prvt")]);
  expect(paths).toEqual([join(root, "prvt", "alpha")]);
});

test("a differently cased root reports the on-disk path once", async () => {
  if (!existsSync(join(root, "PRVT"))) return; // case-sensitive volume
  const { paths } = await findSpecProjects([join(root, "PRVT"), join(root, "prvt")]);
  expect(paths).toEqual([join(root, "prvt", "alpha")]);
});

test("ignore paths are skipped, by whole segments, however they are spelled", async () => {
  const roots = [join(root, "mirror"), join(root, "prvt")];
  const all = [join(root, "mirror", "repos-extra", "app"), join(root, "mirror", "repos", "alpha"), join(root, "prvt", "alpha")]; // "-" sorts before "/"
  expect((await findSpecProjects(roots)).paths).toEqual(all);
  const ignored = await findSpecProjects(roots, DEFAULT_MAX_DEPTH, [`${join(root, "mirror", "repos")}/`]);
  expect(ignored.paths).toEqual([join(root, "mirror", "repos-extra", "app"), join(root, "prvt", "alpha")]);
  // the repository itself, and a symlinked spelling of its parent
  expect((await findSpecProjects(roots, DEFAULT_MAX_DEPTH, [join(root, "prvt-link", "alpha")])).paths).toEqual(all.slice(0, 2));
  expect((await findSpecProjects(roots, DEFAULT_MAX_DEPTH, [join(root, "mirror", "repos")])).paths).toContain(join(root, "mirror", "repos-extra", "app"));
});

test("an ignored root yields no results and no error", async () => {
  expect(await findSpecProjects([join(root, "mirror")], DEFAULT_MAX_DEPTH, [join(root, "mirror")])).toEqual({ paths: [], frameworks: new Map(), integratable: [], errors: [] });
});

test("a tracked repo is not offered again under a symlinked spelling", async () => {
  const tracked = { ...newRepoConfig(join(root, "prvt", "alpha"), true), name: "Alpha!" };
  const { candidates } = await discoverRepos([tracked], [join(root, "prvt-link")]);
  expect(candidates).toEqual([]);
});

test("normalizeRemote makes ssh and https forms of one repository equal", () => {
  const same = ["git@example.test:org/app.git", "https://example.test/org/app", "https://Example.TEST/org/app.git", "ssh://git@example.test:22/org/app.git", "https://user@example.test/org/app/"];
  for (const url of same) expect(normalizeRemote(url)).toBe("example.test/org/app");
  expect(normalizeRemote("git@example.test:org/other.git")).toBe("example.test/org/other");
  expect(normalizeRemote("https://example.test/Org/app")).toBe("example.test/Org/app"); // only the host is case-insensitive
  expect(normalizeRemote("/srv/git/app.git")).toBe("/srv/git/app.git");
  expect(normalizeRemote("  ")).toBeUndefined();
});

test("candidates sharing an origin are flagged with each other and with tracked repos, never hidden", async () => {
  const tracked = await clone("git@example.test:org/app.git", "remotes", "acme", "app");
  const mirror = await clone("https://example.test/org/app", "remotes", "mirror", "app");
  const second = await clone("https://EXAMPLE.test/org/app.git", "remotes", "second", "app");
  const other = await clone("git@example.test:org/other.git", "remotes", "acme", "other");
  const noOrigin = await clone(undefined, "remotes", "acme", "no-origin");
  const noGit = await repoAt("remotes", "acme", "no-git");

  const fresh = await discoverRepos([], [join(root, "remotes")]);
  expect(fresh.errors).toEqual([]);
  expect(fresh.candidates.map((c) => c.path)).toEqual([tracked, noGit, noOrigin, other, mirror, second]);
  const byPath = new Map(fresh.candidates.map((c) => [c.path, c]));
  expect(byPath.get(mirror)?.sameRemoteAs).toEqual([
    { name: "app", path: tracked, tracked: false },
    { name: "app", path: second, tracked: false },
  ]);
  expect(byPath.get(tracked)?.sameRemoteAs?.map((r) => r.path)).toEqual([mirror, second]);
  for (const path of [other, noOrigin, noGit]) expect(byPath.get(path)).not.toHaveProperty("sameRemoteAs");

  const known = { ...newRepoConfig(tracked, true), name: "App (main)" };
  const { candidates } = await discoverRepos([known], [join(root, "remotes")]);
  expect(candidates.map((c) => c.path)).toEqual([noGit, noOrigin, other, mirror, second]);
  expect(candidates.find((c) => c.path === mirror)?.sameRemoteAs).toEqual([
    { name: "App (main)", path: tracked, tracked: true },
    { name: "app", path: second, tracked: false },
  ]);
});

test("remote lookup leaves the repositories' git config untouched", async () => {
  const dir = await clone("git@example.test:org/untouched.git", "readonly", "untouched");
  const before = await Bun.file(join(dir, ".git", "config")).text();
  await discoverRepos([], [join(root, "readonly")]);
  expect(await Bun.file(join(dir, ".git", "config")).text()).toBe(before);
});

test("git repositories without OpenSpec are reported separately, containers and worktrees are not", async () => {
  const { paths, integratable, errors } = await findSpecProjects([join(root, "plain")]);
  expect(errors).toEqual([]);
  // the walk still descends into a plain git repository, so the package inside the monorepo is found as before
  expect(paths).toEqual([join(root, "plain", "mono", "packages", "tools")]);
  // `mono` holds that package, so it is a container; `notes` has no git and `beta-soc-wt` is a linked worktree
  expect(integratable).toEqual([join(root, "plain", "beta-soc")]);
});

test("reporting integratable repositories leaves the candidates untouched", async () => {
  const roots = [join(root, "prvt"), join(root, "acme"), join(root, "deep"), join(root, "plain")];
  const { paths, integratable } = await findSpecProjects(roots);
  expect(paths).toEqual([join(root, "acme", "beta"), join(root, "plain", "mono", "packages", "tools"), join(root, "prvt", "alpha")]);
  expect(integratable).toEqual([join(root, "plain", "beta-soc")]);
});

test("ignore paths and ignored directory names apply to integratable repositories too", async () => {
  const ignored = await findSpecProjects([join(root, "plain")], DEFAULT_MAX_DEPTH, [join(root, "plain", "beta-soc")]);
  expect(ignored.integratable).toEqual([]);
  expect(ignored.paths).toEqual([join(root, "plain", "mono", "packages", "tools")]); // the rest is unaffected
});

test("a tracked repository is in neither list", async () => {
  const tracked = { ...newRepoConfig(join(root, "plain", "beta-soc"), true), name: "Beta SOC" };
  const { candidates, integratable } = await discoverRepos([tracked], [join(root, "plain")]);
  expect(integratable).toEqual([]);
  expect(candidates.map((c) => c.path)).toEqual([join(root, "plain", "mono", "packages", "tools")]);
});

test("discovery reports integratable repositories with an id and a default name", async () => {
  const { integratable } = await discoverRepos([], [join(root, "plain")]);
  expect(integratable).toEqual([{ id: newRepoConfig(join(root, "plain", "beta-soc")).id, path: join(root, "plain", "beta-soc"), name: "beta-soc" }]);
});

test("toIntegratable drops configured repositories and sorts by path", () => {
  const known = [newRepoConfig("/w/alpha", true), newRepoConfig("/w/beta", false)];
  expect(toIntegratable(known, ["/w/zeta", "/w/alpha", "/w/beta", "/w/gamma"]).map((r) => r.path)).toEqual(["/w/gamma", "/w/zeta"]);
});

test("a folder a clone is still writing is in neither result until the clone has finished", async () => {
  // A clone in progress: `.git` exists, and the marker may already be checked out.
  const cloning = await repoAt("cloning", "beta-soc");
  await mkdir(join(cloning, ".git"));
  await mkdir(join(root, "cloning", "chat-groups", ".git"), { recursive: true });
  const during = await discoverRepos([], [join(root, "cloning")], [], [cloning, join(root, "cloning", "chat-groups")]);
  expect(during.candidates).toEqual([]);
  expect(during.integratable).toEqual([]);
  const after = await discoverRepos([], [join(root, "cloning")]);
  expect(after.candidates.map((c) => c.path)).toEqual([cloning]);
  expect(after.integratable.map((r) => r.path)).toEqual([join(root, "cloning", "chat-groups")]);
});
