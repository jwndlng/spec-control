// The Import from issues dialog's logic, free of the DOM so it can be tested (openspec/specs/issue-import): which issues
// a filter shows, which are already imported, the name each checked issue proposes and why one is refused, the prompt
// it becomes, and the one-at-a-time creates that import them.
import { issueRef, issueUrl } from "../shared/issues.ts";
import { newChangeNameProblem } from "../shared/changeNames.ts";
import type { ChangeIssueRef, ChangeSnapshot, GithubIssue } from "../shared/types.ts";
import { api, ApiError } from "./api.ts";

/** The issues whose number, title or labels contain `query`, ignoring case; all of them for an empty query. */
export function filterIssues(issues: GithubIssue[], query: string): GithubIssue[] {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return issues;
  return issues.filter((issue) => String(issue.number).includes(q) || issue.title.toLowerCase().includes(q) || issue.labels.some((l) => l.toLowerCase().includes(q)));
}

/**
 * Issue number → the change of this repository that came from it, active or archived. Derived from the snapshot each
 * time it is shown; `github` is the repository the list was fetched for, so another repository's issue `#42` never
 * counts.
 */
export function importedIssues(changes: Pick<ChangeSnapshot, "name" | "sourceIssue">[], github: string | undefined): Map<number, string> {
  const imported = new Map<number, string>();
  if (!github) return imported;
  for (const change of changes) {
    const source = change.sourceIssue;
    if (source && source.github.toLowerCase() === github.toLowerCase() && !imported.has(source.number)) imported.set(source.number, change.name);
  }
  return imported;
}

/** One checked issue and the change name it will be imported as. */
export interface ImportRow {
  issue: GithubIssue;
  name: string;
}

/**
 * Why a checked issue's name cannot be used, or null: the New change form's rule, plus a name an active or archived
 * change of the repository already uses, or one another checked issue uses. The server's `409` stays the authority.
 */
export function nameProblem(name: string, taken: ReadonlySet<string>, others: string[]): string | null {
  const trimmed = name.trim();
  const problem = newChangeNameProblem(trimmed);
  if (problem !== null) return problem;
  if (taken.has(trimmed)) return "a change of this name exists already";
  if (others.includes(trimmed)) return "another checked issue uses this name";
  return null;
}

/** Each row's problem, in row order, comparing every row with all the others. */
export function rowProblems(rows: ImportRow[], taken: ReadonlySet<string>): (string | null)[] {
  return rows.map((row, i) => nameProblem(row.name, taken, rows.filter((_, j) => j !== i).map((r) => r.name.trim())));
}

/** What goes into `prompt.md` below its `# Prompt` heading: the title, where it came from, and the body as written. */
export function issuePrompt(issue: GithubIssue, github: string): string {
  const source = { github, number: issue.number };
  const body = issue.body.trim();
  return `## ${issue.title.trim() || `Issue #${issue.number}`}\n\nImported from ${issueRef(source)} — ${issueUrl(source)}${body ? `\n\n${body}` : ""}`;
}

/** One issue's outcome: created (and whether it was staged), or refused and why. */
export type ImportResult = { number: number; name: string; ok: true; staged: boolean } | { number: number; name: string; ok: false; message: string };

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Imports each row with the create request the New change form sends plus the issue, one at a time and in order. A
 * refusal is that issue's result and never stops the rest; nothing created is undone. Once anything was created a
 * fresh scan is asked for until one starts, so the board shows every new change.
 */
export async function importIssues(
  repoId: string,
  github: string,
  rows: ImportRow[],
  onProgress: (number: number) => void = () => {},
  wait: (ms: number) => Promise<void> = pause,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const { issue, name } of rows) {
    onProgress(issue.number);
    const ref: ChangeIssueRef = { number: issue.number, ...(issue.title.trim() ? { title: issue.title.slice(0, 256) } : {}) };
    try {
      const created = await api.createChange(repoId, name.trim(), issuePrompt(issue, github), undefined, ref);
      results.push({ number: issue.number, name: name.trim(), ok: true, staged: created.staged });
    } catch (err) {
      results.push({ number: issue.number, name: name.trim(), ok: false, message: errorText(err) });
    }
  }
  if (results.some((r) => r.ok)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const { started } = await api.scan().catch(() => ({ started: true }));
      if (started) break;
      await wait(250);
    }
  }
  return results;
}
