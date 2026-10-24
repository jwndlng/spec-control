// The branch an agent session works on. The server creates it (`src/server/sessions/manager.ts`) and the UI links a
// change's pull request by it (`pullRequestLink.ts`), so both read the name from here and can never disagree.
import type { ChangeSession, SessionAction } from "./types.ts";

/**
 * Archiving gets a branch of its own, and so does a Draft session that ships its proposal (`proposal`: the repository had
 * docs auto-merge on when it started); every other action works on the change's implementation branch.
 */
export function sessionBranch(action: SessionAction, change: string, { proposal = false }: { proposal?: boolean } = {}): string {
  if (action === "archive") return `chore/archive-${change}`;
  return action === "draft" && proposal ? proposalBranch(change) : `feat/${change}`;
}

/** The branch a Draft session in a docs auto-merge project opens its proposal pull request from. */
export function proposalBranch(change: string): string {
  return `docs/${change}`;
}

/** Whether a session drafts its change's proposal on a branch of its own: decided when it started, kept as its branch. */
export function isProposalSession(session: Pick<ChangeSession, "change" | "branch">): boolean {
  return session.branch === proposalBranch(session.change);
}

/**
 * The running session an action for a change goes into, if any. A proposal session takes only Draft: implementing never
 * continues on the proposal's branch, so every other action gets a session of its own next to it. `sessions` newest first.
 */
export function receivingSession<S extends Pick<ChangeSession, "repoId" | "change" | "branch" | "state">>(sessions: readonly S[], repoId: string, change: string, action: SessionAction): S | undefined {
  const running = sessions.filter((s) => s.repoId === repoId && s.change === change && s.state === "running");
  if (action !== "draft") return running.find((s) => !isProposalSession(s));
  return running.find(isProposalSession) ?? running[0];
}
