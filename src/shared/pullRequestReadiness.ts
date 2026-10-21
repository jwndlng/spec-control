// Whether a change's open pull request is ready (openspec/specs/pull-requests: "A linked open pull request has a
// readiness"): every check green and no conflict with its base. Derived on display, never stored or logged; the card,
// the detail header and the board's watch share this one rule so they can never disagree. Pure and total — whatever an
// older cache wrote, it answers or returns undefined.
import type { MergeAsked, PullRequest } from "./types.ts";

export type NotReadyReason = "draft" | "conflicts" | "checks failing" | "checks running" | "mergeability unknown";

/**
 * `inProgress`: something on GitHub is still being computed (checks running, mergeability unknown), so the answer may
 * change on its own soon. Otherwise the pull request is only waiting — on a person or on a new push.
 */
export type Readiness = { ready: true } | { ready: false; reason: NotReadyReason; inProgress: boolean };

/**
 * The readiness of an open pull request (drafts included); undefined for a merged or closed one, or an entry that is
 * not a pull request at all. The reasons are checked in order, so "needs a human" (draft, conflict, failure) outranks
 * "still computing". The review decision does not enter into it.
 */
export function pullRequestReadiness(pr: Partial<PullRequest> | undefined): Readiness | undefined {
  if (!pr || typeof pr !== "object" || pr.state !== "open") return undefined;
  if (pr.draft === true) return { ready: false, reason: "draft", inProgress: false };
  const mergeable = pr.mergeable === "mergeable" || pr.mergeable === "conflicting" ? pr.mergeable : "unknown";
  if (mergeable === "conflicting") return { ready: false, reason: "conflicts", inProgress: false };
  if (pr.checks === "failing") return { ready: false, reason: "checks failing", inProgress: false };
  // Anything but a known green summary keeps it running: drift in an older cache must never look ready.
  if (pr.checks !== "passing" && pr.checks !== "none") return { ready: false, reason: "checks running", inProgress: true };
  if (mergeable === "unknown") return { ready: false, reason: "mergeability unknown", inProgress: true };
  return { ready: true };
}

/** An open pull request that is not ready: what keeps a card in its working state and what the board watches. */
export function isNotReady(pr: Partial<PullRequest> | undefined): boolean {
  return pullRequestReadiness(pr)?.ready === false;
}

/**
 * A Merge prompt was sent for this pull request at its current head commit, and it has not merged or closed since
 * (agent-merges-docs-prs D5): what keeps the board's watch going and what the panel and the card say. A new head, a
 * merge or a close ends it by itself — nothing has to be cleared.
 */
export function mergePending(pr: Partial<PullRequest> | undefined, asked: Pick<MergeAsked, "pr" | "head"> | undefined): boolean {
  return pr?.state === "open" && asked !== undefined && pr.number === asked.pr && typeof pr.headOid === "string" && pr.headOid === asked.head;
}

/**
 * The pull request's side of the automatic Merge rule ("A ready docs-only pull request is handed to its agent to
 * merge"): open, not a draft, mergeable, checks passing — `none` never counts, since checks that have not registered
 * yet look the same — docs-only and with a head commit. The base branch, the session and the worktree are checked
 * where those are known.
 */
export function mergeReady(pr: Partial<PullRequest> | undefined): boolean {
  return pr?.state === "open" && pr.draft !== true && pr.mergeable === "mergeable" && pr.checks === "passing" && pr.docsOnly === true && typeof pr.headOid === "string" && pr.headOid !== "";
}

/** The status role a readiness wears, on the card and in the header alike. Never `info`: that is a running agent's. */
export function readinessRole(readiness: Readiness): "success" | "danger" | "warning" | "branch" {
  if (readiness.ready) return "success";
  if (readiness.reason === "checks failing") return "danger";
  if (readiness.reason === "conflicts") return "warning";
  return "branch";
}

/** The readiness in words, as the card and the header say it. */
export function readinessWord(readiness: Readiness): "ready" | NotReadyReason {
  return readiness.ready ? "ready" : readiness.reason;
}

/** What the pull request waits for, in a sentence for a tooltip. */
export function readinessDetail(readiness: Readiness): string {
  if (readiness.ready) return "Ready: all checks pass and it merges cleanly";
  switch (readiness.reason) {
    case "draft":
      return "Not ready: it is a draft";
    case "conflicts":
      return "Not ready: it conflicts with its base branch";
    case "checks failing":
      return "Not ready: at least one check failed";
    case "checks running":
      return "Not ready: checks are still running";
    case "mergeability unknown":
      return "Not ready: GitHub has not yet worked out whether it merges cleanly";
  }
}
