import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import { contextBegin } from "../src/server/sharedConfig.ts";
import type { RepoConfig } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";

const SCAFFOLD = "schema: spec-driven\n\n# Project context (optional)\n#   context: |\n#     Tech stack: TypeScript\n";
const BASE = { id: "base", name: "Base", context: "We use conventional commits.", rules: { proposal: ["Always include Non-goals"] } };
const SECURITY = { id: "security", name: "Security", context: "Threat-model every new endpoint.", rules: {} };
const SHARED = { profiles: [BASE, SECURITY] };
const assign = (profileIds: string[], ...repos: { id: string }[]) => ({ assignments: repos.map((r) => ({ repoId: r.id, profileIds })) });

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let healthy: RepoConfig;
let broken: RepoConfig;
let disabled: RepoConfig;
const roots: string[] = [];

const api = async (path: string, method = "GET", body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { status: res.status, body: await res.json() };
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
  return out;
}

async function makeRepo(name: string, config: string, enabled: boolean): Promise<RepoConfig> {
  const root = join(await tempDir("osd-api-"), name);
  roots.push(root);
  await mkdir(join(root, "openspec", "changes", "some-change"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), config);
  await writeFile(join(root, "openspec", "changes", "some-change", "proposal.md"), "# x\n");
  await writeFile(join(root, "README.md"), "# repo\n");
  await git(root, "init", "-q");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "init");
  return newRepoConfig(root, enabled);
}

/** Every file under `root` (including `.git`) with size and mtime: any write at all shows up as a difference. */
async function fingerprint(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await visit(p);
      else {
        const s = await stat(p);
        out[relative(root, p)] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  await visit(root);
  return out;
}

/** Apply as the dialog does: preview first, then send each repository back with its preview's digest. */
const previewThenApply = async (body: ReturnType<typeof assign>) => {
  const { previews } = (await api("/api/shared-config/preview", "POST", body)).body as { previews: { repoId: string; digest: string }[] };
  const digests = new Map(previews.map((p) => [p.repoId, p.digest]));
  return api("/api/shared-config/apply", "POST", { assignments: body.assignments.map((a) => ({ ...a, digest: digests.get(a.repoId) })) });
};

const changedPaths = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  healthy = await makeRepo("alpha-infra", SCAFFOLD, true);
  broken = await makeRepo("beta-soc", "schema: [unclosed", true);
  disabled = await makeRepo("demo-ops", SCAFFOLD, false);
  state = { config: { ...defaultConfig(), repos: [healthy, broken, disabled] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  for (const root of roots) await rm(join(root, ".."), { recursive: true, force: true });
  await cleanup();
});

/** A scan that certainly started after this call: waits out one that is already running, then runs another. */
const freshScan = async () => {
  await state.scanner.trigger().done;
  await state.scanner.trigger().done;
};

const stateOf = async (id: string) => (await api("/api/state")).body.repos.find((r: { id: string }) => r.id === id)?.sharedConfig;

test("before anything is saved: empty config, no state in the snapshot", async () => {
  expect((await api("/api/shared-config")).body).toEqual({ profiles: [] });
  await state.scanner.trigger().done;
  expect(await stateOf(healthy.id)).toBeUndefined();
});

test("invalid save is rejected and nothing is stored", async () => {
  const res = await api("/api/shared-config", "PUT", { profiles: [{ ...BASE, rules: { "../evil": ["a"] } }] });
  expect(res.status).toBe(400);
  expect(res.body.issues[0]).toContain("artifact id");
  expect((await api("/api/shared-config")).body).toEqual({ profiles: [] });
});

test("scan, save and preview write nothing to any repository; the snapshot then reports states", async () => {
  const before = await Promise.all([healthy, broken, disabled].map((r) => fingerprint(r.path)));

  const saved = await api("/api/shared-config", "PUT", SHARED);
  expect([saved.status, saved.body]).toEqual([200, SHARED]);
  await state.scanner.trigger().done;
  const preview = await api("/api/shared-config/preview", "POST", assign(["base"], healthy, broken, disabled, { id: "nope" }));
  expect(preview.status).toBe(200);
  await state.scanner.trigger().done;

  const after = await Promise.all([healthy, broken, disabled].map((r) => fingerprint(r.path)));
  expect(after).toEqual(before);

  const byId = Object.fromEntries(preview.body.previews.map((p: { repoId: string }) => [p.repoId, p]));
  expect([byId[healthy.id].current, byId[healthy.id].refusal, byId[healthy.id].before]).toEqual([{ unreadable: false, applied: [] }, undefined, SCAFFOLD]);
  expect(byId[healthy.id].after).toContain(contextBegin("base"));
  expect(byId[broken.id].refusal).toContain("invalid YAML");
  expect(byId[disabled.id].refusal).toContain("not an enabled repository");
  expect(byId.nope.refusal).toContain("not an enabled repository");

  expect(await stateOf(healthy.id)).toEqual({ unreadable: false, applied: [] });
  expect(await stateOf(broken.id)).toEqual({ unreadable: true, applied: [] });
  expect((await api("/api/state")).body.repos.find((r: { id: string }) => r.id === broken.id).ok).toBe(true);
});

test("apply: partial success, exactly one file changes, git sees one modification and its index is untouched", async () => {
  const before = await fingerprint(healthy.path);
  const index = await readFile(join(healthy.path, ".git", "index"));
  const others = await Promise.all([broken, disabled].map((r) => fingerprint(r.path)));

  const res = await previewThenApply(assign(["base", "security"], healthy, broken, disabled));
  expect(res.status).toBe(200);
  const byId = Object.fromEntries(res.body.results.map((r: { repoId: string }) => [r.repoId, r]));
  expect(byId[healthy.id]).toEqual({ repoId: healthy.id, result: "written" });
  expect([byId[broken.id].result, byId[disabled.id].result]).toEqual(["refused", "refused"]);
  expect(byId[disabled.id].reason).toContain("not an enabled repository");
  await state.scanner.trigger().done;

  expect(changedPaths(before, await fingerprint(healthy.path))).toEqual([join("openspec", "config.yaml")]);
  expect(await Promise.all([broken, disabled].map((r) => fingerprint(r.path)))).toEqual(others);
  expect(Buffer.compare(index, await readFile(join(healthy.path, ".git", "index")))).toBe(0);
  expect((await git(healthy.path, "status", "--porcelain")).trim()).toBe("M openspec/config.yaml");
  expect(await stateOf(healthy.id)).toEqual({ unreadable: false, applied: [{ id: "base", state: "in-sync" }, { id: "security", state: "in-sync" }] });

  // again: nothing to do, nothing written
  const again = await previewThenApply(assign(["base", "security"], healthy));
  expect(again.body.results).toEqual([{ repoId: healthy.id, result: "unchanged" }]);
});

test("apply refuses a file changed after the preview and writes nothing; a fresh preview then applies", async () => {
  const file = join(healthy.path, "openspec", "config.yaml");
  await api("/api/shared-config", "PUT", { profiles: [{ ...BASE, context: "We use conventional commits. Squash on merge." }, SECURITY] });
  await freshScan();
  expect((await stateOf(healthy.id)).applied[0]).toEqual({ id: "base", state: "outdated" });
  const { previews } = (await api("/api/shared-config/preview", "POST", assign(["base"], healthy))).body;
  const edited = `${await readFile(file, "utf8")}profile: strict # added by hand after the preview\n`;
  await writeFile(file, edited);
  const stale = await api("/api/shared-config/apply", "POST", { assignments: [{ repoId: healthy.id, profileIds: ["base"], digest: previews[0].digest }] });
  expect(stale.status).toBe(200);
  expect(stale.body.results).toEqual([{ repoId: healthy.id, result: "refused", reason: expect.stringContaining("changed since the preview") }]);
  expect(await readFile(file, "utf8")).toBe(edited);

  const res = await previewThenApply(assign(["base"], healthy)); // also detaches "security"
  expect(res.body.results[0].result).toBe("written");
  const text = await readFile(file, "utf8");
  expect(text).toContain("Squash on merge.");
  expect(text).toContain("profile: strict # added by hand after the preview");
  expect(text).not.toContain("Threat-model");
  await state.scanner.trigger().done;
});

test("apply without a digest is refused and writes nothing", async () => {
  const before = await fingerprint(healthy.path);
  const res = await api("/api/shared-config/apply", "POST", assign(["base", "security"], healthy));
  expect(res.status).toBe(200);
  expect(res.body.results).toEqual([{ repoId: healthy.id, result: "refused", reason: expect.stringContaining("changed since the preview") }]);
  expect(await fingerprint(healthy.path)).toEqual(before);
  expect((await api("/api/shared-config/apply", "POST", { assignments: [{ repoId: healthy.id, profileIds: [], digest: 42 }] })).status).toBe(400);
});

test("malformed selection is a 400; the guard applies to these routes too", async () => {
  expect((await api("/api/shared-config/apply", "POST", { assignments: "all" })).status).toBe(400);
  expect((await api("/api/shared-config/apply", "POST", { assignments: [{ repoId: healthy.id }] })).status).toBe(400);
  expect((await api("/api/shared-config/preview", "POST", {})).status).toBe(400);
  const unknown = await api("/api/shared-config/apply", "POST", assign(["nope"], healthy));
  expect(unknown.body.results[0]).toEqual({ repoId: healthy.id, result: "refused", reason: "unknown profile: nope" });
  const foreign = await fetch(`${base}/api/shared-config/apply`, { method: "POST", body: JSON.stringify(assign(["base"], healthy)), headers: { "content-type": "application/json", origin: "https://example.com" } });
  expect(foreign.status).toBe(403);
});

test("a failed scan keeps the previous shared-config state", async () => {
  await state.scanner.trigger().done;
  const known = await stateOf(healthy.id);
  expect(known).toBeDefined();
  class Failing extends LocalRepoSource {
    override exists(): Promise<boolean> {
      return Promise.reject(new Error("boom"));
    }
  }
  const flaky = new Scanner(() => state.config, { persist: false, sharedConfig: async () => SHARED, sourceFor: (r) => new Failing(r.path) }, state.scanner.snapshot);
  const repo = (await flaky.trigger().done).repos.find((r) => r.id === healthy.id)!;
  expect([repo.ok, repo.sharedConfig]).toEqual([false, known]);
});
