import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import { recordBranchInWorktree } from "../src/server/frameworks/worktreeMetadata.ts";
import { tempDir } from "./helpers.ts";

describe("openSpec framework metadata helpers", () => {
  test("changeMetadataPaths returns active and optional archived paths", () => {
    const paths = openSpec.changeMetadataPaths("rotate-keys");
    expect(paths).toEqual({
      active: "openspec/changes/rotate-keys/.openspec.yaml",
    });

    const withArchived = openSpec.changeMetadataPaths("rotate-keys", "2026-10-20-rotate-keys");
    expect(withArchived).toEqual({
      active: "openspec/changes/rotate-keys/.openspec.yaml",
      archived: "openspec/changes/archive/2026-10-20-rotate-keys/.openspec.yaml",
    });
  });

  test("archiveDirPath returns dated archive directory relative path", () => {
    expect(openSpec.archiveDirPath("rotate-keys", "2026-11-02")).toBe(
      "openspec/changes/archive/2026-11-02-rotate-keys"
    );
  });

  test("recordBranchInMetadata updates branch in marker text purely", () => {
    const initial = "schema: spec-driven\ncreated: 2026-10-24\n";
    const res = openSpec.recordBranchInMetadata(initial, "branch", "feat/rotate-keys");
    expect(res).toBe("schema: spec-driven\ncreated: 2026-10-24\nspec-control:\n  branch: feat/rotate-keys\n");
  });
});

describe("recordBranchInWorktree", () => {
  let root: string;
  beforeAll(async () => {
    root = await tempDir("wt-meta-");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("atomically records branch in active change .openspec.yaml", async () => {
    const wt = join(root, "active-wt");
    const changeDir = join(wt, "openspec", "changes", "rotate-keys");
    await mkdir(changeDir, { recursive: true });
    const yamlPath = join(changeDir, ".openspec.yaml");
    await writeFile(yamlPath, "schema: spec-driven\ncreated: 2026-10-24\n");

    const res = await recordBranchInWorktree(wt, "rotate-keys", "branch", "feat/rotate-keys");
    expect(res.updated).toBe(true);
    expect(res.relPath).toBe("openspec/changes/rotate-keys/.openspec.yaml");

    const content = await readFile(yamlPath, "utf8");
    expect(content).toContain("branch: feat/rotate-keys");

    // Idempotent: second call does not rewrite
    const res2 = await recordBranchInWorktree(wt, "rotate-keys", "branch", "feat/rotate-keys");
    expect(res2.updated).toBe(false);
  });

  test("atomically records archive-branch in archived change .openspec.yaml", async () => {
    const wt = join(root, "archive-wt");
    const archiveDir = join(wt, "openspec", "changes", "archive", "2026-10-20-rotate-keys");
    await mkdir(archiveDir, { recursive: true });
    const yamlPath = join(archiveDir, ".openspec.yaml");
    await writeFile(yamlPath, "schema: spec-driven\ncreated: 2026-10-20\nspec-control:\n  branch: feat/rotate-keys\n");

    const res = await recordBranchInWorktree(wt, "rotate-keys", "archive-branch", "chore/archive-rotate-keys");
    expect(res.updated).toBe(true);
    expect(res.relPath).toBe("openspec/changes/archive/2026-10-20-rotate-keys/.openspec.yaml");

    const content = await readFile(yamlPath, "utf8");
    expect(content).toContain("branch: feat/rotate-keys");
    expect(content).toContain("archive-branch: chore/archive-rotate-keys");
  });

  test("refuses to follow symbolic links for any segment", async () => {
    const wt = join(root, "symlink-wt");
    const outside = join(root, "outside-change");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, ".openspec.yaml"), "schema: spec-driven\n");

    // Symlink at change directory level
    const changesDir = join(wt, "openspec", "changes");
    await mkdir(changesDir, { recursive: true });
    await symlink(outside, join(changesDir, "linked-change"));

    await expect(recordBranchInWorktree(wt, "linked-change", "branch", "feat/linked")).rejects.toThrow(
      "symbolic link not allowed"
    );

    // Symlink at .openspec.yaml file level
    const realChangeDir = join(wt, "openspec", "changes", "real-change");
    await mkdir(realChangeDir, { recursive: true });
    await symlink(join(outside, ".openspec.yaml"), join(realChangeDir, ".openspec.yaml"));

    await expect(recordBranchInWorktree(wt, "real-change", "branch", "feat/real")).rejects.toThrow(
      "symbolic link not allowed"
    );
  });
});
