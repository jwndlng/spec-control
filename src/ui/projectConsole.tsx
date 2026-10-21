// A project's console: one agent session per tracked project for anything that is not a change. It runs the project's
// agent without a prompt **in place** in the project's folder — for a git repository its main checkout — so the
// overlay says that plainly, as the integration overlay does. The session that set the project up counts as its
// console too, which is how it stays reachable once its own overlay was closed. Nothing change-related is offered.
import { useEffect, useRef, useState } from "preact/hooks";
import { projectConsoleSessions, projectConsoleToShow, type ProjectConsoleLike } from "../shared/types.ts";
import { api } from "./api.ts";
import { CloseButton, closeOnEscape, DetailOverlay } from "./changeDetail.tsx";
import { cdCommand } from "./format.ts";
import { IconTerminal } from "./icons.tsx";
import { IN_PLACE_WARNING } from "./integrate.tsx";
import type { ActionDescription } from "./projectDetails.ts";
import { Copy, TerminalView, useTerminalGeneration } from "./sessionPanel.tsx";
import { projectConsoleControl, projectConsoleUnavailable, sessionBadge } from "./sessionState.ts";
import { SessionBadgeView, useSessionUi } from "./sessions.tsx";

/** The project's console sessions as the UI knows them: its own consoles and the setup sessions in its folder. */
function useProjectConsoles(repoId: string | undefined): { name: string; path: string; sessions: ProjectConsoleLike[] } | undefined {
  const ui = useSessionUi();
  const repo = ui.config?.repos.find((r) => r.id === repoId);
  if (!repo) return undefined;
  return { name: repo.name, path: repo.path, sessions: projectConsoleSessions([...ui.projectConsoles, ...ui.integrations], repo) };
}

/**
 * The console control of one managed project, on its overview row, its tile and its board header: the terminal icon,
 * the label **Console** and, while a console runs, its state in the session badge's words. `"board"` matches the other
 * actions of the board header; `"project"` is the outlined, smaller button on the overview row and tile. Absent while
 * agent sessions are off; inactive, with the reason in its name and tooltip, while the project's own sessions are off or
 * its agent is missing. It never opens the board it sits on.
 */
/** `description` (the board's): the tooltip, and the accessible description through the element with its id. */
export function ProjectConsoleButton({ repoId, variant, description }: { repoId: string; variant: "board" | "project"; description?: ActionDescription }) {
  const ui = useSessionUi();
  const project = useProjectConsoles(repoId);
  const unavailable = projectConsoleUnavailable(ui.config, ui.agents, repoId);
  if (unavailable === null || !project) return null;
  const control = projectConsoleControl(project.sessions, project.name, unavailable);
  const badge = control.badge;
  return (
    <button
      type="button"
      class={`btn${variant === "project" ? " sm" : ""} console-btn project-console-btn on-${variant}`}
      aria-label={control.name}
      title={description?.text ?? control.title}
      aria-describedby={description?.id}
      disabled={control.disabled}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        ui.showProjectConsole(repoId);
      }}
    >
      <IconTerminal size={15} />
      Console
      {/* The name already says the state; shown here for sighted users, not announced a second time. */}
      {control.state && (
        <span class="console-state" aria-hidden="true">
          {control.state}
        </span>
      )}
      {badge && <span class={`console-dot ${badge.tone}${badge.live ? " live" : ""}`} aria-hidden="true" />}
    </button>
  );
}

/** Mounted by the app shell outside the part that goes inert, next to the other console overlays. */
export function ProjectConsoleOverlay() {
  const ui = useSessionUi();
  if (!ui.projectConsoleRepoId) return null;
  // Keyed by project: switching projects is a fresh overlay, never the previous project's terminal.
  return <ProjectConsoleView key={ui.projectConsoleRepoId} repoId={ui.projectConsoleRepoId} onClose={() => ui.showProjectConsole(undefined)} />;
}

function ProjectConsoleView({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const ui = useSessionUi();
  const project = useProjectConsoles(repoId);
  const panel = useRef<HTMLDivElement>(null);
  // The session this overlay opened or showed, so a fresh one is shown before the next poll lists it.
  const [shownId, setShownId] = useState<string>();
  const [opened, setOpened] = useState<ProjectConsoleLike>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const listed = projectConsoleToShow(project?.sessions ?? [], shownId);
  const session = listed ?? (opened && opened.id === shownId ? opened : undefined);
  const generation = useTerminalGeneration(session);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await ui.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    act(async () => {
      const started = await api.openProjectConsole(repoId);
      setOpened(started);
      setShownId(started.id);
    });

  // Nothing to show at all: start one. An ended console stays on screen until the user asks for a new one.
  const startedOnce = useRef(false);
  useEffect(() => {
    if (startedOnce.current || (project?.sessions.length ?? 0) > 0) return;
    startedOnce.current = true;
    void start();
  }, []);

  useEffect(() => {
    const onKey = closeOnEscape(onClose);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus into the panel on open, back to the control that opened it on close (see ChangeDetail for why it waits a tick).
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    panel.current?.focus();
    return () => {
      setTimeout(() => {
        if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
      }, 0);
    };
  }, [opener]);

  const name = project?.name ?? "this project";
  const folder = session?.worktreePath ?? project?.path;
  const running = session?.state === "running";
  return (
    <DetailOverlay label={`Console of ${name}`} onClose={onClose} panelRef={panel}>
      <div class="repo-head detail-head console-head">
        <div class="row">
          <h1 class="crumbs">
            <IconTerminal size={18} />
            <span>{name}</span>
            <span class="hint">· Project console</span>
          </h1>
          <CloseButton onClose={onClose} />
        </div>
        <p class="hint">Your agent in this project's folder, for anything that is not a change — questions, setup, housekeeping.</p>
      </div>
      <section class="console-pane main-console" aria-label={`Console of ${name}`}>
        <header class="session-head">
          <div class="row">
            {session && <span class="hint">{session.agentName}</span>}
            {folder && (
              <span class="hint mono" title="The project folder the agent runs in">
                · {folder}
              </span>
            )}
            {session?.integration && <span class="hint">· the session that set this project up</span>}
            {session && <SessionBadgeView badge={sessionBadge(session)} />}
          </div>
          <div class="row">
            {session && !running && session.resumable && (
              <button type="button" class="btn sm" disabled={busy} title="Start the agent again in the same folder, continuing its latest conversation" onClick={() => act(() => api.resumeSession(session.id))}>
                ▶ Resume
              </button>
            )}
            {session && !running && (
              <button type="button" class="btn sm" disabled={busy} title="Start a new console in this project's folder" onClick={() => void start()}>
                New console
              </button>
            )}
            {running && !confirmEnd && (
              <button type="button" class="btn sm" onClick={() => setConfirmEnd(true)}>
                End session
              </button>
            )}
            {running && confirmEnd && (
              <>
                <span class="hint">End {session.agentName}? Closing this overlay would keep it running.</span>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api.closeSession(session.id, false);
                      setConfirmEnd(false);
                    })
                  }
                >
                  End it
                </button>
                <button type="button" class="btn sm ghost" onClick={() => setConfirmEnd(false)}>
                  Cancel
                </button>
              </>
            )}
            {session && !running && (
              <button type="button" class="btn sm ghost" disabled={busy} title="Delete this session's record and stored output" onClick={() => act(() => api.deleteSession(session.id))}>
                Delete record
              </button>
            )}
            {folder && <Copy text={cdCommand(folder)} label="Copy cd" />}
          </div>
          {/* The project console runs in the folder the user works in — said where the terminal is, not only once. */}
          <div class="notice warn in-place-note">{IN_PLACE_WARNING}</div>
          {(error ?? session?.error) && <div class="notice danger">{error ?? session?.error}</div>}
        </header>
        {session ? (
          <TerminalView key={`${session.id}:${generation}`} sessionId={session.id} running={running} onExit={ui.refresh} />
        ) : (
          <div class="console-empty">
            <p class="detail-hint">{busy ? "Starting the console…" : error ? "The console could not be started." : "No console is running."}</p>
            {!busy && (
              <button type="button" class="btn sm primary" onClick={() => void start()}>
                Start console
              </button>
            )}
          </div>
        )}
      </section>
    </DetailOverlay>
  );
}
