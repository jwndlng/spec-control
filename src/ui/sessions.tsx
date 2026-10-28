// Agent sessions in the UI: a provider that polls the session list while the feature is on, and the controls a
// card shows (starter buttons, or a badge that opens the session panel).
import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";
import { changeSessions, isConsole, isIntegration, isProjectConsole, type AgentAvailability, type ChangeSession, type ChangeSnapshot, type Config, type ConsoleSession, type IntegrationSession, type ProjectConsoleSession, type PullRequest, type SessionAction, type SessionWorktree, type Snapshot, type EditorAvailability } from "../shared/types.ts";
import { api } from "./api.ts";
import { FastForwardDialog, type FastForwardChoice } from "./fastForwardDialog.tsx";
import { cdCommand, relTime } from "./format.ts";
import { assignRepoHues, repoTint } from "./repoGroups.ts";
import { type NextStep, type PullRequestStep, waitingLabel } from "../shared/nextStep.ts";
import { isProposalPullRequest } from "../shared/pullRequestLink.ts";
import { ActionMenu, type ActionItem, type ActionStatus } from "./actionMenu.tsx";
import { afterStart, agentForRepo, type AutoMergeReport, cardSessionControls, conflictBadge, editorControl, type EditorControl, openWork, pullRequestSession, type SessionBadge, nextStepFor, sessionBadge, sessionsEnabledFor, startersFor, starterSplit, startShowsConsole, type StarterPlace, workBadge, worktreeForChange } from "./sessionState.ts";
import { boardFrom, changePath, CONSOLE_TAB, parseDetailQuery, routeFromPath, serializeDetailQuery } from "./routes.ts";
import { currentPath, currentQuery, followInApp, hrefWithQuery, navigate } from "./url.ts";

const POLL_MS = 3000;

interface SessionUi {
  config: Config | null;
  snapshot: Snapshot | null;
  /** Sessions of changes: everything about repositories, cards and Open work reads these and only these. */
  sessions: ChangeSession[];
  /** Main console sessions, newest first; they belong to no repository and are shown only in the console overlay. */
  consoles: ConsoleSession[];
  /** Whether the main console overlay is open. Not part of the route: the console is not a place in the app. */
  consoleOpen: boolean;
  showConsole(open: boolean): void;
  /** Sessions setting a repository up for OpenSpec, newest first; they belong to no repository in the config. */
  integrations: IntegrationSession[];
  /** The integration session whose overlay is open, if any. Like the console, not part of the route. */
  integrationId?: string;
  showIntegration(id: string | undefined): void;
  /** Project console sessions, newest first; each belongs to one project and is shown only in its console overlay. */
  projectConsoles: ProjectConsoleSession[];
  /** The project whose console overlay is open, if any. Like the main console, not part of the route. */
  projectConsoleRepoId?: string;
  showProjectConsole(repoId: string | undefined): void;
  agents: AgentAvailability[];
  /** Every session worktree with what became of its work; outlives session records. */
  worktrees: SessionWorktree[];
  /** The editor command in effect and whether it was found, for Open in editor; absent until the list was read. */
  editor?: EditorAvailability;
  /** The session the end-session dialog is open for. */
  endingId?: string;
  /** Bumped whenever the terminal should take the keyboard (after something was typed into it for the user). */
  focusTick: { id?: string; tick: number };
  /** The session whose last text sent on the user's behalf was typed but not submitted; its panel says so. */
  unsentId?: string;
  reportUnsent(id: string | undefined): void;
  /** The session whose last Ship or Archive prompt carried the docs auto-merge instruction; its panel says so. */
  autoMerge?: AutoMergeReport;
  reportAutoMerge(report: AutoMergeReport | undefined): void;
  /** Opens the end-session dialog; nothing is ended before the user confirms there. */
  requestEnd(id: string | undefined): void;
  /** The polling error, if the session list could not be read. */
  error?: string;
  /** Shows a session: navigates to its change's detail view with the Console tab selected. */
  openPanel(id: string | undefined): void;
  /** Navigates to a change's Console tab, showing `sessionId` when given — also for a session not in the list yet. */
  openChangeConsole(repoId: string, change: string, sessionId?: string): void;
  /**
   * Starts a session, or sends the next step into the change's running one. Resolves with the reason when the request
   * was refused and no session exists to report it — the caller shows it where the starter was activated. `show` says
   * whether the session's console is shown afterwards; a card's starter leaves the user on the board. Fast-forward asks
   * for confirmation first unless the user switched that off; a cancelled one resolves with nothing and starts nothing.
   */
  /**
   * `carryOver`: the archive session that carries a stranded archive over; `removeDuplicate`: the archive session that
   * removes a duplicate after archive. Neither is ever typed into a running session.
   * `resolveConflicts`: Resolve conflicts, where the server decides the session and branch from its own lists.
   */
  start(repoId: string, change: string, action: SessionAction, show: boolean, options?: { carryOver?: boolean; removeDuplicate?: boolean; resolveConflicts?: boolean }): Promise<string | undefined>;
  refresh(): Promise<void>;
}

const noop = async () => undefined;
const Context = createContext<SessionUi>({ config: null, snapshot: null, sessions: [], consoles: [], consoleOpen: false, showConsole: () => {}, integrations: [], showIntegration: () => {}, projectConsoles: [], showProjectConsole: () => {}, agents: [], worktrees: [], focusTick: { tick: 0 }, reportUnsent: () => {}, reportAutoMerge: () => {}, requestEnd: () => {}, openPanel: () => {}, openChangeConsole: () => {}, start: noop, refresh: noop });

export const useSessionUi = () => useContext(Context);

/**
 * `consoleOpen` is owned by the app shell, which also has to make the page behind the console overlay inert; it is
 * passed through here so the top-bar control and the overlay can reach it.
 */
export function SessionProvider({
  config,
  snapshot = null,
  consoleOpen = false,
  showConsole = () => {},
  integrationId,
  showIntegration = () => {},
  projectConsoleRepoId,
  showProjectConsole = () => {},
  onConfig = () => {},
  children,
}: {
  config: Config | null;
  snapshot?: Snapshot | null;
  consoleOpen?: boolean;
  showConsole?: (open: boolean) => void;
  integrationId?: string;
  showIntegration?: (id: string | undefined) => void;
  projectConsoleRepoId?: string;
  showProjectConsole?: (repoId: string | undefined) => void;
  /** Takes a configuration the server saved on the way, so the app's copy follows (the Fast-forward warning). */
  onConfig?: (config: Config) => void;
  children: ComponentChildren;
}) {
  const enabled = config?.agentSessions.enabled === true;
  const [sessions, setSessions] = useState<ChangeSession[]>([]);
  const [consoles, setConsoles] = useState<ConsoleSession[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationSession[]>([]);
  const [projectConsoles, setProjectConsoles] = useState<ProjectConsoleSession[]>([]);
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [worktrees, setWorktrees] = useState<SessionWorktree[]>([]);
  const [editor, setEditor] = useState<EditorAvailability>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const result = await api.sessions();
      setSessions(changeSessions(result.sessions));
      setConsoles(result.sessions.filter(isConsole));
      setIntegrations(result.sessions.filter(isIntegration));
      setProjectConsoles(result.sessions.filter(isProjectConsole));
      setAgents(result.agents);
      setWorktrees(result.worktrees ?? []);
      setEditor(result.editor);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  /**
   * A session belongs to one change, so showing a terminal is a navigation to that change's detail view with its
   * Console tab selected. `from` keeps the board to return to: the one on screen, or — when another change's detail
   * view is already open — whatever board that one was opened from.
   */
  const openConsole = useCallback((repoId: string, change: string, sessionId?: string) => {
    const path = currentPath();
    const view = routeFromPath(path).view;
    const from = view === "board" || view === "repo" ? boardFrom(path, currentQuery()) : parseDetailQuery(currentQuery()).from;
    navigate(changePath(repoId, change), serializeDetailQuery({ raw: false, artifact: CONSOLE_TAB, session: sessionId, from }));
  }, []);

  /** "Show this session" — every caller's way to a terminal, by id. */
  const openPanel = useCallback(
    (id: string | undefined) => {
      const session = id ? sessions.find((s) => s.id === id) : undefined;
      if (session) openConsole(session.repoId, session.change, session.id);
    },
    [sessions, openConsole],
  );

  const [endingId, requestEnd] = useState<string>();
  const [focusTick, setFocusTick] = useState<{ id?: string; tick: number }>({ tick: 0 });
  const [unsentId, reportUnsent] = useState<string>();
  const [autoMerge, reportAutoMerge] = useState<AutoMergeReport>();

  /** The Fast-forward warning on screen, and how the start waiting for it goes on. */
  const [fastForwardAsk, setFastForwardAsk] = useState<{ repoId: string; change: string; answer: (choice: FastForwardChoice | undefined) => void }>();
  const askFastForward = useCallback(
    (repoId: string, change: string) => new Promise<FastForwardChoice | undefined>((resolve) => setFastForwardAsk({ repoId, change, answer: resolve })),
    [],
  );

  const start = useCallback(
    async (repoId: string, change: string, action: SessionAction, show: boolean, options?: { carryOver?: boolean; removeDuplicate?: boolean; resolveConflicts?: boolean }) => {
      let warningNotSaved: string | undefined;
      if (action === "fastForward" && config?.agentSessions.confirmFastForward !== false) {
        const choice = await askFastForward(repoId, change);
        if (!choice) return undefined;
        if (choice.neverAgain) {
          // Saved before the start; a save that fails is reported, but what the user confirmed still starts.
          try {
            onConfig(await api.setFastForwardWarning(false));
          } catch (err) {
            warningNotSaved = `"Don't show this warning again" was not saved: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }
      try {
        const into = options?.carryOver || options?.removeDuplicate || options?.resolveConflicts ? undefined : nextStepFor(sessions, repoId, change, action).promptSessionId;
        const session = into ? await api.promptSession(into, action) : await api.openSession(repoId, change, action, options);
        reportAutoMerge((current) => afterStart(current, session.id, session.autoMerge));
        if (into) {
          // Sent under the rules for text sent on the user's behalf: say so when the agent never showed it.
          reportUnsent("submitted" in session && !session.submitted ? into : undefined);
          setFocusTick((t) => ({ id: into, tick: t.tick + 1 }));
        }
        // Awaited either way: it is what puts the session's badge in place of a card's starter.
        await refresh();
        // By id and place, not through `openPanel`: a session just started is not in this closure's list yet.
        if (show) openConsole(repoId, change, session.id);
        return warningNotSaved;
      } catch (err) {
        // A start that failed has no session and so no panel to report itself in: the reason goes back to the caller,
        // which shows it next to the starter. Not the provider's `error` — the poll clears that within seconds.
        return err instanceof Error ? err.message : String(err);
      }
    },
    [refresh, openConsole, sessions, reportUnsent, config, askFastForward, onConfig],
  );

  const shown = consoleOpen && enabled;
  const value = useMemo(
    () => ({ config, snapshot, sessions, consoles, consoleOpen: shown, showConsole, integrations, integrationId, showIntegration, projectConsoles, projectConsoleRepoId, showProjectConsole, agents, worktrees, editor, endingId, focusTick, unsentId, reportUnsent, autoMerge, reportAutoMerge, requestEnd, error, openPanel, openChangeConsole: openConsole, start, refresh }),
    [config, snapshot, sessions, consoles, shown, integrations, integrationId, showIntegration, projectConsoles, projectConsoleRepoId, showProjectConsole, agents, worktrees, editor, endingId, focusTick, unsentId, autoMerge, error, openPanel, openConsole, start, refresh],
  );
  const answerFastForward = useCallback(
    (choice: FastForwardChoice | undefined) => {
      fastForwardAsk?.answer(choice);
      setFastForwardAsk(undefined);
    },
    [fastForwardAsk],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {fastForwardAsk && (
        <FastForwardDialog
          change={fastForwardAsk.change}
          agentName={agentForRepo(config, fastForwardAsk.repoId)?.name}
          onConfirm={answerFastForward}
          onCancel={() => answerFastForward(undefined)}
        />
      )}
    </Context.Provider>
  );
}

/**
 * The one place a session badge is drawn, so cards and the panel cannot drift apart. `live` adds the motion that means
 * "an agent is working now"; the glyph is decoration, the words carry the status.
 */
export function SessionBadgeView({ badge, onClick }: { badge: SessionBadge; onClick?: () => void }) {
  const cls = `badge ${onClick ? "session-badge " : ""}${badge.tone}${badge.live ? " live" : ""}`;
  const content = (
    <>
      {badge.icon && (
        <span class="dot" aria-hidden="true">
          {badge.icon}
        </span>
      )}
      <span class="text">{badge.label}</span>
    </>
  );
  return onClick ? (
    <button type="button" class={cls} title={badge.title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span class={cls} title={badge.title}>
      {content}
    </span>
  );
}

/** What became of the work in a worktree. Opens the worktree's latest session when its record still exists. */
export function WorkBadge({ worktree }: { worktree: SessionWorktree }) {
  const ui = useSessionUi();
  const badge = workBadge(worktree, ui.sessions);
  if (!badge) return null;
  const id = worktree.sessionId;
  if (!id)
    return (
      <span class={`badge ${badge.tone}`} title={`${badge.title} · no session record is left`}>
        {badge.label}
      </span>
    );
  return (
    <button type="button" class={`badge session-badge ${badge.tone}`} title={badge.title} onClick={() => ui.openPanel(id)}>
      {badge.label}
    </button>
  );
}

function OrphanActions({ worktree }: { worktree: SessionWorktree }) {
  const ui = useSessionUi();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string>();
  const remove = async () => {
    try {
      const result = await api.removeWorktree(worktree.repoId, worktree.name);
      setNote(result.removable ? undefined : `kept: ${result.reason ?? "not safe to remove"}`);
      await ui.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
    setConfirming(false);
  };
  return (
    <>
      <button type="button" class="btn sm ghost" title={worktree.path} onClick={() => void navigator.clipboard.writeText(cdCommand(worktree.path))}>
        Copy cd
      </button>
      <OpenInEditor
        folder={worktree.path}
        open={() => api.openWorktreeEditor(worktree.repoId, worktree.name)}
        run={async (fn) => {
          try {
            setNote(undefined);
            await fn();
          } catch (err) {
            setNote(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {confirming ? (
        <button type="button" class="btn sm primary" title="Removed only if it is clean and its work is merged or exists elsewhere; the branch stays" onClick={() => void remove()}>
          Confirm remove
        </button>
      ) : (
        <button type="button" class="btn sm ghost" onClick={() => setConfirming(true)}>
          Remove…
        </button>
      )}
      {note && <span class="hint">{note}</span>}
    </>
  );
}

/**
 * **Open in editor** (editor-launch), beside Copy cd: starts the user's editor on a change session's folder. The browser
 * names the session or worktree in `open`; the folder shown here is only for the tooltip. `run` reports a refusal the
 * way the host reports its other actions. Hosts offer it only for change sessions, so consoles never get one.
 */
export function OpenInEditor({ folder, open, run }: { folder: string; open: () => Promise<unknown>; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const ui = useSessionUi();
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    setBusy(true);
    await run(open);
    setBusy(false);
  };
  return <OpenInEditorView control={editorControl(ui.editor, folder)} busy={busy} onActivate={() => void activate()} />;
}

/** The control itself, without state: a button, and when the editor is not found, a link to change it in Settings. */
export function OpenInEditorView({ control, busy = false, onActivate }: { control: EditorControl; busy?: boolean; onActivate: () => void }) {
  return (
    <>
      <button type="button" class="btn sm ghost" disabled={!control.enabled || busy} title={control.title} onClick={onActivate}>
        Open in editor
      </button>
      {control.notFound && (
        <a class="hint" href={hrefWithQuery("/settings", "?section=agents")} onClick={(e) => followInApp(e, "/settings", "?section=agents")}>
          {control.notFound} not found — change the editor
        </a>
      )}
    </>
  );
}

/**
 * Top-bar control, and the only view of agent activity that spans repositories now that each terminal lives in its
 * change's detail view. It lists the sessions running right now — including in-place ones, which have no worktree —
 * and then every worktree that still holds work with no session running, which is the only way to reach a worktree
 * whose change has left the board. Every row with a session opens that change's Console tab.
 */
export function OpenWork() {
  const ui = useSessionUi();
  const [open, setOpen] = useState(false);
  const { items, unshipped, running } = useMemo(() => openWork(ui.worktrees, ui.sessions), [ui.worktrees, ui.sessions]);
  const hues = useMemo(() => assignRepoHues((ui.snapshot?.repos ?? []).map((r) => r.id)), [ui.snapshot]);
  if (!ui.config?.agentSessions.enabled || items.length === 0) return null;
  const repoName = (id: string) => ui.config?.repos.find((r) => r.id === id)?.name ?? id;
  return (
    <div class="open-work">
      <button
        type="button"
        class={`btn sm ${unshipped > 0 ? "attention" : running > 0 ? "" : "ghost"}`}
        aria-expanded={open}
        title="Agents running right now, and work in agent worktrees that has not ended in a merged pull request"
        onClick={() => setOpen(!open)}
      >
        Open work {running + unshipped > 0 ? running + unshipped : "✓"}
      </button>
      {open && (
        <div class="open-work-list" role="dialog" aria-label="Open work">
          <div class="hint">Read from local git only — “pushed” and “merged” are as of your last fetch.</div>
          {items.map((item) => {
            const { session, worktree } = item;
            const tint = repoTint(hues, item.repoId);
            const age = session ? relTime(session.createdAt) : worktree?.lastActivityAt ? relTime(worktree.lastActivityAt) : undefined;
            return (
              <div class={`open-work-row${tint.class ? ` ${tint.class}` : ""}`} style={tint.style} key={item.key}>
                <div class="open-work-what">
                  <span class="hint repo-name">
                    {repoName(item.repoId)}
                    {session && ` · ${session.action} · ${session.agentName}`}
                  </span>
                  <strong class="mono">{item.change}</strong>
                  {(session?.inPlace ? undefined : (session?.branch ?? worktree?.branch)) && <span class="hint mono">{session?.branch ?? worktree?.branch}</span>}
                </div>
                {session?.state === "running" && <SessionBadgeView badge={sessionBadge(session)} />}
                {worktree && <WorkBadge worktree={worktree} />}
                <span class="hint">{age === undefined ? "" : session ? (age === "just now" ? "started just now" : `started ${age} ago`) : `${age} ago`}</span>
                {session ? (
                  <button
                    type="button"
                    class="btn sm"
                    title={`Opens ${item.change} in its detail view, on the Console tab`}
                    onClick={() => {
                      setOpen(false);
                      ui.openPanel(session.id);
                    }}
                  >
                    Open
                  </button>
                ) : (
                  worktree && <OrphanActions worktree={worktree} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STARTER_LABEL: Record<SessionAction, string> = { draft: "Draft artifacts", fastForward: "Fast-forward", implement: "Implement", validate: "Validate", archive: "Archive" };
const STARTER_HINT: Record<SessionAction, string> = {
  draft: "Start an agent in a terminal to write this change's missing artifacts",
  fastForward: "Fast-forward: write the artifacts, implement and open a pull request, without stopping for review",
  implement: "Start an agent in a terminal to implement this change's tasks",
  validate: "Start an agent in a terminal to walk you through this change's tasks awaiting validation",
  archive: "Start an agent in a terminal to sync the specs and archive this completed change",
};
/** Draft in `Ready` is for what implementing does not need; it says so wherever it is offered. */
const DRAFT_READY_HINT = "Start an agent in a terminal to write the artifacts not required for implementing, such as a design";
const STEP_LABEL: Record<PullRequestStep, string> = { merge: "⤵ Merge", resolveConflicts: "⚠ Resolve conflicts", fixChecks: "Fix checks" };
/** The same steps for the change's proposal pull request, which the card names as such (kanban-board). */
const PROPOSAL_STEP_LABEL: Record<PullRequestStep, string> = { merge: "⤵ Merge proposal", resolveConflicts: "⚠ Resolve proposal conflicts", fixChecks: "Fix proposal checks" };

function starterHint(action: SessionAction, stage: ChangeSnapshot["stage"]): string {
  return action === "draft" && stage === "ready" ? DRAFT_READY_HINT : STARTER_HINT[action];
}

/** What a pull-request step does where no running session can be sent a prompt: it leads to the session, or to GitHub. */
function pullRequestItem(step: PullRequestStep, pr: PullRequest, target: ChangeSession | undefined, open: (sessionId?: string) => void, proposal = false): ActionItem {
  const label = (proposal ? PROPOSAL_STEP_LABEL : STEP_LABEL)[step];
  if (step === "merge" && !target) return { key: step, label, href: pr.url, title: `#${pr.number} is ready: opens it on GitHub, in a new tab` };
  const where = target ? `the Console tab of ${target.branch}` : "the Console tab";
  const title =
    step === "merge"
      ? `#${pr.number} is ready: opens ${where}, where Merge asks the agent to merge it`
      : step === "resolveConflicts"
        ? `#${pr.number} conflicts with its base: opens ${where}, where the agent can be asked to resolve the conflicts`
        : `#${pr.number}'s checks fail: opens ${where}, where the agent can be resumed to fix them`;
  return { key: step, label, title, onActivate: () => open(target?.id) };
}

/**
 * A change's session state and its next step, in one place so the two can never disagree: the session badge (working,
 * may need you, waiting for you, failed) and the starters, as one split button (kanban-board: "A change's actions are
 * one split button"). Rendered in a card's footer, and in the Console tab. Shows nothing at all unless the feature is
 * on and the repository has not been switched off.
 *
 * While any of the change's sessions runs, the badge stands in for the starters and nothing else is offered: the badge
 * opens the terminal, which is where the next step and **End session** live. A badge that is not running is the failure
 * case, so it keeps its starters — the next attempt stays one activation away. The work status is the detail view's
 * (see `WorkStatus`), never a card's. `place` decides whether a start shows the new session (`startShowsConsole`).
 *
 * `into` is the Console tab's running session: the starters are then the prompts that reach it, sent into it, and
 * `steps` supplies what the pull request's own steps do there (Merge and Resolve conflicts are prompts into it too).
 */
export function SessionControls({
  card,
  place,
  pullRequest,
  into,
  steps,
}: {
  card: Pick<ChangeSnapshot, "repoId" | "name" | "archived" | "artifacts" | "stage" | "subState" | "blocked">;
  place: StarterPlace;
  pullRequest?: PullRequest;
  into?: ChangeSession;
  steps?: Partial<Record<PullRequestStep, ActionItem | ActionStatus>>;
}) {
  const ui = useSessionUi();
  const [starting, setStarting] = useState<SessionAction>();
  const [failure, setFailure] = useState<string>();
  if (!sessionsEnabledFor(ui.config, card.repoId)) return null;

  const controls = cardSessionControls(ui.config, ui.sessions, { ...card, pullRequest });
  const shown = into ? [] : controls.shown;
  // Sent into `into`: only what that session receives — a proposal session takes Draft alone (`nextStepFor`).
  const { main, menu } = into ? starterSplit(card, startersFor(ui.config, card).filter((a) => nextStepFor(ui.sessions, into.repoId, into.change, a).promptSessionId === into.id), pullRequest) : controls;
  const agent = agentForRepo(ui.config, card.repoId);
  const found = ui.agents.find((a) => a.id === agent?.id);
  const unavailable = !into && found && !found.available ? `${found.name} was not found on this machine — check its command in Settings` : undefined;
  const target = pullRequestSession(ui.sessions, card, pullRequest);
  const proposal = isProposalPullRequest(card, pullRequest);

  const starterItem = (action: SessionAction, isMain: boolean): ActionItem => {
    const hint = into ? `Sends the “${STARTER_LABEL[action]}” prompt to this session’s agent` : `${starterHint(action, card.stage)} (${agent?.name})`;
    const glyph = into ? "↳" : action === "fastForward" ? "⏵⏵" : "▶";
    return {
      key: action,
      label: starting === action ? "Starting…" : isMain ? `${glyph} ${STARTER_LABEL[action]}` : STARTER_LABEL[action],
      title: unavailable ?? hint,
      ariaLabel: action === "fastForward" && !into ? `${STARTER_HINT.fastForward} (${agent?.name})` : undefined,
      disabled: Boolean(unavailable),
      onActivate: async () => {
        setStarting(action);
        setFailure(undefined);
        // On a card nothing runs, so this is always an opening; in the Console tab it is sent into `into`.
        setFailure(await ui.start(card.repoId, card.name, action, startShowsConsole(place)));
        setStarting(undefined);
      },
    };
  };
  const item = (next: NextStep, isMain: boolean): ActionItem | ActionStatus | undefined => {
    if (next.kind === "start") return starterItem(next.action, isMain);
    if (next.kind === "waiting") return { status: waitingLabel(next.reason, proposal), title: "The pull request is not ready yet; every action is still in the menu" };
    if (!pullRequest) return undefined;
    if (into) return steps?.[next.step];
    return pullRequestItem(next.step, pullRequest, target, (sessionId) => ui.openChangeConsole(card.repoId, card.name, sessionId), proposal);
  };
  const mainPart = main ? item(main, true) : undefined;
  const items = menu.map((m) => item(m, false)).filter((m): m is ActionItem => m !== undefined && !("status" in m));
  return (
    <>
      {shown.map((session) => (
        <SessionBadgeView key={session.id} badge={sessionBadge(session)} onClick={() => ui.openPanel(session.id)} />
      ))}
      <ActionMenu main={mainPart} items={items} name={card.name} disabled={starting !== undefined} />
      {failure && (
        <span class="notice danger session-failure" role="status">
          {failure}
        </span>
      )}
    </>
  );
}

/**
 * "This branch no longer merges." Hook-free on purpose: it is rendered in two places and is the one piece of this
 * feature's markup worth asserting on without a renderer. Nothing when the branch merges, or could not be checked.
 */
export function ConflictBadge({ worktree }: { worktree: SessionWorktree | undefined }) {
  const badge = conflictBadge(worktree);
  if (!badge) return null;
  return (
    <span class={`badge ${badge.tone}`} title={badge.title}>
      <span aria-hidden="true">{badge.icon} </span>
      {badge.label}
    </span>
  );
}

/**
 * The work status of a change's session worktree, for the detail view's header; nothing when there is none to show.
 * A conflicting branch says so here too, but the control to do something about it stays in the panel, where the agent is.
 */
export function WorkStatus({ repoId, name }: { repoId: string; name: string }) {
  const ui = useSessionUi();
  if (!sessionsEnabledFor(ui.config, repoId)) return null;
  const worktree = worktreeForChange(ui.worktrees, repoId, name);
  if (!worktree) return null;
  return (
    <>
      <WorkBadge worktree={worktree} />
      <ConflictBadge worktree={worktree} />
    </>
  );
}
