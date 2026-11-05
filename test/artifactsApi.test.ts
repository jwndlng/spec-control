import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { MAX_ARTIFACT_BYTES } from "../src/server/artifacts.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import type { ChangeArtifacts } from "../src/shared/types.ts";
import { FIXTURES, tempDir, treeFingerprint, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let scratch: string;

const demoOps = newRepoConfig(join(FIXTURES, "demo-ops"), true);
const betaSoc = newRepoConfig(join(FIXTURES, "beta-soc"), true);
const disabled = newRepoConfig(join(FIXTURES, "does-not-matter"), false);

const get = (repoId: string, change: string, rest: string) => fetch(`${base}/api/repos/${encodeURIComponent(repoId)}/changes/${encodeURIComponent(change)}/${rest}`);
const file = (repoId: string, change: string, path: string) => get(repoId, change, `file?path=${encodeURIComponent(path)}`);

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  // What the fixtures must not contain: a link out of a change and an oversize file.
  scratch = await tempDir("osd-artifacts-api-");
  const change = join(scratch, "openspec", "changes", "edge-cases");
  await mkdir(join(change, "specs"), { recursive: true });
  await writeFile(join(change, "proposal.md"), "## Why\n");
  await writeFile(join(scratch, "secrets.md"), "outside\n");
  await symlink(join(scratch, "secrets.md"), join(change, "leak.md"));
  await writeFile(join(change, "huge.md"), "x".repeat(MAX_ARTIFACT_BYTES + 1));

  state = { config: { ...defaultConfig(), repos: [demoOps, betaSoc, disabled, newRepoConfig(scratch, true)] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await rm(scratch, { recursive: true, force: true });
  await cleanup();
});

test("artifact list: change header, schema order, files with sizes, empty files for unwritten artifacts", async () => {
  const res = await get(demoOps.id, "cloud-deployment", "artifacts");
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  const body = (await res.json()) as ChangeArtifacts;
  expect(body.change).toEqual({ repoId: demoOps.id, name: "cloud-deployment", schema: "spec-driven", dir: join(demoOps.path, "openspec", "changes", "cloud-deployment"), archived: false });
  expect(body.artifacts.map((a) => [a.id, a.status, a.files.map((f) => f.path)])).toEqual([
    ["proposal", "done", ["proposal.md"]],
    ["specs", "done", ["specs/cloud-deployment/spec.md"]],
    ["design", "done", ["design.md"]],
    ["tasks", "done", ["tasks.md"]],
  ]);
  expect(body.artifacts[0].files[0].bytes).toBeGreaterThan(0);

  const early = (await (await get(demoOps.id, "add-health-endpoint", "artifacts")).json()) as ChangeArtifacts;
  expect(early.artifacts.map((a) => [a.id, a.files.length])).toEqual([["proposal", 1], ["specs", 0], ["design", 0], ["tasks", 0]]);
});

test("file content with its size", async () => {
  const res = await file(demoOps.id, "cloud-deployment", "proposal.md");
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  const body = await res.json();
  const text = await Bun.file(join(demoOps.path, "openspec", "changes", "cloud-deployment", "proposal.md")).text();
  expect(body).toEqual({ path: "proposal.md", bytes: Buffer.byteLength(text), text });
});

test("400 for a missing, absolute or escaping path and for an invalid change name", async () => {
  expect((await get(demoOps.id, "cloud-deployment", "file")).status).toBe(400);
  for (const path of ["/etc/passwd", "../../../../etc/passwd", "specs/../../../secrets.md"]) {
    const res = await file(demoOps.id, "cloud-deployment", path);
    expect([path, res.status]).toEqual([path, 400]);
    expect(JSON.stringify(await res.json())).not.toContain("root:");
  }
  for (const name of ["../cloud-deployment", "a/b", "cloud deployment", "%"]) {
    expect([name, (await get(demoOps.id, name, "artifacts")).status]).toEqual([name, 400]);
    expect([name, (await file(demoOps.id, name, "proposal.md")).status]).toEqual([name, 400]);
  }
  expect((await fetch(`${base}/api/repos/${demoOps.id}/changes/%E0%A4%A/artifacts`)).status).toBe(400); // undecodable
});

test("404 for an unknown or disabled repository, an unknown change, a link out of the change and a non-file", async () => {
  expect((await get("nope", "cloud-deployment", "artifacts")).status).toBe(404);
  expect((await file("nope", "cloud-deployment", "proposal.md")).status).toBe(404);
  expect((await get(disabled.id, "cloud-deployment", "artifacts")).status).toBe(404);
  expect((await get(demoOps.id, "never-existed", "artifacts")).status).toBe(404);
  expect((await file(demoOps.id, "never-existed", "proposal.md")).status).toBe(404);
  expect((await file(demoOps.id, "cloud-deployment", "specs")).status).toBe(404);
  expect((await file(demoOps.id, "cloud-deployment", "missing.md")).status).toBe(404);
  const scratchId = state.config.repos[3].id;
  const leak = await file(scratchId, "edge-cases", "leak.md");
  expect(leak.status).toBe(404);
  expect(await leak.text()).not.toContain("outside");
  expect((await file(scratchId, "edge-cases", "proposal.md")).status).toBe(200);
});

test("413 without content for an oversize file", async () => {
  const res = await file(state.config.repos[3].id, "edge-cases", "huge.md");
  expect(res.status).toBe(413);
  const body = await res.json();
  expect(body.error).toContain("larger than");
  expect(body.text).toBeUndefined();
});

test("other methods are not routed here", async () => {
  const res = await fetch(`${base}/api/repos/${demoOps.id}/changes/cloud-deployment/artifacts`, { method: "POST", headers: { "content-type": "application/json" } });
  expect(res.status).toBe(404);
});

test("archived changes answer from their archive directory", async () => {
  const body = (await (await get(demoOps.id, "runbook-repo-field", "artifacts")).json()) as ChangeArtifacts;
  expect(body.change.archived).toBe(true);
  expect(body.change.dir).toBe(join(demoOps.path, "openspec", "changes", "archive", "2026-06-18-runbook-repo-field"));
  expect(body.artifacts.find((a) => a.id === "specs")?.files.map((f) => f.path)).toEqual(["specs/runbook-repo-field/spec.md"]);
  const res = await file(demoOps.id, "runbook-repo-field", "tasks.md");
  expect(res.status).toBe(200);
  expect((await res.json()).text).toContain("- [x]");
});

test("reading every artifact of every fixture change leaves the repositories untouched", async () => {
  const before = await Promise.all([demoOps, betaSoc].map((r) => treeFingerprint(r.path)));
  let reads = 0;
  for (const repo of [demoOps, betaSoc]) {
    const { active, archived } = await openSpec.listChanges(new LocalRepoSource(repo.path));
    for (const change of [...active, ...archived]) {
      const res = await get(repo.id, change.name, "artifacts");
      expect([change.name, res.status]).toEqual([change.name, 200]);
      for (const artifact of ((await res.json()) as ChangeArtifacts).artifacts) {
        for (const f of artifact.files) {
          expect((await file(repo.id, change.name, f.path)).status).toBe(200);
          reads++;
        }
      }
    }
  }
  expect(reads).toBeGreaterThan(30);
  expect(await Promise.all([demoOps, betaSoc].map((r) => treeFingerprint(r.path)))).toEqual(before);
});

test("a change that lives only in a linked worktree is read from that worktree", async () => {
  const git = async (cwd: string, ...args: string[]) => {
    const proc = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
    if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
  };
  const root = join(scratch, "alpha-infra");
  await mkdir(join(root, "openspec", "changes"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await git(root, "init");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "init");
  const worktree = join(scratch, "alpha-infra-wt");
  await git(root, "worktree", "add", worktree, "-b", "feat/add-login");
  const change = join(worktree, "openspec", "changes", "add-login");
  await mkdir(change, { recursive: true });
  await writeFile(join(change, ".openspec.yaml"), "schema: spec-driven\n");
  await writeFile(join(change, "proposal.md"), "## Why\n\nIn a worktree.\n");

  const alpha = newRepoConfig(root, true);
  state.config = { ...state.config, repos: [...state.config.repos, alpha] };
  await state.scanner.trigger().done;

  const list = await get(alpha.id, "add-login", "artifacts");
  expect(list.status).toBe(200);
  const body = (await list.json()) as ChangeArtifacts;
  expect(body.change.dir.endsWith(join("alpha-infra-wt", "openspec", "changes", "add-login"))).toBe(true);
  expect(body.artifacts[0].files.map((f) => f.path)).toEqual(["proposal.md"]);
  const content = await file(alpha.id, "add-login", "proposal.md");
  expect(content.status).toBe(200);
  expect(((await content.json()) as { text: string }).text).toContain("In a worktree.");
}, 30_000); // Includes full fixture scans and subprocesses on slower runners.
