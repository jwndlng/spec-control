import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { ISSUE_FILE, isIssueNumber, MAX_ISSUE_TITLE } from "../shared/issues.ts";
import type { SourceIssue } from "../shared/types.ts";
import type { SpecFramework } from "./frameworks/framework.ts";
import { openSpec } from "./frameworks/openspec/index.ts";
import { writablePaths } from "./frameworks/registry.ts";
import { githubRepoFromRemote } from "./gh.ts";
import { originUrl } from "./git.ts";
import { gitWrite } from "./gitWrite.ts";
import { CHANGE_NAME, LocalRepoSource } from "./source.ts";

export type CreateChangeResult =
  | { ok: true; name: string; dir: string; wrotePrompt: boolean; staged: boolean }
  | { ok: false; reason: "invalid-name" | "invalid-prompt" | "invalid-dependencies" | "invalid-issue" | "not-writable" | "not-on-github" | "no-openspec-dir" | "duplicate-active" | "duplicate-archived"; message: string };

const ARCHIVE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
const GIT_TIMEOUT_MS = 10_000;
/** More than a handful of dependencies is not an order any more; the cap keeps the file and the form honest. */
export const MAX_DEPENDENCIES = 32;
const DEPENDS_ON_HEADER = "# Changes that must be implemented and merged before this one is implemented (spec-control).\n";

const ISSUE_HEADER = "# The GitHub issue this change was imported from (spec-control).\n";

/** The validated `issue` of a create request, or the reason it is refused. Absent and `null` mean none. */
export function validateIssue(issue: unknown): { ok: true; issue?: { number: number; title?: string } } | { ok: false; message: string } {
  if (issue === undefined || issue === null) return { ok: true };
  if (typeof issue !== "object" || Array.isArray(issue)) return { ok: false, message: "issue must be an object with a number" };
  const { number, title } = issue as Record<string, unknown>;
  if (!isIssueNumber(number)) return { ok: false, message: "issue.number must be a positive integer" };
  if (title !== undefined && title !== null && (typeof title !== "string" || title.length > MAX_ISSUE_TITLE)) {
    return { ok: false, message: `issue.title must be a string of at most ${MAX_ISSUE_TITLE} characters` };
  }
  return { ok: true, issue: typeof title === "string" && title.trim() !== "" ? { number, title } : { number } };
}

/** The validated `dependsOn` of a create request, or the reason it is refused. Absent and `null` mean none. */
export function validateDependsOn(name: string, dependsOn: unknown): { ok: true; names: string[] } | { ok: false; message: string } {
  if (dependsOn === undefined || dependsOn === null) return { ok: true, names: [] };
  if (!Array.isArray(dependsOn) || dependsOn.length > MAX_DEPENDENCIES) return { ok: false, message: `dependsOn must be a list of at most ${MAX_DEPENDENCIES} change names` };
  for (const dep of dependsOn) {
    if (typeof dep !== "string" || !CHANGE_NAME.test(dep)) return { ok: false, message: "every dependency must be a valid change name" };
    if (dep === name) return { ok: false, message: "a change cannot depend on itself" };
  }
  if (new Set(dependsOn).size !== dependsOn.length) return { ok: false, message: "a dependency is listed twice" };
  return { ok: true, names: dependsOn as string[] };
}

/**
 * Stages the new change directory — and only it — so git tracks the change from the moment it exists. The path
 * goes after `--` and is the directory, not `.` or `-A`: whatever else the user has modified or left untracked stays
 * out of the index. Best-effort: `false` means the change is on disk but untracked.
 */
export async function stageChangeDir(repoPath: string, name: string, timeoutMs = GIT_TIMEOUT_MS, framework: SpecFramework = openSpec): Promise<boolean> {
  const layout = writablePaths(framework);
  if (!layout || !CHANGE_NAME.test(name)) return false;
  // The one writing git command creating a change runs: no hooks, no prompt, no stdin (`gitWrite`). A missing git, a
  // non-zero exit or a timeout all resolve to `false` — never a throw, because by now the change exists on disk.
  return (await gitWrite(repoPath, ["add", "--", `${layout.changesDir}/${name}/`], { timeoutMs })).ok;
}

/** Today in the server's local time zone as `YYYY-MM-DD`; matches what `openspec new change` records. */
function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function archivedNames(repoPath: string, archiveDir: string | undefined): Promise<Set<string>> {
  if (archiveDir === undefined) return new Set();
  try {
    const entries = await readdir(join(repoPath, archiveDir), { withFileTypes: true });
    const names = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = ARCHIVE_PREFIX.exec(entry.name);
      names.add(match ? match[2] : entry.name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Creates `<changesDir>/<name>/` in the repository (`openspec/changes/<name>/`; the only framework whose write paths
 * are enumerated), atomically (exclusive-create so two callers cannot both succeed), and writes the framework's
 * scaffold — `.openspec.yaml` — (and `prompt.md` when a non-whitespace prompt is given, `depends-on.yaml` when
 * dependencies are given, and `issue.yaml` when the change is imported from a GitHub issue — all validated before
 * anything is created). The issue's repository is the one the repository's own `origin` names, read with the
 * read-only `git config --get`; it is never taken from the request.
 *
 * Writes only inside that new directory and never invokes the `openspec` CLI. A failed write after `mkdir` removes
 * the just-created directory so a half-empty change never remains. Once both writes have succeeded, and only then,
 * the directory is staged with one `git add` (see `stageChangeDir`); a refused create runs no git at all.
 */
export async function createChange(repoPath: string, name: string, prompt?: string, dependsOn?: unknown, issue?: unknown, framework: SpecFramework = openSpec): Promise<CreateChangeResult> {
  if (typeof name !== "string" || !CHANGE_NAME.test(name)) {
    return { ok: false, reason: "invalid-name", message: "change name must match ^[A-Za-z0-9._-]+$" };
  }
  if (prompt !== undefined && prompt !== null && typeof prompt !== "string") {
    return { ok: false, reason: "invalid-prompt", message: "prompt must be a string" };
  }
  const deps = validateDependsOn(name, dependsOn);
  if (!deps.ok) return { ok: false, reason: "invalid-dependencies", message: deps.message };
  const imported = validateIssue(issue);
  if (!imported.ok) return { ok: false, reason: "invalid-issue", message: imported.message };
  const layout = writablePaths(framework);
  if (!layout) {
    return { ok: false, reason: "not-writable", message: `the dashboard does not create ${framework.label} changes` };
  }
  if (!(await isDirectory(join(repoPath, layout.changesDir)))) {
    return { ok: false, reason: "no-openspec-dir", message: `repository has no ${layout.changesDir} directory` };
  }
  if (await archivedNames(repoPath, layout.archiveDir).then((names) => names.has(name))) {
    return { ok: false, reason: "duplicate-archived", message: `a change named "${name}" is already archived` };
  }

  let source: SourceIssue | undefined;
  if (imported.issue) {
    const github = githubRepoFromRemote(await originUrl(repoPath));
    if (!github) return { ok: false, reason: "not-on-github", message: "the repository's origin is not on GitHub, so it has no issues to import from" };
    source = { github, ...imported.issue };
  }

  const dir = join(repoPath, layout.changesDir, name);
  try {
    await mkdir(dir, { recursive: false });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, reason: "duplicate-active", message: `a change named "${name}" already exists` };
    throw err;
  }

  let wrotePrompt = false;
  try {
    const project = await framework.readProject(new LocalRepoSource(repoPath));
    for (const [file, content] of Object.entries(framework.scaffold({ project, today: today() }))) await writeFile(join(dir, file), content, "utf8");
    const trimmed = typeof prompt === "string" ? prompt.trim() : "";
    if (trimmed) {
      await writeFile(join(dir, "prompt.md"), `# Prompt\n\n${trimmed}\n`, "utf8");
      wrotePrompt = true;
    }
    if (deps.names.length) {
      await writeFile(join(dir, "depends-on.yaml"), DEPENDS_ON_HEADER + stringifyYaml({ depends_on: deps.names }), { encoding: "utf8", flag: "wx" });
    }
    if (source) {
      await writeFile(join(dir, ISSUE_FILE), ISSUE_HEADER + stringifyYaml(source), { encoding: "utf8", flag: "wx" });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  // The files exist and are the user's now: whatever git does, the create has succeeded.
  const staged = await stageChangeDir(repoPath, name, GIT_TIMEOUT_MS, framework);
  return { ok: true, name, dir, wrotePrompt, staged };
}
