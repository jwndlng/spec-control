// Atomically records branch metadata in a change's .openspec.yaml inside a managed session worktree
// (agent-interoperability design D1; dashboard-api exception 10).
import { randomUUID } from "node:crypto";
import { chmod, lstat, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { openSpec } from "./openspec/index.ts";
import { type RecordedBranchKey, setRecordedBranchInMarker } from "./openspec/marker.ts";

export interface RecordBranchResult {
  updated: boolean;
  relPath: string;
  absPath: string;
}

export interface RecordBranchOptions {
  archiveDirName?: string;
}

/**
 * Verifies with `lstat` that every path segment from `root` down to `relPath` is a real directory
 * (and the final segment is a real regular file), and none is a symbolic link.
 * Returns the file mode of the target file.
 */
export async function assertNoSymlinks(root: string, relPath: string): Promise<number> {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  for (let i = 1; i <= segments.length; i++) {
    const sub = segments.slice(0, i).join("/");
    const abs = join(root, sub);
    const info = await lstat(abs).catch(() => undefined);
    if (!info) {
      throw new Error(`path does not exist: ${sub}`);
    }
    if (info.isSymbolicLink()) {
      throw new Error(`symbolic link not allowed: ${sub}`);
    }
    if (i < segments.length) {
      if (!info.isDirectory()) {
        throw new Error(`expected directory but found file: ${sub}`);
      }
    } else {
      if (!info.isFile()) {
        throw new Error(`expected regular file: ${sub}`);
      }
      return info.mode & 0o777;
    }
  }
  throw new Error(`invalid path: ${relPath}`);
}

/**
 * Verifies with `lstat` that `root/relPath` and every ancestor segment exists and is not a symbolic link,
 * and recursively verifies that no file or subdirectory within `root/relPath` is a symbolic link.
 */
export async function assertDirectoryNoSymlinks(root: string, relPath: string): Promise<void> {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  for (let i = 1; i <= segments.length; i++) {
    const sub = segments.slice(0, i).join("/");
    const abs = join(root, sub);
    const info = await lstat(abs).catch(() => undefined);
    if (!info) throw new Error(`path does not exist: ${sub}`);
    if (info.isSymbolicLink()) throw new Error(`symbolic link not allowed: ${sub}`);
    if (!info.isDirectory()) throw new Error(`expected directory: ${sub}`);
  }
  const full = join(root, relPath);
  async function checkTree(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic link not allowed: ${join(dir, entry.name)}`);
      }
      if (entry.isDirectory()) {
        await checkTree(join(dir, entry.name));
      }
    }
  }
  await checkTree(full);
}

/**
 * Finds the change's metadata file in a worktree, checking active first and then archived copies
 * (or archived first if `preferArchived` is true).
 */
export async function findChangeMetadataRelPath(
  worktreePath: string,
  changeName: string,
  archiveDirName?: string,
  preferArchived = false
): Promise<string | undefined> {
  const paths = openSpec.changeMetadataPaths(changeName, archiveDirName);
  if (paths.archived) {
    const absArchived = join(worktreePath, paths.archived);
    const exists = await lstat(absArchived).then(() => true, () => false);
    if (exists) return paths.archived;
  }

  const findInArchive = async () => {
    const archiveBase = join(worktreePath, openSpec.layout.archiveDir ?? "openspec/changes/archive");
    const archiveEntries = await readdir(archiveBase).catch(() => [] as string[]);
    for (const entry of archiveEntries) {
      if (entry.endsWith(`-${changeName}`)) {
        const candidate = `${openSpec.layout.archiveDir}/${entry}/.openspec.yaml`;
        const candidateExists = await lstat(join(worktreePath, candidate)).then((i) => i.isFile(), () => false);
        if (candidateExists) return candidate;
      }
    }
    return undefined;
  };

  if (preferArchived) {
    const candidate = await findInArchive();
    if (candidate) return candidate;
  }

  const absActive = join(worktreePath, paths.active);
  const activeExists = await lstat(absActive).then(() => true, () => false);
  if (activeExists) return paths.active;

  if (!preferArchived) {
    const candidate = await findInArchive();
    if (candidate) return candidate;
  }

  return undefined;
}

/**
 * Atomically records `branch` or `archive-branch` in `.openspec.yaml` inside `worktreePath`.
 * Verifies that no segment is a symbolic link and uses a temporary sibling file with atomic rename.
 */
export async function recordBranchInWorktree(
  worktreePath: string,
  changeName: string,
  key: RecordedBranchKey,
  branch: string,
  options: RecordBranchOptions = {}
): Promise<RecordBranchResult> {
  const relPath = await findChangeMetadataRelPath(
    worktreePath,
    changeName,
    options.archiveDirName,
    key === "archive-branch"
  );
  if (!relPath) {
    throw new Error(`could not find metadata file for change "${changeName}" in worktree`);
  }

  const mode = await assertNoSymlinks(worktreePath, relPath);
  const absPath = join(worktreePath, relPath);
  const text = await readFile(absPath, "utf8");
  const updatedText = setRecordedBranchInMarker(text, key, branch);

  if (updatedText === text) {
    return { updated: false, relPath, absPath };
  }

  const tmp = join(dirname(absPath), `.${basename(absPath)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    await writeFile(tmp, updatedText, { encoding: "utf8", flag: "wx", mode });
    created = true;
    await chmod(tmp, mode);
    await rename(tmp, absPath);
    return { updated: true, relPath, absPath };
  } catch (err) {
    if (created) {
      await unlink(tmp).catch(() => undefined);
    }
    throw err;
  }
}
