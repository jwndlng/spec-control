// Which of a change's actions is its next step (openspec/specs/kanban-board: "A change's actions are one split
// button"). Derived on display, never stored or logged: the card and the Console tab share this one rule so they can
// never disagree. It only orders what is already available — the available starters and every refusal are the
// server's, decided by stage alone (`availableActions`), so a stale pull-request list can never block a start.
import { pullRequestReadiness } from "./pullRequestReadiness.ts";
import type { ChangeSnapshot, PullRequest, SessionAction } from "./types.ts";

/** What the linked open pull request asks for, beside the starters. */
export type PullRequestStep = "resolveConflicts" | "merge" | "fixChecks";

/** What the pull request waits for while there is nothing to do but wait. */
export type WaitingReason = "draft" | "checks running" | "mergeability unknown";

export type NextStep = { kind: "start"; action: SessionAction } | { kind: "pullRequest"; step: PullRequestStep } | { kind: "waiting"; reason: WaitingReason };

/** The menu's fixed order; the pull request's own action comes after these. */
export const MENU_ORDER: readonly SessionAction[] = ["draft", "fastForward", "implement", "validate", "archive"];

/** The stage's primary step, whether or not it is available. */
export function stagePrimary(change: Pick<ChangeSnapshot, "stage" | "subState">): SessionAction | undefined {
  switch (change.stage) {
    case "unknown":
    case "backlog":
    case "drafts":
      return "draft";
    case "ready":
    case "implementing":
      return "implement";
    case "done":
      return change.subState === "validate" ? "validate" : "archive";
    default:
      return undefined;
  }
}

/** A linked pull request that is open, for a change that is not archived: the only one that decides anything here. */
function openPullRequest(change: Pick<ChangeSnapshot, "archived">, pr: PullRequest | undefined): PullRequest | undefined {
  return !change.archived && pr?.state === "open" ? pr : undefined;
}

/**
 * The pull request's own action, if it has one: Resolve conflicts for a conflict, Merge when ready, and Fix checks for
 * failing checks where Implement — the way an agent gets that work before `Done` — is not available.
 */
export function pullRequestStep(change: Pick<ChangeSnapshot, "archived">, actions: readonly SessionAction[], pr: PullRequest | undefined): PullRequestStep | undefined {
  const readiness = pullRequestReadiness(openPullRequest(change, pr));
  if (!readiness) return undefined;
  if (readiness.ready) return "merge";
  if (readiness.reason === "conflicts") return "resolveConflicts";
  if (readiness.reason === "checks failing" && !actions.includes("implement")) return "fixChecks";
  return undefined;
}

/**
 * The recommended action: with a linked open pull request, what its readiness asks for — Resolve conflicts, Merge,
 * Implement (or Fix checks in `Done`) for failing checks, or waiting; otherwise the stage's primary step, falling back to
 * the first available action in menu order when that step is not available (blocked, no prompt). `undefined` when
 * nothing is available at all.
 */
export function recommendedAction(
  change: Pick<ChangeSnapshot, "stage" | "subState" | "archived">,
  actions: readonly SessionAction[],
  pr?: PullRequest,
): NextStep | undefined {
  const readiness = pullRequestReadiness(openPullRequest(change, pr));
  if (readiness) {
    const step = pullRequestStep(change, actions, pr);
    if (step) return { kind: "pullRequest", step };
    if (!readiness.ready) {
      const { reason } = readiness;
      if (reason === "checks failing") return { kind: "start", action: "implement" };
      // Draft, checks running, mergeability unknown: the honest next step is to wait; the menu still has everything.
      if (reason !== "conflicts") return { kind: "waiting", reason };
    }
  }
  const primary = stagePrimary(change);
  if (primary && actions.includes(primary)) return { kind: "start", action: primary };
  const first = MENU_ORDER.find((a) => actions.includes(a));
  return first ? { kind: "start", action: first } : undefined;
}

/** The menu: every available action but the recommended one, starters in menu order, then the pull request's action. */
export function menuActions(
  change: Pick<ChangeSnapshot, "archived">,
  actions: readonly SessionAction[],
  pr: PullRequest | undefined,
  recommended: NextStep | undefined,
): NextStep[] {
  const items: NextStep[] = MENU_ORDER.filter((a) => actions.includes(a) && !(recommended?.kind === "start" && recommended.action === a)).map((action) => ({ kind: "start", action }));
  const step = pullRequestStep(change, actions, pr);
  if (step && !(recommended?.kind === "pullRequest" && recommended.step === step)) items.push({ kind: "pullRequest", step });
  return items;
}

/** The waiting label, in words; `proposal` when the pull request is the change's proposal pull request. */
export function waitingLabel(reason: WaitingReason, proposal = false): string {
  const of = proposal ? "proposal " : "";
  switch (reason) {
    case "draft":
      return `Waiting: draft ${of}pull request`;
    case "checks running":
      return `Waiting: ${of}checks running`;
    case "mergeability unknown":
      return `Waiting: ${of}mergeability unknown`;
  }
}
