import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { ISSUE_LIMIT, Issues, parseIssue } from "../src/server/issues.ts";
import type { RepoTarget } from "../src/server/pullRequests.ts";
import { ghIssue, installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { gitIn, tempDir, useTempHome } from "./helpers.ts";

setDefaultTimeout(30_000);

let gh: GhHarness;
let cleanupHome: () => Promise<void>;
const dirs: string[] = [];

beforeAll(async () => {
  ({ cleanup: cleanupHome } = await useTempHome());
  gh = await installFakeGh({});
});

afterAll(async () => {
  gh.restore();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  await cleanupHome();
});

async function repoAt(name: string, origin?: string): Promise<string> {
  const dir = join(await tempDir("osd-issues-"), name);
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  await gitIn(dir, "init", "-q", "-b", "main");
  if (origin) await gitIn(dir, "remote", "add", "origin", origin);
  return dir;
}

const target = (id: string, path: string, isGit = true): RepoTarget => ({ id, path, isGit });
const store = () => new Issues({ timeoutMs: 10_000 });

// ---- the fake gh (1.2) ----

test("the fake gh answers issue list from the scenario and records the call", async () => {
  await gh.scenario({ issues: { "acme/alpha-infra": [ghIssue({ number: 3, labels: [{ name: "bug" }] })] } });
  await gh.forget();
  const proc = Bun.spawn(["gh", "issue", "list", "--repo", "acme/alpha-infra", "--state", "open", "--limit", "5", "--json", "number,labels"], {
    cwd: process.env.SPEC_CONTROL_HOME,
    stdout: "pipe",
    stdin: "ignore",
    env: process.env,
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(JSON.parse(out)).toEqual([{ number: 3, labels: [{ name: "bug" }] }]);
  expect((await gh.calls()).map((c) => c.argv.slice(0, 2))).toEqual([["issue", "list"]]);
});

// ---- parsing ----

test("parseIssue keeps the documented fields and skips entries without a usable number", () => {
  expect(parseIssue(ghIssue({ number: 4, author: { login: "dev" }, labels: [{ name: "bug" }, { name: "" }, null] }))).toEqual({
    number: 4,
    title: "issue 4",
    body: "Body of issue 4.",
    url: "https://github.com/acme/alpha-infra/issues/4",
    author: "dev",
    labels: ["bug"],
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-02T10:00:00Z",
  });
  expect(parseIssue({ number: 0 })).toBeUndefined();
  expect(parseIssue({ number: "4" })).toBeUndefined();
  expect(parseIssue(null)).toBeUndefined();
  expect(parseIssue({ number: 9, author: null, labels: "bug" })).toMatchObject({ number: 9, author: "", labels: [], title: "", body: "" });
});

// ---- the query ----

test("lists open issues newest first with the fixed, read-only argument list, outside the repository", async () => {
  const alpha = await repoAt("alpha-infra", "git@github.com:acme/alpha-infra.git");
  await gh.scenario({
    issues: {
      "acme/alpha-infra": [ghIssue({ number: 12, createdAt: "2026-09-01T00:00:00Z" }), ghIssue({ number: 15, createdAt: "2026-09-03T00:00:00Z" }), { title: "no number" }],
    },
  });
  await gh.forget();
  const answer = await store().list(target("a", alpha));
  expect(answer).toMatchObject({ repoId: "a", github: "acme/alpha-infra", status: "ok", truncated: false });
  expect(answer.fetchedAt).toBeString();
  expect(answer.issues.map((i) => i.number)).toEqual([15, 12]);
  const calls = await gh.calls();
  expect(calls.map((c) => c.argv)).toEqual([
    ["issue", "list", "--repo", "acme/alpha-infra", "--state", "open", "--limit", String(ISSUE_LIMIT + 1), "--json", "number,title,body,url,author,labels,createdAt,updatedAt"],
  ]);
  expect(await realpath(calls[0].cwd)).toBe(await realpath(process.env.SPEC_CONTROL_HOME ?? ""));
});

test("140 open issues: 100 are listed and the list says it is truncated", async () => {
  const alpha = await repoAt("alpha-infra", "https://github.com/acme/alpha-infra.git");
  await gh.scenario({ issues: { "acme/alpha-infra": Array.from({ length: 140 }, (_, i) => ghIssue({ number: i + 1 })) } });
  const answer = await store().list(target("a", alpha));
  expect(answer.issues).toHaveLength(100);
  expect(answer.truncated).toBe(true);
});

test("a repository off GitHub or without git is unavailable and starts no gh", async () => {
  const offline = await repoAt("offline", "git@gitlab.example.test:acme/offline.git");
  const bare = await repoAt("bare");
  await gh.forget();
  expect(await store().list(target("o", offline))).toMatchObject({ status: "unavailable", reason: "not on GitHub", issues: [] });
  expect(await store().list(target("b", bare))).toMatchObject({ status: "unavailable", reason: "not on GitHub" });
  expect(await store().list(target("p", bare, false))).toMatchObject({ status: "unavailable", reason: "not a git repository" });
  expect(await gh.calls()).toEqual([]);
});

test("gh not signed in names gh auth login; failures and timeouts are reported as failed", async () => {
  const alpha = await repoAt("alpha-infra", "https://github.com/acme/alpha-infra.git");
  await gh.scenario({ mode: "not-logged-in" });
  const signedOut = await store().list(target("a", alpha));
  expect(signedOut).toMatchObject({ status: "unavailable", setup: "gh-signed-out", issues: [] });
  expect(signedOut.reason).toContain("gh auth login");

  await gh.scenario({ mode: "fail", stderr: "gh: HTTP 502 from https://user:secret@api.github.com" });
  const failed = await store().list(target("a", alpha));
  expect(failed.status).toBe("failed");
  expect(failed.reason).not.toContain("secret");

  await gh.scenario({ mode: "hang" });
  const started = Date.now();
  expect(await new Issues({ timeoutMs: 300 }).list(target("a", alpha))).toMatchObject({ status: "failed", reason: "gh timed out" });
  expect(Date.now() - started).toBeLessThan(10_000);
});

test("gh missing is unavailable with GitHub CLI not installed", async () => {
  const alpha = await repoAt("alpha-infra", "https://github.com/acme/alpha-infra.git");
  const missing = await installFakeGh({}, { onPath: false });
  const path = process.env.PATH;
  process.env.PATH = (path ?? "")
    .split(":")
    .filter((dir) => !dir.includes("osd-gh-"))
    .join(":");
  try {
    if (Bun.which("gh")) return; // a real gh on this machine: the case cannot be produced here
    const answer = await store().list(target("a", alpha));
    expect(answer).toMatchObject({ status: "unavailable", setup: "gh-missing" });
    expect(answer.reason).toContain("GitHub CLI not installed");
  } finally {
    process.env.PATH = path;
    missing.restore();
  }
});

test("concurrent requests for one repository share one gh process", async () => {
  const alpha = await repoAt("alpha-infra", "https://github.com/acme/alpha-infra.git");
  await gh.scenario({ issues: { "acme/alpha-infra": [ghIssue({ number: 1 })] } });
  await gh.forget();
  const issues = store();
  const [a, b] = await Promise.all([issues.list(target("a", alpha)), issues.list(target("a", alpha))]);
  expect(a).toBe(b);
  expect(await gh.calls()).toHaveLength(1);
  // Once settled, the next request queries again: nothing is cached.
  await issues.list(target("a", alpha));
  expect(await gh.calls()).toHaveLength(2);
});

test("output that is not a JSON list is a failure", async () => {
  const alpha = await repoAt("alpha-infra", "https://github.com/acme/alpha-infra.git");
  await gh.scenario({ issues: { "acme/alpha-infra": { not: "a list" } } });
  expect(await store().list(target("a", alpha))).toMatchObject({ status: "failed" });
});
