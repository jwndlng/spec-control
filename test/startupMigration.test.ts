// The CLI's start-up order around the home migration: `--version`/`--help` never migrate, and a busy port — another
// instance still serving — stops the start before anything moves. Runs with HOME pointed at a temp directory and no
// home variable, so the defaults resolve there and never to the real `~`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_RECORD, NOT_YET_ATTEMPTED } from "../src/server/homeMigration.ts";
import { tempDir, treeFingerprint } from "./helpers.ts";

const root = join(import.meta.dir, "..");
let home: string;

beforeAll(async () => {
  if (!existsSync(join(root, "dist", "ui", "index.html"))) {
    const build = Bun.spawn(["bun", "run", join(root, "scripts", "build-ui.ts")], { cwd: root, stdout: "ignore", stderr: "inherit" });
    expect(await build.exited).toBe(0);
  }
  home = await tempDir("osd-userhome-");
  await mkdir(join(home, ".openspec-dashboard"));
  await writeFile(join(home, ".openspec-dashboard", "config.json"), "{}\n");
});
afterAll(() => rm(home, { recursive: true, force: true }));

/** Only the dashboard's own entries: bun keeps a transpiler cache under `$HOME` too. */
const homes = async () => treeFingerprint(join(home, ".openspec-dashboard"));

function env(): Record<string, string> {
  const out: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home };
  delete out.SPEC_CONTROL_HOME;
  delete out.OPENSPEC_DASHBOARD_HOME;
  return out;
}

async function cli(...args: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "run", join(root, "src", "server", "index.ts"), ...args], { cwd: root, env: env(), stdout: "ignore", stderr: "ignore" });
  return proc.exited;
}

test("--version and --help neither move nor write the old home", async () => {
  const before = await homes();
  expect(await cli("--version")).toBe(0);
  expect(await cli("--help")).toBe(0);
  expect(await homes()).toBe(before);
  expect(existsSync(join(home, ".spec-control"))).toBe(false);
});

test("a busy port exits before the home is moved", async () => {
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("the other instance") });
  try {
    const before = await homes();
    expect(await cli("--no-open", "--port", String(other.port))).not.toBe(0);
    expect(await homes()).toBe(before);
    expect(existsSync(join(home, ".spec-control"))).toBe(false);
  } finally {
    other.stop(true);
  }
});

test("a free port: the server binds, migrates and then serves", async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  const proc = Bun.spawn(["bun", "run", join(root, "src", "server", "index.ts"), "--no-open", "--port", String(port)], { cwd: root, env: env(), stdout: "pipe", stderr: "ignore" });
  try {
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("listening on")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toContain(`moved ${join(home, ".openspec-dashboard")} to ${join(home, ".spec-control")}`);
    expect(existsSync(join(home, ".spec-control", "config.json"))).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/api/snapshot`)).status).not.toBe(503);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("a migration an earlier start was stopped in: the start-up line and the environment check say this start finished it", async () => {
  const user = await tempDir("osd-userhome-");
  try {
    const oldHome = join(user, ".openspec-dashboard");
    const newHome = join(user, ".spec-control");
    // What a start stopped right after the rename leaves: the new home, its record, every step not yet attempted.
    await mkdir(join(newHome, "cache"), { recursive: true });
    await writeFile(join(newHome, "config.json"), "{}\n");
    await writeFile(join(newHome, "cache", "snapshot.json"), "{}\n");
    const pending = [
      { kind: "link", error: NOT_YET_ATTEMPTED },
      { kind: "rewrite", file: join(newHome, "config.json"), error: NOT_YET_ATTEMPTED },
      { kind: "cache", error: NOT_YET_ATTEMPTED },
    ];
    await writeFile(join(newHome, MIGRATION_RECORD), JSON.stringify({ migratedAt: "2026-10-01T09:00:00.000Z", from: [oldHome], to: newHome, pending }));

    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    const userEnv: Record<string, string> = { ...env(), HOME: user };
    const proc = Bun.spawn(["bun", "run", join(root, "src", "server", "index.ts"), "--no-open", "--port", String(port)], { cwd: root, env: userEnv, stdout: "pipe", stderr: "ignore" });
    try {
      const reader = proc.stdout.getReader();
      let out = "";
      while (!out.includes("listening on")) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      expect(out).toContain(`finished moving ${oldHome} to ${newHome}, which an earlier start was stopped in the middle of`);
      expect(await readlink(oldHome)).toBe(newHome);
      expect(existsSync(join(newHome, "cache", "snapshot.json"))).toBe(false);
      expect(JSON.parse(await readFile(join(newHome, MIGRATION_RECORD), "utf8")).pending).toEqual([]);
      const report = (await (await fetch(`http://127.0.0.1:${port}/api/environment`)).json()) as { checks: { id: string; status: string; found: string }[] };
      const check = report.checks.find((c) => c.id === "dashboard-home");
      expect(check?.status).toBe("ok");
      expect(check?.found).toContain("finished moving the home, which an earlier start was stopped in the middle of");
    } finally {
      proc.kill();
      await proc.exited;
    }
  } finally {
    await rm(user, { recursive: true, force: true });
  }
}, 30_000);
