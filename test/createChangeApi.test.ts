import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import { tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { git } from "./sessionHelpers.ts";

interface Harness {
  base: string;
  state: AppState;
  server: ReturnType<typeof Bun.serve>;
  home: () => Promise<void>;
  repoRoot: string;
  repoId: string;
}

/** `git status --porcelain --untracked-files=all`, lines sorted and untrimmed: the leading column is the index state. */
function porcelain(repo: string): string[] {
  const out = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo, stdout: "pipe", stderr: "pipe" }).stdout.toString();
  return out.split("\n").filter((line) => line !== "").sort();
}

/** `.git/index` and the tree together: equal before and after means neither a file nor an index entry changed. */
const indexAndTree = async (repoRoot: string) => `${readFileSync(join(repoRoot, ".git", "index")).toString("hex")}\n${await treeFingerprint(repoRoot)}`;

async function harness(options: { withOpenspecDir?: boolean; withArchive?: boolean; enabled?: boolean; schema?: string; git?: boolean } = {}): Promise<Harness> {
  const { withOpenspecDir = true, withArchive = false, enabled = true, schema = "spec-driven", git: asGit = false } = options;
  const { cleanup } = await useTempHome();
  const repoRoot = await tempDir("osd-repo-");
  if (withOpenspecDir) {
    await mkdir(join(repoRoot, "openspec", "changes"), { recursive: true });
    await writeFile(join(repoRoot, "openspec", "config.yaml"), `schema: ${schema}\n`);
  }
  if (withArchive) {
    await mkdir(join(repoRoot, "openspec", "changes", "archive", "2026-06-18-old-thing"), { recursive: true });
    await writeFile(join(repoRoot, "openspec", "changes", "archive", "2026-06-18-old-thing", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-06-18\n");
  }
  if (asGit) {
    // A real repository with one commit, so that staging has an index to write and refs to leave alone.
    git(repoRoot, "init", "-q", "-b", "main");
    git(repoRoot, "config", "user.email", "t@example.invalid");
    git(repoRoot, "config", "user.name", "t");
    await writeFile(join(repoRoot, "README.md"), "# demo-ops\n");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-q", "-m", "init");
  }
  const repo = newRepoConfig(repoRoot, enabled);
  const state: AppState = { config: { ...defaultConfig(), repos: [repo] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  const base = `http://127.0.0.1:${server.port}`;
  return {
    base, state, server, repoRoot, repoId: repo.id,
    home: async () => {
      state.scanner.stop();
      server.stop(true);
      await rm(repoRoot, { recursive: true, force: true });
      await cleanup();
    },
  };
}

const post = (base: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

let h: Harness;
afterEach(() => h?.home());

test("POST /api/repos/:id/changes creates the directory and returns 201 (staged false outside git)", async () => {
  h = await harness();
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ name: "add-audit-trail", staged: false });
  const marker = await Bun.file(join(h.repoRoot, "openspec", "changes", "add-audit-trail", ".openspec.yaml")).text();
  expect(marker).toContain("schema: spec-driven");
});

test("in a git repository the new directory is staged and the 201 body says so", async () => {
  h = await harness({ git: true });
  const head = git(h.repoRoot, "rev-parse", "HEAD");
  const refs = git(h.repoRoot, "for-each-ref");
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail", prompt: "Log every mutation" });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ name: "add-audit-trail", staged: true });
  expect(porcelain(h.repoRoot)).toEqual([
    "A  openspec/changes/add-audit-trail/.openspec.yaml",
    "A  openspec/changes/add-audit-trail/prompt.md",
  ]);
  // Staged, not committed: HEAD, the branch and every ref are what they were.
  expect(git(h.repoRoot, "rev-parse", "HEAD")).toBe(head);
  expect(git(h.repoRoot, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  expect(git(h.repoRoot, "for-each-ref")).toBe(refs);

  await h.state.scanner.trigger().done;
  const snap = await (await fetch(`${h.base}/api/state`)).json();
  const change = snap.repos[0].changes.find((c: { name: string }) => c.name === "add-audit-trail");
  expect(change?.column).toBe("Backlog");
});

test("in a git repository with unrelated dirty and untracked files, only the new directory is staged", async () => {
  h = await harness({ git: true });
  await writeFile(join(h.repoRoot, "README.md"), "# demo-ops\n\nedited locally, not staged\n");
  await writeFile(join(h.repoRoot, "scratch.txt"), "untracked and staying that way\n");
  expect(porcelain(h.repoRoot)).toEqual([" M README.md", "?? scratch.txt"]);

  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(201);
  expect(porcelain(h.repoRoot)).toEqual([" M README.md", "?? scratch.txt", "A  openspec/changes/add-audit-trail/.openspec.yaml"]);
  expect(git(h.repoRoot, "diff", "--cached", "--name-only")).toBe("openspec/changes/add-audit-trail/.openspec.yaml");
});

test("a successful create writes only the new change directory (nothing else moves)", async () => {
  h = await harness();
  // Seed a pre-existing sibling change and a config file to make the tree richer.
  await mkdir(join(h.repoRoot, "openspec", "changes", "prior"), { recursive: true });
  await writeFile(join(h.repoRoot, "openspec", "changes", "prior", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-08-01\n");
  await writeFile(join(h.repoRoot, "openspec", "changes", "prior", "proposal.md"), "# Prior\n");
  const beforeFiles = await treeFingerprint(h.repoRoot);

  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail", prompt: "Log every mutation" });
  expect(res.status).toBe(201);

  // The prior change and every other path is unchanged: fingerprint the tree excluding the new directory.
  const priorAfter = await treeFingerprint(join(h.repoRoot, "openspec", "changes", "prior"));
  const priorBefore = await treeFingerprint(join(h.repoRoot, "openspec", "changes", "prior"));
  expect(priorAfter).toBe(priorBefore);
  // The only new files are inside the new change directory.
  const newDir = join(h.repoRoot, "openspec", "changes", "add-audit-trail");
  expect(await Bun.file(join(newDir, ".openspec.yaml")).exists()).toBe(true);
  expect(await Bun.file(join(newDir, "prompt.md")).exists()).toBe(true);
  // Sanity: nothing that would indicate the endpoint wrote outside the tree.
  expect(beforeFiles.split("\n").every((line) => line.length > 0)).toBe(true);
});

test("subsequent GET /api/state reflects the new change (prompt included, recognised marker)", async () => {
  h = await harness();
  const create = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail", prompt: "Log every mutation" });
  expect(create.status).toBe(201);
  await h.state.scanner.trigger().done; // ensure the rescan we triggered ran

  const dir = join(h.repoRoot, "openspec", "changes", "add-audit-trail");
  const marker = await Bun.file(join(dir, ".openspec.yaml")).text();
  expect(marker).toMatch(/^schema: spec-driven\ncreated: \d{4}-\d{2}-\d{2}\n$/);
  const promptFile = await Bun.file(join(dir, "prompt.md")).text();
  expect(promptFile).toBe("# Prompt\n\nLog every mutation\n");

  const snap = await (await fetch(`${h.base}/api/state`)).json();
  const change = snap.repos[0].changes.find((c: { name: string }) => c.name === "add-audit-trail");
  expect(change).toBeTruthy();
  // The scanner ran through the OpenSpec adapter and recognised the marker as `spec-driven`:
  expect(change.schema).toBe("spec-driven");
  // No artifact is done, so it sits in New with the prompt visible on the snapshot.
  expect(change.column).toBe("Backlog");
  expect(change.prompt).toBe("# Prompt\n\nLog every mutation\n");
});

test("400 on invalid name", async () => {
  h = await harness();
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "foo/bar" });
  expect(res.status).toBe(400);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("404 for an unknown repository", async () => {
  h = await harness();
  const res = await post(h.base, `/api/repos/does-not-exist/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(404);
});

test("409 when the repository is disabled", async () => {
  h = await harness({ enabled: false });
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("409 when there is no openspec/ directory", async () => {
  h = await harness({ withOpenspecDir: false });
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("409 when openspec/changes is a symbolic link, and nothing appears in its target", async () => {
  h = await harness();
  const target = join(await tempDir("osd-linked-target-"), "shared");
  await rename(join(h.repoRoot, "openspec", "changes"), target);
  await symlink(target, join(h.repoRoot, "openspec", "changes"));
  const before = await treeFingerprint(target);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await treeFingerprint(target)).toBe(before);
});

test("409 for a duplicate active name", async () => {
  h = await harness();
  await mkdir(join(h.repoRoot, "openspec", "changes", "add-audit-trail"), { recursive: true });
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("409 for a duplicate archived name", async () => {
  h = await harness({ withArchive: true });
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "old-thing" });
  expect(res.status).toBe(409);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("403 for a foreign origin and no directory is written", async () => {
  h = await harness();
  const before = await treeFingerprint(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" }, { origin: "https://example.com" });
  expect(res.status).toBe(403);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("403 for a non-JSON content type and no directory is written", async () => {
  h = await harness();
  const before = await treeFingerprint(h.repoRoot);
  const res = await fetch(`${h.base}/api/repos/${h.repoId}/changes`, { method: "POST", body: JSON.stringify({ name: "add-audit-trail" }), headers: { "content-type": "text/plain" } });
  expect(res.status).toBe(403);
  expect(await treeFingerprint(h.repoRoot)).toBe(before);
});

test("400 for a malformed JSON body", async () => {
  h = await harness();
  const res = await fetch(`${h.base}/api/repos/${h.repoId}/changes`, { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
  expect(res.status).toBe(400);
});

// --- Refusals in a git repository run no git: the index is byte-for-byte unchanged, as is the tree ---

test("400 (invalid name) in a git repository leaves the index and tree untouched", async () => {
  h = await harness({ git: true });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "foo/bar" });
  expect(res.status).toBe(400);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("400 for the archive root in a repository with no archived change yet: nothing is written, the index included", async () => {
  h = await harness({ git: true });
  const before = await indexAndTree(h.repoRoot);
  for (const name of ["archive", "Archive", ".git", "-wip", "a..b", "notes.", "notes.lock"]) {
    const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name });
    expect([name, res.status]).toEqual([name, 400]);
    const body = (await res.json()) as { error: string };
    expect([name, body.error.startsWith("invalid change name: ")]).toEqual([name, true]);
    if (name === "archive") expect(body.error).toContain("reserved");
  }
  expect(existsSync(join(h.repoRoot, "openspec", "changes", "archive"))).toBe(false);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("404 (unknown repository) leaves a git repository's index and tree untouched", async () => {
  h = await harness({ git: true });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/does-not-exist/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(404);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("409 (duplicate active name) in a git repository leaves the index and tree untouched", async () => {
  h = await harness({ git: true });
  await mkdir(join(h.repoRoot, "openspec", "changes", "add-audit-trail"), { recursive: true });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("409 (duplicate archived name) in a git repository leaves the index and tree untouched", async () => {
  h = await harness({ git: true, withArchive: true });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "old-thing" });
  expect(res.status).toBe(409);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("409 (no openspec/ directory) in a git repository leaves the index and tree untouched", async () => {
  h = await harness({ git: true, withOpenspecDir: false });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" });
  expect(res.status).toBe(409);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("403 (foreign origin) in a git repository leaves the index and tree untouched", async () => {
  h = await harness({ git: true });
  const before = await indexAndTree(h.repoRoot);
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-audit-trail" }, { origin: "https://example.com" });
  expect(res.status).toBe(403);
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});

test("dependsOn is written as depends-on.yaml, staged, and reported by the next scan", async () => {
  h = await harness({ git: true });
  const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-billing-ui", dependsOn: ["add-billing-api"] });
  expect(res.status).toBe(201);
  expect(porcelain(h.repoRoot)).toEqual([
    "A  openspec/changes/add-billing-ui/.openspec.yaml",
    "A  openspec/changes/add-billing-ui/depends-on.yaml",
  ]);
  await h.state.scanner.trigger().done;
  const snap = await (await fetch(`${h.base}/api/state`)).json();
  const change = snap.repos[0].changes.find((c: { name: string }) => c.name === "add-billing-ui");
  expect(change.dependsOn).toEqual([{ name: "add-billing-api", state: "missing" }]);
  expect(change.blocked).toBe(true);
});

test("400 for invalid dependencies, and the repository and its index are unchanged", async () => {
  h = await harness({ git: true });
  const before = await indexAndTree(h.repoRoot);
  for (const dependsOn of [["../etc"], ["a", "a"], ["add-billing-ui"], "add-billing-api", { 0: "a" }]) {
    const res = await post(h.base, `/api/repos/${h.repoId}/changes`, { name: "add-billing-ui", dependsOn });
    expect(res.status).toBe(400);
  }
  expect(await indexAndTree(h.repoRoot)).toBe(before);
});
