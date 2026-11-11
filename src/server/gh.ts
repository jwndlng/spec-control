// The GitHub CLI, run the one way the dashboard runs it: shared by the pull-request query (pullRequests.ts), the
// issue query (issues.ts) and the repository listing of Add from GitHub (`listGithubRepos` below), so all three are
// provably started alike — without a shell, in the dashboard home, with prompts disabled, no stdin and a timeout. Each
// subcommand is written out in full where it is used, so the read-only `gh pr list`, `gh api user`, `gh issue list` and
// `gh repo list` remain the only ones (openspec/specs/dashboard-api).
import { mkdir } from "node:fs/promises";
import type { GithubRepoEntry, GithubRepoList, RepoPullRequests } from "../shared/types.ts";
import { normalizeRemote } from "./git.ts";
import { dashboardHome, whichOnPath } from "./paths.ts";
import { maskCredentials } from "./pull.ts";

export const GH_TIMEOUT_MS = 30_000;

export interface GhFailure {
  /** `unavailable`: cannot be queried at all. `failed`: this attempt did not work. */
  kind: "unavailable" | "failed";
  reason: string;
  /** The process timed out after a potentially successful remote mutation; callers must reconcile before claiming failure. */
  outcomeUnknown?: boolean;
  /** The machine's `gh`, not this repository: the view says it once rather than per repository. */
  setup?: RepoPullRequests["setup"];
}

// ---- remotes ----

/** `owner/name` for a github.com remote; undefined for every other host, form or failure. */
export function githubRepoFromRemote(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalized = normalizeRemote(url);
  if (!normalized?.startsWith("github.com/")) return undefined;
  const parts = normalized.slice("github.com/".length).split("/").filter(Boolean);
  // Exactly owner and name: a longer path is not a repository we can address.
  if (parts.length !== 2) return undefined;
  return `${parts[0]}/${parts[1]}`;
}

// ---- the gh process ----

export interface GhRun {
  ok: boolean;
  out: string;
  err: string;
  timedOut: boolean;
  /** `gh` is not on PATH. */
  missing: boolean;
}

/** `purpose` finishes the sentence "install gh to …": the pull-request and issue views each say what it is for. */
const notInstalled = (purpose: string): GhFailure => ({ kind: "unavailable", reason: `GitHub CLI not installed — install gh to ${purpose}`, setup: "gh-missing" });
const NOT_SIGNED_IN: GhFailure = { kind: "unavailable", reason: "gh is not signed in to github.com — run `gh auth login`", setup: "gh-signed-out" };

/** Whether `gh`'s stderr says the problem is authentication rather than this repository. */
function saysNotSignedIn(stderr: string): boolean {
  return /gh auth login|not logged in|authentication|requires authentication|bad credentials/i.test(stderr);
}

/** The line of `gh`'s stderr worth showing, masked and kept short; never a token, never a whole dump. */
export function ghReason(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const first = lines.find((l) => !/^(hint|note):/i.test(l)) ?? "gh gave no reason";
  const text = maskCredentials(first.replace(/^gh:\s*/i, ""));
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/**
 * `gh` without a shell: no stdin, no prompts, no colour, no update notifier, and a timeout after which the process is
 * killed. The working directory is the dashboard home, so `gh` never looks at — let alone runs git in — a tracked
 * repository. Credentials stay entirely with `gh`; the dashboard never sees them.
 */
export async function runGh(args: string[], timeoutMs = GH_TIMEOUT_MS): Promise<GhRun> {
  // Looked up explicitly rather than left to the spawn: with no `gh` on PATH some platforms fall back to a default
  // search path and would find another one, and the spec wants "not installed" decided before any process starts.
  if (!whichOnPath("gh")) return { ok: false, out: "", err: "gh is not on PATH", timedOut: false, missing: true };
  const cwd = dashboardHome();
  await mkdir(cwd, { recursive: true }).catch(() => undefined);
  const env = { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1" };
  let timedOut = false;
  try {
    const proc = Bun.spawn(["gh", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    try {
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { ok: code === 0 && !timedOut, out, err: err.trim(), timedOut, missing: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, out: "", err: text, timedOut, missing: /ENOENT|not found|No such file/i.test(text) };
  }
}

/** What went wrong, in the terms the UI shows; `undefined` when nothing did. */
export function failureOf(run: GhRun, purpose = "see pull requests"): GhFailure | undefined {
  if (run.missing) return notInstalled(purpose);
  if (run.ok) return undefined;
  if (saysNotSignedIn(run.err)) return NOT_SIGNED_IN;
  if (run.timedOut) return { kind: "failed", reason: "gh timed out", outcomeUnknown: true };
  return { kind: "failed", reason: ghReason(run.err) };
}

// ---- the repository listing (openspec/specs/github-repositories) ----

/** Repositories per owner; GitHub's own order is not trusted, the list is sorted by the last push. */
export const REPO_LIST_LIMIT = 200;
const REPO_FIELDS = "nameWithOwner,description,isPrivate,isArchived,pushedAt";

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/** One entry of `gh repo list --json …`, or undefined when it names no repository. */
export function parseRepoEntry(raw: unknown, added: ReadonlySet<string>): GithubRepoEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as Record<string, unknown>;
  const repo = asText(entry.nameWithOwner);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return undefined;
  return {
    repo,
    description: asText(entry.description),
    private: entry.isPrivate === true,
    archived: entry.isArchived === true,
    pushedAt: asText(entry.pushedAt),
    added: added.has(repo.toLowerCase()),
  };
}

/**
 * One owner's repositories through the read-only `gh repo list`, for the user who opened Add from GitHub, changed its
 * owner or pressed Refresh — never on a timer. Without `owner`, `gh api user` names the signed-in account first.
 * `owner` must already be validated (`isGithubOwner`); it is passed as one argument. `added` holds the lower-cased
 * `owner/name` of every tracked repository's `origin`. Writes nothing and keeps nothing.
 */
export async function listGithubRepos(owner: string | undefined, added: ReadonlySet<string>, timeoutMs = GH_TIMEOUT_MS): Promise<GithubRepoList> {
  const purpose = "list your GitHub repositories";
  let login = owner;
  if (!login) {
    const user = await runGh(["api", "user", "--jq", ".login"], timeoutMs);
    const failure = failureOf(user, purpose);
    if (failure) return { status: failure.kind, reason: failure.reason, setup: failure.setup, repos: [] };
    login = user.out.trim();
    if (!login) return { status: "failed", reason: "gh did not name the signed-in account", repos: [] };
  }
  const run = await runGh(["repo", "list", login, "--limit", String(REPO_LIST_LIMIT), "--json", REPO_FIELDS], timeoutMs);
  const failure = failureOf(run, purpose);
  if (failure) return { status: failure.kind, owner: login, reason: failure.reason, setup: failure.setup, repos: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(run.out || "[]");
  } catch {
    return { status: "failed", owner: login, reason: "gh returned output that is not JSON", repos: [] };
  }
  if (!Array.isArray(raw)) return { status: "failed", owner: login, reason: "gh returned output that is not a list", repos: [] };
  const repos = raw
    .map((entry) => parseRepoEntry(entry, added))
    .filter((entry): entry is GithubRepoEntry => entry !== undefined)
    // Newest push first; the name breaks ties.
    .sort((a, b) => (Date.parse(b.pushedAt) || 0) - (Date.parse(a.pushedAt) || 0) || a.repo.localeCompare(b.repo));
  return { status: "ok", owner: login, truncated: raw.length >= REPO_LIST_LIMIT, repos };
}

// ---- pull request mutations (pull-requests: "Pull requests are created and merged through the GitHub CLI") ----

export interface CreatePullRequestInput {
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface CreatePullRequestResult {
  ok: boolean;
  url?: string;
  failure?: GhFailure;
}

export interface MergePullRequestResult {
  ok: boolean;
  failure?: GhFailure;
}

/**
 * Creates a pull request via `gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>`.
 * Runs in the dashboard home directory without a shell, with prompts disabled.
 */
export async function createPullRequest(
  repo: string,
  input: CreatePullRequestInput,
  timeoutMs = GH_TIMEOUT_MS
): Promise<CreatePullRequestResult> {
  const purpose = "create a pull request";
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, failure: { kind: "failed", reason: `invalid repository name: ${repo}` } };
  }
  if (!input.head || !input.base || !input.title) {
    return { ok: false, failure: { kind: "failed", reason: "head, base and title are required" } };
  }

  const args = [
    "pr",
    "create",
    "--repo",
    repo,
    "--head",
    input.head,
    "--base",
    input.base,
    "--title",
    input.title,
    "--body",
    input.body ?? "",
  ];

  const run = await runGh(args, timeoutMs);
  const failure = failureOf(run, purpose);
  if (failure) return { ok: false, failure };
  return { ok: true, url: run.out.trim() };
}

/**
 * Merges a pull request via `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>`.
 * Never passes `--delete-branch` or `--auto`.
 * Runs in the dashboard home directory without a shell, with prompts disabled.
 */
export async function mergePullRequest(
  repo: string,
  number: number,
  headOid: string,
  timeoutMs = GH_TIMEOUT_MS
): Promise<MergePullRequestResult> {
  const purpose = "merge a pull request";
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, failure: { kind: "failed", reason: `invalid repository name: ${repo}` } };
  }
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, failure: { kind: "failed", reason: `invalid pull request number: ${number}` } };
  }
  if (!/^[0-9a-f]{40}$/i.test(headOid)) {
    return { ok: false, failure: { kind: "failed", reason: `invalid head commit: ${headOid}` } };
  }

  const args = [
    "pr",
    "merge",
    String(number),
    "--repo",
    repo,
    "--squash",
    "--match-head-commit",
    headOid,
  ];

  const run = await runGh(args, timeoutMs);
  const failure = failureOf(run, purpose);
  if (failure) return { ok: false, failure };
  return { ok: true };
}

