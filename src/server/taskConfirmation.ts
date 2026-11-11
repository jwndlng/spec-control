import { chmod, lstat, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { parseTaskLine } from "../shared/taskLine.ts";

const locks = new Map<string, Promise<void>>();

/** Compares and atomically replaces task markers while preserving all other file bytes and its mode. */
async function replaceTaskMarkers(file: string, repoDir: string, changeDir: string, expected: string, transform: (lines: string[]) => string[] | undefined): Promise<"ok" | "conflict"> {
  const rel = relative(repoDir, file);
  const inChange = relative(changeDir, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || rel.includes("\0") || !inChange || inChange.startsWith(`..${sep}`) || inChange === "..") return "conflict";
  const prior = locks.get(file);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(file, current);
  if (prior) await prior;
  try {
    // Every path component from the change directory to the task file must be ordinary.
    let path = repoDir;
    for (const part of rel.split(sep)) {
      path = `${path}${sep}${part}`;
      const stat = await lstat(path).catch(() => undefined);
      if (!stat || stat.isSymbolicLink() || (path === file ? !stat.isFile() : !stat.isDirectory())) return "conflict";
    }
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let before: string;
    let mode: number;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) return "conflict";
      mode = stat.mode & 0o777;
      before = await handle.readFile("utf8");
    } finally { await handle.close(); }
    if (before !== expected) return "conflict";
    const lines = before.split(/(?<=\n)/);
    const replaced = transform(lines);
    if (!replaced) return "conflict";
    const after = replaced.join("");
    const temp = `${dirname(file)}${sep}.tasks.${crypto.randomUUID()}.tmp`;
    try {
      const out = await open(temp, "wx", mode);
      try { await out.writeFile(after, "utf8"); await chmod(temp, mode); await out.sync(); } finally { await out.close(); }
      // Recheck the exact version and path immediately before the atomic replacement.
      const check = await lstat(file).catch(() => undefined);
      if (!check || check.isSymbolicLink() || !check.isFile()) return "conflict";
      const verify = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let currentText: string;
      try { currentText = await verify.readFile("utf8"); } finally { await verify.close(); }
      if (currentText !== expected) return "conflict";
      await rename(temp, file);
      return "ok";
    } finally { await unlink(temp).catch(() => undefined); }
  } finally {
    release();
    if (locks.get(file) === current) locks.delete(file);
  }
}

/** Changes exactly one `[~]` marker after comparing the complete displayed file version. */
export function confirmTask(file: string, repoDir: string, changeDir: string, expected: string, lineNumber: number): Promise<"ok" | "conflict"> {
  return replaceTaskMarkers(file, repoDir, changeDir, expected, (lines) => {
    const line = lines[lineNumber - 1];
    const task = line === undefined ? undefined : parseTaskLine(line);
    if (!line || task?.state !== "~") return undefined;
    const box = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[[^\]]*\]/.exec(line);
    if (!box) return undefined;
    lines[lineNumber - 1] = `${line.slice(0, box[0].lastIndexOf("[") + 1)}x]${line.slice(box[0].length)}`;
    return lines;
  });
}

/** Explicit Ship-menu assertion: marks every open or awaiting task done in the exact preflight version. */
export function confirmAllTasks(file: string, repoDir: string, changeDir: string, expected: string): Promise<"ok" | "conflict"> {
  return replaceTaskMarkers(file, repoDir, changeDir, expected, (lines) => {
    let changed = false;
    for (const [index, line] of lines.entries()) {
      const task = parseTaskLine(line);
      if (!task || /^[xX]$/.test(task.state)) continue;
      const box = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[[^\]]*\]/.exec(line);
      if (!box) return undefined;
      lines[index] = `${line.slice(0, box[0].lastIndexOf("[") + 1)}x]${line.slice(box[0].length)}`;
      changed = true;
    }
    return changed ? lines : undefined;
  });
}
