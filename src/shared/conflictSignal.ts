// Whether a change's work conflicts with its base, and from whose point of view (resolve-pr-conflicts D1). Two signals,
// one rule: the local one is git's `merge-tree` in a session worktree as of the user's last fetch, the GitHub one is the
// linked open pull request's mergeability as of the last pull-request refresh. The change detail, the session panel and
// the server's refusals all ask this function, so the button and the refusal never disagree. Pure: no git, no `gh`.
import type { PullRequest, SessionWorktree, WorkConflicts } from "./types.ts";

export interface GithubConflict {
  number: number;
  head: string;
  base: string;
  /** When the repository's pull-request list was last fetched; absent when it never was. */
  at?: string;
  /** The worktree on the head branch is at another commit than GitHub's head: a local fix may not be pushed yet. */
  pushPending?: true;
}

export interface ConflictSignal<W> {
  local?: WorkConflicts;
  github?: GithubConflict;
  /** The worktree the action runs in; absent when none exists yet and a session would be started on the head branch. */
  worktree?: W;
  /** The open pull request the action is about, when one is linked. */
  pullRequest?: PullRequest;
}

type Tree = Pick<SessionWorktree, "branch" | "work" | "head">;

/**
 * `worktrees` are the change's session worktrees, `pr` its linked pull request (any state), `fetchedAt` when that
 * repository's list was fetched. With an open pull request only the worktree on its head branch counts — another
 * worktree's conflict is about another branch. Without one (or with a merged or closed one), the first worktree that
 * reports a conflict does. Undefined when neither signal holds.
 */
export function conflictSignal<W extends Tree>(worktrees: readonly W[], pr: PullRequest | undefined, fetchedAt?: string): ConflictSignal<W> | undefined {
  const open = pr?.state === "open" && typeof pr.head === "string" && pr.head !== "" ? pr : undefined;
  const worktree = open ? worktrees.find((w) => w.branch === open.head) : worktrees.find((w) => w.work.conflicts !== undefined);
  const local = worktree?.work.conflicts;
  const github: GithubConflict | undefined =
    open && open.mergeable === "conflicting"
      ? {
          number: open.number,
          head: open.head,
          base: open.base,
          ...(fetchedAt ? { at: fetchedAt } : {}),
          ...(worktree?.head && open.headOid && worktree.head !== open.headOid ? { pushPending: true as const } : {}),
        }
      : undefined;
  if (!local && !github) return undefined;
  return { ...(local ? { local } : {}), ...(github ? { github } : {}), ...(worktree ? { worktree } : {}), ...(open ? { pullRequest: open } : {}) };
}
