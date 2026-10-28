// The bounded read every repository file goes through, and the segment check of writes and deletes
// (contain-repository-reads design D1, D6). Links, pipes and device links are made here, never committed as fixtures.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedReadWarning, linkedSegment, readBounded } from "../src/server/source.ts";
import { tempDir } from "./helpers.ts";

let root: string;
let dir: string;
let outside: string;
beforeAll(async () => {
  root = await tempDir("osd-source-");
  dir = join(root, "repo", "openspec", "changes", "lint-rules");
  outside = join(root, "elsewhere");
  await mkdir(dir, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(dir, "tasks.md"), "- [ ] 1.1 Do it\n");
  await mkdir(join(dir, "notes"));
  await writeFile(join(dir, "notes", "tasks.md"), "- [x] 1.1 Done\n");
  await symlink(join(dir, "notes", "tasks.md"), join(dir, "linked-tasks.md"));
  await writeFile(join(outside, "hosts"), "127.0.0.1 secret-host\n");
  await symlink(join(outside, "hosts"), join(dir, "prompt.md"));
  await symlink("/dev/zero", join(dir, ".openspec.yaml"));
  expect(Bun.spawnSync(["mkfifo", join(dir, "pipe.md")]).exitCode).toBe(0);
  await writeFile(join(dir, "big.md"), "y".repeat(5000));
  await writeFile(join(dir, "accent.md"), "é".repeat(10));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const opts = (maxBytes = 4096) => ({ within: dir, maxBytes });

test("an ordinary file is read whole", async () => {
  expect(await readBounded(join(dir, "tasks.md"), opts())).toEqual({ ok: true, text: "- [ ] 1.1 Do it\n", bytes: 16, truncated: false });
});

test("a link to another file of the same directory is followed", async () => {
  const read = await readBounded(join(dir, "linked-tasks.md"), opts());
  expect(read.ok && read.text).toBe("- [x] 1.1 Done\n");
});

test("a link to /dev/zero is refused before a byte is read", async () => {
  // Outside the directory first; inside a checkout that held /dev itself it would still not be a regular file.
  expect(await readBounded(join(dir, ".openspec.yaml"), opts())).toEqual({ ok: false, reason: "outside" });
  expect(await readBounded("/dev/zero", { within: "/dev", maxBytes: 16 })).toEqual({ ok: false, reason: "not-a-file" });
});

test("a named pipe nobody writes to is refused at once", async () => {
  const started = Date.now();
  expect(await readBounded(join(dir, "pipe.md"), opts())).toEqual({ ok: false, reason: "not-a-file" });
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a link out of the directory is refused, and so is a path that climbs out and does not exist", async () => {
  expect(await readBounded(join(dir, "prompt.md"), opts())).toEqual({ ok: false, reason: "outside" });
  expect(await readBounded(join(dir, "..", "..", "..", "..", "outside.md"), opts())).toEqual({ ok: false, reason: "outside" });
  expect(await readBounded(join(dir, "missing.md"), opts())).toEqual({ ok: false, reason: "missing" });
});

test("a file over the cap is refused, or read only up to it when truncation is asked for", async () => {
  expect(await readBounded(join(dir, "big.md"), opts(1000))).toEqual({ ok: false, reason: "too-large" });
  const cut = await readBounded(join(dir, "big.md"), { ...opts(1000), truncate: true });
  expect(cut).toEqual({ ok: true, text: "y".repeat(1000), bytes: 5000, truncated: true });
  // A cut through a two-byte character does not leave half of it behind.
  const accent = await readBounded(join(dir, "accent.md"), { ...opts(5), truncate: true });
  expect(accent.ok && accent.text).toBe("éé");
});

test("in place: only a regular file directly in the directory counts, never a link", async () => {
  expect(await readBounded(join(dir, "prompt.md"), { ...opts(), inPlace: true })).toEqual({ ok: false, reason: "not-a-file" });
  expect(await readBounded(join(dir, "linked-tasks.md"), { ...opts(), inPlace: true })).toEqual({ ok: false, reason: "not-a-file" });
  expect(await readBounded(join(dir, "notes", "tasks.md"), { ...opts(), inPlace: true })).toEqual({ ok: false, reason: "outside" });
  expect(await readBounded(join(dir, "pipe.md"), { ...opts(), inPlace: true })).toEqual({ ok: false, reason: "not-a-file" });
  const read = await readBounded(join(dir, "tasks.md"), { ...opts(), inPlace: true });
  expect(read.ok).toBe(true);
});

test("no descriptor stays open after refused reads", async () => {
  const fds = async () => (await readdir("/dev/fd")).length;
  const before = await fds();
  for (let i = 0; i < 50; i++) {
    await readBounded(join(dir, "pipe.md"), opts());
    await readBounded(join(dir, "big.md"), opts(10));
  }
  expect(await fds()).toBeLessThanOrEqual(before + 2);
});

test("warnings name the file and the reason, and say nothing for a missing file", () => {
  expect(boundedReadWarning("tasks.md", { ok: false, reason: "not-a-file" }, 10)).toBe("tasks.md is not a regular file and was not read");
  expect(boundedReadWarning("config.yaml", { ok: false, reason: "too-large" }, 1048576)).toBe("config.yaml is larger than 1048576 bytes and was not read");
  expect(boundedReadWarning("tasks.md", { ok: false, reason: "missing" }, 10)).toBeUndefined();
});

test("linkedSegment names the first segment that is not a real directory", async () => {
  const repo = join(root, "linked");
  await mkdir(join(repo, "openspec"), { recursive: true });
  await symlink(outside, join(repo, "openspec", "changes"));
  expect(await linkedSegment(repo, "openspec")).toBeUndefined();
  expect(await linkedSegment(repo, "openspec/changes/x")).toEqual({ segment: "openspec/changes", reason: "symbolic link" });
  expect(await linkedSegment(join(root, "repo"), "openspec/changes/lint-rules")).toBeUndefined();
  expect(await linkedSegment(join(root, "repo"), "openspec/changes/nope")).toEqual({ segment: "openspec/changes/nope", reason: "missing" });
  expect(await linkedSegment(join(root, "repo"), "openspec/changes/lint-rules/tasks.md")).toEqual({ segment: "openspec/changes/lint-rules/tasks.md", reason: "not a directory" });
});
