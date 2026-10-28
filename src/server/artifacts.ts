// Artifact files of one change, for the detail view: which files exist, and the bounded, validated read of one of
// them. A request only ever contributes a change name and a relative path; the directory comes from `listChanges()`.
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type { ArtifactFileContent, ChangeArtifactEntry, ChangeArtifactFile, ChangeArtifacts } from "../shared/types.ts";
import type { SpecFramework } from "./frameworks/framework.ts";
import { openSpec } from "./frameworks/openspec/index.ts";
import { CHANGE_NAME, type ChangeDirEntry, MAX_REPO_FILE_BYTES, type RepoSource } from "./source.ts";

export const MAX_ARTIFACT_BYTES = MAX_REPO_FILE_BYTES;

export type ChangeDirResult = { ok: true; entry: ChangeDirEntry } | { ok: false; reason: "invalid-name" | "unknown-change" };

/** Active changes win over archived ones of the same name; among archives the most recent. */
export async function changeDirFor(source: RepoSource, changeName: string, framework: SpecFramework = openSpec): Promise<ChangeDirResult> {
  if (!CHANGE_NAME.test(changeName)) return { ok: false, reason: "invalid-name" };
  const { active, archived } = await framework.listChanges(source);
  const entry = active.find((c) => c.name === changeName) ?? archived.find((c) => c.name === changeName);
  return entry ? { ok: true, entry } : { ok: false, reason: "unknown-change" };
}

function inside(dir: string, candidate: string): boolean {
  return candidate.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

export async function listArtifactFiles(source: RepoSource, repoId: string, entry: ChangeDirEntry, framework: SpecFramework = openSpec): Promise<ChangeArtifacts> {
  const change = { repoId, name: entry.name, dir: entry.dir, archived: Boolean(entry.archived) };
  // A change that could not be read (an unknown schema) has no artifacts: the snapshot already carries the warning.
  const info = await framework.readChangeOutputs(source, await framework.readProject(source), entry);

  // Glob outputs come back with symbolic links resolved (on macOS a temp dir is one), so paths are made relative
  // between real paths; that also leaves out a link that points out of the change directory.
  const realDir = (await source.readFileInfo(entry.dir))?.realPath ?? entry.dir;
  const artifacts: ChangeArtifactEntry[] = [];
  for (const artifact of info.artifacts) {
    const files: ChangeArtifactFile[] = [];
    for (const abs of info.outputs[artifact.id] ?? []) {
      const file = await source.readFileInfo(abs);
      if (!file?.isFile || !inside(realDir, file.realPath)) continue;
      files.push({ path: relative(realDir, file.realPath).split(sep).join("/"), bytes: file.size });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    artifacts.push({ ...artifact, files });
  }
  return { change: { ...change, schema: info.schema }, artifacts };
}

export type ArtifactFileResult =
  | { ok: true; file: ArtifactFileContent }
  | { ok: false; reason: "bad-path" | "not-found" | "too-large"; message: string };

/** design.md D2: string checks first, then the bounded read: containment of the real path, a regular file, the size cap. */
export async function readArtifactFile(source: RepoSource, changeDir: string, path: string | null | undefined): Promise<ArtifactFileResult> {
  if (!path) return { ok: false, reason: "bad-path", message: "path is required" };
  if (path.includes("\0") || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith("\\")) return { ok: false, reason: "bad-path", message: "path must be relative to the change directory" };
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.startsWith("../")) return { ok: false, reason: "bad-path", message: "path escapes the change directory" };
  const candidate = join(changeDir, normalized);
  if (!inside(changeDir, candidate)) return { ok: false, reason: "bad-path", message: "path escapes the change directory" };

  // The bounded read compares real paths (the change directory may sit behind a link: a worktree, /tmp on macOS) and
  // refuses a pipe, device or anything else that is not a regular file before reading it.
  const read = await source.readBounded(candidate, { within: changeDir, maxBytes: MAX_ARTIFACT_BYTES });
  if (!read.ok && read.reason === "too-large") return { ok: false, reason: "too-large", message: `file is larger than ${MAX_ARTIFACT_BYTES} bytes` };
  if (!read.ok) return { ok: false, reason: "not-found", message: "no such file in this change" };
  return { ok: true, file: { path: normalized.split(sep).join("/"), bytes: read.bytes, text: read.text } };
}
