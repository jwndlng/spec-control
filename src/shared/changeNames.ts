import { CHANGE_NAME_PATTERN } from "./types.ts";

/** The longest name the dashboard creates: keeps worktree paths and `feat/<name>` well inside file-system limits. */
export const MAX_NEW_CHANGE_NAME = 128;

const isArchiveRoot = (name: string) => name.toLowerCase() === "archive";

/**
 * A name that may name an existing change directory the dashboard acts on (dismissal, stale cleanup, pull leftovers):
 * the scanner's pattern, never `.` or `..`, and never the archive root `archive` in any letter case — on a
 * case-insensitive file system `Archive` is the same directory.
 */
export function isChangeDirName(name: unknown): name is string {
  return typeof name === "string" && CHANGE_NAME_PATTERN.test(name) && name !== "." && name !== ".." && !isArchiveRoot(name);
}

/**
 * Why the dashboard will not create a change of this name, or null when it may. Stricter than `isChangeDirName`:
 * a new name must also work as `feat/<name>` for git and as an argument typed into an agent's command.
 */
export function newChangeNameProblem(name: string): string | null {
  if (name === "") return "required";
  if (!CHANGE_NAME_PATTERN.test(name)) return "only letters, digits, dots, dashes and underscores";
  if (isArchiveRoot(name)) return "archive is reserved for archived changes";
  if (name.startsWith(".") || name.startsWith("-")) return "must not start with . or -";
  if (name.includes("..")) return "must not contain ..";
  if (name.endsWith(".lock")) return "must not end in .lock";
  if (name.endsWith(".")) return "must not end in .";
  if (name.length > MAX_NEW_CHANGE_NAME) return `at most ${MAX_NEW_CHANGE_NAME} characters`;
  return null;
}

/** A name the dashboard may create a change under: `newChangeNameProblem` finds nothing wrong with it. */
export function isNewChangeName(name: unknown): name is string {
  return typeof name === "string" && newChangeNameProblem(name) === null;
}
