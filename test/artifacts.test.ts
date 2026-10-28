import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changeDirFor, listArtifactFiles, MAX_ARTIFACT_BYTES, readArtifactFile } from "../src/server/artifacts.ts";
import { readChangeArtifacts } from "../src/server/frameworks/openspec/adapter.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import { FIXTURES, tempDir } from "./helpers.ts";

const DEMO_OPS = join(FIXTURES, "demo-ops");
const fixtures = new LocalRepoSource(DEMO_OPS);

// A throwaway repository for what the fixtures do not have: two delta specs, a link out of the change, an oversize file.
let root: string;
let changeDir: string;
let temp: LocalRepoSource;
beforeAll(async () => {
  root = await realpath(await tempDir("osd-artifacts-")); // the adapter reports real paths; on macOS the temp dir is a link
  changeDir = join(root, "openspec", "changes", "multi-tenant-sync");
  await mkdir(join(changeDir, "specs", "kanban-board"), { recursive: true });
  await mkdir(join(changeDir, "specs", "dashboard-api"), { recursive: true });
  await writeFile(join(changeDir, "proposal.md"), "## Why\n\nBecause.\n");
  await writeFile(join(changeDir, "specs", "kanban-board", "spec.md"), "## ADDED Requirements\n");
  await writeFile(join(changeDir, "specs", "dashboard-api", "spec.md"), "## ADDED Requirements\n");
  await writeFile(join(root, "secrets.md"), "outside the change\n");
  await symlink(join(root, "secrets.md"), join(changeDir, "leak.md"));
  await writeFile(join(changeDir, "huge.md"), "x".repeat(2 * MAX_ARTIFACT_BYTES));
  temp = new LocalRepoSource(root);
});
afterAll(() => rm(root, { recursive: true, force: true }));

test("the adapter reports each artifact's resolved output paths", () => {
  const info = readChangeArtifacts(root, "multi-tenant-sync");
  expect(info.outputs.proposal).toEqual([join(changeDir, "proposal.md")]);
  expect([...info.outputs.specs].sort()).toEqual([join(changeDir, "specs", "dashboard-api", "spec.md"), join(changeDir, "specs", "kanban-board", "spec.md")]);
  expect(info.outputs.design).toEqual([]);
  expect(info.artifacts.map((a) => a.id)).toEqual(["proposal", "specs", "design", "tasks"]);
});

test("the adapter reports which artifacts the schema's apply.requires names", async () => {
  // spec-driven: only `tasks` is needed before implementing; the design is optional.
  const info = readChangeArtifacts(root, "multi-tenant-sync");
  expect(info.artifacts.map((a) => [a.id, a.required])).toEqual([["proposal", false], ["specs", false], ["design", false], ["tasks", true]]);

  // A schema that declares no `apply.requires` needs every artifact.
  const project = await realpath(await tempDir("osd-norequires-"));
  try {
    await mkdir(join(project, "openspec", "schemas", "checklist-flow"), { recursive: true });
    await writeFile(
      join(project, "openspec", "schemas", "checklist-flow", "schema.yaml"),
      [
        "name: checklist-flow",
        "version: 1",
        "artifacts:",
        "  - id: brief",
        "    generates: brief.md",
        "    description: Brief",
        "    template: brief.md",
        "    requires: []",
        "  - id: checklist",
        "    generates: checklist.md",
        "    description: Checklist",
        "    template: checklist.md",
        "    requires: [brief]",
        "",
      ].join("\n"),
    );
    await mkdir(join(project, "openspec", "changes", "add-widget"), { recursive: true });
    // The module reads the local schema with the bounded read and hands the adapter its text.
    const schemaYaml = await readFile(join(project, "openspec", "schemas", "checklist-flow", "schema.yaml"), "utf8");
    const custom = readChangeArtifacts(project, "add-widget", { schemaName: "checklist-flow", schemaYaml });
    expect(custom.artifacts.map((a) => [a.id, a.required])).toEqual([["brief", true], ["checklist", true]]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("readFileInfo: regular file, directory, missing path", async () => {
  const file = await temp.readFileInfo(join(changeDir, "proposal.md"));
  expect(file).toMatchObject({ isFile: true, size: 17 });
  expect((await temp.readFileInfo(join(changeDir, "specs")))?.isFile).toBe(false);
  expect(await temp.readFileInfo(join(changeDir, "nope.md"))).toBeUndefined();
});

test("changeDirFor validates the name, then resolves active and archived directories", async () => {
  expect(await changeDirFor(fixtures, "../demo-ops")).toEqual({ ok: false, reason: "invalid-name" });
  expect(await changeDirFor(fixtures, "a/b")).toEqual({ ok: false, reason: "invalid-name" });
  expect(await changeDirFor(fixtures, "never-existed")).toEqual({ ok: false, reason: "unknown-change" });
  const active = await changeDirFor(fixtures, "cloud-deployment");
  expect(active.ok && active.entry.dir).toBe(join(DEMO_OPS, "openspec", "changes", "cloud-deployment"));
  const archived = await changeDirFor(fixtures, "runbook-repo-field");
  expect(archived.ok && archived.entry.dir).toBe(join(DEMO_OPS, "openspec", "changes", "archive", "2026-06-18-runbook-repo-field"));
  expect(archived.ok && archived.entry.archived).toBe("2026-06-18");
});

test("listArtifactFiles: schema order, sorted relative paths with sizes, empty files for unwritten artifacts", async () => {
  const found = await changeDirFor(temp, "multi-tenant-sync");
  if (!found.ok) throw new Error("fixture change missing");
  const listing = await listArtifactFiles(temp, "r1", found.entry);
  expect(listing.change).toEqual({ repoId: "r1", name: "multi-tenant-sync", schema: "spec-driven", dir: changeDir, archived: false });
  expect(listing.artifacts).toEqual([
    { id: "proposal", status: "done", required: false, files: [{ path: "proposal.md", bytes: 17 }] },
    { id: "specs", status: "done", required: false, files: [{ path: "specs/dashboard-api/spec.md", bytes: 22 }, { path: "specs/kanban-board/spec.md", bytes: 22 }] },
    { id: "design", status: "ready", required: false, files: [] },
    { id: "tasks", status: "blocked", required: true, files: [] },
  ]);
});

test("readArtifactFile reads a file inside the change", async () => {
  expect(await readArtifactFile(temp, changeDir, "proposal.md")).toEqual({ ok: true, file: { path: "proposal.md", bytes: 17, text: "## Why\n\nBecause.\n" } });
  const nested = await readArtifactFile(temp, changeDir, "specs/./kanban-board/spec.md");
  expect(nested.ok && nested.file.path).toBe("specs/kanban-board/spec.md");
});

test("readArtifactFile refuses everything that is not a regular file inside the change directory", async () => {
  const reason = async (path: string | null) => {
    const result = await readArtifactFile(temp, changeDir, path);
    return result.ok ? "ok" : result.reason;
  };
  expect(await reason(null)).toBe("bad-path");
  expect(await reason("")).toBe("bad-path");
  expect(await reason("../../../../etc/passwd")).toBe("bad-path");
  expect(await reason("/etc/passwd")).toBe("bad-path");
  expect(await reason("specs/../../../secrets.md")).toBe("bad-path");
  expect(await reason("..")).toBe("bad-path");
  expect(await reason("leak.md")).toBe("not-found"); // symlink pointing out of the change directory
  expect(await reason("specs")).toBe("not-found"); // a directory
  expect(await reason("missing.md")).toBe("not-found");
  expect(await reason("huge.md")).toBe("too-large");
  const huge = await readArtifactFile(temp, changeDir, "huge.md");
  expect(JSON.stringify(huge)).not.toContain("xxxx");
});

test("readArtifactFile answers not-found for a named pipe instead of waiting for a writer", async () => {
  const pipe = join(changeDir, "pipe.md");
  expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
  try {
    const result = await readArtifactFile(temp, changeDir, "pipe.md");
    expect(result.ok ? "ok" : result.reason).toBe("not-found");
  } finally {
    await rm(pipe, { force: true });
  }
});
