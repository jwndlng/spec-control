// Changes imported from GitHub issues (openspec/specs/issue-import): the shape of `issue.yaml`, the link it stands
// for and the change name an issue's title suggests. Shared, so the server writes and reads exactly what the UI shows.
import { isNewChangeName } from "./changeNames.ts";
import type { SourceIssue } from "./types.ts";

/** The dashboard's own file in a change directory that records where the change came from. Not a schema artifact. */
export const ISSUE_FILE = "issue.yaml";
/** Longest issue title kept in `issue.yaml` and accepted in a create request. */
export const MAX_ISSUE_TITLE = 256;
/** Longest change name proposed from an issue title. */
export const MAX_ISSUE_NAME = 48;

/** `owner/name` exactly as GitHub allows them: never a path, a URL or anything with a meaning of its own. */
const GITHUB_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export function isGithubRepo(value: unknown): value is string {
  return typeof value === "string" && GITHUB_REPO.test(value) && !value.endsWith("/.") && !value.endsWith("/..");
}

export function isIssueNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The issue on github.com, always built from `owner/name` and the number — never a URL read from a file or a request. */
export function issueUrl(issue: Pick<SourceIssue, "github" | "number">): string {
  return `https://github.com/${issue.github}/issues/${issue.number}`;
}

/** `owner/name#42`, the way GitHub itself writes a cross-repository reference. */
export function issueRef(issue: Pick<SourceIssue, "github" | "number">): string {
  return `${issue.github}#${issue.number}`;
}

/** A parsed `issue.yaml`, validated; `undefined` for anything that is not a well-formed source issue. */
export function toSourceIssue(raw: unknown): SourceIssue | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { github, number, title } = raw as Record<string, unknown>;
  if (!isGithubRepo(github) || !isIssueNumber(number)) return undefined;
  const issue: SourceIssue = { github, number };
  if (typeof title === "string" && title.trim() !== "") issue.title = title.slice(0, MAX_ISSUE_TITLE);
  return issue;
}

/**
 * The change name an issue's title suggests: lower-cased, every run of characters other than `a`–`z` and `0`–`9` one
 * `-`, no `-` at either end, at most 48 characters cut at a `-` where there is one; `issue-<number>` when nothing is
 * left, and `<name>-<number>` when the name is reserved (`archive`). Always a name `isNewChangeName` accepts.
 */
export function issueChangeName(title: string, number: number): string {
  let name = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (name.length > MAX_ISSUE_NAME) {
    const cut = name.slice(0, MAX_ISSUE_NAME + 1);
    const boundary = cut.lastIndexOf("-");
    name = (boundary > 0 ? cut.slice(0, boundary) : name.slice(0, MAX_ISSUE_NAME)).replace(/-+$/, "");
  }
  if (name === "") return `issue-${number}`;
  return isNewChangeName(name) ? name : `${name}-${number}`;
}
