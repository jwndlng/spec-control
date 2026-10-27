// Pure helpers for the agent-session UI; free of DOM access at import time so they can be unit-tested.
import { menuActions, type NextStep, recommendedAction } from "../shared/nextStep.ts";
import { conflictSignal, type ConflictSignal } from "../shared/conflictSignal.ts";
import { linkedPullRequest } from "../shared/pullRequestLink.ts";
import { relTime } from "./format.ts";
import { isEndedProposalSession, isProposalSession, receivingSession } from "../shared/sessionBranch.ts";
import { mergePending, pullRequestReadiness, readinessDetail } from "../shared/pullRequestReadiness.ts";
import { availableActions, fastForwardAvailable, isChangeless, OPEN_SESSION_STATES, repoAgentEnabled, SESSION_ACTIONS, SHIPPABLE_WORK, type AgentAvailability, type AgentProfile, type AutoEnded, type ProjectConsoleLike, type ChangeSnapshot, type Config, type RepoSnapshot, type ChangeSession, changeSessions, type ConsoleSession, type PullRequest, type RepoPullRequests, type Session, type SessionAction, type SessionWorktree, type ShipResult, type WorkStatus } from "../shared/types.ts";

/** Session starters are shown when the feature is on, for every tracked repository that has not been switched off. */
export function sessionsEnabledFor(config: Config | null, repoId: string): boolean {
  if (!config?.agentSessions.enabled) return false;
  return config.repos.some((r) => r.id === repoId && repoAgentEnabled(r));
}

export function agentForRepo(config: Config | null, repoId: string): AgentProfile | undefined {
  if (!config) return undefined;
  const wanted = config.repos.find((r) => r.id === repoId)?.agent?.agentId;
  const agents = config.agentSessions.agents;
  return agents.find((a) => a.id === wanted) ?? agents.find((a) => a.id === config.agentSessions.defaultAgent);
}

/** What the change's stage allows, narrowed to what this repository's agent has an opening prompt for. */
export function startersFor(config: Config | null, card: Pick<ChangeSnapshot, "repoId" | "archived" | "artifacts" | "stage" | "subState" | "blocked">): SessionAction[] {
  const agent = agentForRepo(config, card.repoId);
  if (!agent) return [];
  return availableActions(card).filter((action) => (action === "fastForward" ? fastForwardAvailable(agent) : Boolean(agent.prompts[action])));
}

/**
 * The sessions a card shows: the running one (a change has at most one), otherwise the most recent one if it did not
 * end cleanly. A list, not a single session, because records from before the one-session-per-change rule may still
 * show two running for one change until they end.
 */
export function sessionsForChange(sessions: ChangeSession[], repoId: string, change: string): ChangeSession[] {
  const mine = sessions.filter((s) => s.repoId === repoId && s.change === change).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const running = mine.filter((s) => s.state === "running");
  if (running.length > 0) return running;
  const latest = mine[0];
  // An end the dashboard decided on (its auto-merge pull request merged) stays on the card, so the user sees what happened.
  return latest && (latest.state === "failed" || latest.autoEnded !== undefined || (latest.exitCode ?? 0) !== 0) ? [latest] : [];
}

/** Why the dashboard ended a session on its own, and what became of its worktree (auto-merge-cleanup D6). */
export function autoEndedText(ended: AutoEnded): string {
  return `Ended because #${ended.pr} merged; ${ended.removed ? "worktree removed" : `worktree kept: ${ended.reason ?? "it could not be removed"}`}`;
}

/**
 * What a card offers about its change's sessions: the sessions to show a badge for, and the starters to offer beside
 * them. While any of the change's sessions runs the badge stands in for the starters and there are none — the badge
 * opens the terminal, which is where the next step and **End session** live. A badge that is not running is the failure
 * case `sessionsForChange` keeps, so it comes with the starters and the next attempt stays one activation away.
 *
 * Pure, because this is the rule the card and the console's empty state must agree on, and a component that uses hooks
 * cannot be asserted on without a renderer.
 */
export function cardSessionControls(
  config: Config | null,
  sessions: ChangeSession[],
  card: Pick<ChangeSnapshot, "repoId" | "name" | "archived" | "artifacts" | "stage" | "subState" | "blocked"> & { pullRequest?: PullRequest },
): { shown: ChangeSession[]; starters: SessionAction[]; main?: NextStep; menu: NextStep[] } {
  if (!sessionsEnabledFor(config, card.repoId)) return { shown: [], starters: [], menu: [] };
  const shown = sessionsForChange(sessions, card.repoId, card.name);
  // A running session's badge stands in for the whole split button, pull-request steps included — a session drafting the
  // proposal on its own branch too: its next steps are in its console, which ends it first (one-console-per-change D1).
  if (shown.some((s) => s.state === "running")) return { shown, starters: [], menu: [] };
  const starters = startersFor(config, card);
  return { shown, starters, ...starterSplit(card, starters, card.pullRequest) };
}

/**
 * The split button for a set of starters (kanban-board: "A change's actions are one split button"): the recommended
 * action and the menu of every other one. Display only — `starters` is already what the server would accept.
 */
export function starterSplit(card: Pick<ChangeSnapshot, "stage" | "subState" | "archived">, starters: readonly SessionAction[], pullRequest: PullRequest | undefined): { main?: NextStep; menu: NextStep[] } {
  const main = recommendedAction(card, starters, pullRequest);
  return { main, menu: menuActions(card, starters, pullRequest, main) };
}

/**
 * Where Merge, Resolve conflicts and Fix checks lead: the change's most recent session whose branch heads the pull
 * request. `undefined` when the dashboard has no such record — Merge is then a link to the pull request.
 */
export function pullRequestSession(sessions: ChangeSession[], card: Pick<ChangeSnapshot, "repoId" | "name">, pr: Pick<PullRequest, "head"> | undefined): ChangeSession | undefined {
  if (!pr) return undefined;
  return sessions
    .filter((s) => s.repoId === card.repoId && s.change === card.name && !s.inPlace && s.branch === pr.head)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Whether a card shows an agent at work as a whole — tinted, its name swept. Derived from the very badges the card's
 * footer draws, so the card and its `working` badge can never disagree, sessions switched off included.
 */
export function cardIsLive(
  config: Config | null,
  sessions: ChangeSession[],
  card: Pick<ChangeSnapshot, "repoId" | "name" | "archived" | "artifacts" | "stage" | "subState" | "blocked">,
  now = Date.now(),
): boolean {
  return cardSessionControls(config, sessions, card).shown.some((s) => sessionBadge(s, now).live === true);
}

/** How a card shows that its change is not finished: the working tint, and whether its name sweeps. */
export interface CardWorkingState {
  tinted: boolean;
  sweeping: boolean;
}

/**
 * A card's working state (kanban-board: "A card keeps its working state until its pull request is ready"): tinted
 * while an agent works on the change (`cardIsLive`) or while its linked pull request is open and not ready; its name
 * sweeps while the agent works or while that pull request is still being computed on GitHub (checks running,
 * mergeability unknown) — a pull request that only waits keeps the tint without motion. Display only: the starters,
 * the session badge, the column and the progress are decided elsewhere and never from this.
 */
export function cardWorkingState(
  config: Config | null,
  sessions: ChangeSession[],
  card: Pick<ChangeSnapshot, "repoId" | "name" | "archived" | "artifacts" | "stage" | "subState"> & { pullRequest?: PullRequest },
  now = Date.now(),
): CardWorkingState {
  const live = cardIsLive(config, sessions, card, now);
  const readiness = pullRequestReadiness(card.pullRequest);
  const waiting = readiness?.ready === false;
  return { tinted: live || waiting, sweeping: live || (waiting && readiness.inProgress) };
}

/** Where a starter is rendered: in a card's footer on a board, or in a change's Console tab. */
export type StarterPlace = "card" | "console";

/**
 * Whether starting a session shows its console afterwards. A card never navigates: the user starts work and stays on
 * the board, where the card's badge takes the starter's place and opens the console on demand. In the Console tab the
 * user is already looking at the console, so the started session is shown there.
 */
export function startShowsConsole(place: StarterPlace): boolean {
  return place === "console";
}

/**
 * Where a starter goes: into the change's running session (the prompt is typed there), or into a new session. One
 * change has one console, and every action the stage allows is sent to it, Archive included — except that a session
 * drafting the proposal on its own branch takes only Draft (`receivingSession`, the rule the server applies too); every
 * other action opens a new session that ends it first (`consoleSteps`). Without an action, any running session of the change.
 */
export function nextStepFor(sessions: ChangeSession[], repoId: string, change: string, action?: SessionAction): { promptSessionId?: string } {
  if (action) return { promptSessionId: receivingSession(sessions, repoId, change, action)?.id };
  return { promptSessionId: sessions.find((s) => s.repoId === repoId && s.change === change && s.state === "running")?.id };
}

/**
 * What the Console tab of a running session offers as the change's next steps (change-detail: "The console tab offers
 * the change's next step"): `into`, the starters whose prompt goes into that very session, and `endFirst`, for a session
 * drafting the proposal on its own branch, every other starter the stage allows but Fast-forward — each opens a new
 * session that ends the proposal session first (one-console-per-change D2). Undefined when the session receives nothing:
 * it has ended, or another session of the change is the one that runs.
 */
export function consoleSteps(config: Config | null, sessions: ChangeSession[], card: Pick<ChangeSnapshot, "repoId" | "archived" | "artifacts" | "stage" | "subState" | "blocked">, session: ChangeSession): { into: SessionAction[]; endFirst: SessionAction[] } | undefined {
  if (session.state !== "running") return undefined;
  const receives = (action: SessionAction) => nextStepFor(sessions, session.repoId, session.change, action).promptSessionId === session.id;
  const starters = startersFor(config, card);
  if (isProposalSession(session)) {
    if (!receives("draft")) return undefined;
    return { into: starters.filter((a) => a === "draft"), endFirst: starters.filter((a) => a !== "draft" && a !== "fastForward") };
  }
  if (!SESSION_ACTIONS.some(receives)) return undefined;
  return { into: starters.filter(receives), endFirst: [] };
}

/**
 * What ending the proposal session to start the next step has to ask first: nothing while its worktree loses nothing
 * by it — the worktree and branch are kept either way — and one confirmation while the proposal is not pushed yet, since
 * no agent will open or update its pull request then (one-console-per-change D2).
 */
export function endProposalConfirmation(worktree: Pick<SessionWorktree, "work"> | undefined): string | undefined {
  const state = worktree?.work.state;
  if (state !== "uncommitted" && state !== "unpushed") return undefined;
  const what = state === "uncommitted" ? "has uncommitted files" : "has commits that are not pushed";
  return `The proposal is not pushed yet: its worktree ${what}. Ending its session means no agent will open or update the proposal's pull request. The worktree and its branch are kept.`;
}

/** When a session was last doing something: what it printed, else what happened to the record. */
const activityAt = (s: Session) => s.lastOutputAt ?? s.updatedAt ?? s.createdAt;

/**
 * Every session of one change, most recently active first: what the detail view's Console tab lists. Ended sessions
 * stay listed — their output is still readable and their worktree may still hold work.
 */
export function consoleSessions(sessions: ChangeSession[], repoId: string, change: string): ChangeSession[] {
  return sessions.filter((s) => s.repoId === repoId && s.change === change).sort((a, b) => activityAt(b).localeCompare(activityAt(a)));
}

/** The session the Console tab shows: the one the URL names while it is one of the change's, else the most recent. */
export function consoleSession(sessions: ChangeSession[], wanted: string | undefined): ChangeSession | undefined {
  return sessions.find((s) => s.id === wanted) ?? sessions[0];
}

/**
 * Whether a change has a console with something in it: a session record, or a worktree — which counts even without one
 * and outlives the change itself, and is why a change the snapshot no longer carries is shown rather than reported as
 * not found. Not the same question as `consoleTabAvailable`: this one has to stay narrow, or every name that is in no
 * snapshot would render an empty console frame instead of "not found".
 */
export function consoleAvailable(config: Config | null, sessions: ChangeSession[], worktrees: SessionWorktree[], repoId: string, change: string): boolean {
  if (!sessionsEnabledFor(config, repoId)) return false;
  return sessions.some((s) => s.repoId === repoId && s.change === change) || worktrees.some((w) => w.repoId === repoId && w.change === change);
}

/**
 * Whether a change gets a Console tab, and its card the console quick link: one question, asked per repository, because
 * the tab now exists before any agent has run — with nothing to show it offers the change's starters. Deliberately
 * independent of the change: the way into a terminal is in the same place on every card.
 */
export function consoleTabAvailable(config: Config | null, repoId: string): boolean {
  return sessionsEnabledFor(config, repoId);
}

export type EndSeverity = "plain" | "notice" | "danger";

/** How loudly ending a session has to be questioned: work that exists only in the worktree is the loud case. */
export function endSeverity(work: Pick<WorkStatus, "state"> | undefined): EndSeverity {
  if (work?.state === "uncommitted" || work?.state === "unpushed") return "danger";
  return work?.state === "pushed" ? "notice" : "plain";
}

export function endWarning(work: WorkStatus | undefined): string | undefined {
  const n = work?.count ?? 0;
  if (work?.state === "uncommitted") return `${n} uncommitted file${n === 1 ? "" : "s"} exist${n === 1 ? "s" : ""} only in this worktree. Nothing has been shipped.`;
  if (work?.state === "unpushed") return `${n} commit${n === 1 ? "" : "s"} exist${n === 1 ? "s" : ""} only on this machine. Nothing has been pushed.`;
  if (work?.state === "pushed") return `The work is pushed but not merged into ${work.base ?? "the default branch"} as of your last fetch.`;
  return undefined;
}

/**
 * The worktree a session's panel and dialogs speak for. An in-place session runs in the repository folder itself,
 * which is not a worktree: it has no work status, nothing to ship and nothing to remove, so it has none.
 */
export function worktreeOfSession(session: Pick<Session, "inPlace" | "worktreePath"> | undefined, worktrees: SessionWorktree[]): SessionWorktree | undefined {
  if (!session || session.inPlace) return undefined;
  return worktrees.find((w) => w.path === session.worktreePath);
}

/** Whether ending a session may offer to remove its worktree at all: an in-place session has none to remove. */
export function worktreeRemovalPossible(session: Pick<Session, "inPlace"> | undefined): boolean {
  return session !== undefined && !session.inPlace;
}

/**
 * Whether the end-session dialog's confirm button can be pressed: never while a request runs, and for a session with a
 * worktree only once its status arrived, since the warning and the removal are decided on it. An in-place session has
 * no worktree status to wait for, so it can be confirmed at once.
 */
export function endConfirmable(session: Pick<Session, "inPlace"> | undefined, status: unknown, busy: boolean): boolean {
  return !busy && (!worktreeRemovalPossible(session) || status !== undefined);
}

export interface PullOffer {
  /** Whether the end-session dialog offers to pull at all: only for a worktree session, in a repository the pull action can run in. */
  offered: boolean;
  /** Whether that offer starts ticked: whenever it is made, so a habitual confirm keeps the checkout current. */
  preselected: boolean;
}

/**
 * Ending a session usually means the work landed, so the dialog offers to bring the main checkout — what archives,
 * specs and progress are read from — up to date with it, ticked whatever the work status: the work status is only as
 * fresh as the last fetch, and the pull is fast-forward-only and never touches the session's worktree or branch.
 * Deliberately independent of whether the worktree can be removed: a worktree kept for a reason should still let the
 * checkout catch up. An in-place session gets no offer: it ran in the main checkout itself, and in a repository with
 * no commit there is no upstream to fast-forward from — decided from the session, so one that kept running after the
 * first commit keeps its in-place dialog.
 */
export function pullOffer(repo: Pick<RepoSnapshot, "isGit" | "ok"> | undefined, session: Pick<Session, "inPlace"> | undefined): PullOffer {
  const offered = repo?.isGit === true && repo.ok === true && worktreeRemovalPossible(session);
  return { offered, preselected: offered };
}

/**
 * Whether the end-session dialog's worktree removal starts ticked: whenever the server says the worktree may be
 * removed, whatever its work status. `removable` already excludes uncommitted work and commits that exist only on the
 * branch — all a removal could lose — and the branch itself is kept.
 */
export function removalPreselected(status: { removable: boolean; reason?: string; work?: Pick<WorkStatus, "state"> } | undefined): boolean {
  return status?.removable === true;
}

/** The one session a card stands for, where only one fits (see `sessionsForChange`). */
export function sessionForChange(sessions: ChangeSession[], repoId: string, change: string): ChangeSession | undefined {
  return sessionsForChange(sessions, repoId, change)[0];
}

export interface SessionBadge {
  /** Leading glyph, kept apart from the words so it can be styled (and hidden from assistive technology) on its own. */
  icon?: string;
  /** True only while the terminal is producing output: the one state that is shown with motion. */
  live?: boolean;
  label: string;
  tone: "info" | "branch" | "success" | "warning" | "danger" | "";
  title: string;
}

/** How long a running session's terminal may stay silent before the badge says the session may need the user. */
export const NEEDS_YOU_AFTER_MS = 20_000;

/** A silence as the badge states it: seconds under a minute (`45s`), whole minutes from there on (`3m`). */
export function silenceDuration(ms: number): string {
  return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m`;
}

/**
 * A terminal is a byte stream, so the dashboard cannot know that an agent works or waits for you. An agent can say so
 * itself, through its state file: a current `waiting` report is shown first, as the agent's report. Otherwise the badge
 * says whether the terminal is printing or has fallen silent — decided by the time of its last output that counts as
 * activity — and, when silent, that the session may need you. Status is always words plus colour, so the running
 * states differ in their words.
 */
export function sessionBadge(session: Session, now = Date.now()): SessionBadge {
  if (session.state === "running") {
    const reported = session.waitingReportedAt ? Date.parse(session.waitingReportedAt) : Number.NaN;
    if (!Number.isNaN(reported)) {
      const ago = silenceDuration(Math.max(0, now - reported));
      return { icon: "◆", label: `waiting for you · ${ago}`, tone: "warning", title: `${session.agentName} reported ${ago} ago that it is waiting for you` };
    }
    const last = session.lastOutputAt ? Date.parse(session.lastOutputAt) : Number.NaN;
    const silent = Number.isNaN(last) ? 0 : now - last;
    if (silent > NEEDS_YOU_AFTER_MS) {
      const duration = silenceDuration(silent);
      return { icon: "◆", label: `may need you ${duration}`, tone: "warning", title: `the terminal has printed nothing for ${duration} — ${session.agentName} may be waiting for you` };
    }
    return { icon: "●", label: "working", live: true, tone: "info", title: `the terminal of ${session.agentName} is producing output` };
  }
  if (!isChangeless(session) && session.autoEnded) {
    const ended = session.autoEnded;
    return { icon: "✓", label: `ended · #${ended.pr} merged`, tone: ended.removed ? "success" : "warning", title: autoEndedText(ended) };
  }
  if (session.state === "failed") return { icon: "⚠", label: "failed", tone: "danger", title: session.error ?? "the agent could not be started" };
  const code = session.exitCode;
  if (session.error || (code ?? 0) !== 0) return { icon: "⚠", label: `ended${code ? ` (${code})` : ""}`, tone: "danger", title: session.error ?? `the agent exited with code ${code}` };
  return { label: "ended", tone: "", title: "the agent exited" };
}

const HOUR = 3_600_000;
/** Work that is not even pushed is forgotten fastest; a pushed branch may simply wait for review. */
const STALE_AFTER_MS: Partial<Record<SessionWorktree["work"]["state"], number>> = { uncommitted: 24 * HOUR, unpushed: 24 * HOUR, pushed: 7 * 24 * HOUR };

/** Unshipped work nobody is working on: past its age limit and without a running session. */
export function staleAge(worktree: SessionWorktree, sessions: readonly Session[], now = Date.now()): string | undefined {
  const limit = STALE_AFTER_MS[worktree.work.state];
  const last = worktree.lastActivityAt ? Date.parse(worktree.lastActivityAt) : Number.NaN;
  if (limit === undefined || Number.isNaN(last) || now - last < limit) return undefined;
  if (sessions.some((s) => s.id === worktree.sessionId && s.state === "running")) return undefined;
  const hours = Math.floor((now - last) / HOUR);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Text plus colour, never colour alone. Nothing for `clean` and `missing`: there is nothing to say about them.
 * Everything short of merged is work in a branch, so it wears the branch role; stale overrides that with danger.
 */
export function workBadge(worktree: SessionWorktree, sessions: readonly Session[], now = Date.now()): SessionBadge | undefined {
  const { state, count = 0, base } = worktree.work;
  const stale = staleAge(worktree, sessions, now);
  const tail = stale ? ` · ${stale}` : "";
  const waiting = stale ? ` — untouched for ${stale}` : "";
  if (state === "uncommitted") return { label: `✎ ${count} uncommitted${tail}`, tone: stale ? "danger" : "branch", title: `${plural(count, "file")} in the worktree ${count === 1 ? "is" : "are"} not committed${waiting}` };
  if (state === "unpushed") return { label: `↑ ${count} not pushed${tail}`, tone: stale ? "danger" : "branch", title: `${plural(count, "commit")} exist only on this machine${waiting}` };
  if (state === "pushed") return { label: `⇡ pushed${tail}`, tone: stale ? "warning" : "branch", title: `pushed, but not in ${base ?? "the default branch"} as of your last fetch${waiting}` };
  if (state === "merged") return { label: "✓ merged", tone: "success", title: `merged into ${base ?? "the default branch"} as of your last fetch — the worktree can be removed` };
  return undefined;
}

/**
 * The conflict badge, beside the work badge rather than replacing it: "pushed" and "no longer merges" are two different
 * facts about the same branch, and the user needs both. Warning, not danger: nothing is lost, the branch needs work.
 *
 * The wording always carries the freshness caveat, because the base is whatever the user last fetched (design D4).
 */
export function conflictBadge(worktree: SessionWorktree | undefined): SessionBadge | undefined {
  const conflicts = worktree?.work.conflicts;
  if (!conflicts) return undefined;
  const count = conflicts.files.length;
  const listed = conflicts.truncated ? `${count}+ files` : plural(count, "file");
  const names = conflicts.files.join(", ");
  return {
    icon: "⚠",
    label: `conflicts with ${conflicts.base}`,
    tone: "warning",
    title: `this branch no longer merges into ${conflicts.base} as of your last fetch — ${listed}: ${names}${conflicts.truncated ? ", and more" : ""}. Pull to refresh the base.`,
  };
}

/**
 * Whether a session's panel offers Resolve conflicts: the same rule the server refuses by (`conflictSignal`), for this
 * session's worktree and the change's linked pull request — an in-place session has no branch, a session on another
 * branch than the open pull request's head is not where its conflict is, and without either signal there is nothing.
 */
export function resolvable(session: Session | undefined, worktree: SessionWorktree | undefined, pr?: PullRequest, fetchedAt?: string): boolean {
  if (!session || isChangeless(session) || session.inPlace || !worktree) return false;
  return conflictSignal([worktree], pr, fetchedAt) !== undefined && (pr?.state !== "open" || worktree.branch === pr.head);
}

/** Resolve conflicts for a change, as its detail header offers it (resolve-pr-conflicts D1, D5). */
export interface ConflictAction {
  signal: ConflictSignal<SessionWorktree>;
  /** The session the prompt goes to, running or ended; absent when a session is started on the head branch. */
  sessionId?: string;
  /** One line per signal: its source, its base and how fresh it is. */
  lines: string[];
}

/**
 * The change detail's Resolve conflicts: offered when either signal holds and the server would act on it — not for a
 * running session on another branch than the pull request's head, not where the worktree a new session would use is
 * on another branch, and not for an in-place session. Read from what the page holds; it starts nothing.
 */
export function conflictAction(
  change: Pick<ChangeSnapshot, "repoId" | "name" | "branchMatch" | "created" | "recorded">,
  worktrees: readonly SessionWorktree[],
  sessions: readonly Session[],
  response: { repos: readonly RepoPullRequests[] } | undefined,
  now = Date.now(),
): ConflictAction | undefined {
  const trees = worktrees.filter((w) => w.repoId === change.repoId && w.change === change.name);
  const list = response?.repos.find((r) => r.repoId === change.repoId);
  const pr = linkedPullRequest(change, response?.repos);
  const signal = conflictSignal(trees, pr, list?.fetchedAt);
  if (!signal) return undefined;
  const mine = changeSessions([...sessions]).filter((s) => s.repoId === change.repoId && s.change === change.name);
  if (mine.some((s) => s.inPlace)) return undefined;
  const running = mine.find((s) => OPEN_SESSION_STATES.includes(s.state));
  const head = signal.pullRequest?.head;
  if (running && head !== undefined && (worktrees.find((w) => w.path === running.worktreePath)?.branch ?? running.branch) !== head) return undefined;
  const sessionId = running?.id ?? signal.worktree?.sessionId;
  if (!sessionId) {
    if (!signal.github || head === undefined) return undefined;
    // A new session would use this worktree name; one already there on another branch is the user's to deal with.
    const name = head === `chore/archive-${change.name}` ? `archive-${change.name}` : change.name;
    if (!signal.worktree && trees.some((t) => t.name === name)) return undefined;
  }
  return { signal, ...(sessionId ? { sessionId } : {}), lines: conflictLines(signal, now) };
}

/** What each signal says (design D5): the local one as of the last fetch, GitHub's as of the last refresh. */
export function conflictLines(signal: Pick<ConflictSignal<unknown>, "local" | "github">, now = Date.now()): string[] {
  const lines: string[] = [];
  if (signal.local) lines.push(`Conflicts with ${signal.local.base} — as of your last fetch. Pull to refresh the base.`);
  if (signal.github) {
    const when = signal.github.at ? `${relTime(signal.github.at, now)} ago` : "the last pull-request refresh";
    const pending = signal.github.pushPending ? " — push pending: this worktree has commits GitHub has not seen" : "";
    lines.push(`GitHub reports conflicts with ${signal.github.base} — as of ${when}${pending}.`);
  }
  return lines;
}

/** The worktree a card stands for: the change's own one; its archive worktree only matters once that holds work. */
export function worktreeForChange(worktrees: SessionWorktree[], repoId: string, change: string): SessionWorktree | undefined {
  const mine = worktrees.filter((w) => w.repoId === repoId && w.change === change);
  return mine.find((w) => SHIPPABLE_WORK.includes(w.work.state)) ?? mine.find((w) => w.work.state === "merged");
}

/**
 * The worktree the detail header shows and copies (change-detail: "The detail header shows and copies the change's
 * worktree path"): the linked worktree the change's data comes from, else its most recently active session worktree.
 * Undefined for a change only in the main checkout with no session worktree.
 */
export function changeWorktreePath(change: Pick<ChangeSnapshot, "repoId" | "name" | "checkout">, worktrees: readonly SessionWorktree[]): string | undefined {
  if (change.checkout && !change.checkout.isMain) return change.checkout.path;
  const mine = worktrees.filter((w) => w.repoId === change.repoId && w.change === change.name);
  return mine.reduce<SessionWorktree | undefined>((latest, w) => (!latest || (w.lastActivityAt ?? "") > (latest.lastActivityAt ?? "") ? w : latest), undefined)?.path;
}

/**
 * An archived change that still has to be pushed or merged: its agent worktree holds unshipped work, or its archive is
 * only in a linked worktree that is not known to be merged. Everything else — the main checkout holds the archive, or
 * there is no git — is wrapped up. From local git only, so "merged" is as of the user's last fetch or pull.
 */
export function archivePending(card: Pick<ChangeSnapshot, "repoId" | "name" | "checkout">, worktrees: readonly SessionWorktree[]): boolean {
  const mine = worktrees.filter((w) => w.repoId === card.repoId && w.change === card.name);
  if (mine.some((w) => SHIPPABLE_WORK.includes(w.work.state))) return true;
  return card.checkout?.isMain === false && !mine.some((w) => w.work.state === "merged");
}

/**
 * Whether an agent session of this change is still running — its own session or its archive session, which runs under
 * the same change name. Only `running` counts: ending the session is what lets **Hide merged** hide the change again.
 */
export function hasRunningSession(card: Pick<ChangeSnapshot, "repoId" | "name">, sessions: readonly ChangeSession[]): boolean {
  return sessions.some((s) => s.repoId === card.repoId && s.change === card.name && s.state === "running");
}

/**
 * Whether an archived card stays in the `Archived` column: with **Hide merged** on, only a pending archive or one whose
 * change still has a running session — that card is the way back to its console. A running session does not make the
 * change pending; it only keeps it shown.
 */
export function archivedShown(card: Pick<ChangeSnapshot, "repoId" | "name" | "checkout">, hideMerged: boolean, worktrees: readonly SessionWorktree[], sessions: readonly ChangeSession[]): boolean {
  return !hideMerged || archivePending(card, worktrees) || hasRunningSession(card, sessions);
}

/** One row of the Open work list: a running session, or a worktree that still holds something. */
export interface OpenWorkItem {
  key: string;
  repoId: string;
  change: string;
  /** Absent for an in-place session, which runs in the folder itself and has no worktree. */
  worktree?: SessionWorktree;
  session?: ChangeSession;
  /** Running sessions come first, then stale work, then the rest, then merged. */
  rank: number;
}

/**
 * The Open work list — the only view of agent activity that spans repositories now that terminals live in each
 * change's detail view, so it has to carry both kinds of thing.
 *
 * Sessions first, by session and not by worktree: an in-place session (a tracked folder that is not a git repository)
 * has no worktree at all, and would otherwise be missing from the one list that is supposed to find it. Then every
 * worktree that still holds work and has no running session — including worktrees whose change is gone from the board,
 * which no card can offer.
 */
export function openWork(worktrees: SessionWorktree[], all: readonly Session[], now = Date.now()): { items: OpenWorkItem[]; unshipped: number; running: number } {
  // The main console belongs to no repository and no change: it is never open work.
  const sessions = changeSessions(all);
  const live = sessions.filter((s) => s.state === "running").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const items: OpenWorkItem[] = live.map((session) => ({
    key: session.id,
    repoId: session.repoId,
    change: session.change,
    worktree: worktreeOfSession(session, worktrees),
    session,
    rank: 0,
  }));

  const taken = new Set(items.map((i) => i.worktree?.path).filter(Boolean));
  const left = worktrees
    .filter((w) => !taken.has(w.path) && (SHIPPABLE_WORK.includes(w.work.state) || w.work.state === "merged"))
    .map<OpenWorkItem>((worktree) => ({
      key: worktree.path,
      repoId: worktree.repoId,
      change: worktree.change,
      worktree,
      session: sessions.find((s) => s.id === worktree.sessionId),
      rank: staleAge(worktree, sessions, now) ? 1 : worktree.work.state === "merged" ? 3 : 2,
    }));
  left.sort((a, b) => a.rank - b.rank || (a.worktree?.lastActivityAt ?? "").localeCompare(b.worktree?.lastActivityAt ?? ""));

  // Each row counts once: a running session is "running", never also "unshipped", so the badge matches the rows.
  return { items: [...items, ...left], unshipped: left.filter((i) => i.worktree?.work.state !== "merged").length, running: items.length };
}

/** One argument per line; blank lines are dropped. A command is an argument list, never a shell string. */
export function parseArgLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function slugId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The one starter prompt a newly added agent gets; the others are left for the user to write in Settings. */
export const NEW_AGENT_PROMPTS: AgentProfile["prompts"] = { implement: "Implement the OpenSpec change {change}: run `openspec instructions apply --change {change}` and follow it." };

/**
 * The profile Settings' **+ Add agent** and the setup wizard's **Add another agent** create: a name, a command and
 * {@link NEW_AGENT_PROMPTS}. The id is made from `idBase` (the name unless given) and differs from every `taken` one.
 */
export function newAgentProfile({ name, command, taken, idBase = name }: { name: string; command: string[]; taken: string[]; idBase?: string }): AgentProfile {
  return { id: slugId(idBase, taken), name, command, prompts: { ...NEW_AGENT_PROMPTS } };
}

/**
 * The main console the overlay shows: the running one (there is at most one), else the one the overlay just opened or
 * last showed, else the most recent. An ended console stays readable until the user starts a new one.
 */
export function consoleToShow(consoles: readonly ConsoleSession[], preferred?: string): ConsoleSession | undefined {
  return consoles.find((s) => s.state === "running") ?? consoles.find((s) => s.id === preferred) ?? [...consoles].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export const CONSOLE_CONTROL_NAME = "Open the agent console";

/**
 * The top-bar console control's name and state. The state is the running console's badge — the same two running states
 * as every session, decided the same way — and is part of the name, so it is never shown by colour or motion alone.
 */
export function consoleControl(consoles: readonly ConsoleSession[], now = Date.now()): { name: string; title: string; badge?: SessionBadge } {
  const running = consoles.find((s) => s.state === "running");
  if (!running) return { name: CONSOLE_CONTROL_NAME, title: `${CONSOLE_CONTROL_NAME}: talk to your agent about anything that is not a change` };
  const badge = sessionBadge(running, now);
  return { name: `${CONSOLE_CONTROL_NAME} — ${badge.label}`, title: `${CONSOLE_CONTROL_NAME} — ${badge.title}`, badge };
}

/**
 * Why a project's console cannot be opened, or undefined when it can. `null` when no control is shown at all: agent
 * sessions are off globally, or the project is not a managed one.
 */
export function projectConsoleUnavailable(config: Config | null, agents: readonly AgentAvailability[], repoId: string): string | null | undefined {
  if (!config?.agentSessions.enabled) return null;
  const repo = config.repos.find((r) => r.id === repoId);
  if (!repo?.enabled) return null;
  if (!repoAgentEnabled(repo)) return "agent sessions are off for this project";
  const agent = agentForRepo(config, repoId);
  if (!agent) return "no agent is configured";
  if (agents.find((a) => a.id === agent.id)?.available === false) return `${agent.name} was not found (${agent.command[0]})`;
  return undefined;
}

/**
 * A project's console control: its name, tooltip and — while one of its console sessions runs — that session's badge,
 * in words as part of the name, exactly like the top-bar console control. `unavailable` makes it inactive with a reason.
 */
export function projectConsoleControl(sessions: readonly ProjectConsoleLike[], projectName: string, unavailable?: string, now = Date.now()): { name: string; title: string; badge?: SessionBadge; state?: string; disabled: boolean } {
  const name = `Open the console of ${projectName}`;
  if (unavailable) return { name: `${name} — unavailable: ${unavailable}`, title: `${name} — unavailable: ${unavailable}`, disabled: true };
  const running = sessions.find((s) => OPEN_SESSION_STATES.includes(s.state));
  if (!running) return { name, title: `${name}: your agent in this project's folder, for anything that is not a change`, disabled: false };
  const badge = sessionBadge(running, now);
  return { name: `${name} — ${badge.label}`, title: `${name} — ${badge.title}`, badge, state: badge.label, disabled: false };
}

// ---- Merge (agent-merges-docs-prs) ----

/** The open pull request whose head branch is this session's branch, in its repository's list. */
export function sessionPullRequest(session: Pick<ChangeSession, "repoId" | "branch" | "inPlace"> | undefined, lists: readonly RepoPullRequests[] | undefined): PullRequest | undefined {
  if (!session || session.inPlace || !session.branch) return undefined;
  return lists?.find((l) => l.repoId === session.repoId)?.pullRequests.find((pr) => pr.state === "open" && pr.head === session.branch);
}

/** The Merge action of a session's panel: shown once its branch has an open pull request, enabled only when the server
 *  would accept it — the agent runs, the pull request is ready and the list names its head commit. */
export interface MergeControl {
  pr: PullRequest;
  enabled: boolean;
  title: string;
  /** The session whose Merge record counts for this pull request: the ended proposal session for a handed-over one. */
  recordedOn: ChangeSession;
}

/**
 * The ended proposal session whose pull request a running session receives (one-console-per-change D3): the session is
 * the change's only running one, has a worktree of its own, and the proposal session's worktree is still listed — the
 * same rule the server applies. Read from what the page holds.
 */
export function handedOverProposal(session: ChangeSession | undefined, sessions: readonly ChangeSession[], worktrees: readonly SessionWorktree[]): ChangeSession | undefined {
  if (session?.state !== "running" || session.inPlace || session.adopted || isProposalSession(session)) return undefined;
  const mine = sessions.filter((s) => s.repoId === session.repoId && s.change === session.change).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const running = mine.filter((s) => s.state === "running");
  if (running.length !== 1 || running[0].id !== session.id) return undefined;
  return mine.find((s) => isEndedProposalSession(s) && worktrees.some((w) => w.path === s.worktreePath && w.work.state !== "missing"));
}

/** `proposal`: the change's ended proposal session, whose pull request this session's Merge targets when its own branch has none. */
export function mergeControl(session: ChangeSession | undefined, lists: readonly RepoPullRequests[] | undefined, proposal?: ChangeSession): MergeControl | undefined {
  const own = sessionPullRequest(session, lists);
  const handed = own ? undefined : sessionPullRequest(proposal, lists);
  const pr = own ?? handed;
  if (!session || !pr) return undefined;
  const recordedOn = handed && proposal ? proposal : session;
  const readiness = pullRequestReadiness(pr);
  if (!readiness?.ready) return { pr, recordedOn, enabled: false, title: `${readiness ? readinessDetail(readiness) : "Not ready"}, so #${pr.number} cannot be merged yet.` };
  if (!pr.headOid) return { pr, recordedOn, enabled: false, title: `The pull-request list names no head commit for #${pr.number} yet; refresh it first.` };
  if (session.state !== "running") return { pr, recordedOn, enabled: false, title: RESUME_TO_MERGE };
  const which = handed ? `the proposal's pull request #${pr.number} (from ${pr.head})` : `#${pr.number}`;
  return { pr, recordedOn, enabled: true, title: `Sends ${session.agentName} a prompt asking it to merge ${which}, only if its head is still ${shortCommit(pr.headOid)}. The dashboard merges nothing itself.` };
}

/** What the panel says next to a ready pull request whose agent has ended: nothing is merged automatically then. */
export const RESUME_TO_MERGE = "Resume the session to merge.";

const shortCommit = (head: string) => head.slice(0, 7);

/** What the panel says while a Merge prompt for the pull request's current head commit is pending (design D7). */
export function mergeNotice(session: Pick<ChangeSession, "mergeAsked"> | undefined, pr: PullRequest | undefined): { text: string; title?: string; tone: "warn" | "info" } | undefined {
  const asked = session?.mergeAsked;
  if (!asked || !mergePending(pr, asked)) return undefined;
  if (!asked.submitted) return { text: `The Merge prompt for #${asked.pr} was typed but not sent. Press Enter in the terminal to send it.`, tone: "warn" };
  return { text: `Asked the agent to merge #${asked.pr} at ${shortCommit(asked.head)}.`, title: asked.head, tone: "info" };
}

/** What a card's pull request says while one of its change's sessions was asked to merge it at its current head. */
export function cardMergePending(sessions: readonly Session[], card: Pick<ChangeSnapshot, "repoId" | "name">, pr: PullRequest | undefined): string | undefined {
  const asked = changeSessions(sessions).find((s) => s.repoId === card.repoId && s.change === card.name && s.mergeAsked && mergePending(pr, s.mergeAsked))?.mergeAsked;
  return asked ? `asked the agent to merge #${asked.pr}` : undefined;
}

/** Which session's panel says that its last prompt carried an auto-merge instruction, and which action's prompt it was. */
export type AutoMergeReport = { id: string; action: "ship" | "archive" };

/** Said in the panel when Ship's prompt (auto-merge-docs) or an Archive prompt (archive-auto-merge-docs) carried the
 *  auto-merge instruction. Archive's is conditional, like the instruction: the Archive prompt may open no pull request. */
export function autoMergeNotice(action: AutoMergeReport["action"]): string {
  return action === "ship"
    ? "Only OpenSpec documents changed, so the pull request will be handed back to the agent to merge once its checks pass. The dashboard itself merges nothing."
    : "Only OpenSpec documents are in this worktree, so if the agent opens a pull request it will be handed back to the agent to merge once its checks pass. The dashboard itself merges nothing.";
}

/** What both Ship controls report afterwards: a prompt typed but not sent, and whether auto-merge was asked for. */
export function reportShip(ui: { reportUnsent(id: string | undefined): void; reportAutoMerge(report: AutoMergeReport | undefined): void }, sessionId: string, result: Pick<ShipResult, "submitted" | "autoMerge">): void {
  ui.reportUnsent(result.submitted ? undefined : sessionId);
  ui.reportAutoMerge(result.autoMerge ? { id: sessionId, action: "ship" } : undefined);
}

/** The auto-merge notice after a starter was started or sent: Archive's when its prompt carried the instruction, else
 *  that session's notice goes and another session's stays. */
export function afterStart(current: AutoMergeReport | undefined, sessionId: string, autoMerge: boolean): AutoMergeReport | undefined {
  if (autoMerge) return { id: sessionId, action: "archive" };
  return current?.id === sessionId ? undefined : current;
}
