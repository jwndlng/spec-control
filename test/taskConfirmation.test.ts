import { expect, test } from "bun:test";
import { mkdir, readFile, rm, symlink, writeFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { confirmTask } from "../src/server/taskConfirmation.ts";
import { tempDir } from "./helpers.ts";

test("confirms only the requested awaiting marker and preserves other bytes and mode", async () => {
  const root = await tempDir("osd-task-confirm-");
  try {
    const dir = join(root, "openspec", "changes", "active");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "tasks.md");
    const original = "# Tasks\r\n\r\n- [~] repeat\r\n- [~] repeat\r\n- [ ] stay open\r\n";
    await writeFile(file, original, { mode: 0o640 });
    const result = await confirmTask(file, root, dir, original, 4);
    expect(result).toBe("ok");
    expect(await readFile(file, "utf8")).toBe("# Tasks\r\n\r\n- [~] repeat\r\n- [x] repeat\r\n- [ ] stay open\r\n");
    expect((await stat(file)).mode & 0o777).toBe(0o640);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stale versions, open tasks and symlinked paths are refused without writes", async () => {
  const root = await tempDir("osd-task-confirm-");
  try {
    const dir = join(root, "openspec", "changes", "active");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "tasks.md");
    const original = "- [~] verify\n- [ ] open\n";
    await writeFile(file, original);
    const outside = join(root, "outside.md");
    await writeFile(outside, original);
    expect(await confirmTask(join(dir, "missing.md"), root, dir, original, 1)).toBe("conflict");
    expect(await confirmTask(outside, root, dir, original, 1)).toBe("conflict");
    expect(await confirmTask(file, root, dir, "- [ ] stale\n", 1)).toBe("conflict");
    expect(await confirmTask(file, root, dir, original, 2)).toBe("conflict");
    expect(await readFile(file, "utf8")).toBe(original);
    await rm(file);
    await symlink(outside, file);
    expect(await confirmTask(file, root, dir, original, 1)).toBe("conflict");
    expect(await readFile(outside, "utf8")).toBe(original);
    await rm(file);
    await rm(join(root, "openspec"), { recursive: true });
    await symlink(root, join(root, "openspec"));
    expect(await confirmTask(join(root, "openspec", "changes", "active", "tasks.md"), root, dir, original, 1)).toBe("conflict");
    expect(await readFile(outside, "utf8")).toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent confirmation of one displayed version writes once", async () => {
  const root = await tempDir("osd-task-confirm-");
  try {
    const dir = join(root, "openspec", "changes", "active");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "tasks.md");
    const original = "- [~] once\n";
    await writeFile(file, original);
    const results = await Promise.all([confirmTask(file, root, dir, original, 1), confirmTask(file, root, dir, original, 1)]);
    expect(results.sort()).toEqual(["conflict", "ok"]);
    expect(await readFile(file, "utf8")).toBe("- [x] once\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
