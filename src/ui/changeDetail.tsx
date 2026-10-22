// One change with its artifacts, as an overlay over the board it belongs to. The header comes from the snapshot the
// boards use; file lists and file text are fetched on demand from the read-only artifact endpoints. The one write is
// dismissing the change, and only after the user confirmed it in its own dialog.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChangeArtifactEntry, ChangeArtifacts, ChangeSnapshot, DismissPreview, DismissResult, RepoSnapshot, Snapshot, TaskProgress } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { CopyButton, CopyRefButton, Meter } from "./kanban.tsx";
import { renderMarkdown } from "./markdown.tsx";
import { backTarget, CONSOLE_TAB, changePath, type DetailQuery, parseDetailQuery, repoPath, serializeDetailQuery } from "./routes.ts";
import { ConsolePanel, ConsoleSessionList } from "./sessionPanel.tsx";
import { changeWorktreePath, consoleAvailable, consoleSession, consoleSessions, consoleTabAvailable } from "./sessionState.ts";
import { useSessionUi, WorkStatus } from "./sessions.tsx";
import { isComplete } from "../shared/columns.ts";
import { promptBody } from "./boardMarks.ts";
import { BranchBadge } from "./checkout.tsx";
import { IconCheck, IconFolder } from "./icons.tsx";
import { SourceIssueLink } from "./importIssues.tsx";
import { type DetailPr, DetailPullRequest, detailPullRequest, usePullRequests } from "./pullRequests.tsx";
import { DeleteBranchDialog } from "./deleteBranch.tsx";
import { DismissDialog } from "./dismissChange.tsx";
import { listedWorktreePath, staleHint, staleReason } from "./staleState.ts";
import { dismissedNotice, dismissOffer } from "./dismissState.ts";
import { checkoutHint, daysSince, leftoverHint, pendingArchiveHint, relTime, splitPathLabel } from "./format.ts";
import { currentQuery, followInApp, href, navigate, replaceQuery } from "./url.ts";

export function artifactLabel(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export interface Selection {
  artifactId?: string;
  file?: string;
}

/**
 * What is on screen for a URL: the console when the URL names it and the change has one, else the named artifact and
 * file when they exist, else the first artifact that has content and its first file. A stale link — a missing
 * artifact, a missing file, or the console for a change without a session — therefore never produces an error.
 */
export function resolveSelection(artifacts: ChangeArtifactEntry[], query: Pick<DetailQuery, "artifact" | "file">, hasConsole = false): Selection {
  if (query.artifact === CONSOLE_TAB && hasConsole) return { artifactId: CONSOLE_TAB };
  const withContent = artifacts.filter((a) => a.files.length > 0);
  const artifact = withContent.find((a) => a.id === query.artifact) ?? withContent[0];
  if (!artifact) return {};
  const file = artifact.files.find((f) => f.path === query.file) ?? artifact.files[0];
  return { artifactId: artifact.id, file: file.path };
}

/** Same line shape and the same three states the scanner counts, so the checklist's label cannot disagree with the boxes below it. */
export function taskProgress(markdown: string): TaskProgress {
  const boxes = markdown.match(/^\s*(?:[-*+]|\d+[.)])\s+\[\s*[^\]\s]?\s*\]/gm) ?? [];
  const state = (box: string) => box.slice(box.indexOf("[") + 1, box.lastIndexOf("]")).trim();
  return {
    done: boxes.filter((b) => state(b).toLowerCase() === "x").length,
    awaiting: boxes.filter((b) => state(b) === "~").length,
    total: boxes.length,
  };
}

export function absoluteFilePath(changeDir: string, file: string): string {
  return `${changeDir.replace(/\/+$/, "")}/${file}`;
}

export type FileState =
  | { status: "ok"; path: string; text: string }
  | { status: "too-large"; path: string; message: string }
  | { status: "error"; path: string; message: string };

/** The previous state when nothing changed, so an unchanged poll re-renders nothing and the scroll position stays. */
export function nextFileState(prev: FileState | null, next: FileState): FileState {
  if (!prev || prev.status !== next.status || prev.path !== next.path) return next;
  if (prev.status === "ok" && next.status === "ok") return prev.text === next.text ? prev : next;
  return (prev as { message: string }).message === (next as { message: string }).message ? prev : next;
}

export function nextListing(prev: ChangeArtifacts | null, next: ChangeArtifacts): ChangeArtifacts {
  return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

export function fileFailure(path: string, err: unknown): FileState {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiError && err.status === 413) return { status: "too-large", path, message };
  return { status: "error", path, message };
}

function AppLink({ path, query = "", class: className, children }: { path: string; query?: string; class?: string; children: ComponentChildren }) {
  return (
    <a class={className} href={href(path, undefined, query)} onClick={(e) => followInApp(e, path, query)}>
      {children}
    </a>
  );
}

export function ChangeNotFound({ repo, repoId, changeName }: { repo?: RepoSnapshot; repoId: string; changeName: string }) {
  return (
    <div class="empty">
      <h1>Change not found</h1>
      {repo ? (
        <p>
          <strong>{repo.name}</strong> has no change named <code>{changeName}</code>. It may have been renamed or removed.
        </p>
      ) : (
        <p>
          No tracked repository with the id <code>{repoId}</code>, so the change <code>{changeName}</code> cannot be shown.
        </p>
      )}
      <AppLink class="btn primary" path="/">
        Back to Projects
      </AppLink>
    </div>
  );
}

/**
 * Closing the overlay is a navigation to the board it belongs to — never the browser's Back, which leaves the app when
 * the view was opened from a pasted URL or in a new tab. One function for the close control, the backdrop and Escape.
 */
export function detailClose(from: string | undefined, repoId: string, go: (path: string, query: string) => void = navigate): () => void {
  return () => {
    const back = backTarget(from, repoId);
    go(back.path, back.query);
  };
}

/** The console's terminal box (`ConsolePanel` renders it), where Escape belongs to the agent rather than the overlay. */
export const TERMINAL_SELECTOR = ".session-terminal";

/**
 * A `keydown` listener that closes on Escape — except while the keyboard is in a terminal, where Escape belongs to the
 * agent. The close control and the backdrop stay, so there is always a way out that a terminal cannot swallow.
 */
export function closeOnEscape(onClose: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    // Duck-typed rather than `instanceof Element`, so this stays a pure function testable without a DOM.
    const target = e.target as { closest?: (selector: string) => unknown } | null;
    if (typeof target?.closest === "function" && target.closest(TERMINAL_SELECTOR)) return;
    e.preventDefault();
    onClose();
  };
}

// Backdrops a press started on. A click is dispatched to the common ancestor of press and release, so a text selection
// dragged out of the panel would otherwise land on the backdrop and close the overlay.
const pressedBackdrops = new WeakSet<EventTarget>();

/**
 * The modal shell: a dimmed backdrop over the board and a bounded panel on it. The board behind is made inert by
 * `App`, so the panel needs no focus trap of its own.
 */
export function DetailOverlay({ label, onClose, panelRef, children }: { label: string; onClose: () => void; panelRef?: RefObject<HTMLDivElement>; children: ComponentChildren }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the backdrop is a pointer shortcut; Escape and the close control are its keyboard equivalents
    <div
      class="overlay detail-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) pressedBackdrops.add(e.currentTarget);
        else pressedBackdrops.delete(e.currentTarget);
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !pressedBackdrops.has(e.currentTarget)) return;
        pressedBackdrops.delete(e.currentTarget);
        onClose();
      }}
    >
      <div class="detail" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={panelRef}>
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" class="btn sm ghost detail-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
      ✕
    </button>
  );
}

/**
 * Identity only: where the change lives, its name, and a way out. The status labels stay on the board's card; warnings
 * are the exception, because they say something is broken.
 */
// The change is a full snapshot entry in the ordinary case, and just a name for a worktree whose change is gone.
export function DetailHeader({
  repo,
  change,
  from,
  onClose,
  onDismiss,
  pullRequest,
}: {
  repo: RepoSnapshot;
  change: ChangeSnapshot | Pick<ChangeSnapshot, "name" | "warnings">;
  from?: string;
  onClose: () => void;
  /** Opens the dismiss confirmation; absent where dismissing is not offered at all. */
  onDismiss?: () => void;
  /** The change's pull request, or why pull requests are unavailable; absent when there is nothing to say. */
  pullRequest?: DetailPr;
}) {
  // The repository's board, with its filters when that is the board the view was opened from.
  const back = backTarget(from, repo.id);
  const repoLink = back.path === repoPath(repo.id) ? back : { path: repoPath(repo.id), query: "" };
  return (
    <div class="repo-head detail-head">
      <div class="row">
        <h1 class="crumbs">
          <AppLink class="crumb-link" path={repoLink.path} query={repoLink.query}>
            {repo.name}
          </AppLink>
          <span class="sep">/</span>
          <span class="mono change-name">{change.name}</span>
          <CopyRefButton project={repo.name} change={change.name} />
        </h1>
        {onDismiss && "column" in change && <DismissButton change={change} failing={!repo.ok} onDismiss={onDismiss} />}
        <CloseButton onClose={onClose} />
      </div>
      {"column" in change && <ChangeFacts change={change} pullRequest={pullRequest} />}
      {"column" in change && <ChangeDependencies change={change} repo={repo} from={from} />}
      {change.warnings?.map((w) => (
        <div key={w} class="notice warn">
          {w}
        </div>
      ))}
    </div>
  );
}

/** Quiet until hovered or focused, so it never reads as the change's next step. */
function DismissButton({ change, failing, onDismiss }: { change: ChangeSnapshot; failing: boolean; onDismiss: () => void }) {
  const offer = dismissOffer(change);
  if (!offer.shown || failing) return null;
  return (
    <button
      type="button"
      class="btn sm ghost dismiss-change"
      disabled={offer.disabledReason !== undefined}
      title={offer.disabledReason ?? "Delete this change's directory from the project, after you confirm"}
      onClick={onDismiss}
    >
      Dismiss change
    </button>
  );
}

/**
 * What the card leaves out: where the change lives and what state it is in — column, tasks, last update, how long it
 * has been complete, its branch and checkouts, an archive the main checkout lacks or an active copy left next to one,
 * its worktree's work status — and the prompt it was started with. The artifact tabs below say which phases are written.
 */
function ChangeFacts({ change, pullRequest, now = Date.now() }: { change: ChangeSnapshot; pullRequest?: DetailPr; now?: number }) {
  const age = daysSince(change.lastActivityAt, now);
  const pending = pendingArchiveHint(change);
  const leftover = leftoverHint(change);
  const prompt = promptBody(change.prompt);
  return (
    <>
      <div class="row detail-facts">
        <span class="badge" title="The column this change is in">
          {change.column}
        </span>
        {change.tasks && change.tasks.total > 0 && <Meter done={change.tasks.done} total={change.tasks.total} />}
        <span class="badge" title={change.lastActivityAt ? `last activity ${change.lastActivityAt}` : "no activity date"}>
          {change.archived ? `archived ${change.archived}` : `updated ${relTime(change.lastActivityAt, now)} ago`}
        </span>
        {isComplete(change.stage) && age !== undefined && <span class="badge success">✓ complete · {age}d</span>}
        {pending && (
          <span class="badge warning" title={pending.title}>
            ⑂ {pending.label}
          </span>
        )}
        {leftover && (
          <span class="badge warning" title={leftover.title}>
            ⚠ {leftover.label}
          </span>
        )}
        {change.branchMatch && <BranchBadge branch={change.branchMatch} hint={checkoutHint(change)} />}
        <WorktreePath change={change} />
        {change.sourceIssue && <SourceIssueLink issue={change.sourceIssue} place="detail" />}
        {pullRequest && <DetailPullRequest info={pullRequest} />}
        <WorkStatus repoId={change.repoId} name={change.name} />
      </div>
      {prompt && (
        <div class="detail-prompt" role="note" aria-label={`prompt: ${prompt}`}>
          <span class="detail-prompt-label">✎ prompt</span>
          <p>{prompt}</p>
        </div>
      )}
    </>
  );
}

/**
 * The change's worktree path, copied on activation (change-detail: "The detail header shows and copies the change's
 * worktree path"). The path's parent is clipped, its last segment — the worktree's own name — always shows; it confirms
 * only once the clipboard took the text.
 */
export function WorktreePath({ change }: { change: Pick<ChangeSnapshot, "repoId" | "name" | "checkout"> }) {
  const ui = useSessionUi();
  const path = changeWorktreePath(change, ui.worktrees);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  if (!path) return null;
  const { head, tail } = splitPathLabel(path);
  const label = done ? "Copied" : `Copy worktree path ${path}`;
  return (
    <button type="button" class={`badge worktree-path mono truncate ${done ? "done" : ""}`} title={done ? "Copied" : `${path} — click to copy`} aria-label={label} onClick={() => navigator.clipboard.writeText(path).then(() => setDone(true), () => {})}>
      <span aria-hidden="true">{done ? <IconCheck size={11} /> : <IconFolder size={11} />}</span>
      <span class="text" aria-hidden="true">
        <span class="head">{head}</span>
        {tail && <span class="tail">{tail}</span>}
      </span>
      <span class="visually-hidden" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

const DEPENDENCY_STATE_TEXT = { met: "met", waiting: "waiting", missing: "missing", cycle: "cycle" } as const;

/**
 * Both directions of `depends-on.yaml`: what this change waits for, each with its state in words, and the changes that
 * wait for it. A name the snapshot has links to that change's detail view, keeping the board it was opened from; a
 * `missing` one is plain text. Nothing when the change has neither.
 */
export function ChangeDependencies({ change, repo, from }: { change: Pick<ChangeSnapshot, "dependsOn" | "requiredBy" | "blocked">; repo: RepoSnapshot; from?: string }) {
  if (!change.dependsOn?.length && !change.requiredBy?.length && !change.blocked) return null;
  const query = serializeDetailQuery({ raw: false, from });
  const known = (name: string) => repo.changes.some((c) => c.name === name);
  const nameOf = (name: string) =>
    known(name) ? (
      <AppLink class="mono" path={changePath(repo.id, name)} query={query}>
        {name}
      </AppLink>
    ) : (
      <span class="mono">{name}</span>
    );
  return (
    <div class="detail-deps">
      {(change.dependsOn?.length || change.blocked) && (
        <div class="detail-deps-group">
          <span class="detail-deps-label">
            Depends on · <span class={change.blocked ? "warn-text" : "ok-text"}>{change.blocked ? "blocked — Implement is held back" : "all met"}</span>
          </span>
          <ul>
            {(change.dependsOn ?? []).map((d) => (
              <li key={d.name} class={`dep-${d.state}`}>
                {nameOf(d.name)} <span class="dep-state">— {DEPENDENCY_STATE_TEXT[d.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {change.requiredBy?.length ? (
        <div class="detail-deps-group">
          <span class="detail-deps-label">Required by</span>
          <ul>
            {change.requiredBy.map((name) => (
              <li key={name}>{nameOf(name)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One tab per artifact of the change's schema, and — when the change has a session or a session worktree — the Console
 * tab after them. The Console tab is not an artifact: it carries no state label and is always selectable, so a change
 * whose artifacts are all unwritten can still be watched.
 */
export function ArtifactTabs({ artifacts, selected, onSelect, console: hasConsole = false }: { artifacts: ChangeArtifactEntry[]; selected?: string; onSelect: (id: string) => void; console?: boolean }) {
  return (
    <div class="detail-tabs" role="tablist" aria-label="Artifacts">
      {artifacts.map((a) => {
        const empty = a.files.length === 0;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            class={`detail-tab ${a.id === selected ? "on" : ""}`}
            aria-selected={a.id === selected}
            disabled={empty}
            title={empty ? `not written yet — ${a.status}` : undefined}
            onClick={() => onSelect(a.id)}
          >
            {artifactLabel(a.id)}
            <span class={`state ${a.status}`}>{a.status}</span>
          </button>
        );
      })}
      {hasConsole && (
        <button
          type="button"
          role="tab"
          class={`detail-tab console ${selected === CONSOLE_TAB ? "on" : ""}`}
          aria-selected={selected === CONSOLE_TAB}
          title="The agent's terminal for this change"
          onClick={() => onSelect(CONSOLE_TAB)}
        >
          Console
        </button>
      )}
    </div>
  );
}

export function FileList({ artifact, selected, onSelect }: { artifact: ChangeArtifactEntry; selected?: string; onSelect: (path: string) => void }) {
  if (artifact.files.length < 2) return null;
  return (
    <nav class="detail-files" aria-label={`Files of ${artifactLabel(artifact.id)}`}>
      {artifact.files.map((f) => (
        <button key={f.path} type="button" class={`detail-file mono ${f.path === selected ? "on" : ""}`} aria-current={f.path === selected ? "true" : undefined} onClick={() => onSelect(f.path)}>
          {f.path}
        </button>
      ))}
    </nav>
  );
}

/** The content column for one file state. `rendered` is the memoised Markdown of `state.text`. */
export function FileContent({ state, raw, isTasks, rendered, filePath }: { state: FileState; raw: boolean; isTasks: boolean; rendered: ComponentChildren; filePath?: string }) {
  if (state.status === "too-large") {
    return (
      <div class="notice warn detail-problem">
        <p>
          <code>{state.path}</code> is too large to display here ({state.message}).
        </p>
        {filePath && <CopyButton text={filePath} label="Copy file path" />}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div class="notice danger detail-problem">
        Could not read <code>{state.path}</code>: {state.message}
      </div>
    );
  }
  const progress = isTasks ? taskProgress(state.text) : undefined;
  return (
    <>
      {progress && progress.total > 0 && (
        <div class="detail-meter wide">
          <Meter done={progress.done} total={progress.total} awaiting={progress.awaiting} />
          {(progress.awaiting ?? 0) > 0 && (
            <p class="awaiting-note">
              {progress.awaiting} {progress.awaiting === 1 ? "task awaits" : "tasks await"} your validation. Only you can tick those off — start <strong>Validate</strong> on
              the card, or tell your agent in a session.
            </p>
          )}
        </div>
      )}
      {raw ? <pre class="detail-raw">{state.text}</pre> : rendered}
    </>
  );
}

/**
 * Why a change is stale and the one action that fits (stale-changes: "The change detail offers the fitting action for a
 * stale change"). Removing a settled worktree is the project details' deletion dialog, unchanged; carrying an archive
 * over starts an archive session whose commit the server takes from its own scan.
 */
export function StaleNotice({ repo, change }: { repo: RepoSnapshot; change: ChangeSnapshot }) {
  const ui = useSessionUi();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const opener = useRef<HTMLButtonElement>(null);
  const reason = staleReason(change, ui.worktrees, repo.defaultBranch);
  if (!reason) return null;
  const sessionsHere = consoleTabAvailable(ui.config, repo.id);
  const running = ui.sessions.some((s) => s.repoId === repo.id && s.change === change.name && s.state === "running");
  const listedPath = reason.kind === "settled" ? listedWorktreePath(reason.worktree, repo.worktrees) : undefined;
  const carryOver = async () => {
    setBusy(true);
    setFailure(await ui.start(repo.id, change.name, "archive", true, { carryOver: true }));
    setBusy(false);
  };
  return (
    <div class="notice warn stale-notice" role="note">
      <p>
        <strong>{reason.title}.</strong> {staleHint(reason, sessionsHere, repo.defaultBranch)}
      </p>
      {reason.kind === "settled" && listedPath && (
        <button type="button" class="btn sm" ref={opener} onClick={() => setDeleting(true)}>
          Remove worktree…
        </button>
      )}
      {reason.kind === "stranded" && sessionsHere && !running && (
        <button type="button" class="btn sm primary" disabled={busy} onClick={carryOver}>
          Carry over archive
        </button>
      )}
      {failure && <p class="error">{failure}</p>}
      {deleting && listedPath && reason.kind === "settled" && (
        <DeleteBranchDialog
          repoId={repo.id}
          path={listedPath}
          label={reason.worktree.branch ?? "detached worktree"}
          note={`Opened because this worktree is stale: everything it holds is already archived on ${repo.defaultBranch ?? "the default branch"} (${reason.worktree.settled?.archive}).`}
          onClose={() => setDeleting(false)}
          // The rescan moves the card; the session poll drops the worktree from the listing within seconds.
          onDone={() => void api.scan().catch(() => undefined)}
          returnFocus={() => opener.current}
        />
      )}
    </div>
  );
}

export function ChangeDetail({
  snapshot,
  repoId,
  changeName,
  onDismissed,
}: {
  snapshot: Snapshot | null;
  repoId: string;
  changeName: string;
  /** Told the notice to show once the change was dismissed; the app shows it and picks up the rescan. */
  onDismissed?: (notice: string) => void;
}) {
  const ui = useSessionUi();
  // Cached only: the board this view opens over already refreshed a stale cache when it opened.
  const pullRequests = usePullRequests();
  const [dismissing, setDismissing] = useState(false);
  const [query, setQueryState] = useState<DetailQuery>(() => parseDetailQuery(currentQuery()));
  const [listing, setListing] = useState<ChangeArtifacts | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileState | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const setQuery = (patch: Partial<DetailQuery>) => {
    const next = { ...query, ...patch };
    setQueryState(next);
    replaceQuery(serializeDetailQuery(next));
  };

  const repo = snapshot?.repos.find((r) => r.id === repoId);
  const change = repo?.changes.find((c) => c.name === changeName);
  const known = change !== undefined;

  // The console's own inputs. A worktree outlives its change, so a change the snapshot no longer carries can still
  // have one — that is what keeps an interrupted archive session reachable once its change is gone from the board.
  const sessions = useMemo(() => consoleSessions(ui.sessions, repoId, changeName), [ui.sessions, repoId, changeName]);
  const worktrees = useMemo(() => ui.worktrees.filter((w) => w.repoId === repoId && w.change === changeName), [ui.worktrees, repoId, changeName]);
  // Two questions, deliberately not one (see `sessionState.ts`): the tab exists for every change of a repository agent
  // sessions apply to, while `hasWork` — a session or a worktree — is what makes a change the snapshot has lost worth a
  // frame instead of "not found".
  const hasConsole = consoleTabAvailable(ui.config, repoId);
  const hasWork = consoleAvailable(ui.config, ui.sessions, ui.worktrees, repoId, changeName);
  const shownSession = consoleSession(sessions, query.session);
  const shownWorktree = worktrees.find((w) => w.path === shownSession?.worktreePath) ?? (shownSession ? undefined : worktrees[0]);

  // `snapshot` is a new object after every poll and every manual refresh, so both fetches follow the regular refresh.
  useEffect(() => {
    if (!known) return;
    let cancelled = false;
    api.changeArtifacts(repoId, changeName).then(
      (next) => {
        if (cancelled) return;
        setListing((prev) => nextListing(prev, next));
        setListError(null);
      },
      (err) => !cancelled && setListError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [repoId, changeName, known, snapshot]);

  const selection = useMemo(() => resolveSelection(listing?.artifacts ?? [], query, hasConsole), [listing, query, hasConsole]);
  const onConsole = selection.artifactId === CONSOLE_TAB;
  const file = selection.file;

  useEffect(() => {
    if (!known || !file) return;
    let cancelled = false;
    api.artifactFile(repoId, changeName, file).then(
      (content) => !cancelled && setFileState((prev) => nextFileState(prev, { status: "ok", path: file, text: content.text })),
      (err) => !cancelled && setFileState((prev) => nextFileState(prev, fileFailure(file, err))),
    );
    return () => {
      cancelled = true;
    };
  }, [repoId, changeName, known, file, snapshot]);

  const text = fileState?.status === "ok" ? fileState.text : undefined;
  const rendered = useMemo(() => (text === undefined ? null : renderMarkdown(text)), [text]);

  // `from` never changes while the view is open: selecting a tab, a file or raw keeps it in the query.
  const close = useMemo(() => detailClose(query.from, repoId), [query.from, repoId]);
  useEffect(() => {
    const onKey = closeOnEscape(close);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Focus into the panel on open, back to wherever it was (the card's Show details) on close. The opener is read during
  // the first render: once this render commits, the page behind turns inert and the browser drops its focus. Giving it
  // back waits a tick, because the overlay unmounts before the page behind stops being inert.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    panel.current?.focus();
    return () => {
      setTimeout(() => {
        if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
      }, 0);
    };
  }, [opener]);

  const label = `Change ${changeName}`;

  // The change is gone from the snapshot but its worktree is not: show the frame with a working Console tab rather
  // than "not found", so the work left in that worktree stays reachable.
  if (snapshot && repo && !change && hasWork) {
    return (
      <DetailOverlay label={label} onClose={close} panelRef={panel}>
        <DetailHeader repo={repo} change={{ name: changeName }} from={query.from} onClose={close} />
        <ArtifactTabs artifacts={[]} selected={CONSOLE_TAB} onSelect={() => {}} console />
        <div class="detail-body">
          <ConsoleSessionList sessions={sessions} selected={shownSession?.id} onSelect={(id) => setQuery({ artifact: CONSOLE_TAB, session: id })} />
          <section class="detail-content">
            <p class="detail-hint">This change is no longer in the repository, so it has no artifacts to read. Its worktree is still here.</p>
            <ConsolePanel session={shownSession} worktree={shownWorktree} />
          </section>
        </div>
      </DetailOverlay>
    );
  }

  if (!snapshot || !repo || !change) {
    return (
      <DetailOverlay label={label} onClose={close} panelRef={panel}>
        <div class="repo-head detail-head">
          <div class="row">
            <span class="spacer" />
            <CloseButton onClose={close} />
          </div>
        </div>
        {!snapshot ? <div class="empty">Loading…</div> : <ChangeNotFound repo={repo} repoId={repoId} changeName={changeName} />}
      </DetailOverlay>
    );
  }

  const artifact = listing?.artifacts.find((a) => a.id === selection.artifactId);
  const dismissed = (result: DismissResult, preview: DismissPreview) => {
    setDismissing(false);
    onDismissed?.(dismissedNotice(result, preview));
    // A worktree's copy keeps the change on the board: stay, and show that copy after the rescan.
    if (preview.copies.length === 0) close();
  };
  const filePath = listing && file ? absoluteFilePath(listing.change.dir, file) : undefined;
  const current = fileState && fileState.path === file ? fileState : null;

  return (
    <>
    <DetailOverlay label={label} onClose={close} panelRef={panel}>
      <DetailHeader
        repo={repo}
        change={change}
        from={query.from}
        onClose={close}
        onDismiss={onDismissed ? () => setDismissing(true) : undefined}
        pullRequest={detailPullRequest(change, pullRequests.data)}
      />
      <StaleNotice repo={repo} change={change} />
      {(listing || hasConsole) && (
        <ArtifactTabs artifacts={listing?.artifacts ?? []} selected={selection.artifactId} onSelect={(id) => setQuery({ artifact: id, file: undefined })} console={hasConsole} />
      )}
      <div class="detail-body">
        {onConsole ? (
          <ConsoleSessionList sessions={sessions} selected={shownSession?.id} onSelect={(id) => setQuery({ artifact: CONSOLE_TAB, session: id })} />
        ) : (
          artifact && <FileList artifact={artifact} selected={file} onSelect={(path) => setQuery({ artifact: artifact.id, file: path })} />
        )}
        <section class="detail-content">
          {onConsole ? (
            <ConsolePanel session={shownSession} worktree={shownWorktree} of={{ repoId, change: changeName }} />
          ) : (
            <>
          {file && (
            <div class="detail-toolbar">
              <code class="path">{file}</code>
              <label class="check">
                <input type="checkbox" checked={query.raw} onChange={(e) => setQuery({ raw: e.currentTarget.checked })} />
                raw
              </label>
            </div>
          )}
          {listError && !listing ? (
            <div class="notice danger detail-problem">Could not read this change's artifacts: {listError}</div>
          ) : !listing ? (
            <p class="detail-hint">Loading…</p>
          ) : !file ? (
            <p class="detail-hint">This change has no artifacts yet — nothing has been written to its directory.</p>
          ) : !current ? (
            <p class="detail-hint">Loading…</p>
          ) : (
            <FileContent state={current} raw={query.raw} isTasks={selection.artifactId === "tasks"} rendered={rendered} filePath={filePath} />
          )}
            </>
          )}
        </section>
      </div>
    </DetailOverlay>
    {/* Outside the panel: a dialog of its own over the detail view, whose Escape closes only this dialog. */}
    {dismissing && <DismissDialog repoId={repo.id} repoName={repo.name} change={change.name} onClose={() => setDismissing(false)} onDismissed={dismissed} />}
    </>
  );
}
