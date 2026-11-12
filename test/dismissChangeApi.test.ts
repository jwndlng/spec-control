import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { DeleteFilesPreview, RepoConfig } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { treeFingerprint } from "./helpers.ts";
import { git, tempGitRepo, tempPlainRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let active: RepoConfig;
let disabled: RepoConfig;
let plain: RepoConfig;

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const route = (repo: RepoConfig | string, name: string) => `/api/repos/${encodeURIComponent(typeof repo === "string" ? repo : repo.id)}/changes/${encodeURIComponent(name)}/delete-files`;
const dismissRoute = (repo: RepoConfig | string, name: string) => `/api/repos/${encodeURIComponent(typeof repo === "string" ? repo : repo.id)}/changes/${encodeURIComponent(name)}/dismiss`;
const dir = (repo: RepoConfig, name: string) => join(repo.path, "openspec", "changes", name);

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  const activePath = await tempGitRepo();
  // A linked worktree that has `cloud-deployment` while the main checkout does not.
  git(activePath, "rm", "-q", "-r", "openspec/changes/cloud-deployment");
  git(activePath, "commit", "-q", "-m", "drop from main");
  const wt = join(await tempDir("osd-wt-"), "cloud-deployment");
  git(activePath, "worktree", "add", "-q", "-b", "feat/cloud-deployment", wt, "HEAD~1");
  active = newRepoConfig(activePath, true);
  disabled = newRepoConfig(await tempGitRepo(), false);
  plain = newRepoConfig(await tempPlainRepo(), true);
  // No session manager: agent sessions are disabled, and dismissing must work regardless.
  state = { config: { ...defaultConfig(), repos: [active, disabled, plain] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

test("unknown repositories are 404, disabled ones 409, invalid names 400", async () => {
  expect((await send("GET", route("nope", "structured-logs"))).status).toBe(404);
  expect((await send("POST", route("nope", "structured-logs"), { fingerprint: "x" })).status).toBe(404);
  expect((await send("GET", route(disabled, "structured-logs"))).status).toBe(409);
  expect((await send("POST", route(disabled, "structured-logs"), { fingerprint: "x" })).status).toBe(409);
  expect(existsSync(dir(disabled, "structured-logs"))).toBe(true);
  for (const bad of ["archive", "a b", "%2E%2E"]) {
    expect((await send("GET", route(active, bad))).status).toBe(400);
    expect((await send("POST", route(active, bad), { fingerprint: "x" })).status).toBe(400);
  }
  // A literal `..` is a dot segment the URL parser removes before routing: no dismiss route is reached at all.
  expect((await send("POST", `/api/repos/${encodeURIComponent(active.id)}/changes/../dismiss`, { fingerprint: "x" })).status).toBe(404);
  expect(existsSync(join(active.path, "openspec", "changes", "archive"))).toBe(true);
});

test("a change only in a linked worktree is 404 naming its branch; an unknown one is 404", async () => {
  const res = await send("GET", route(active, "cloud-deployment"));
  expect(res.status).toBe(404);
  expect(res.body.error).toContain("feat/cloud-deployment");
  expect((await send("GET", route(active, "no-such-change"))).status).toBe(404);
});

test("a missing or malformed fingerprint is 400; a stale one is 409 and deletes nothing", async () => {
  const path = route(active, "rotate-credentials");
  expect((await send("POST", path, "{not json")).status).toBe(400);
  expect((await send("POST", path, {})).status).toBe(400);
  expect((await send("POST", path, { fingerprint: 7 })).status).toBe(400);
  const preview = (await send("GET", path)).body as DeleteFilesPreview;
  await writeFile(join(dir(active, "rotate-credentials"), "tasks.md"), "- [ ] 1.1 new\n");
  const stale = await send("POST", path, { fingerprint: preview.fingerprint });
  expect(stale.status).toBe(409);
  expect(existsSync(join(dir(active, "rotate-credentials"), "tasks.md"))).toBe(true);
});

test("preview then dismiss removes the change, stages its removal and rescans", async () => {
  const path = route(active, "structured-logs");
  const preview = await send("GET", path);
  expect(preview.status).toBe(200);
  const p = preview.body as DeleteFilesPreview;
  expect(p.isGit).toBe(true);
  expect(p.files.every((f) => f.state === "restorable")).toBe(true);
  // The linked worktree was cut before `cloud-deployment` left main, so it holds a copy of every change.
  expect(p.copies.map((c) => c.branch)).toEqual(["feat/cloud-deployment"]);
  const res = await send("POST", path, { fingerprint: p.fingerprint });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ name: "structured-logs", staged: true });
  expect(existsSync(dir(active, "structured-logs"))).toBe(false);
  await state.scanner.trigger().done;
  // The card stays, now read from the worktree's copy.
  expect(state.scanner.snapshot.repos.find((r) => r.id === active.id)?.changes.find((c) => c.name === "structured-logs")?.checkout?.isMain).toBe(false);
  expect(git(active.path, "diff", "--cached", "--name-only").split("\n").every((l) => l.startsWith("openspec/changes/structured-logs/"))).toBe(true);
});

test("a folder without git is supported and nothing is staged", async () => {
  const path = route(plain, "add-health-endpoint");
  const p = (await send("GET", path)).body as DeleteFilesPreview;
  expect(p.isGit).toBe(false);
  const res = await send("POST", path, { fingerprint: p.fingerprint });
  expect(res.body).toEqual({ name: "add-health-endpoint", staged: false });
  expect(existsSync(dir(plain, "add-health-endpoint"))).toBe(false);
});

test("a page on another origin cannot dismiss", async () => {
  const path = route(active, "bump-toolchain");
  const p = (await send("GET", path)).body as DeleteFilesPreview;
  const res = await send("POST", path, { fingerprint: p.fingerprint }, { origin: "https://evil.example" });
  expect(res.status).toBe(403);
  expect(existsSync(dir(active, "bump-toolchain"))).toBe(true);
});

test("dismiss is reversible, works for a worktree-only change, and never changes repository files or the index", async () => {
  const path = dismissRoute(active, "cloud-deployment");
  const before = await treeFingerprint(active.path);
  const index = await Bun.file(join(active.path, ".git", "index")).arrayBuffer();
  const preview = await send("GET", path);
  expect(preview.status).toBe(200);
  expect(preview.body).toMatchObject({ name: "cloud-deployment", copies: expect.arrayContaining([expect.objectContaining({ branch: "feat/cloud-deployment" })]) });
  expect(typeof preview.body.identity).toBe("string");
  const legacy = await send("POST", path, { fingerprint: "old-delete-fingerprint" });
  expect(legacy.status).toBe(400);
  expect(legacy.body.error).toContain("reversible");
  const dismissed = await send("POST", path, { identity: preview.body.identity });
  expect(dismissed).toMatchObject({ status: 200, body: { name: "cloud-deployment", identity: preview.body.identity, dismissed: true } });
  expect(await treeFingerprint(active.path)).toBe(before);
  expect(await Bun.file(join(active.path, ".git", "index")).arrayBuffer()).toEqual(index);
  expect((await send("GET", `/api/repos/${encodeURIComponent(active.id)}/dismissed-changes`)).body.changes).toContainEqual(expect.objectContaining({ name: "cloud-deployment", identity: preview.body.identity }));
  for (let i = 0; i < 2; i++) expect(await send("POST", dismissRoute(active, "cloud-deployment").replace(/\/dismiss$/, "/restore"), { identity: preview.body.identity })).toMatchObject({ status: 200, body: { dismissed: false } });
  expect((await send("GET", `/api/repos/${encodeURIComponent(active.id)}/dismissed-changes`)).body.changes.some((c: { name: string }) => c.name === "cloud-deployment")).toBe(false);
});

test("dismiss identity races, foreign origins, and same-name repositories are scoped safely", async () => {
  const path = dismissRoute(active, "structured-logs");
  const preview = (await send("GET", path)).body;
  const race = await send("POST", path, { identity: "stale-identity" });
  expect(race.status).toBe(409);
  const foreign = await send("POST", path, { identity: preview.identity }, { origin: "https://evil.example" });
  expect(foreign.status).toBe(403);
  const ok = await send("POST", path, { identity: preview.identity });
  expect(ok.status).toBe(200);
  expect((await send("GET", `/api/repos/${encodeURIComponent(active.id)}/dismissed-changes`)).body.changes.some((c: { name: string }) => c.name === "structured-logs")).toBe(true);
  expect((await send("GET", `/api/repos/${encodeURIComponent(plain.id)}/dismissed-changes`)).body.changes.some((c: { name: string }) => c.name === "structured-logs")).toBe(false);
});
