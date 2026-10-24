// The stale-cleanup routes (dashboard-api: "Stale cleanup endpoints"): preview, `?ending=`, the shape and
// acknowledgement checks, a non-leftover item and the same-origin guard. Real temp git repositories and the fake agent.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { StaleCleanupPreview, StaleCleanupResult } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

const CHANGE = "structured-logs";
let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let h: Harness;
let sessionId: string;
let wt: string;

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const route = (name = CHANGE) => `/api/repos/${h.repoId}/changes/${name}/stale-cleanup`;

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  h = await harness();
  // A running session in its worktree on `feat/structured-logs`; then the default branch archives the change.
  const started = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  sessionId = started.id;
  wt = started.worktreePath;
  await rename(join(h.repoPath, "openspec/changes", CHANGE), join(h.repoPath, "openspec/changes/archive", `2026-07-01-${CHANGE}`));
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", "archive");
  await writeFile(join(wt, "keys.ts"), "export {};\n");
  state = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await h.manager.shutdown();
  await cleanup();
});

test("unknown repositories are 404, invalid names 400, a malformed body 400", async () => {
  expect((await send("GET", `/api/repos/nope/changes/${CHANGE}/stale-cleanup`)).status).toBe(404);
  expect((await send("GET", route("..%2F.."))).status).toBe(400);
  expect((await send("POST", route(), "{not json")).status).toBe(400);
  expect((await send("POST", route(), { worktrees: [], branches: [{ name: "--all", commit: "a".repeat(40) }], mainCheckout: null, acknowledged: false })).status).toBe(400);
  expect((await send("POST", route(), { worktrees: [], branches: [], mainCheckout: null })).status).toBe(400);
});

test("a running session keeps its worktree; ?ending= judges it as if the session had ended", async () => {
  const running = (await send("GET", route())).body as StaleCleanupPreview;
  expect(running.stale?.leftovers.filter((l) => l.kind === "worktree")).toEqual([]);
  expect(running.stale?.kept).toMatchObject([{ kind: "worktree", reason: "an agent session is running in it" }]);
  const ending = (await send("GET", `${route()}?ending=${sessionId}`)).body as StaleCleanupPreview;
  expect(ending.stale?.leftovers).toMatchObject([{ kind: "worktree", uncommitted: ["keys.ts"], outside: ["keys.ts"] }]);
  expect(ending.backupRoot).toContain("branch-backups");
  // Only a running worktree session of this change.
  expect((await send("GET", `${route()}?ending=nope`)).status).toBe(400);
  expect((await send("GET", `${route("cache-api-calls")}?ending=${sessionId}`)).status).toBe(400);
});

test("a foreign origin is refused, a missing acknowledgement is 409, a non-leftover item is kept", async () => {
  await h.manager.close(sessionId);
  const preview = (await send("GET", route())).body as StaleCleanupPreview;
  const worktree = preview.stale?.leftovers.find((l) => l.kind === "worktree");
  if (worktree?.kind !== "worktree") throw new Error("expected the worktree as a leftover");
  const body = { worktrees: [{ path: worktree.path, branch: worktree.branch ?? null, commit: worktree.commit, uncommitted: worktree.uncommitted }], branches: [], mainCheckout: null, acknowledged: false };
  expect((await send("POST", route(), { ...body, acknowledged: true }, { origin: "https://example.com" })).status).toBe(403);
  expect((await send("POST", route(), body)).status).toBe(409);
  expect(existsSync(wt)).toBe(true);

  const other = (await send("POST", route(), { worktrees: [], branches: [{ name: "feat/report", commit: "a".repeat(40) }], mainCheckout: null, acknowledged: false })).body as StaleCleanupResult;
  expect(other.items).toMatchObject([{ kind: "branch", id: "feat/report", outcome: "kept" }]);

  const done = await send("POST", route(), { ...body, acknowledged: true });
  expect(done.status).toBe(200);
  expect((done.body as StaleCleanupResult).items).toMatchObject([{ kind: "worktree", outcome: "deleted", branch: `feat/${CHANGE}` }]);
  expect(existsSync(wt)).toBe(false);
});
