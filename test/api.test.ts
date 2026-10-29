import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AppState, createFetchHandler, crossSiteRefusal, startingFetchHandler } from "../src/server/api.ts";
import { readSnapshot } from "../src/server/cache.ts";
import { defaultConfig, newRepoConfig, saveConfig } from "../src/server/config.ts";
import { cachePath, configPath } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { overviewRows, wipIndicator } from "../src/ui/overviewState.ts";
import type { Config } from "../src/shared/types.ts";
import { FIXTURES, tempDir, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;

/** A mutating request the way the UI sends it: JSON content type, string body as given. */
const send = (path: string, method: string, body?: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, body, headers: { "content-type": "application/json", ...headers } });

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  state = { config: defaultConfig(), scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

test("fresh install: empty state, default config, UI fallback", async () => {
  const stateRes = await (await fetch(`${base}/api/state`)).json();
  expect(stateRes.repos).toEqual([]);
  const config = await (await fetch(`${base}/api/config`)).json();
  expect(config.port).toBe(4711);
  const html = await fetch(`${base}/settings`);
  expect(html.headers.get("content-type")).toContain("text/html");
  expect(await html.text()).toContain("stub");
  expect((await fetch(`${base}/api/nope`)).status).toBe(404);
});

test("invalid config is rejected and unchanged", async () => {
  const res = await send("/api/config", "PUT", JSON.stringify({ ...defaultConfig(), pollIntervalSeconds: 1 }));
  expect(res.status).toBe(400);
  expect((await res.json()).issues[0]).toContain("pollIntervalSeconds");
  expect(state.config.pollIntervalSeconds).toBe(60);
});

test("shortcuts are saved and served back; a multi-line prompt is refused and changes nothing", async () => {
  const shortcuts = [{ id: "ship", title: "Ship it", prompt: "Commit the work, push the branch and open a pull request." }];
  const withShortcuts = (list: unknown) => ({ ...defaultConfig(), agentSessions: { ...defaultConfig().agentSessions, shortcuts: list } });
  expect((await send("/api/config", "PUT", JSON.stringify(withShortcuts(shortcuts)))).status).toBe(200);
  expect((await (await fetch(`${base}/api/config`)).json()).agentSessions.shortcuts).toEqual(shortcuts);

  const bad = withShortcuts([{ ...shortcuts[0], prompt: "First line\nSecond line" }]);
  const res = await send("/api/config", "PUT", JSON.stringify(bad));
  expect(res.status).toBe(400);
  expect((await res.json()).issues.join(" ")).toContain("shortcuts");
  expect(state.config.agentSessions.shortcuts).toEqual(shortcuts);
});

test("enabling a repo persists and triggers a scan that populates state", async () => {
  const repo = newRepoConfig(join(FIXTURES, "demo-ops"), true);
  const res = await send("/api/config", "PUT", JSON.stringify({ ...defaultConfig(), repos: [repo] }));
  expect(res.status).toBe(200);
  expect(state.scanner.scanning).toBe(true);
  expect((await (await send("/api/scan", "POST")).json()).started).toBe(false);
  await state.scanner.trigger().done;
  const snap = await (await fetch(`${base}/api/state`)).json();
  expect(snap.repos[0].name).toBe("demo-ops");
  expect(snap.repos[0].changes.length).toBeGreaterThan(8);
  expect((await (await send("/api/scan", "POST")).json()).started).toBe(true);
  while (state.scanner.scanning) await Bun.sleep(10);
}, 30_000); // the scan request during the first scan queues a follow-up: three full scans of the fixture

test("changing only labels saves without a scan; an invalid label is refused and changes nothing", async () => {
  const [repo] = state.config.repos;
  const labelled = { ...state.config, repos: [{ ...repo, labels: ["client", "infra"], hiddenLabels: ["docker"] }] };
  const res = await send("/api/config", "PUT", JSON.stringify(labelled));
  expect(res.status).toBe(200);
  expect(state.scanner.scanning).toBe(false);
  const stored = JSON.parse(await readFile(configPath(), "utf8"));
  expect(stored.repos[0].labels).toEqual(["client", "infra"]);
  expect(stored.repos[0].hiddenLabels).toEqual(["docker"]);

  const refused = await send("/api/config", "PUT", JSON.stringify({ ...labelled, repos: [{ ...labelled.repos[0], labels: ["Infra", "infra"] }] }));
  expect(refused.status).toBe(400);
  expect((await refused.json()).issues.join(" ")).toContain('demo-ops: label "infra" is listed twice');
  expect(state.config.repos[0].labels).toEqual(["client", "infra"]);
  expect(JSON.parse(await readFile(configPath(), "utf8")).repos[0].labels).toEqual(["client", "infra"]);
});

const discover = (body?: unknown) =>
  send("/api/discover", "POST", body === undefined ? undefined : JSON.stringify(body));

test("discover uses saved roots, returns only unconfigured repos and persists nothing", async () => {
  state.config = { ...state.config, scanRoots: [FIXTURES] };
  const before = structuredClone(state.config);
  const result = await (await discover()).json();
  expect(result.errors).toEqual([]);
  // demo-ops was configured by the previous test, so only the other fixture is a candidate
  expect(result.candidates).toEqual([{ ...newRepoConfig(join(FIXTURES, "beta-soc"), false), framework: "openspec" }]);
  expect(state.config).toEqual(before);
  const config = await (await fetch(`${base}/api/config`)).json();
  expect(config.repos.length).toBe(1);
});

test("discover takes roots from the body without saving them", async () => {
  state.config = { ...state.config, scanRoots: [] };
  expect((await (await discover()).json()).candidates).toEqual([]);
  const result = await (await discover({ scanRoots: [FIXTURES] })).json();
  expect(result.candidates.map((r: { name: string }) => r.name)).toEqual(["beta-soc"]);
  expect((await (await fetch(`${base}/api/config`)).json()).scanRoots).toEqual([]);
});

test("discover rejects relative roots and malformed bodies", async () => {
  const res = await discover({ scanRoots: ["relative/path"] });
  expect(res.status).toBe(400);
  expect((await res.json()).issues[0]).toContain("scanRoots.0");
  expect((await send("/api/discover", "POST", "{nope")).status).toBe(400);
});

test("discover honours ignore paths from the body without saving them", async () => {
  const res = await discover({ scanRoots: [FIXTURES], ignorePaths: [`${join(FIXTURES, "beta-soc")}/`] });
  expect(res.status).toBe(200);
  expect((await res.json()).candidates).toEqual([]);
  expect((await (await fetch(`${base}/api/config`)).json()).ignorePaths).toEqual([]);
  // saved ignore paths apply when the body has none
  state.config = { ...state.config, ignorePaths: [FIXTURES] };
  expect((await (await discover({ scanRoots: [FIXTURES] })).json()).candidates).toEqual([]);
  expect((await (await discover({ scanRoots: [FIXTURES], ignorePaths: [] })).json()).candidates.length).toBe(1);
  state.config = { ...state.config, ignorePaths: [] };
});

test("discover rejects a relative ignore path", async () => {
  const res = await discover({ scanRoots: [FIXTURES], ignorePaths: ["relative/dir"] });
  expect(res.status).toBe(400);
  expect((await res.json()).issues[0]).toContain("ignorePaths.0");
});

test("two roots resolving to one directory produce each candidate once", async () => {
  const result = await (await discover({ scanRoots: [FIXTURES, `${FIXTURES}/`, join(FIXTURES, ".", "beta-soc", "..")] })).json();
  expect(result.errors).toEqual([]);
  expect(result.candidates.map((r: { name: string }) => r.name)).toEqual(["beta-soc"]);
});

test("config paths are stored canonically and ignorePaths is optional", async () => {
  const { ignorePaths: _dropped, ...body } = { ...state.config, scanRoots: [`${FIXTURES}/`] };
  const res = await send("/api/config", "PUT", JSON.stringify(body));
  expect(res.status).toBe(200);
  const saved = await res.json();
  expect(saved.scanRoots).toEqual([FIXTURES]);
  expect(saved.ignorePaths).toEqual([]);
  const rejected = await send("/api/config", "PUT", JSON.stringify({ ...state.config, ignorePaths: ["relative/dir"] }));
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).issues[0]).toContain("ignorePaths.0");
  expect(state.config.ignorePaths).toEqual([]);
  await send("/api/config", "PUT", JSON.stringify({ ...state.config, scanRoots: [] }));
});

test("discover reports a missing root and still scans the others", async () => {
  const missing = join(FIXTURES, "does-not-exist");
  const res = await discover({ scanRoots: [missing, FIXTURES] });
  expect(res.status).toBe(200);
  const result = await res.json();
  expect(result.errors).toEqual([{ root: missing, message: "does not exist" }]);
  expect(result.candidates.map((r: { name: string }) => r.name)).toEqual(["beta-soc"]);
});

test("mutating requests must come from the dashboard itself", async () => {
  const port = new URL(base).port;
  const before = JSON.stringify(state.config);
  const body = JSON.stringify({ ...defaultConfig(), pollIntervalSeconds: 999 });

  // another web page, a sandboxed frame, a rebinding-style origin on the right port, and the wrong port
  for (const origin of ["https://example.com", "null", `http://evil.example:${port}`, "http://127.0.0.1:1"]) {
    const res = await send("/api/config", "PUT", body, { origin });
    expect([origin, res.status]).toEqual([origin, 403]);
  }
  expect((await send("/api/config", "PUT", body, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  // what a plain HTML form or a no-preflight fetch can send
  for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"]) {
    expect((await fetch(`${base}/api/config`, { method: "PUT", body, headers: { "content-type": type } })).status).toBe(403);
  }
  expect((await fetch(`${base}/api/scan`, { method: "POST" })).status).toBe(403);
  expect(JSON.stringify(state.config)).toBe(before); // refused requests had no effect

  // the UI (either loopback name), and a command-line client that sends no Origin at all
  expect((await send("/api/scan", "POST", undefined, { origin: base })).status).toBe(200);
  expect((await send("/api/scan", "POST", undefined, { origin: `http://localhost:${port}`, "sec-fetch-site": "same-origin" })).status).toBe(200);
  expect((await send("/api/scan", "POST")).status).toBe(200);
  expect((await fetch(`${base}/api/state`, { headers: { origin: "https://example.com" } })).status).toBe(200); // reads stay open
  await state.scanner.trigger().done;
});

test("a request addressed to a non-loopback host name is refused (DNS rebinding)", () => {
  const req = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } });
  expect(crossSiteRefusal(req("http://evil.example:4711/api/scan", { origin: "http://evil.example:4711" }))).toContain("loopback");
  expect(crossSiteRefusal(req("http://127.0.0.1:4711/api/scan", { origin: "http://127.0.0.1:4711" }))).toBeUndefined();
  expect(crossSiteRefusal(req("http://localhost:4711/api/scan", {}))).toBeUndefined();
});

test("every request addressed to a foreign host name is refused before any route runs (DNS rebinding)", async () => {
  // Bun builds `req.url` from the Host header, so a Request on that URL is what a rebound page's request looks like.
  // Any use of the state (config, scanner, sessions, the environment check's processes) is recorded.
  const touched: PropertyKey[] = [];
  const watched = new Proxy({} as AppState, {
    get(_target, key) {
      touched.push(key);
      return undefined;
    },
  });
  const handler = createFetchHandler({ state: watched, indexHtml: "<title>stub</title>" });
  const foreign = [
    ["GET", "/api/config"],
    ["GET", "/api/state"],
    ["GET", "/api/repos/abc123/changes/rotate-keys/file?path=proposal.md"],
    ["GET", "/api/environment?force=1"],
    ["HEAD", "/api/state"],
    ["GET", "/api/version"],
    ["GET", "/"],
    ["GET", "/settings"],
    ["POST", "/api/scan"],
  ];
  for (const host of ["attacker.example:4711", "127.0.0.1.attacker.example:4711", "localhost.:4711"]) {
    for (const [method, path] of foreign) {
      const res = await handler(new Request(`http://${host}${path}`, { method, headers: { "content-type": "application/json" } }));
      expect([host, method, path, res.status]).toEqual([host, method, path, 403]);
      const body = await res.text();
      expect(body).not.toContain("stub");
      expect(body).not.toContain("spec-control");
      if (path.startsWith("/api/") && method !== "HEAD") expect(JSON.parse(body).error).toContain("loopback");
    }
  }
  expect(touched).toEqual([]);
});

test("loopback host names are answered as before, in any case", async () => {
  const handler = createFetchHandler({ state, indexHtml: "<title>stub</title>" });
  for (const host of ["127.0.0.1:4711", "localhost:4711", "[::1]:4711", "LOCALHOST:4711"]) {
    const res = await handler(new Request(`http://${host}/api/state`));
    expect([host, res.status]).toEqual([host, 200]);
    expect((await res.json()).repos).toBeArray();
    expect(await (await handler(new Request(`http://${host}/`))).text()).toContain("stub");
  }
});

test("while starting, a foreign host name gets 403, not the version", async () => {
  const foreign = startingFetchHandler(new Request("http://attacker.example:4711/api/version"));
  expect(foreign.status).toBe(403);
  expect(await foreign.text()).not.toContain("spec-control");
  expect(startingFetchHandler(new Request("http://attacker.example:4711/")).status).toBe(403);
  const own = startingFetchHandler(new Request("http://127.0.0.1:4711/api/version"));
  expect(own.status).toBe(200);
  expect((await own.json()).name).toBe("spec-control");
  expect(startingFetchHandler(new Request("http://127.0.0.1:4711/api/state")).status).toBe(503);
});

test("a snapshot cached before working-tree status existed is served on startup", async () => {
  // What an older version wrote: worktrees as path/branch pairs, the main checkout among them, and no summary.
  const old = {
    generatedAt: "2026-09-01T00:00:00Z",
    repos: [
      {
        id: "abc123",
        name: "alpha-infra",
        path: "/w/acme/alpha-infra",
        ok: true,
        scannedAt: "2026-09-01T00:00:00Z",
        isGit: true,
        currentBranch: "main",
        worktrees: [
          { path: "/w/acme/alpha-infra", branch: "main" },
          { path: "/w/acme/wt/report", branch: "feat/report" },
        ],
        changes: [],
      },
    ],
  };
  await mkdir(dirname(cachePath()), { recursive: true });
  await writeFile(cachePath(), JSON.stringify(old));
  const cached = await readSnapshot();
  const app: AppState = { config: defaultConfig(), scanner: new Scanner(() => defaultConfig(), { persist: false }, cached ?? undefined) };
  const res = await createFetchHandler({ state: app, indexHtml: "" })(new Request("http://127.0.0.1:4711/api/state"));
  expect(res.status).toBe(200);
  const served = await res.json();
  expect(served).toEqual(old);
  expect(served.repos[0].workInProgress).toBeUndefined();
  // …and the overview derives rows from it, without an indicator until the first scan.
  const [row] = overviewRows(served);
  expect(row.workInProgress).toBeUndefined();
  expect(wipIndicator(row.workInProgress)).toBeUndefined();
});

test("a config save naming the current revision is applied; one naming an older revision is refused and writes nothing", async () => {
  const read = await fetch(`${base}/api/config`);
  const r1 = read.headers.get("etag");
  expect(r1).toMatch(/^"[0-9a-f]{16}"$/);
  const draft = await read.json();

  // Up to date: saved, and the response names the new revision.
  const saved = await send("/api/config", "PUT", JSON.stringify({ ...draft, pollIntervalSeconds: 120 }), { "if-match": r1 as string });
  expect(saved.status).toBe(200);
  const r2 = saved.headers.get("etag");
  expect(r2).not.toBe(r1);
  expect((await fetch(`${base}/api/config`)).headers.get("etag")).toBe(r2);

  // A label colour chosen elsewhere answers with the next revision.
  const coloured = await send("/api/labels/color", "POST", JSON.stringify({ label: "client", hue: 290 }));
  const r3 = coloured.headers.get("etag");
  expect(r3).not.toBe(r2);

  // A tab still holding r2 cannot save its copy over it.
  const stale = await send("/api/config", "PUT", JSON.stringify({ ...draft, pollIntervalSeconds: 90 }), { "if-match": r2 as string });
  expect(stale.status).toBe(412);
  expect(stale.headers.get("etag")).toBe(r3);
  const body = await stale.json();
  expect(body.error).toBeString();
  expect(body.config.labelColors).toEqual({ client: 290 });
  expect(state.config.labelColors).toEqual({ client: 290 });
  expect(state.config.pollIntervalSeconds).toBe(120);
  expect(JSON.parse(await readFile(configPath(), "utf8")).labelColors).toEqual({ client: 290 });

  // Without If-Match (a command-line client) the body is applied as before.
  const plain = await send("/api/config", "PUT", JSON.stringify({ ...draft, pollIntervalSeconds: 60 }));
  expect(plain.status).toBe(200);
  expect(state.config.pollIntervalSeconds).toBe(60);
  expect(state.config.labelColors).toBeUndefined();
});

/** A second server whose scans wait on a gate, so a request can arrive while one is in flight. */
async function gatedServer() {
  let open: () => void = () => {};
  let gate = new Promise<void>((resolve) => (open = resolve));
  let scans = 0;
  const gated: AppState = { config: defaultConfig(), scanner: undefined as unknown as Scanner };
  gated.scanner = new Scanner(() => gated.config, {
    persist: false,
    sharedConfig: async () => {
      scans++;
      await gate;
      return undefined;
    },
  });
  const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state: gated, indexHtml: "<title>stub</title>" }) });
  const url = `http://127.0.0.1:${srv.port}`;
  return {
    state: gated,
    scans: () => scans,
    release: () => {
      open();
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    request: (path: string, method = "GET", body?: string) =>
      fetch(`${url}${path}`, { method, body, headers: method === "GET" ? {} : { "content-type": "application/json" } }),
    stop: () => srv.stop(true),
  };
}

test("a repository enabled through PUT /api/config during a slow scan shows up without another trigger", async () => {
  const g = await gatedServer();
  try {
    const nano = newRepoConfig(join(FIXTURES, "demo-ops"), true);
    const soc = newRepoConfig(join(FIXTURES, "beta-soc"), true);
    expect((await g.request("/api/config", "PUT", JSON.stringify({ ...defaultConfig(), repos: [nano] }))).status).toBe(200);
    expect(g.state.scanner.scanning).toBe(true);
    expect((await g.request("/api/config", "PUT", JSON.stringify({ ...defaultConfig(), repos: [nano, soc] }))).status).toBe(200);
    // Let the running scan and then the follow-up through; nothing else triggers one.
    while (g.state.scanner.scanning) {
      g.release();
      await Bun.sleep(20);
    }
    const snap = await (await g.request("/api/state")).json();
    expect(snap.repos.map((r: { name: string }) => r.name)).toEqual(["demo-ops", "beta-soc"]);
    expect(g.scans()).toBe(2);
  } finally {
    g.stop();
  }
}, 30_000);

test("POST /api/scan: started when idle; during a scan not started, but one follow-up is queued", async () => {
  const g = await gatedServer();
  try {
    expect(await (await g.request("/api/scan", "POST")).json()).toEqual({ started: true });
    expect(await (await g.request("/api/scan", "POST")).json()).toEqual({ started: false });
    expect(await (await g.request("/api/scan", "POST")).json()).toEqual({ started: false });
    expect(g.scans()).toBe(1);
    g.release();
    while (g.scans() < 2) await Bun.sleep(5);
    expect(g.state.scanner.scanning).toBe(true);
    g.release();
    while (g.state.scanner.scanning) await Bun.sleep(5);
    expect(g.scans()).toBe(2);
  } finally {
    g.stop();
  }
}, 30_000);

test("a tracked folder replaced by a link to it keeps its id through every config write; an id cannot be re-pointed", async () => {
  const work = await tempDir("osd-respelled-");
  try {
    const old = join(work, "acme", "alpha-infra");
    const now = join(work, "acme", "repos", "alpha-infra");
    await mkdir(old, { recursive: true });
    await mkdir(join(work, "acme", "demo-ops"));
    const alpha = newRepoConfig(old, false);
    const demo = newRepoConfig(join(work, "acme", "demo-ops"), false);
    const tracked: Config = await saveConfig({ ...defaultConfig(), repos: [alpha, demo] });
    // Moved while the dashboard runs, with a link left behind: the stored path no longer canonicalises to itself.
    await mkdir(dirname(now));
    await rename(old, now);
    await symlink(now, old);

    const writes: [string, string, unknown][] = [
      ["/api/config", "PUT", tracked],
      [`/api/repos/${alpha.id}/enabled`, "POST", { enabled: true }],
      [`/api/repos/${alpha.id}/labels`, "POST", { labels: ["infra"] }],
      ["/api/ignore-paths", "POST", { path: join(work, "mirror") }],
    ];
    for (const [path, method, body] of writes) {
      state.config = tracked; // as the running server held it
      const res = await send(path, method, JSON.stringify(body));
      expect([path, res.status]).toEqual([path, 200]);
      const saved: Config = JSON.parse(await readFile(configPath(), "utf8"));
      expect(saved.repos.map((r) => [r.id, r.path])).toEqual([
        [alpha.id, now],
        [demo.id, demo.path],
      ]);
    }

    // Case-only rename, where the temporary directory's file system ignores case.
    const upper = join(work, "Acme-Tools");
    await mkdir(upper);
    if (await stat(join(work, "acme-tools")).catch(() => undefined)) {
      const tools = newRepoConfig(upper, false);
      const withTools: Config = await saveConfig({ ...defaultConfig(), repos: [tools] });
      await rename(upper, join(work, "tmp-tools"));
      await rename(join(work, "tmp-tools"), join(work, "acme-tools"));
      state.config = withTools;
      const res = await send("/api/config", "PUT", JSON.stringify({ ...withTools, repos: [{ ...tools, name: "Tools" }] }));
      expect(res.status).toBe(200);
      expect((await res.json()).repos).toEqual([{ ...tools, name: "Tools", path: join(work, "acme-tools") }]);
    }

    state.config = await saveConfig({ ...defaultConfig(), repos: [alpha, demo] });
    const before = await readFile(configPath(), "utf8");
    const repointed = await send("/api/config", "PUT", JSON.stringify({ ...state.config, repos: [{ ...demo, path: now }] }));
    expect(repointed.status).toBe(400);
    expect((await repointed.json()).issues).toEqual(["repos.0.id: this id belongs to another directory"]);
    expect(await readFile(configPath(), "utf8")).toBe(before);
  } finally {
    state.config = await saveConfig(defaultConfig());
    await rm(work, { recursive: true, force: true });
  }
});
