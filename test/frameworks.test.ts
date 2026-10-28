// The framework module contract and registry (spec-frameworks spec; support-spec-frameworks design D1, D2, D5).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listArtifactFiles, readArtifactFile } from "../src/server/artifacts.ts";
import { newRepoConfig } from "../src/server/config.ts";
import { createChange } from "../src/server/createChange.ts";
import { DismissError, previewDismiss } from "../src/server/dismissChange.ts";
import { type FrameworkChange, type FrameworkChangeOutputs, type FrameworkLayout, type FrameworkProject, SpecFramework } from "../src/server/frameworks/framework.ts";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import { claimFramework, detectFramework, FRAMEWORKS, frameworkById, OPENSPEC_PATHS, skippedDirs, unclaimedMessage, writablePaths } from "../src/server/frameworks/registry.ts";
import { isChangeLeftoverPath } from "../src/server/pull.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { type ChangeDirEntry, LocalRepoSource, type RepoSource } from "../src/server/source.ts";
import { FRAMEWORK_INFO, frameworkInfo, type RepoSnapshot } from "../src/shared/types.ts";
import { FIXTURES, tempDir, treeFingerprint } from "./helpers.ts";

/**
 * A read-only module of a made-up layout: `plans/<name>/` with `plan.md` (the one required artifact) and `todo.md`
 * (the tasks), no archive, no spec deltas, no shared config. Its write paths are enumerated nowhere.
 */
class StubFramework extends SpecFramework {
  readonly id: string;
  readonly layout: FrameworkLayout;
  constructor(id = "stub", root = "plans") {
    super();
    this.id = id;
    this.layout = { root, changesDir: root, skipDirs: [root] };
  }
  async isProject(dir: string): Promise<boolean> {
    return stat(join(dir, this.layout.root, "PLANS")).then((i) => i.isFile(), () => false);
  }
  async readChange(source: RepoSource, project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChange> {
    const { outputs: _, ...change } = await this.readChangeOutputs(source, project, entry);
    return change;
  }
  async readChangeOutputs(source: RepoSource, _project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChangeOutputs> {
    const plan = join(entry.dir, "plan.md");
    const written = (await source.readFileInfo(plan))?.isFile === true;
    return {
      schema: "stub-flow",
      artifacts: [{ id: "plan", status: written ? "done" : "ready", required: true }],
      tasksPath: join(entry.dir, "todo.md"),
      outputs: { plan: written ? [plan] : [] },
      warnings: [],
    };
  }
  scaffold(): Record<string, string> {
    return { "plan.md": "# Plan\n" };
  }
}

let root: string;
beforeAll(async () => {
  root = await tempDir("frameworks-");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function stubProject(name: string, changes: Record<string, Record<string, string>>): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, "plans"), { recursive: true });
  await writeFile(join(dir, "plans", "PLANS"), "");
  for (const [change, files] of Object.entries(changes)) {
    await mkdir(join(dir, "plans", change), { recursive: true });
    for (const [file, text] of Object.entries(files)) await writeFile(join(dir, "plans", change, file), text);
  }
  return dir;
}

// ---- Registry ----

test("OpenSpec is the one registered module, first, with the shared display facts", () => {
  expect(FRAMEWORKS.map((f) => f.id)).toEqual(["openspec"]);
  expect(openSpec.label).toBe("OpenSpec");
  expect(FRAMEWORK_INFO.openspec).toEqual({ label: "OpenSpec", changesDir: "openspec/changes" });
  expect(openSpec.layout).toEqual({ root: "openspec", changesDir: "openspec/changes", archiveDir: "openspec/changes/archive", skipDirs: ["openspec"] });
  expect(openSpec.sharedConfigFile).toBe("openspec/config.yaml");
  expect(skippedDirs()).toEqual(new Set(["openspec"]));
});

test("an absent framework id reads as OpenSpec; an unknown one is no module", () => {
  expect(frameworkById(undefined)).toBe(openSpec);
  expect(frameworkById("openspec")).toBe(openSpec);
  expect(frameworkById("nope")).toBeUndefined();
  expect(frameworkInfo(undefined)).toEqual(FRAMEWORK_INFO.openspec);
  expect(frameworkInfo("nope")).toEqual(FRAMEWORK_INFO.openspec);
});

test("detection: the fixtures are OpenSpec projects, a bare folder is none", async () => {
  expect(await detectFramework(join(FIXTURES, "demo-ops"))).toBe(openSpec);
  const bare = join(root, "bare");
  await mkdir(bare, { recursive: true });
  expect(await detectFramework(bare)).toBeUndefined();
  expect(await claimFramework(new LocalRepoSource(bare))).toBeUndefined();
});

test("the first claiming module wins, so a folder with two markers is read once", async () => {
  const dir = await stubProject("both", { one: { "plan.md": "x" } });
  await mkdir(join(dir, "openspec", "changes"), { recursive: true });
  await writeFile(join(dir, "openspec", "config.yaml"), "schema: spec-driven\n");
  const first = new StubFramework("first");
  const second = new StubFramework("second");
  expect(await detectFramework(dir, [first, second])).toBe(first);
  expect(await detectFramework(dir, [second, first])).toBe(second);
  expect(await detectFramework(dir, [openSpec, first])).toBe(openSpec);
  expect((await scanRepo(newRepoConfig(dir, true), new LocalRepoSource(dir), undefined, [first, openSpec])).framework).toBe("first");
});

test("a tracked folder no module claims fails with the old message and does not throw", async () => {
  const bare = join(root, "unclaimed");
  await mkdir(bare, { recursive: true });
  const snap = await scanRepo(newRepoConfig(bare, true));
  expect([snap.ok, snap.error, snap.framework]).toEqual([false, "repository path or its openspec/ directory does not exist", undefined]);
  expect(unclaimedMessage([openSpec, new StubFramework()])).toBe("repository path or its openspec/ or plans/ directory does not exist");
});

test("a scanned OpenSpec repository names its framework", async () => {
  const repo = newRepoConfig(join(FIXTURES, "demo-ops"), true);
  expect((await scanRepo(repo)).framework).toBe("openspec");
});

// ---- OpenSpec module ----

test("the OpenSpec scaffold is the change marker with the project's schema and the date", () => {
  expect(openSpec.scaffold({ project: {}, today: "2026-01-02" })).toEqual({ ".openspec.yaml": "schema: spec-driven\ncreated: 2026-01-02\n" });
  expect(openSpec.scaffold({ project: { schema: "lean" }, today: "2026-01-02" })).toEqual({ ".openspec.yaml": "schema: lean\ncreated: 2026-01-02\n" });
});

test("a worktree without its own config inherits the main checkout's schema", async () => {
  const dir = join(root, "no-config");
  await mkdir(join(dir, "openspec"), { recursive: true });
  expect(await openSpec.readProject(new LocalRepoSource(dir), { schema: "lean" })).toEqual({ schema: "lean" });
  expect(await openSpec.readProject(new LocalRepoSource(dir))).toEqual({});
});

// ---- A second, read-only module on the same Kanban ----

test("a stub module's changes land in the board's columns through the neutral shape", async () => {
  const dir = await stubProject("stub-board", {
    drafting: {},
    planned: { "plan.md": "x", "todo.md": "- [ ] a\n- [ ] b\n" },
    halfway: { "plan.md": "x", "todo.md": "- [x] a\n- [ ] b\n" },
    finished: { "plan.md": "x", "todo.md": "- [x] a\n- [x] b\n" },
    checking: { "plan.md": "x", "todo.md": "- [x] a\n- [~] b\n" },
  });
  const stub = new StubFramework();
  const snap = await scanRepo(newRepoConfig(dir, true), new LocalRepoSource(dir), undefined, [openSpec, stub]);
  expect([snap.ok, snap.framework]).toEqual([true, "stub"]);
  const byName = Object.fromEntries(snap.changes.map((c) => [c.name, c]));
  expect(Object.fromEntries(snap.changes.map((c) => [c.name, [c.column, c.subState ?? null]]))).toEqual({
    drafting: ["Backlog", null],
    planned: ["Ready", null],
    halfway: ["Implementing", null],
    finished: ["Done", "complete"],
    checking: ["Done", "validate"],
  });
  expect(byName.finished.specsSynced).toBeUndefined();
  expect(byName.finished.schema).toBe("stub-flow");
  expect(snap.sharedConfig).toBeUndefined();
});

test("the detail view lists a stub module's artifact files", async () => {
  const dir = await stubProject("stub-detail", { planned: { "plan.md": "# Plan\n" } });
  const stub = new StubFramework();
  const source = new LocalRepoSource(dir);
  const [entry] = (await stub.listChanges(source)).active;
  const listed = await listArtifactFiles(source, "r1", entry, stub);
  expect(listed.change.schema).toBe("stub-flow");
  expect(listed.artifacts.map((a) => [a.id, a.files.map((f) => f.path)])).toEqual([["plan", ["plan.md"]]]);
});

test("writes are offered only to modules whose paths are enumerated", async () => {
  const stub = new StubFramework();
  expect(writablePaths(openSpec)).toBe(openSpec.layout);
  expect(writablePaths(stub)).toBeUndefined();
  expect(writablePaths(undefined)).toBeUndefined();

  const dir = await stubProject("stub-writes", { kept: { "plan.md": "x" } });
  const before = await treeFingerprint(dir);
  const created = await createChange(dir, "fresh", "a prompt", undefined, undefined, stub);
  expect(created).toMatchObject({ ok: false, reason: "not-writable" });

  const scanned: RepoSnapshot = { id: "r", name: "stub-writes", path: dir, framework: "stub", ok: true, scannedAt: "", isGit: false, worktrees: [], changes: [] };
  const refused = await previewDismiss(newRepoConfig(dir, true), scanned, "kept").catch((err) => err);
  expect(refused).toBeInstanceOf(DismissError);
  expect((refused as DismissError).status).toBe(409);
  expect(await treeFingerprint(dir)).toBe(before);

  // Pull leftovers, the session worktree copy and the docs-only check are pinned to OpenSpec's paths.
  expect(OPENSPEC_PATHS).toBe(openSpec.layout);
  expect(isChangeLeftoverPath("plans/kept/plan.md")).toBe(false);
  expect(isChangeLeftoverPath("openspec/changes/kept/proposal.md")).toBe(true);
});

// ---- Read-only ----

test("scanning, listing artifacts and reading files through the modules leaves every fixture untouched", async () => {
  const fixtures = ["demo-ops", "beta-soc"].map((name) => join(FIXTURES, name));
  const before = await Promise.all(fixtures.map(treeFingerprint));
  for (const path of fixtures) {
    const snap = await scanRepo(newRepoConfig(path, true));
    expect([snap.ok, snap.framework]).toEqual([true, "openspec"]);
    const source = new LocalRepoSource(path);
    const { active, archived } = await openSpec.listChanges(source);
    for (const entry of [...active, ...archived]) {
      const listed = await listArtifactFiles(source, snap.id, entry);
      const file = listed.artifacts.flatMap((a) => a.files)[0];
      if (file) expect((await readArtifactFile(source, entry.dir, file.path)).ok).toBe(true);
    }
  }
  expect(await Promise.all(fixtures.map(treeFingerprint))).toEqual(before);
});

// ---- Schema names and tracked tasks stay inside (contain-repository-reads design D5) ----

/** A valid schema with one artifact; `tracks` sets `apply.tracks`. */
const schemaYaml = (tracks?: string) =>
  [
    "name: checklist-flow",
    "version: 1",
    "artifacts:",
    "  - id: brief",
    "    generates: brief.md",
    "    description: Brief",
    "    template: brief.md",
    "    requires: []",
    ...(tracks ? ["apply:", "  requires: [brief]", `  tracks: ${tracks}`] : []),
    "",
  ].join("\n");

async function schemaProject(): Promise<{ base: string; repo: string; changes: string }> {
  const base = await tempDir("osd-schema-names-");
  const repo = join(base, "demo-ops");
  const changes = join(repo, "openspec", "changes");
  await mkdir(changes, { recursive: true });
  await writeFile(join(repo, "openspec", "config.yaml"), "schema: spec-driven\n");
  return { base, repo, changes };
}

async function change(changes: string, name: string, schema: string, files: Record<string, string> = {}): Promise<void> {
  await mkdir(join(changes, name), { recursive: true });
  await writeFile(join(changes, name, ".openspec.yaml"), `schema: ${schema}\ncreated: 2026-09-01\n`);
  for (const [file, text] of Object.entries(files)) await writeFile(join(changes, name, file), text);
}

test("a schema name that is not one plain segment is an unknown schema with a warning, and nothing outside openspec/schemas/ is opened", async () => {
  const { base, repo, changes } = await schemaProject();
  // Valid schemas exactly where `..` and `../../shared` would lead: were they opened, the changes would have artifacts.
  await writeFile(join(repo, "openspec", "schema.yaml"), schemaYaml());
  await mkdir(join(base, "shared"), { recursive: true });
  await writeFile(join(base, "shared", "schema.yaml"), schemaYaml());
  await change(changes, "climb-one", "..", { "brief.md": "# Brief\n" });
  await change(changes, "climb-two", "../../shared", { "brief.md": "# Brief\n" });
  try {
    const snap = await scanRepo(newRepoConfig(repo, true));
    for (const name of ["climb-one", "climb-two"]) {
      const c = snap.changes.find((x) => x.name === name)!;
      expect([name, c.artifacts, c.schema]).toEqual([name, [], "unknown"]);
      expect(c.warnings?.some((w) => w.includes("is not a plain name"))).toBe(true);
    }
    // The same rule for a name from openspec/config.yaml.
    await writeFile(join(repo, "openspec", "config.yaml"), "schema: ../..\n");
    await mkdir(join(changes, "plain"), { recursive: true });
    const plain = (await scanRepo(newRepoConfig(repo, true))).changes.find((x) => x.name === "plain")!;
    expect(plain.artifacts).toEqual([]);
    expect(plain.warnings?.some((w) => w.includes("is not a plain name"))).toBe(true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a project-local schema is read with the bounded read, and apply.tracks must stay in the change directory", async () => {
  const { base, repo, changes } = await schemaProject();
  const local = (name: string) => join(repo, "openspec", "schemas", name);
  await mkdir(local("checklist-flow"), { recursive: true });
  await writeFile(join(local("checklist-flow"), "schema.yaml"), schemaYaml("checklist.md"));
  await mkdir(local("escaping"), { recursive: true });
  await writeFile(join(local("escaping"), "schema.yaml"), schemaYaml("../../../outside.md").replace("checklist-flow", "escaping"));
  await mkdir(local("endless"), { recursive: true });
  await symlink("/dev/zero", join(local("endless"), "schema.yaml"));
  await writeFile(join(repo, "openspec", "outside.md"), "- [x] 1.1 Not this change's\n");
  await change(changes, "local-ok", "checklist-flow", { "brief.md": "# Brief\n", "checklist.md": "- [x] 1.1 One\n- [ ] 1.2 Two\n" });
  await change(changes, "escapes", "escaping", { "brief.md": "# Brief\n" });
  await change(changes, "linked-out", "checklist-flow", { "brief.md": "# Brief\n" });
  await symlink(join(repo, "openspec", "outside.md"), join(changes, "linked-out", "checklist.md"));
  await change(changes, "zero", "endless", { "brief.md": "# Brief\n" });
  try {
    const snap = await scanRepo(newRepoConfig(repo, true));
    const get = (name: string) => snap.changes.find((x) => x.name === name)!;
    expect(get("local-ok").artifacts.map((a) => a.id)).toEqual(["brief"]);
    expect(get("local-ok").tasks).toMatchObject({ done: 1, total: 2 });
    // The library's schema parser refuses a path that climbs out; either way there are no tasks and a warning.
    expect(get("escapes").tasks).toBeNull();
    expect(get("escapes").warnings?.some((w) => w.includes("apply.tracks"))).toBe(true);
    // A tracked file that is a link out of the change is refused by the bounded read.
    expect(get("linked-out").tasks).toBeNull();
    expect(get("linked-out").warnings?.some((w) => w.includes("checklist.md resolves outside"))).toBe(true);
    expect(get("zero").artifacts).toEqual([]);
    expect(get("zero").warnings?.some((w) => w.includes("openspec/schemas/endless/schema.yaml"))).toBe(true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
