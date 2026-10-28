import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import { changeSpecsSynced, isDeltaSynced } from "../src/server/frameworks/openspec/specSync.ts";
import { tempDir, useTempHome } from "./helpers.ts";

const req = (name: string, body: string, scenario = "works") => `### Requirement: ${name}\n${body}\n\n#### Scenario: ${scenario}\n- **WHEN** something happens\n- **THEN** it ${scenario}\n`;
const spec = (...blocks: string[]) => `# auth Specification\n\n## Purpose\nAuthentication.\n\n## Requirements\n\n${blocks.join("\n")}`;

const OLD_TIMEOUT = req("Session timeout", "Sessions SHALL expire after 60 minutes.");
// Same scenario name as before: the CLI refuses a MODIFIED block that drops an existing scenario.
const NEW_TIMEOUT = req("Session timeout", "Sessions SHALL expire after 15 minutes of inactivity.");
const TWO_FACTOR = req("Two-factor login", "The system SHALL require a second factor.");
const LEGACY = req("Legacy export", "The system SHALL export XML.");
const LOGIN = req("Login", "Users SHALL be able to log in.");

const DELTA = [
  "## ADDED Requirements\n",
  TWO_FACTOR,
  "## MODIFIED Requirements\n",
  NEW_TIMEOUT,
  "## REMOVED Requirements\n",
  "### Requirement: Legacy export\n**Reason**: Nobody uses XML.\n**Migration**: Use JSON.\n",
  "## RENAMED Requirements\n",
  "- FROM: `### Requirement: Login`\n- TO: `### Requirement: Sign in`\n",
].join("\n");
const BEFORE = spec(OLD_TIMEOUT, LEGACY, LOGIN);
const AFTER = spec(NEW_TIMEOUT, LOGIN.replace("Requirement: Login", "Requirement: Sign in"), TWO_FACTOR);

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(() => cleanup());

test("isDeltaSynced: each operation has to hold in the main spec", () => {
  expect(isDeltaSynced(DELTA, BEFORE)).toBe(false);
  expect(isDeltaSynced(DELTA, AFTER)).toBe(true);
  // one operation missing at a time
  expect(isDeltaSynced(DELTA, AFTER.replace(TWO_FACTOR, ""))).toBe(false);
  expect(isDeltaSynced(DELTA, AFTER.replace(NEW_TIMEOUT, OLD_TIMEOUT))).toBe(false);
  expect(isDeltaSynced(DELTA, `${AFTER}\n${LEGACY}`)).toBe(false);
  expect(isDeltaSynced(DELTA, AFTER.replace("Requirement: Sign in", "Requirement: Login"))).toBe(false);
  expect(isDeltaSynced(DELTA, `${AFTER}\n${LOGIN}`)).toBe(false);
});

test("isDeltaSynced: whitespace differences are ignored, later edits to an added requirement are fine", () => {
  const reflowed = AFTER.replace(NEW_TIMEOUT, NEW_TIMEOUT.replace(/\n\n/g, "\n\n\n").replace("inactivity.", "inactivity.   ")).replace(/\n/g, "\r\n");
  expect(isDeltaSynced(DELTA, reflowed)).toBe(true);
  const addedLaterChanged = AFTER.replace("require a second factor", "require a hardware key");
  expect(isDeltaSynced(DELTA, addedLaterChanged)).toBe(true);
});

test("isDeltaSynced: missing main spec, empty delta, malformed delta", () => {
  expect(isDeltaSynced(`## ADDED Requirements\n\n${TWO_FACTOR}`, undefined)).toBe(false);
  expect(isDeltaSynced("## REMOVED Requirements\n\n### Requirement: Legacy export\n**Reason**: x\n**Migration**: y\n", undefined)).toBe(true);
  expect(isDeltaSynced("## ADDED Requirements\n", BEFORE)).toBe(true);
  expect(isDeltaSynced("", BEFORE)).toBe(true);
  // a requirement written outside any delta section must not pass as "nothing to do"
  expect(() => isDeltaSynced(TWO_FACTOR, BEFORE)).toThrow();
});

/** A project with a main `auth` spec and a finished change `harden-auth` carrying DELTA. */
async function project(): Promise<{ root: string; change: string; mainSpec: string }> {
  const root = await tempDir("osd-sync-");
  const change = join(root, "openspec", "changes", "harden-auth");
  const mainSpec = join(root, "openspec", "specs", "auth", "spec.md");
  await mkdir(join(change, "specs", "auth"), { recursive: true });
  await mkdir(join(root, "openspec", "specs", "auth"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(mainSpec, BEFORE);
  await writeFile(join(change, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");
  await writeFile(join(change, "proposal.md"), "## Why\n\nSessions live too long and XML export is dead weight, so auth needs hardening now.\n\n## What Changes\n\n- Shorter sessions, second factor, no XML.\n");
  await writeFile(join(change, "design.md"), "## Context\n\nx\n");
  await writeFile(join(change, "tasks.md"), "## 1. Work\n\n- [x] 1.1 do it\n- [x] 1.2 test it\n");
  await writeFile(join(change, "specs", "auth", "spec.md"), DELTA);
  return { root, change, mainSpec };
}

const changeOf = async (root: string, source?: LocalRepoSource) => (await scanRepo(newRepoConfig(root, true), source)).changes.find((c) => c.name === "harden-auth")!;

test("scanner: a finished change reports whether its delta is in the main specs and stays Done either way", async () => {
  const { root, mainSpec } = await project();
  let c = await changeOf(root);
  expect([c.specsSynced, c.stage, c.column]).toEqual([false, "done", "Done"]);
  await writeFile(mainSpec, AFTER);
  c = await changeOf(root);
  expect([c.specsSynced, c.stage, c.column]).toEqual([true, "done", "Done"]);
  await rm(root, { recursive: true, force: true });
});

test("scanner: no delta specs means nothing to sync; unfinished changes are not checked", async () => {
  const { root, change } = await project();
  await writeFile(join(change, "tasks.md"), "## 1. Work\n\n- [x] 1.1 do it\n- [ ] 1.2 test it\n");
  let reads = 0;
  class Counting extends LocalRepoSource {
    override listDirs(dir: string): Promise<string[]> {
      if (dir.endsWith(join("harden-auth", "specs"))) reads++;
      return super.listDirs(dir);
    }
  }
  let c = await changeOf(root, new Counting(root));
  expect([c.specsSynced, c.column, reads]).toEqual([undefined, "Implementing", 0]);

  await writeFile(join(change, "tasks.md"), "## 1. Work\n\n- [x] 1.1 do it\n");
  await rm(join(change, "specs"), { recursive: true });
  c = await changeOf(root);
  expect([c.specsSynced, c.column]).toEqual([true, "Done"]);
  await rm(root, { recursive: true, force: true });
});

test("scanner: a delta that cannot be checked stays Done with a warning and does not fail the repo", async () => {
  const { root, change } = await project();
  await writeFile(join(change, "specs", "auth", "spec.md"), TWO_FACTOR); // requirement outside any delta section
  const snap = await scanRepo(newRepoConfig(root, true));
  const c = snap.changes.find((x) => x.name === "harden-auth")!;
  expect(snap.ok).toBe(true);
  expect([c.specsSynced, c.column]).toEqual([false, "Done"]);
  expect(c.warnings?.some((w) => w.includes("could not check spec sync for auth"))).toBe(true);
  await rm(root, { recursive: true, force: true });
});

test("agrees with the real tool: deltas applied by `openspec archive` are reported as synced", async () => {
  const { root, change, mainSpec } = await project();
  const delta = await readFile(join(change, "specs", "auth", "spec.md"), "utf8");
  expect(isDeltaSynced(delta, await readFile(mainSpec, "utf8"))).toBe(false);

  // Keep a copy outside changes/: archive moves the original away.
  const kept = join(root, "kept-delta.md");
  await cp(join(change, "specs", "auth", "spec.md"), kept);
  const cli = join(import.meta.dir, "..", "node_modules", ".bin", "openspec");
  const proc = Bun.spawn([cli, "archive", "harden-auth", "-y"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, OPENSPEC_TELEMETRY: "0", CI: "1" } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(`${code}\n${out}\n${err}`).toStartWith("0\n");
  expect((await readdir(join(root, "openspec", "changes", "archive"))).some((d) => d.endsWith("-harden-auth"))).toBe(true);

  expect(isDeltaSynced(await readFile(kept, "utf8"), await readFile(mainSpec, "utf8"))).toBe(true);
  await rm(root, { recursive: true, force: true });
}, 60_000);

test("a delta or main spec that is a link out, a pipe or a device is not read: not synced, with a warning", async () => {
  const root = await tempDir("osd-syncsafe-");
  const repo = join(root, "demo-ops");
  const changeDir = join(repo, "openspec", "changes", "rotate-keys");
  await mkdir(join(changeDir, "specs", "auth"), { recursive: true });
  await mkdir(join(changeDir, "specs", "billing"), { recursive: true });
  await mkdir(join(repo, "openspec", "specs", "billing"), { recursive: true });
  await mkdir(join(root, "elsewhere"), { recursive: true });
  await writeFile(join(root, "elsewhere", "spec.md"), DELTA);
  await symlink(join(root, "elsewhere", "spec.md"), join(changeDir, "specs", "auth", "spec.md"));
  await writeFile(join(changeDir, "specs", "billing", "spec.md"), `## ADDED Requirements\n\n${TWO_FACTOR}`);
  await symlink("/dev/zero", join(repo, "openspec", "specs", "billing", "spec.md"));
  try {
    const result = await changeSpecsSynced(new LocalRepoSource(repo), changeDir);
    expect(result.synced).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("specs/auth/spec.md resolves outside"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("openspec/specs/billing/spec.md resolves outside"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
