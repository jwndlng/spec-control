// The console: the agent's own terminal, streamed from the dashboard server, shown in the Console tab of its change's
// detail view. The dashboard adds nothing to what the agent shows and interprets none of it; keystrokes go straight to
// the agent, exactly as in a terminal window.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "preact/hooks";
import { SHIPPABLE_WORK, type ChangeSnapshot, type ChangeSession, type Session, type SessionAction, type SessionWorktree, type Shortcut } from "../shared/types.ts";
import type { PullRequestStep } from "../shared/nextStep.ts";
import { linkedPullRequest } from "../shared/pullRequestLink.ts";
import { api, type TerminalMessage } from "./api.ts";
import { cdCommand } from "./format.ts";
import { inPlaceReason } from "./inPlaceText.ts";
import { NOT_SUBMITTED_NOTICE, shortcutHint, shortcutMessage, visibleShortcuts } from "./quickReplies.ts";
import { usePullRequests } from "./pullRequests.tsx";
import { autoEndedText, autoMergeNotice, conflictAction, consoleSteps, handedOverProposal, mergeControl, mergeNotice, reportShip, RESUME_TO_MERGE, resolvable, sessionBadge, sessionsEnabledFor, starterSplit, workBadge, worktreeOfSession } from "./sessionState.ts";
import { ConflictBadge, SessionBadgeView, SessionControls, useSessionUi } from "./sessions.tsx";

export function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="btn sm ghost"
      title={text}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Terminal colours follow the dashboard theme by reading its tokens. */
function terminalTheme(el: HTMLElement) {
  const css = getComputedStyle(el);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: token("--bg-base", "#26272b"),
    foreground: token("--fg-heading", "#f6f6f7"),
    cursor: token("--brand", "#6366f1"),
    selectionBackground: token("--bg-elevated", "#4b4c51"),
  };
}

/** A sent shortcut stays inert until the server answers; this only covers an answer that never comes. */
const SUBMIT_GUARD_MS = 10_000;
/** How long the "typed but not sent" notice stays before it dismisses itself. */
const UNSENT_NOTICE_MS = 12_000;

/**
 * One session's terminal plus the configured shortcuts. Used by a change's Console tab and by the main console; it knows
 * nothing about repositories or changes, which is why every session is offered the same shortcuts.
 */
export function TerminalView({ sessionId, running, onExit }: { sessionId: string; running: boolean; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  // The effect below owns the terminal and its socket; the shortcuts reach them through this ref.
  const live = useRef<{ send: (message: TerminalMessage) => void; focus: () => void }>();
  // The ref is the guard (it holds within one tick, where state would still be stale); the state only greys the button.
  const guard = useRef(new Set<string>());
  const [guarded, setGuarded] = useState<readonly string[]>([]);

  // A shortcut goes to the server as `submit`: its prompt is typed, and sent with Enter only once the agent has shown
  // it. The server answers this socket with `submitted`; until then the activated shortcut stays inert.
  const pending = useRef<string[]>([]);
  // Text went into this terminal on the user's behalf (a next step): put the keyboard back where the agent is.
  const { config, focusTick, unsentId, reportUnsent, autoMerge, reportAutoMerge } = useSessionUi();
  // The shortcuts are the user's, the same for every session; an empty list means the row is not shown at all.
  const shortcuts = visibleShortcuts(config, running, status === "open");
  useEffect(() => {
    if (focusTick.tick > 0 && focusTick.id === sessionId) live.current?.focus();
  }, [focusTick, sessionId]);

  const release = (id: string) => {
    guard.current.delete(id);
    setGuarded([...guard.current]);
  };
  const sendShortcut = (shortcut: Shortcut) => {
    if (guard.current.has(shortcut.id)) return;
    guard.current.add(shortcut.id);
    setGuarded([...guard.current]);
    if (unsentId === sessionId) reportUnsent(undefined); // another pane's notice is not this pane's to clear
    live.current?.send(shortcutMessage(shortcut));
    live.current?.focus();
    pending.current.push(shortcut.id);
    setTimeout(() => {
      pending.current = pending.current.filter((id) => id !== shortcut.id);
      release(shortcut.id);
    }, SUBMIT_GUARD_MS);
  };
  // Answers arrive in the order the submissions were made (the server runs them one after another).
  const onSubmitted = useRef<(ok: boolean) => void>(() => {});
  onSubmitted.current = (ok) => {
    const id = pending.current.shift();
    if (id) release(id);
    if (!ok) reportUnsent(sessionId);
  };

  useEffect(() => {
    if (unsentId !== sessionId) return;
    const timer = setTimeout(() => reportUnsent(undefined), UNSENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [unsentId, sessionId, reportUnsent]);
  useEffect(() => {
    if (autoMerge?.id !== sessionId) return;
    const timer = setTimeout(() => reportAutoMerge(undefined), UNSENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [autoMerge, sessionId, reportAutoMerge]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 10_000,
      theme: terminalTheme(el),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    // The stream comes from the API layer: a WebSocket in the product, a scripted recording in the demo.
    const connection = api.openTerminal(sessionId, {
      onOpen: () => {
        setStatus("open");
        sendSize();
        // One terminal per view, and the user selected the Console tab to get here: give it the keyboard.
        term.focus();
      },
      onData: (bytes) => term.write(bytes),
      onExit,
      onSubmitted: (ok) => onSubmitted.current(ok),
      onClose: () => setStatus("closed"),
    });
    const send = (message: TerminalMessage) => connection.send(message);
    function sendSize() {
      send({ type: "resize", cols: term.cols, rows: term.rows });
    }
    live.current = { send, focus: () => term.focus() };

    const input = term.onData((data) => send({ type: "input", data }));
    const resized = term.onResize(sendSize);
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(el);

    return () => {
      live.current = undefined;
      observer.disconnect();
      input.dispose();
      resized.dispose();
      connection.close();
      term.dispose();
    };
  }, [sessionId, onExit]);

  return (
    <div class="session-terminal">
      <div class="session-terminal-area">
        <div ref={host} class="session-terminal-host" />
        {status !== "open" && <div class="session-terminal-note">{status === "connecting" ? "connecting to the terminal…" : "terminal disconnected"}</div>}
      </div>
      {unsentId === sessionId && (
        <div class="session-unsent notice warn" role="status">
          <span>{NOT_SUBMITTED_NOTICE}</span>
          <button type="button" class="btn sm ghost" aria-label="Dismiss" onClick={() => reportUnsent(undefined)}>
            ×
          </button>
        </div>
      )}
      {autoMerge?.id === sessionId && (
        <div class="session-unsent notice" role="status">
          <span>{autoMergeNotice(autoMerge.action)}</span>
          <button type="button" class="btn sm ghost" aria-label="Dismiss" onClick={() => reportAutoMerge(undefined)}>
            ×
          </button>
        </div>
      )}
      {shortcuts.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring legend/border styling the shortcut row does not want
        <div class="session-replies" role="group" aria-labelledby={`replies-${sessionId}`}>
          <span id={`replies-${sessionId}`} class="hint session-replies-label">
            Shortcuts:
          </span>
          {shortcuts.map((shortcut) => (
            <button key={shortcut.id} type="button" class="btn sm" title={shortcutHint(shortcut)} disabled={guarded.includes(shortcut.id)} onClick={() => sendShortcut(shortcut)}>
              {shortcut.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STEP_LABEL: Record<SessionAction, string> = { draft: "Draft artifacts", fastForward: "Fast-forward", implement: "Implement", validate: "Validate", archive: "Archive" };

/**
 * The change's sessions, in the slot the delta specs use for their file list. Omitted for a single session: there is
 * nothing to choose. A change can legitimately have several records — only one of them running, the others ended,
 * their output still readable and their worktrees possibly still holding work.
 */
export function ConsoleSessionList({ sessions, selected, onSelect }: { sessions: ChangeSession[]; selected?: string; onSelect: (id: string) => void }) {
  if (sessions.length < 2) return null;
  return (
    <nav class="detail-files console-sessions" aria-label="Sessions of this change">
      {sessions.map((s) => {
        const badge = sessionBadge(s);
        return (
          <button
            key={s.id}
            type="button"
            class={`detail-file console-session ${s.id === selected ? "on" : ""}`}
            aria-current={s.id === selected ? "true" : undefined}
            title={`${STEP_LABEL[s.action]} · ${s.branch} · ${badge.title}`}
            onClick={() => onSelect(s.id)}
          >
            <span class="console-session-what">{STEP_LABEL[s.action]}</span>
            <span class="hint mono">{s.branch}</span>
            <SessionBadgeView badge={badge} />
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The console itself: one session's terminal with the facts and actions that belong to it. Shown in the Console tab of
 * the change's detail view — the only place the dashboard renders a terminal.
 *
 * A worktree without a session record still gets a panel: its path, its work status and a way to copy a `cd` for it.
 * There is nothing to attach a terminal to, and the dashboard will not start one behind the user's back.
 */
/** Bumps when an ended session runs again (Resume, Ship), so its terminal view starts fresh on the new process. */
export function useTerminalGeneration(session: Session | undefined): number {
  const [generation, setGeneration] = useState(0);
  const seen = useRef<{ id?: string; running?: boolean }>({});
  const runningNow = session?.state === "running";
  useEffect(() => {
    if (seen.current.id === session?.id && seen.current.running === false && runningNow) setGeneration((n) => n + 1);
    seen.current = { id: session?.id, running: session ? runningNow : undefined };
  }, [session?.id, runningNow, session]);
  return generation;
}

/**
 * The Console tab's body. `of` is the change the tab belongs to, which is the only thing left to go on when the change
 * has neither a session nor a worktree — the tab exists before any agent has run, and then its job is to offer the
 * starters rather than to explain itself away.
 */
export function ConsolePanel({ session, worktree, of }: { session?: ChangeSession; worktree?: SessionWorktree; of?: { repoId: string; change: string } }) {
  const ui = useSessionUi();
  const prs = usePullRequests();
  const [error, setError] = useState<string>();
  // An agent that was started again (Resume, Ship — from here or from the end-session dialog) gets a fresh terminal view.
  const generation = useTerminalGeneration(session);

  const badge = session ? sessionBadge(session) : undefined;
  const repoId = session?.repoId ?? worktree?.repoId ?? of?.repoId;
  const change = session?.change ?? worktree?.change ?? of?.change;
  const repo = ui.config?.repos.find((r) => r.id === repoId);
  // An in-place session runs in the repository folder, which is not a worktree: nothing git-derived applies to it.
  const tree = worktreeOfSession(session, ui.worktrees) ?? (session ? undefined : worktree);
  const work = tree && workBadge(tree, ui.sessions);
  const shippable = session !== undefined && tree !== undefined && SHIPPABLE_WORK.includes(tree.work.state);
  // The badge sits beside the work badge, not instead of it: "pushed" and "no longer merges" are both true.
  // The change's pull request, from the lists the page already holds: GitHub's conflict counts here too.
  const card = repoId && change ? ui.snapshot?.repos.find((r) => r.id === repoId)?.changes.find((c) => c.name === change && !c.archived) : undefined;
  const canResolve = resolvable(session, tree, card ? linkedPullRequest(card, prs.data?.repos) : undefined, prs.data?.repos.find((r) => r.repoId === repoId)?.fetchedAt);
  const merged = tree?.work.state === "merged";
  // Merge: the session's open pull request, from the lists the page already holds (agent-merges-docs-prs D7) — or the
  // proposal's, handed to the change's running session once the proposal session ended (one-console-per-change D3).
  const merge = mergeControl(session, prs.data?.repos, handedOverProposal(session, ui.sessions, ui.worktrees));
  const pendingMerge = mergeNotice(merge?.recordedOn ?? session, merge?.pr);
  // `card`, the change as the snapshot has it, is also what the next steps and the empty state's starters are decided from.
  // Every starter the change's stage allows — Archive included — but only in the panel of the session that would
  // receive it, which is the change's running one. An ended session's panel offers none: nothing can be typed there.
  // A proposal session receives Draft only and offers every other step as ending it first (`consoleSteps`).
  const steps = session && card ? consoleSteps(ui.config, ui.sessions, card, session) : undefined;
  const receiving = steps !== undefined;
  // The change's pull request decides which of them is recommended, as on its card; it never adds or removes one.
  const linked = card ? linkedPullRequest(card, prs.data?.repos) : undefined;
  const split = steps && card ? starterSplit(card, [...steps.into, ...steps.endFirst], linked) : undefined;
  // A pull-request step the split button offers is not offered a second time beside it.
  const inSplit = (step: PullRequestStep) => split !== undefined && [split.main, ...split.menu].some((n) => n?.kind === "pullRequest" && n.step === step);
  // Nothing has ever run for this change: the tab says so and offers the openings, which is why it exists at all.
  const untouched = !session && !tree;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await fn();
      await ui.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const path = session?.worktreePath ?? tree?.path;
  return (
    <section class="console-pane" aria-label={`Agent console ${change ?? ""}`}>
      <header class="session-head">
        <div class="row">
          {session && <span class="hint">{session.agentName}</span>}
          {repo && <span class="hint">· {repo.name}</span>}
          {!session?.inPlace && (session?.branch ?? tree?.branch) && <span class="hint mono pane-branch">{session?.branch ?? tree?.branch}</span>}
          {session?.inPlace && (
            <span class="badge warning" title={inPlaceReason(session.worktreePath, ui.snapshot?.repos.find((r) => r.id === repoId)?.isGit)}>
              in the folder — no undo
            </span>
          )}
          {badge && <SessionBadgeView badge={badge} />}
          {work && (
            <span class={`badge ${work.tone}`} title={merged && session?.state !== "running" ? `${work.title}: use Clean up.` : work.title}>
              {work.label}
            </span>
          )}
          <ConflictBadge worktree={tree} />
          {session?.adopted && (
            <span
              class="badge"
              title="This branch was already checked out in a worktree created outside the dashboard, so the agent works there. The dashboard will not remove it."
            >
              adopted worktree
            </span>
          )}
        </div>
        <div class="row">
          {shippable && session && (
            <button
              type="button"
              class="btn sm primary"
              title={
                session.state === "running"
                  ? `Sends ${session.agentName} a prompt asking it to commit, push and open a pull request`
                  : `Starts ${session.agentName} in this worktree with a prompt to commit, push and open a pull request`
              }
              onClick={() =>
                act(async () => {
                  reportShip(ui, session.id, await api.shipSession(session.id));
                })
              }
            >
              ⇪ Ship
            </button>
          )}
          {canResolve && session && !inSplit("resolveConflicts") && (
            <button
              type="button"
              class="btn sm"
              title={
                session.state === "running"
                  ? `Sends ${session.agentName} a prompt asking it to bring the branch up to date and resolve the conflicts. The dashboard merges nothing itself.`
                  : `Starts ${session.agentName} in this worktree with a prompt to bring the branch up to date and resolve the conflicts. The dashboard merges nothing itself.`
              }
              onClick={() =>
                act(async () => {
                  const result = await api.resolveConflicts(session.id);
                  ui.reportUnsent(result.submitted ? undefined : session.id);
                })
              }
            >
              ⚠ Resolve conflicts
            </button>
          )}
          {merge && session && !inSplit("merge") && (
            <button
              type="button"
              class="btn sm"
              disabled={!merge.enabled}
              title={merge.title}
              onClick={() =>
                act(async () => {
                  const result = await api.mergeSession(session.id);
                  ui.reportUnsent(result.submitted ? undefined : session.id);
                })
              }
            >
              ⤵ Merge
            </button>
          )}
          {session && session.state !== "running" && session.resumable && (
            <button
              type="button"
              class="btn sm"
              title="Start the agent again in the same worktree, continuing its latest conversation"
              onClick={() => act(() => api.resumeSession(session.id))}
            >
              ▶ Resume
            </button>
          )}
          {session && card && receiving && (
            <SessionControls
              card={card}
              place="console"
              pullRequest={linked}
              into={session}
              steps={{
                merge: merge && {
                  key: "merge",
                  label: "⤵ Merge",
                  title: merge.title,
                  disabled: !merge.enabled,
                  onActivate: () =>
                    act(async () => {
                      const result = await api.mergeSession(session.id);
                      ui.reportUnsent(result.submitted ? undefined : session.id);
                    }),
                },
                // The pull request's step asks the same rule as the detail header: this session, on the head branch.
                resolveConflicts:
                  conflictAction(card, ui.worktrees, ui.sessions, prs.data)?.sessionId !== session.id
                    ? { status: "Conflicts: resolve them on the pull request's branch", title: linked ? `#${linked.number} is on ${linked.head}, not ${session.branch}` : undefined }
                    : {
                      key: "resolveConflicts",
                      label: "⚠ Resolve conflicts",
                      title: `Sends ${session.agentName} a prompt asking it to bring the branch up to date and resolve the conflicts. The dashboard merges nothing itself.`,
                      onActivate: () =>
                        act(async () => {
                          const result = await api.resolveConflicts(session.id);
                          ui.reportUnsent(result.submitted ? undefined : session.id);
                        }),
                    },
                // Nothing to send for it: the agent is right here, and the failure is on GitHub for it to read.
                fixChecks: { status: "Checks failing: ask the agent here to fix them", title: linked ? `#${linked.number}'s checks fail` : undefined },
              }}
            />
          )}
          {session && (
            <button type="button" class="btn sm" onClick={() => ui.requestEnd(session.id)}>
              {session.state === "running" ? "End session" : "Clean up"}
            </button>
          )}
          {session && session.state !== "running" && (
            <button type="button" class="btn sm ghost" title="Delete this session's record and stored output" onClick={() => act(() => api.deleteSession(session.id))}>
              Delete record
            </button>
          )}
          {path && <Copy text={cdCommand(path)} label="Copy cd" />}
        </div>
        {(error ?? session?.error) && <div class="notice danger">{error ?? session?.error}</div>}
        {session?.autoEnded && <div class={`notice ${session.autoEnded.removed ? "ok" : "warn"}`}>{autoEndedText(session.autoEnded)}</div>}
        {pendingMerge && (
          <div class={`notice ${pendingMerge.tone === "warn" ? "warn" : ""}`} role="status" title={pendingMerge.title}>
            {pendingMerge.text}
          </div>
        )}
        {!pendingMerge && merge?.title === RESUME_TO_MERGE && (
          <div class="notice" role="status">
            #{merge.pr.number} is ready. {RESUME_TO_MERGE}
          </div>
        )}
      </header>
      {session ? (
        <TerminalView key={`${session.id}:${generation}`} sessionId={session.id} running={session.state === "running"} onExit={ui.refresh} />
      ) : untouched ? (
        <div class="console-empty">
          <p class="detail-hint">No agent has worked on this change yet. Start one here and its terminal takes this tab.</p>
          {card && (
            <div class="console-starters">
              <SessionControls card={card} place="console" pullRequest={linked} />
            </div>
          )}
        </div>
      ) : (
        <div class="console-empty">
          <p class="detail-hint">
            No session is recorded for this worktree, so there is no terminal to show. Its work is still here — copy a <code>cd</code> for it, or remove it from Open work
            when that is safe.
          </p>
          {path && <p class="hint mono">{path}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * Resolve conflicts for the change (resolve-pr-conflicts D1, D5): offered on the local signal, on GitHub's, or both, each
 * said with its base and freshness. It goes to the change's session on the pull request's branch, or starts one on that
 * branch; the server decides which from its own lists, and nothing is fetched or queried for it.
 */
export function ResolveConflicts({ change }: { change: ChangeSnapshot }) {
  const ui = useSessionUi();
  const pullRequests = usePullRequests();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (change.archived || !sessionsEnabledFor(ui.config, change.repoId)) return null;
  const action = conflictAction(change, ui.worktrees, ui.sessions, pullRequests.data);
  if (!action) return null;
  const { github } = action.signal;
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (action.sessionId) {
        const result = await api.resolveConflicts(action.sessionId);
        ui.reportUnsent(result.submitted ? undefined : action.sessionId);
        await ui.refresh();
        ui.openPanel(action.sessionId);
      } else {
        const failed = await ui.start(change.repoId, change.name, "implement", true, { resolveConflicts: true });
        if (failed) setError(failed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const where = action.sessionId ? "the change's session" : `a new session on ${github?.head ?? "the pull request's branch"}`;
  return (
    <>
      {github && (
        <span class="badge warning" title={action.lines.join(" ")}>
          ⚠ GitHub: conflicts with {github.base}
          {github.pushPending ? " · push pending" : ""}
        </span>
      )}
      <button type="button" class="btn sm" disabled={busy} title={`${action.lines.join(" ")} Asks ${where} to resolve them; the dashboard merges nothing itself.`} onClick={run}>
        ⚠ Resolve conflicts
      </button>
      {error && (
        <span class="badge danger" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
