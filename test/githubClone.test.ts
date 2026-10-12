import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { cloneFailureReason, GithubClones, parseProgressLine, ProgressParser } from "../src/server/githubClone.ts";
import { confirmIntegration } from "../src/server/integration.ts";
import { NewFolderError } from "../src/server/newFolder.ts";
import type { Config, GithubClone } from "../src/shared/types.ts";
import { gitIn, tempDir, useTempHome } from "./helpers.ts";
import { redirectGithub, type GithubRedirect } from "./githubHelpers.ts";

setDefaultTimeout(30_000);

let cleanupHome: () => Promise<void>;
let github: GithubRedirect;

beforeAll(async () => {
  cleanupHome = (await useTempHome()).cleanup;
  github = await redirectGithub();
  await github.repo("acme/beta-soc", { openspec: true });
  await github.repo("acme/chat-groups", { openspec: false });
});
afterEach(() => {
  delete process.env.GIT_TEMPLATE_DIR;
  delete process.env.GIT_PROGRESS_DELAY;
});
afterAll(async () => {
  github.restore();
  await cleanupHome();
});

interface Harness {
  config: Config;
  root: string;
  clones: GithubClones;
  scans: number;
}

async function harness(options: { maxRunning?: number; timeoutMs?: number; repos?: Config["repos"]; onChange?: (clone: GithubClone) => void; track?: (path: string) => Promise<boolean> } = {}): Promise<Harness> {
  const root = await tempDir("osd-clone-root-");
  const h = { config: { ...defaultConfig(), scanRoots: [root], repos: options.repos ?? [] }, root, scans: 0 } as Harness;
  const app = {
    get config() {
      return h.config;
    },
    set config(value: Config) {
      h.config = value;
    },
    scanner: {
      trigger: () => {
        h.scans++;
        return { started: true };
      },
    },
  };
  h.clones = new GithubClones({ config: () => h.config, track: options.track ?? ((path) => confirmIntegration(app, path)) }, { maxRunning: options.maxRunning, timeoutMs: options.timeoutMs, onChange: options.onChange });
  return h;
}

const git = async (cwd: string, ...args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
};

test("a clone is a full checkout of the default branch with origin pointing at github.com", async () => {
  const h = await harness();
  const clone = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  expect(clone.state).toBe("cloning");
  expect(clone.path).toBe(join(h.root, "beta-soc"));
  expect(h.clones.runningPaths()).toEqual([clone.path]);
  await h.clones.settled(clone.id);
  const [done] = h.clones.list();
  expect(done.state).toBe("tracked");
  expect(done.finishedAt).toBeDefined();
  expect(h.clones.runningPaths()).toEqual([]);
  expect(await git(clone.path, "config", "--get", "remote.origin.url")).toBe("https://github.com/acme/beta-soc.git");
  expect(await git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(await git(clone.path, "status", "--porcelain")).toBe("");
  expect(existsSync(join(clone.path, "openspec", "config.yaml"))).toBe(true);
  expect(await readdir(h.root)).toEqual(["beta-soc"]);
});

test("a clone holding openspec/config.yaml is tracked enabled with its default name, and a scan starts", async () => {
  const h = await harness();
  const clone = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  await h.clones.settled(clone.id);
  expect(h.config.repos.map((r) => [r.path, r.name, r.enabled])).toEqual([[clone.path, "beta-soc", true]]);
  expect(h.scans).toBe(1);
});

test("a clone without the marker leaves the configuration alone", async () => {
  const h = await harness();
  const before = JSON.stringify(h.config);
  const clone = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "chat-groups" });
  await h.clones.settled(clone.id);
  expect(h.clones.list()[0].state).toBe("integratable");
  expect(JSON.stringify(h.config)).toBe(before);
  expect(h.scans).toBe(0);
});

test("a name already tracked gets the parent folder in parentheses", async () => {
  const other = await tempDir("osd-other-");
  const h = await harness({ repos: [{ ...newRepoConfig(join(other, "beta-soc"), true), name: "beta-soc" }] });
  const clone = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  await h.clones.settled(clone.id);
  const added = h.config.repos.find((r) => r.path === clone.path);
  expect(added?.name).toBe(`beta-soc (${h.root.split("/").at(-1)})`);
});

test("a failed clone removes the empty folder and reports a masked reason with the credentials hint", async () => {
  const h = await harness();
  const clone = await h.clones.start({ repo: "acme/missing-repo", root: h.root, name: "missing-repo" });
  await h.clones.settled(clone.id);
  const [failed] = h.clones.list();
  expect(failed.state).toBe("failed");
  expect(failed.reason).toBeTruthy();
  expect(existsSync(clone.path)).toBe(false);
  expect(await readdir(h.root)).toEqual([]);
  expect(h.config.repos).toEqual([]);
});

test("the credentials hint names gh auth setup-git and no secret reaches the reason", () => {
  const notFound = cloneFailureReason("Cloning into '/w/acme/beta-soc'...\nremote: Repository not found.\nfatal: repository 'https://github.com/acme/beta-soc.git/' not found\n");
  expect(notFound).toContain("gh auth setup-git");
  const prompt = cloneFailureReason("fatal: could not read Username for 'https://github.com': terminal prompts disabled\n");
  expect(prompt).toContain("gh auth setup-git");
  const masked = cloneFailureReason("fatal: unable to access 'https://jdoe:ghp_secret123@github.com/acme/beta-soc.git/': Could not resolve host: github.com\n");
  expect(masked).not.toContain("ghp_secret123");
  expect(masked).not.toContain("gh auth setup-git");
});

test("a clone that runs too long is stopped and its folder removed", async () => {
  const h = await harness({ timeoutMs: 500 });
  const clone = await h.clones.start({ repo: github.slowRepo, root: h.root, name: "slow" });
  await h.clones.settled(clone.id);
  const [failed] = h.clones.list();
  expect(failed.state).toBe("failed");
  expect(failed.reason).toContain("did not finish");
  expect(existsSync(clone.path)).toBe(false);
});

test("a hook from the git template directory does not run", async () => {
  const template = await tempDir("osd-template-");
  const marker = join(template, "hook-ran");
  await mkdir(join(template, "hooks"));
  await writeFile(join(template, "hooks", "post-checkout"), `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`);
  await chmod(join(template, "hooks", "post-checkout"), 0o755);
  process.env.GIT_TEMPLATE_DIR = template;
  const h = await harness();
  const clone = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "chat-groups" });
  await h.clones.settled(clone.id);
  expect(h.clones.list()[0].state).toBe("integratable");
  // The template was used — the hook was copied — yet never ran.
  expect(existsSync(join(clone.path, ".git", "hooks", "post-checkout"))).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("two requests for one target make one clone and one folder", async () => {
  const h = await harness();
  const results = await Promise.allSettled([
    h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" }),
    h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  expect(ok).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(refused[0].reason).toBeInstanceOf(NewFolderError);
  expect((refused[0].reason as NewFolderError).status).toBe(409);
  await h.clones.settled(h.clones.list()[0].id);
  expect(h.clones.list()).toHaveLength(1);
  expect(await readdir(h.root)).toEqual(["beta-soc"]);
});

test("a third clone waits while two run", async () => {
  const h = await harness({ maxRunning: 2, timeoutMs: 1500 });
  const first = await h.clones.start({ repo: github.slowRepo, root: h.root, name: "slow-1" });
  const second = await h.clones.start({ repo: github.slowRepo, root: h.root, name: "slow-2" });
  const third = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "chat-groups" });
  // The third is queued and its folder exists, but git has not started: the folder stays empty, and discovery leaves it out.
  expect(third.state).toBe("queued");
  await Bun.sleep(700);
  const waiting = h.clones.list().find((c) => c.id === third.id);
  expect(waiting?.state).toBe("queued");
  expect(waiting?.progress).toBeUndefined();
  expect(await readdir(third.path)).toEqual([]);
  expect(h.clones.runningPaths()).toContain(third.path);
  await h.clones.settled(first.id);
  await h.clones.settled(second.id);
  await h.clones.settled(third.id);
  expect(h.clones.list().map((c) => c.state)).toEqual(["failed", "failed", "integratable"]);
});

test("refusals create nothing; retry replaces the failed entry; only finished entries can be dismissed", async () => {
  const h = await harness();
  const refusal = async (input: Record<string, unknown>) => {
    const err = await h.clones.start(input).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NewFolderError);
    return (err as NewFolderError).status;
  };
  expect(await refusal({ repo: "https://example.test/acme/beta-soc", root: h.root, name: "beta-soc" })).toBe(400);
  expect(await refusal({ repo: "acme/../../etc", root: h.root, name: "etc" })).toBe(400);
  expect(await refusal({ repo: "acme/beta-soc", root: h.root, name: "../x" })).toBe(400);
  expect(await refusal({ repo: "acme/beta-soc", root: "/w/other", name: "beta-soc" })).toBe(404);
  await mkdir(join(h.root, "taken"));
  expect(await refusal({ repo: "acme/beta-soc", root: h.root, name: "taken" })).toBe(409);
  expect(await readdir(h.root)).toEqual(["taken"]);
  expect(h.clones.list()).toEqual([]);

  const failed = await h.clones.start({ repo: "acme/later-repo", root: h.root, name: "later-repo" });
  await h.clones.settled(failed.id);
  await github.repo("acme/later-repo", { openspec: false });
  const retried = await h.clones.start({ repo: "acme/later-repo", root: h.root, name: "later-repo" });
  expect(h.clones.list().map((c) => c.id)).toEqual([retried.id]);
  expect(() => h.clones.dismiss(retried.id)).toThrow("still running");
  await h.clones.settled(retried.id);
  expect(h.clones.list()[0].state).toBe("integratable");
  h.clones.dismiss(retried.id);
  expect(h.clones.list()).toEqual([]);
  expect(() => h.clones.dismiss("clone-404")).toThrow("no such clone");
  // Dismissing forgets the entry, never the folder.
  expect(existsSync(join(h.root, "later-repo", ".git"))).toBe(true);
  expect(await readFile(join(h.root, "later-repo", "README.md"), "utf8")).toContain("later-repo");
});

test("clones write nothing but the target folder", async () => {
  const h = await harness();
  await mkdir(join(h.root, "neighbour"));
  await gitIn(join(h.root, "neighbour"), "init", "-q");
  const before = await readdir(join(h.root, "neighbour", ".git"));
  const clone = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "chat-groups" });
  await h.clones.settled(clone.id);
  expect((await readdir(h.root)).sort()).toEqual(["chat-groups", "neighbour"]);
  expect(await readdir(join(h.root, "neighbour", ".git"))).toEqual(before);
});

// ---- progress ----

test("progress lines: receiving with bytes, resolving, checkout, remote reports, and nothing else", () => {
  expect(parseProgressLine("Receiving objects:  45% (450/1000), 12.30 MiB | 4.10 MiB/s")).toEqual({ phase: "receiving", percent: 45, receivedBytes: Math.round(12.3 * 1024 * 1024) });
  expect(parseProgressLine("Receiving objects: 100% (202/202), 8.11 KiB | 8.11 MiB/s, done.")).toEqual({ phase: "receiving", percent: 100, receivedBytes: Math.round(8.11 * 1024) });
  expect(parseProgressLine("Receiving objects:   3% (3/100)")).toEqual({ phase: "receiving", percent: 3 });
  expect(parseProgressLine("Resolving deltas:  80% (80/100)")).toEqual({ phase: "resolving", percent: 80 });
  expect(parseProgressLine("Updating files:  30% (300/1000)")).toEqual({ phase: "checkout", percent: 30 });
  expect(parseProgressLine("Checking out files:  30% (300/1000)")).toEqual({ phase: "checkout", percent: 30 });
  expect(parseProgressLine("remote: Counting objects:  50% (1/2)        ")).toEqual({ phase: "connecting" });
  expect(parseProgressLine("Cloning into '/w/acme/beta-soc'...")).toBeUndefined();
  expect(parseProgressLine("fatal: repository 'https://github.com/acme/x.git/' not found")).toBeUndefined();
  expect(parseProgressLine("Receiving objects: lots")).toBeUndefined();
});

test("the parser follows \\r updates across split chunks and keeps only the other lines for a reason", () => {
  const parser = new ProgressParser();
  expect(parser.feed("Cloning into 'x'...\nremote: Enumerating objects: 5, done.\nReceiving obj")).toEqual({ phase: "connecting" });
  expect(parser.feed("ects:  10% (1/10)\rReceiving objects:  40% (4/10), 1.00 KiB | 1 KiB/s\rResolv")).toEqual({ phase: "receiving", percent: 40, receivedBytes: 1024 });
  expect(parser.feed("ing deltas:  50% (1/2)\r")).toEqual({ phase: "resolving", percent: 50 });
  expect(parser.feed("fatal: early EOF\n")).toBeUndefined();
  expect(parser.feed("Updating files: 100% (3/3)")).toBeUndefined();
  expect(parser.end()).toEqual({ phase: "checkout", percent: 100 });
  expect(parser.tail()).toBe("Cloning into 'x'...\nremote: Enumerating objects: 5, done.\nfatal: early EOF\n");
  const big = new ProgressParser();
  for (let i = 0; i < 2000; i++) big.feed(`remote: line ${i}\n`);
  expect(big.tail().length).toBeLessThanOrEqual(8 * 1024);
  expect(big.tail().endsWith("remote: line 1999\n")).toBe(true);
});

test("a clone reports connecting, receiving and checkout before it is tracked", async () => {
  process.env.GIT_PROGRESS_DELAY = "0";
  const seen: string[] = [];
  const h = await harness({ onChange: (c) => seen.push(c.progress ? `${c.state}:${c.progress.phase}` : c.state) });
  const clone = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  expect(clone.progress?.phase).toBe("connecting");
  await h.clones.settled(clone.id);
  const phases = [...new Set(seen)];
  expect(phases[0]).toBe("cloning:connecting");
  expect(phases).toContain("cloning:receiving");
  expect(phases.indexOf("cloning:receiving")).toBeLessThan(phases.indexOf("cloning:checkout"));
  expect(phases.at(-1)).toBe("tracked");
  // Once it has an outcome, the progress is gone.
  expect(h.clones.list()[0].progress).toBeUndefined();
});

test("a failed clone's reason is made of git's error lines, masked, without progress", async () => {
  const at = Number(process.env.GIT_CONFIG_COUNT);
  process.env.GIT_CONFIG_COUNT = String(at + 1);
  process.env[`GIT_CONFIG_KEY_${at}`] = "url.https://jdoe:ghp_secret123@127.0.0.1:9/.insteadOf";
  process.env[`GIT_CONFIG_VALUE_${at}`] = "https://github.com/acme/secret-repo";
  try {
    const h = await harness();
    const clone = await h.clones.start({ repo: "acme/secret-repo", root: h.root, name: "secret-repo" });
    await h.clones.settled(clone.id);
    const [failed] = h.clones.list();
    expect(failed.state).toBe("failed");
    expect(failed.reason).toBeTruthy();
    expect(failed.reason).not.toContain("ghp_secret123");
    expect(failed.reason).not.toContain("%");
    expect(existsSync(clone.path)).toBe(false);
  } finally {
    process.env.GIT_CONFIG_COUNT = String(at);
    delete process.env[`GIT_CONFIG_KEY_${at}`];
    delete process.env[`GIT_CONFIG_VALUE_${at}`];
  }
});

// ---- cancel ----

test("cancelling a running clone stops git and removes its folder; it can be retried and dismissed", async () => {
  const h = await harness();
  await mkdir(join(h.root, "neighbour"));
  await writeFile(join(h.root, "neighbour", "notes.md"), "keep\n");
  const clone = await h.clones.start({ repo: github.slowRepo, root: h.root, name: "slow" });
  expect(clone.state).toBe("cloning");
  await Bun.sleep(300);
  const cancelled = await h.clones.cancel(clone.id);
  expect(cancelled.state).toBe("cancelled");
  expect(cancelled.progress).toBeUndefined();
  expect(cancelled.finishedAt).toBeDefined();
  expect(existsSync(clone.path)).toBe(false);
  expect(await readdir(h.root)).toEqual(["neighbour"]);
  expect(await readFile(join(h.root, "neighbour", "notes.md"), "utf8")).toBe("keep\n");
  expect(h.clones.runningPaths()).toEqual([]);
  expect(h.config.repos).toEqual([]);
  // A second cancel, and a cancel of a finished clone, answer 409.
  await expect(h.clones.cancel(clone.id)).rejects.toMatchObject({ status: 409 });
  await expect(h.clones.cancel("clone-404")).rejects.toMatchObject({ status: 404 });
  // Retry replaces the cancelled entry.
  const retried = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "slow" });
  expect(h.clones.list().map((c) => c.id)).toEqual([retried.id]);
  await h.clones.settled(retried.id);
  h.clones.dismiss(retried.id);
  expect(h.clones.list()).toEqual([]);
});

test("cancelling a queued clone starts no git, removes its empty folder and leaves the others running", async () => {
  const h = await harness({ maxRunning: 1, timeoutMs: 1500 });
  const first = await h.clones.start({ repo: github.slowRepo, root: h.root, name: "slow-1" });
  const queued = await h.clones.start({ repo: "acme/chat-groups", root: h.root, name: "chat-groups" });
  const after = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  expect([first.state, queued.state, after.state]).toEqual(["cloning", "queued", "queued"]);
  const cancelled = await h.clones.cancel(queued.id);
  expect(cancelled.state).toBe("cancelled");
  expect(existsSync(queued.path)).toBe(false);
  expect(h.clones.list().find((c) => c.id === first.id)?.state).toBe("cloning");
  // The slot still goes to the next one in line.
  await h.clones.settled(first.id);
  await h.clones.settled(after.id);
  expect(h.clones.list().map((c) => `${c.name}:${c.state}`)).toEqual(["slow-1:failed", "chat-groups:cancelled", "beta-soc:tracked"]);
  h.clones.dismiss(queued.id);
});

test("a cancel racing a finish answers 409 and the clone keeps its outcome", async () => {
  let release: (() => void) | undefined;
  const tracking = new Promise<void>((resolve) => (release = resolve));
  let tracked = 0;
  const h = await harness({
    track: async () => {
      // git has exited 0; the cancel arrives now.
      release?.();
      await Bun.sleep(50);
      tracked++;
      return true;
    },
  });
  const clone = await h.clones.start({ repo: "acme/beta-soc", root: h.root, name: "beta-soc" });
  await tracking;
  await expect(h.clones.cancel(clone.id)).rejects.toMatchObject({ status: 409 });
  expect(h.clones.list()[0].state).toBe("tracked");
  expect(tracked).toBe(1);
  expect(existsSync(join(clone.path, ".git"))).toBe(true);
});
