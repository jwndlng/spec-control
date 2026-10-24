// Which cached pull request belongs to a change (openspec/specs/pull-requests: "A pull request is linked to a change
// by its head branch"). Derived on display, never stored: the card, the detail header and the tests share this one rule
// so they can never disagree. Pure and total — whatever an older cache wrote, it answers or returns undefined.
import { sessionBranch } from "./sessionBranch.ts";
import type { ChangeSnapshot, PullRequest, RepoPullRequests } from "./types.ts";

/** When a pull request last moved: merged or closed if it has, else opened; 0 when no date can be read. */
function lastMoved(pr: Partial<PullRequest>): number {
  for (const at of [pr.mergedAt, pr.closedAt, pr.createdAt]) {
    if (typeof at !== "string") continue;
    const t = Date.parse(at);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/** Open (drafts included) before anything else, then the most recently merged, closed or opened, then the higher number. */
function better(a: PullRequest, b: PullRequest): PullRequest {
  const openA = a.state === "open";
  const openB = b.state === "open";
  if (openA !== openB) return openA ? a : b;
  const byTime = lastMoved(a) - lastMoved(b);
  if (byTime !== 0) return byTime > 0 ? a : b;
  return (Number(a.number) || 0) >= (Number(b.number) || 0) ? a : b;
}

/** A recorded branch as the link reads it: a non-empty string, whatever an older cache holds. */
const branchOrNone = (branch: unknown): string[] => (typeof branch === "string" && branch !== "" ? [branch] : []);

/** The head branches the agent recorded for the change: its implementation branch, then its archive branch. */
export function recordedBranches(change: Pick<ChangeSnapshot, "recorded">): string[] {
  const recorded = change.recorded && typeof change.recorded === "object" ? change.recorded : undefined;
  return [...new Set([...branchOrNone(recorded?.branch), ...branchOrNone(recorded?.archiveBranch)])];
}

/**
 * A change's candidate head branches: its recorded branches, its `branchMatch`, then the branches the dashboard's own
 * sessions create for it.
 */
export function candidateBranches(change: Pick<ChangeSnapshot, "name" | "branchMatch" | "recorded">): string[] {
  const names = typeof change.name === "string" && change.name !== "" ? [sessionBranch("implement", change.name), sessionBranch("archive", change.name)] : [];
  return [...new Set([...recordedBranches(change), ...branchOrNone(change.branchMatch), ...names])];
}

const DAY = 86_400_000;

/**
 * A merged or closed pull request that settled more than a day before the change was created belongs to an earlier
 * change of the same name. The day of slack covers `created` being a date without a time zone.
 */
function settledBeforeCreated(pr: PullRequest, created: string | undefined): boolean {
  if (pr.state === "open" || typeof created !== "string") return false;
  const createdAt = Date.parse(created);
  if (Number.isNaN(createdAt)) return false;
  const settled = Date.parse(String(pr.mergedAt ?? pr.closedAt ?? ""));
  return !Number.isNaN(settled) && settled < createdAt - DAY;
}

/** The best of the change's own repository's cached pull requests whose head branch is exactly one of `branches`. */
function bestOn(branches: ReadonlySet<string>, change: Pick<ChangeSnapshot, "repoId" | "created">, lists: readonly RepoPullRequests[]): PullRequest | undefined {
  let best: PullRequest | undefined;
  for (const list of lists) {
    if (!list || list.repoId !== change.repoId || list.status === "unavailable" || !Array.isArray(list.pullRequests)) continue;
    for (const pr of list.pullRequests) {
      if (!pr || typeof pr !== "object" || typeof pr.head !== "string" || !branches.has(pr.head)) continue;
      if (settledBeforeCreated(pr, change.created)) continue;
      best = best ? better(best, pr) : pr;
    }
  }
  return best;
}

/**
 * The change's pull request: one of its own repository's cached pull requests whose head branch is exactly one of the
 * branches the agent recorded for it, else exactly one of its `candidateBranches`, compared as written. The record wins
 * over every guess. No containment, no normalisation, nothing read from a title — showing someone else's pull request
 * is worse than showing none. A repository whose pull requests are unavailable links nothing.
 */
export function linkedPullRequest(
  change: Pick<ChangeSnapshot, "repoId" | "name" | "branchMatch" | "created" | "recorded">,
  lists: readonly RepoPullRequests[] | undefined,
): PullRequest | undefined {
  if (!Array.isArray(lists)) return undefined;
  const recorded = new Set(recordedBranches(change));
  const fromRecord = recorded.size ? bestOn(recorded, change, lists) : undefined;
  if (fromRecord) return fromRecord;
  const candidates = new Set(candidateBranches(change));
  return candidates.size ? bestOn(candidates, change, lists) : undefined;
}
