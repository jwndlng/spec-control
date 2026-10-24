import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { boardColumns, isComplete } from "../shared/columns.ts";
import { waitingNote } from "../shared/dependencies.ts";
import { linkedPullRequest } from "../shared/pullRequestLink.ts";
import { frameworkInfo, type ChangeSession, type ChangeSnapshot, type Config, type PullRequest, type PullRequestsResponse, type RepoSnapshot, type Snapshot } from "../shared/types.ts";
import { NoRepos } from "./empty.tsx";
import { parseFilters, resolveLayout, serializeFilters, STACK_BELOW_PX, type Filters } from "./filters.ts";
import { FilterBar } from "./boardFilters.tsx";
import { Stat } from "./band.tsx";
import { BranchBadge, CheckoutSummaryButton } from "./checkout.tsx";
import { CardPullRequest, RepoPullRequestsButton, RepoPullRequestsDialog, usePullRequests } from "./pullRequests.tsx";
import { armWatch, pendingMergesOf, watchPlan } from "./pullRequestsState.ts";
import { CleanupButton } from "./cleanup.tsx";
import { ImportIssuesDialog, SourceIssueLink } from "./importIssues.tsx";
import { NewChangeDialog } from "./newChangeForm.tsx";
import { FetchNoteBadge, PullButton } from "./pull.tsx";
import { branchNotice } from "./pullState.ts";
import { changeRef, relTime } from "./format.ts";
import { isMinimized, loadGroupState, saveGroupState, toggleGroup, type GroupOverrides } from "./groupState.ts";
import { assignRepoHues, dependencyChoices, groupByRepo, newChangeTargets, recentArchived } from "./repoGroups.ts";
import { columnKind } from "./boardMarks.ts";
import { IconCheck, IconChevronRight, IconCircleDot, IconCopy, IconInfo, IconPlus, IconTerminal } from "./icons.tsx";
import { SessionControls, useSessionUi } from "./sessions.tsx";
import { archivedShown, cardMergePending, cardSessionControls, hasRunningSession, cardWorkingState, type CardWorkingState, consoleTabAvailable, projectConsoleUnavailable } from "./sessionState.ts";
import { ProjectSwitch } from "./projectSwitch.tsx";
import { staleReason, type StaleReason } from "./staleState.ts";
import { boardFrom, changePath, CONSOLE_TAB, repoPath, serializeDetailQuery } from "./routes.ts";
import { currentQuery, followInApp, href, navigate, replaceQuery } from "./url.ts";
import { ProjectConsoleButton } from "./projectConsole.tsx";
import { actionDescriptionId, actionGroups, afterBoardDisable, autoFetchSecondsOf, type BoardAction, boardSettingsOffered, type DetailSection, quickViewFacts } from "./projectDetails.ts";
import { ProjectDetailsDialog } from "./projectDetails.tsx";
import { ProjectSettingsDialog, RepoLabelsDialog, SettingsButton } from "./projectSettings.tsx";
import { useTracking } from "./untracked.tsx";

const ARCHIVED_LIMIT = 25;

export interface Card extends ChangeSnapshot {
  repoName: string;
  repoPath: string;
  /** Repository hue from assignRepoHues; the theme turns it into a colour in CSS. */
  hue: number;
  /** The change's pull request, derived for display from the cached lists; archived changes included. */
  pullRequest?: PullRequest;
  /** When the list that pull request came from was fetched, so its readiness can say how fresh it is. */
  pullRequestFetchedAt?: string;
}

/**
 * A board's cards in the snapshot's order. The pull request is looked up per card and changes nothing else — not the
 * order, the column or any count — so lists arriving later only add the link in place.
 */
export function boardCards(repos: RepoSnapshot[], hues: Map<string, number>, pullRequests?: PullRequestsResponse): Card[] {
  return repos.flatMap((r) =>
    r.changes.map((c) => {
      const card: Card = { ...c, repoName: r.name, repoPath: r.path, hue: hues.get(r.id) ?? 0 };
      const pr = linkedPullRequest(c, pullRequests?.repos);
      if (pr) {
        card.pullRequest = pr;
        const fetchedAt = pullRequests?.repos.find((l) => l.repoId === c.repoId)?.fetchedAt;
        if (fetchedAt) card.pullRequestFetchedAt = fetchedAt;
      }
      return card;
    }),
  );
}

/** Sets --repo-hue for the `repo-tint` class. */
/** Where the boards' changes live, once per framework: `openspec/changes` while OpenSpec is the only one. */
export function changesDirs(repos: RepoSnapshot[]): string {
  const dirs = new Set(repos.map((r) => frameworkInfo(r.framework).changesDir));
  return dirs.size ? [...dirs].join(" · ") : frameworkInfo(undefined).changesDir;
}

function repoHue(hue: number) {
  return { "--repo-hue": hue };
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button type="button"
      class={`btn sm ghost copy ${done ? "done" : ""}`}
      title={`Copy: ${text}`}
      onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * Copies `project/change` (change-detail: "The detail header copies the change's reference"). Icon only, so its title
 * and accessible name say what it copies; it confirms only once the clipboard took the text.
 */
export function CopyRefButton({ project, change }: { project: string; change: string }) {
  const ref = changeRef(project, change);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  const label = done ? "Copied" : `Copy ${ref}`;
  return (
    <button
      type="button"
      class={`btn ghost icon-only copy-ref ${done ? "done" : ""}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(ref).then(() => setDone(true), () => {});
      }}
    >
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span class="visually-hidden" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

/** What a progress bar counts: ticked tasks, or written artifacts while a change is in `Drafts`. */
export type MeterUnit = "tasks" | "artifacts";

/** Colour is never the only cue: the awaiting count is named in words, here and in the visible value. */
export function meterText(done: number, total: number, unit: MeterUnit, awaiting = 0): string {
  if (unit === "artifacts") return `${done} of ${total} artifacts written`;
  if (awaiting > 0) return `${done} of ${total} tasks complete, ${awaiting} awaiting validation, ${total - done - awaiting} open`;
  return `${done} of ${total} tasks complete`;
}

/** `showUnit` names what the bar counts in its visible value (`2/4 Artifacts`, `3/12 Tasks`); the card uses it. */
export function Meter({ done, total, awaiting = 0, unit = "tasks", showUnit = false }: { done: number; total: number; awaiting?: number; unit?: MeterUnit; showUnit?: boolean }) {
  const full = total > 0 && done === total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const awaitingPct = total > 0 ? Math.round((awaiting / total) * 100) : 0;
  const text = meterText(done, total, unit, awaiting);
  return (
    <div class={`meter ${full ? "full" : ""} ${awaiting > 0 ? "has-awaiting" : ""}`} title={text} role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div class="track">
        <div class="fill" style={{ width: `${pct}%` }} />
        {awaiting > 0 && <div class="awaiting" style={{ width: `${awaitingPct}%` }} />}
      </div>
      <span class={`value ${showUnit ? "unit" : ""}`} aria-hidden="true">
        {awaiting > 0 ? `${done} + ${awaiting} awaiting / ${total}` : `${done}/${total}`}
        {showUnit && (unit === "artifacts" ? " Artifacts" : " Tasks")}
      </span>
    </div>
  );
}

/** The progress bar a card shows: written artifacts in `Drafts`, else ticked tasks when there are any, else none. */
export function cardProgress(card: Pick<Card, "stage" | "artifacts" | "tasks">): { done: number; total: number; awaiting?: number; unit: MeterUnit } | undefined {
  if (card.stage === "drafts") return { done: card.artifacts.filter((a) => a.status === "done").length, total: card.artifacts.length, unit: "artifacts" };
  if (card.stage === "backlog" || !card.tasks || card.tasks.total === 0) return undefined;
  return { ...card.tasks, unit: "tasks" };
}

/** Where a card leads: its change's detail view, remembering the board (`from`) it sits on. */
export function cardLink(card: Pick<Card, "repoId" | "name">, from: string): { path: string; query: string } {
  return { path: changePath(card.repoId, card.name), query: serializeDetailQuery({ raw: false, from }) };
}

/**
 * Only **Show details** navigates: the card itself and its change name are plain content, so clicking anywhere else on
 * a card does nothing. It is an anchor, so ⌘/middle-click opens the detail view in a new tab. `working` — an agent is
 * working on the change, or its pull request is not ready yet — shows on the whole card, tinted and, while something is
 * still in progress, with its name swept; the caller decides it (`cardWorkingState`), so the card stays hook-free.
 */
export function ChangeCard({ card, now, from, working, running = false, merging, stale }: { card: Card; now: number; from: string; working?: CardWorkingState; running?: boolean; merging?: string; stale?: StaleReason }) {
  const noTasks = card.warnings?.includes("tasks file has no tasks");
  // The work is finished, a person still has to confirm it — `warning`, not `success`; never on an archived change.
  const validating = !card.archived && (card.tasks?.awaiting ?? 0) > 0;
  const progress = cardProgress(card);
  const link = cardLink(card, from);
  // In the starter's place; a running session's badge takes it instead, as it takes every starter's.
  const waiting = running ? undefined : waitingNote(card);
  // Only what an overview needs: the name and the last update, under them the progress, then the footer with the
  // session state and the next step. The console link keeps the top right corner, the same on every card, so the way
  // into a terminal never moves. Branch, worktree, work status, prompt and completed phases are in the detail view.
  return (
    <article class={working?.tinted ? (working.sweeping ? "card live" : "card live pr-waiting") : "card"}>
      <div class="card-top">
        <div class="card-title">
          <div class="name-row">
            <span class="name">{card.name}</span>
            <CopyRefButton project={card.repoName} change={card.name} />
          </div>
          <span class="age" title={card.lastActivityAt ? `last activity ${card.lastActivityAt}` : "no activity date"}>
            {card.archived ? `archived ${card.archived}` : `updated ${relTime(card.lastActivityAt, now)} ago`}
          </span>
        </div>
        <ConsoleLink card={card} from={from} />
      </div>
      {progress && <Meter {...progress} showUnit />}
      <div class="meta">
        {validating && (
          <span class="badge warning" title={`${card.tasks?.awaiting} ${card.tasks?.awaiting === 1 ? "task awaits" : "tasks await"} your confirmation`}>
            Validate
          </span>
        )}
        {noTasks && <span class="badge warning">no tasks</span>}
        {/* Marked, never moved (stale-changes spec): the reason is in the title; the detail offers what to do. */}
        {stale && (
          <span class="badge warning stale" role="note" title={stale.title} aria-label={stale.title}>
            Stale
          </span>
        )}
        {card.warnings?.filter((w) => w !== "tasks file has no tasks").map((w) => (
          <span class="badge danger" title={w}>
            ⚠ error
          </span>
        ))}
        {card.sourceIssue && <SourceIssueLink issue={card.sourceIssue} place="card" />}
        {card.pullRequest && <CardPullRequest pr={card.pullRequest} repoName={card.repoName} fetchedAt={card.pullRequestFetchedAt} now={now} merging={merging} />}
        <SessionControls card={card} place="card" pullRequest={card.pullRequest} />
        {waiting && (
          <span class="waits-for" role="note" title={waiting.title} aria-label={waiting.title}>
            <span aria-hidden="true">⧗ </span>
            {waiting.label}
          </span>
        )}
        <a class="show-details" href={href(link.path, undefined, link.query)} onClick={(e) => followInApp(e, link.path, link.query)} aria-label={`Show details of ${card.name}`}>
          Show details
          <IconChevronRight size={12} />
        </a>
      </div>
    </article>
  );
}

/** Where the Console quick link leads: the change's detail view on its Console tab, remembering the board. */
export function consoleTarget(card: Pick<Card, "repoId" | "name">, from: string): { path: string; query: string } {
  return { path: changePath(card.repoId, card.name), query: serializeDetailQuery({ raw: false, from, artifact: CONSOLE_TAB }) };
}

/**
 * A quick way into the change's agent console: its detail view opened on the Console tab. Drawn whenever agent sessions
 * apply to the card's repository — before any agent has run, where the tab offers the starters — so that every card
 * carries it in the same corner and the way into a terminal is never somewhere else.
 */
export function ConsoleLink({ card, from }: { card: Card; from: string }) {
  const ui = useSessionUi();
  if (!consoleTabAvailable(ui.config, card.repoId)) return null;
  const { path, query } = consoleTarget(card, from);
  return (
    <a class="console-link" href={href(path, undefined, query)} onClick={(e) => followInApp(e, path, query)} aria-label={`Open the agent console of ${card.name}`} title="Open the agent console">
      <IconTerminal size={14} />
    </a>
  );
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * The cards the filters let through: repositories (on the combined board), the search text and the recent-activity
 * threshold. That threshold hides only what it knows to be old: a card whose activity time is unknown stays, and so does
 * one whose change has a running agent session — the same exception **Hide merged** makes.
 */
export function visibleCards(cards: Card[], filters: Filters, single: boolean, now: number, sessions: readonly ChangeSession[] = []): Card[] {
  const q = filters.q.trim().toLowerCase();
  return cards.filter((c) => {
    if (!single && filters.repos.length && !filters.repos.includes(c.repoId)) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.repoName.toLowerCase().includes(q)) return false;
    if (filters.activeDays > 0) {
      const at = c.lastActivityAt ? Date.parse(c.lastActivityAt) : Number.NaN;
      if (!Number.isNaN(at) && now - at >= filters.activeDays * DAY_MS && !hasRunningSession(c, sessions)) return false;
    }
    return true;
  });
}

/** The band's figures: open changes among the visible cards, and every complete change waiting to be archived. */
export function boardStats(cards: Card[], visible: Card[]): { open: number; toArchive: number } {
  return { open: visible.filter((c) => !c.archived).length, toArchive: cards.filter((c) => isComplete(c.stage)).length };
}

/** The counts every board's band shows: open changes matching the filters, and complete changes waiting to be archived. */
function BoardStats({ open, toArchive }: { open: number; toArchive: number }) {
  return (
    <span class="stats">
      <Stat label="Open" value={open} />
      <Stat label="To archive" value={toArchive} tone={toArchive > 0 ? "success" : undefined} />
    </span>
  );
}

/** Minimize state for the groups of a board; owned by `Kanban`, consumed by every column. */
interface GroupControls {
  overrides: GroupOverrides;
  onToggle: (repoId: string, column: string) => void;
  /** A text search is active: show every group open so matches are never hidden, and leave stored choices alone. */
  forceExpanded: boolean;
}

// Cards of one column, grouped by repository in the same order in every column. On a single-repository
// board (`showRepo` false) the group header would only repeat the page header, so the cards render flat.
function RepoGroups({ column, cards, now, showRepo, from, groups: controls }: { column: string; cards: Card[]; now: number; showRepo: boolean; from: string; groups: GroupControls }) {
  const groups = useMemo(() => groupByRepo(cards), [cards]);
  const ui = useSessionUi();
  const working = (c: Card) => cardWorkingState(ui.config, ui.sessions, c);
  const running = (c: Card) => cardSessionControls(ui.config, ui.sessions, c).shown.some((s) => s.state === "running");
  const merging = (c: Card) => cardMergePending(ui.sessions, c, c.pullRequest);
  const stale = (c: Card) => staleReason(c, ui.worktrees);
  if (!showRepo) {
    return (
      <div class="cards">
        {cards.map((c) => (
          <ChangeCard key={`${c.repoId}/${c.name}`} card={c} now={now} from={from} working={working(c)} running={running(c)} merging={merging(c)} stale={stale(c)} />
        ))}
      </div>
    );
  }
  return (
    <div class="cards">
      {groups.map((g) => {
        const expanded = controls.forceExpanded || !isMinimized(controls.overrides, g.repoId, column);
        const bodyId = `group-${column.replace(/[^A-Za-z0-9]+/g, "-")}-${g.repoId}`;
        return (
          <section key={g.repoId} class={`repo-group repo-tint ${expanded ? "" : "minimized"}`} style={repoHue(g.cards[0].hue)} aria-label={g.repoName}>
            <button
              type="button"
              class="repo-group-head"
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-disabled={controls.forceExpanded}
              title={controls.forceExpanded ? "expanded while searching" : expanded ? "minimize this group" : "expand this group"}
              onClick={() => !controls.forceExpanded && controls.onToggle(g.repoId, column)}
            >
              <span class="chevron" aria-hidden="true" />
              <span class="swatch" />
              <span class="name">{g.repoName}</span>
              <span class="count">{g.cards.length}</span>
            </button>
            {expanded && (
              <div class="repo-group-body" id={bodyId}>
                {g.cards.map((c) => (
                  <ChangeCard key={`${c.repoId}/${c.name}`} card={c} now={now} from={from} working={working(c)} running={running(c)} merging={merging(c)} stale={stale(c)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** What each lifecycle column means. */
const COLUMN_HINT: Record<string, string> = {
  Backlog: "Created, no artifact written yet",
  Drafts: "Some artifacts written, not all of them yet",
  Ready: "Every artifact is written; no task ticked yet",
  Implementing: "At least one task ticked",
  Done: "All tasks complete; ready to archive",
  Archived: `Archived changes; the ${ARCHIVED_LIMIT} most recent are shown`,
};

/** Whether the window is narrower than the point where `auto` stacks the columns; follows resizes. */
function useNarrowWindow(): boolean {
  const query = `(max-width: ${STACK_BELOW_PX - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

// `countLabel` replaces the card count in the header when the column shows only part of its cards (Archived).
function Column({ label, cards, now, hot, showRepo, from, countLabel, groups }: { label: string; cards: Card[]; now: number; hot?: boolean; showRepo: boolean; from: string; countLabel?: string; groups: GroupControls }) {
  return (
    <section class={`column ${cards.length === 0 ? "empty" : ""}`}>
      <div class="column-head">
        <span class="stage-dot" data-kind={columnKind(label)} aria-hidden="true" />
        <h2 title={COLUMN_HINT[label]}>{label}</h2>
        <span class={`count ${hot && cards.length ? "hot" : ""}`}>{countLabel ?? cards.length}</span>
      </div>
      <RepoGroups column={label} cards={cards} now={now} showRepo={showRepo} from={from} groups={groups} />
    </section>
  );
}

// `projects`: every repository of the snapshot, for the breadcrumb's project switcher.
function RepoHeader({ repo, projects, config, now, stats, onCreated, onConfig }: { repo: RepoSnapshot; projects: RepoSnapshot[]; config: Config | null; now: number; stats: { open: number; toArchive: number }; onCreated: () => void; onConfig: (config: Config) => void }) {
  const facts = quickViewFacts(repo, config, now);
  const notice = branchNotice(repo);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // The details overlay and the pull-requests dialog, each with the control focus goes back to when it closes.
  const [details, setDetails] = useState<{ section?: DetailSection; opener: HTMLElement } | null>(null);
  const [prs, setPrs] = useState<{ opener: HTMLElement | null } | null>(null);
  // Set while the overlay hands over to the pull-requests dialog, so its closing does not pull focus behind that dialog.
  const handingOver = useRef(false);
  // The same check the console control renders on, so a group never shows up empty; it needs no good scan.
  const ui = useSessionUi();
  const groups = actionGroups({ console: projectConsoleUnavailable(ui.config, ui.agents, repo.id), isGit: repo.isGit, ok: repo.ok });
  // The project's own settings, as on the overview; Disable leaves for the overview once it is saved.
  const tracking = useTracking({
    onConfig,
    rediscover: () => {},
    onDisabled: (id) => {
      const to = afterBoardDisable(id, repo.id);
      if (to) navigate(to);
    },
  });
  const repoConfig = config?.repos.find((r) => r.id === repo.id);
  const settingsOffered = boardSettingsOffered(config, repo.id);
  const openDetails = (opener: HTMLElement, section?: DetailSection) => {
    handingOver.current = false;
    setDetails({ section, opener });
  };
  const action = (a: BoardAction) => {
    const description = { id: actionDescriptionId(a.id), text: a.description };
    switch (a.id) {
      case "console":
        return <ProjectConsoleButton key={a.id} repoId={repo.id} variant="board" description={description} />;
      case "pull":
        return <PullButton key={a.id} repoId={repo.id} repoName={repo.name} description={description} />;
      case "cleanup":
        return <CleanupButton key={a.id} repoId={repo.id} repoName={repo.name} onDone={onCreated} description={description} />;
      case "import":
        // Every eligible git repository: whether it is on GitHub is the dialog's to say, after asking.
        return (
          <button key={a.id} type="button" class="btn" onClick={() => setImporting(true)} title={description.text} aria-describedby={description.id}>
            <IconCircleDot size={15} />
            Import from issues
          </button>
        );
      case "newChange":
        return (
          <button key={a.id} type="button" class="btn primary" onClick={() => setCreating(true)} title={description.text} aria-describedby={description.id}>
            <IconPlus size={15} />
            New change
          </button>
        );
    }
  };
  return (
    <div class="band repo-head">
      <div class="band-main">
        <div class="row band-title">
          <h1 class="crumbs">
            <a
              class="crumb-link"
              href={href("/")}
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              Projects
            </a>
            <span class="sep">/</span>
            <ProjectSwitch repos={projects} current={repo} />
          </h1>
          {settingsOffered && <SettingsButton id={repo.id} name={repo.name} tracking={tracking} />}
        </div>
        {/* The quick view: what matters at a glance. The rest is in Details; the actions have their own area. */}
        <div class="row status quick-view">
          <BoardStats open={stats.open} toArchive={stats.toArchive} />
          {facts.checkouts === "summary" ? (
            <CheckoutSummaryButton checkouts={repo.worktrees} onOpen={(opener) => openDetails(opener, "checkouts")} />
          ) : (
            facts.checkouts === "branch" && repo.currentBranch && <BranchBadge branch={repo.currentBranch} hint="current branch" />
          )}
          {facts.pullRequests && <RepoPullRequestsButton repoId={repo.id} onOpen={(opener) => setPrs({ opener })} />}
          {facts.fetchNote && <FetchNoteBadge input={{ ...repo, autoFetchSeconds: autoFetchSecondsOf(config, repo.id) }} now={now} />}
          {facts.sharedConfig && (
            <span class={`badge ${facts.sharedConfig.tone}`} title={facts.sharedConfig.detail}>
              {facts.sharedConfig.label}
            </span>
          )}
          <button type="button" class="control details-button" aria-haspopup="dialog" aria-label={`Details of ${repo.name}`} title="Everything about this project: its path, checkouts, sync, pull requests, shared config and labels" onClick={(e) => openDetails(e.currentTarget)}>
            <IconInfo size={13} />
            Details
          </button>
        </div>
      </div>
      {groups.length > 0 && (
        <div class="band-actions">
          {groups.map((g) => (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring legend/border styling the action group does not want
            <div key={g.id} class="action-group" role="group" aria-labelledby={`board-group-${g.id}`}>
              <span class="action-group-caption" id={`board-group-${g.id}`}>
                {g.caption}
              </span>
              <div class="action-group-actions">{g.actions.map(action)}</div>
              {g.actions.map((a) => (
                <span key={a.id} id={actionDescriptionId(a.id)} class="visually-hidden">
                  {a.description}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {notice && (
        <div class="notice warn band-note" role="note">
          ⎇ {notice.long}
        </div>
      )}
      {!repo.ok && <div class="notice danger band-note">Scan failed: {repo.error} — showing the last good data.</div>}
      {repo.warnings?.map((w) => (
        <div key={w} class="notice warn band-note">
          {w}
        </div>
      ))}
      {details && (
        <ProjectDetailsDialog
          repo={repo}
          config={config}
          now={now}
          section={details.section}
          returnFocus={() => (handingOver.current ? null : details.opener)}
          onClose={() => setDetails(null)}
          onOpenPullRequests={() => {
            handingOver.current = true;
            setDetails(null);
            setPrs({ opener: details.opener });
          }}
          onChanged={onCreated}
        />
      )}
      {prs && <RepoPullRequestsDialog repoId={repo.id} repoName={repo.name} onClose={() => setPrs(null)} returnFocus={() => prs.opener} />}
      {settingsOffered && config && repoConfig && tracking.settingsOpen === repo.id && <ProjectSettingsDialog repo={repoConfig} config={config} isGit={repo.isGit} tracking={tracking} />}
      {config && repoConfig && tracking.labelsOpen === repo.id && (
        <RepoLabelsDialog repo={repoConfig} repos={config.repos} detected={repo.detectedLabels ?? []} labelColors={config.labelColors} tracking={tracking} />
      )}
      {importing && <ImportIssuesDialog target={{ repoId: repo.id, repoName: repo.name, changes: repo.changes }} onClose={() => setImporting(false)} onImported={onCreated} />}
      {creating && <NewChangeDialog target={{ repoId: repo.id, repoName: repo.name, changes: dependencyChoices(repo.changes) }} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); onCreated(); }} />}
    </div>
  );
}

function RepoNotFound() {
  return (
    <div class="empty">
      <h1>Repository not found</h1>
      <p>It is not tracked (any more). Enable it in Settings, or pick another one.</p>
      <a
        class="btn primary"
        href={href("/")}
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        Back to Projects
      </a>
    </div>
  );
}

/** Whether the page's tab is hidden; follows `visibilitychange`. Never hidden where there is no document. */
function useTabHidden(): boolean {
  const read = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setHidden(read());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/** Initial filters of a board: from `query`, read once at mount. A repository board has no repo filter, so a stray `repos` key is dropped. */
export function initialFilters(query: string, repoId: string | undefined): Filters {
  return { ...parseFilters(query), ...(repoId === undefined ? {} : { repos: [] }) };
}

/**
 * The combined board, or one repository's board when `repoId` is set. Its filters come from `query` when given — the
 * board behind an open detail view, where the URL holds the detail view's query — and from the URL otherwise.
 */
export function Kanban({ snapshot, config, repoId, query, onReload, onConfig = () => {} }: { snapshot: Snapshot | null; config: Config | null; repoId?: string; query?: string; onReload?: () => void; onConfig?: (config: Config) => void }) {
  const [filters, setFiltersState] = useState<Filters>(() => initialFilters(query ?? currentQuery(), repoId));
  const { worktrees, sessions } = useSessionUi();
  const layout = resolveLayout(filters.layout, useNarrowWindow());
  const now = Date.now();

  const setFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFiltersState(next);
    replaceQuery(serializeFilters(next));
  };

  // Which repository groups are minimized; remembered in the browser, deviations from the defaults only.
  const [groupOverrides, setGroupOverrides] = useState<GroupOverrides>(loadGroupState);
  const toggleGroupState = (groupRepoId: string, column: string) => {
    const next = toggleGroup(groupOverrides, groupRepoId, column);
    setGroupOverrides(next);
    // Prune against every tracked repository (not just the visible ones); without a snapshot nothing is known, so keep all.
    saveGroupState(next, snapshot ? snapshot.repos.map((r) => r.id) : Object.keys(next).map((key) => key.slice(0, key.indexOf("|"))));
  };
  const groupControls: GroupControls = { overrides: groupOverrides, onToggle: toggleGroupState, forceExpanded: filters.q.trim() !== "" };

  const single = repoId !== undefined;
  // Cards carry this board and its filters, so the detail view can lead back here.
  const from = boardFrom(repoId === undefined ? "/board" : repoPath(repoId), serializeFilters(filters));
  const repos: RepoSnapshot[] = useMemo(() => (snapshot?.repos ?? []).filter((r) => !single || r.id === repoId), [snapshot, single, repoId]);
  // Hues come from every repository in the snapshot — not the filtered ones, nor just this board's — so a colour never depends on the view.
  const hues = useMemo(() => assignRepoHues((snapshot?.repos ?? []).map((r) => r.id)), [snapshot]);
  // The cached pull requests at once; a refresh, when opening this board started one, adds links in place.
  const prs = usePullRequests();
  const cards: Card[] = useMemo(() => boardCards(repos, hues, prs.data), [repos, hues, prs.data]);
  // Opening a board is the third way a view showing pull requests may refresh a stale cache — once, here, and never on
  // a timer or after a scan: the board's instance outlives scans and an open detail view (openspec/specs/pull-requests).
  const { loading: prsLoading, openBoard } = prs;
  useEffect(() => {
    if (!prsLoading) openBoard(repoId);
  }, [prsLoading, openBoard, repoId]);
  // The one timed exception: while this board is open and its tab visible, the repositories of its cards whose pull
  // request is open and not ready are refreshed on their own — re-planned from every answer, so a ready pull request
  // ends it, and disarmed when the board is left or the tab hidden (openspec/specs/pull-requests).
  const hidden = useTabHidden();
  const { watch, lastSettledAt, running: prsRunning } = prs;
  // A Merge prompt a session recorded keeps its pull request watched until it merges, closes or gets a new head.
  const pendingMerges = useMemo(() => pendingMergesOf(sessions), [sessions]);
  // Wrapped, never passed bare: `io.setTimer(…)` would call the browser's setTimeout on `io` — "Illegal invocation".
  useEffect(
    () => armWatch({ plan: watchPlan(cards, prs.data?.repos, Date.now(), lastSettledAt(), pendingMerges), hidden, now: Date.now(), watch, setTimer: (run, ms) => setTimeout(run, ms), clearTimer: (h) => clearTimeout(h as number) }),
    [cards, prs.data, prsRunning, hidden, watch, lastSettledAt, pendingMerges],
  );

  const visible = useMemo(() => visibleCards(cards, filters, single, now, sessions), [cards, filters, single, now, sessions]);

  // A single-repository board follows that repository's own schemas, not the majority across all repos.
  const columns = useMemo(() => (snapshot ? boardColumns({ ...snapshot, repos }) : []), [snapshot, repos]);

  // The combined board's "New change": the project list follows every snapshot, the pre-selection is taken when it opens.
  const targets = useMemo(() => newChangeTargets(single ? [] : repos, filters.repos), [single, repos, filters.repos]);
  const [creating, setCreating] = useState<{ preselected?: string } | null>(null);

  const stats = boardStats(cards, visible);
  // The Archived column's candidates: with Hide merged on, only archives that still have to be pushed or merged, and
  // those whose change still has a running session.
  const archivedCards = visible.filter((c) => c.column === "Archived" && archivedShown(c, filters.hideMerged, worktrees, sessions));
  // What the columns on screen hold: archived cards only while their column is shown, and at most its bound.
  const archivedVisible = archivedCards.length;
  const nonArchived = visible.filter((c) => c.column !== "Archived").length;
  const showing = nonArchived + (filters.hideArchived ? 0 : Math.min(archivedVisible, ARCHIVED_LIMIT));

  if (snapshot && snapshot.repos.length === 0) return <NoRepos config={config} />;
  if (snapshot && single && repos.length === 0) return <RepoNotFound />;

  return (
    <>
      {single && repos[0] && <RepoHeader repo={repos[0]} projects={snapshot?.repos ?? repos} config={config} now={now} stats={stats} onCreated={() => onReload?.()} onConfig={onConfig} />}
      {!single && (
        <div class="band">
          <div class="band-main">
            <div class="row band-title">
              <h1>
                All changes
                <span class="band-sub">
                  {repos.length} {repos.length === 1 ? "repository" : "repositories"} · {changesDirs(repos)}
                </span>
              </h1>
              <span class="divider" aria-hidden="true" />
              <BoardStats open={stats.open} toArchive={stats.toArchive} />
            </div>
          </div>
          {targets.projects.length > 0 && (
            <div class="band-actions">
              <button type="button" class="btn primary" onClick={() => setCreating({ preselected: targets.preselected })}>
                <IconPlus size={15} />
                New change
              </button>
            </div>
          )}
        </div>
      )}
      <FilterBar filters={filters} setFilters={setFilters} repos={repos} hues={hues} single={single} showing={showing} layout={layout} />
      {!single && creating && (
        <NewChangeDialog
          target={{ projects: targets.projects, preselected: creating.preselected, byLabel: { repos, config } }}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            onReload?.();
          }}
          onReload={onReload}
        />
      )}
      <div class={`board ${layout === "stack" ? "stacked" : ""}`}>
        {columns.map((label) => {
          const inColumn = visible.filter((c) => c.column === label);
          if (label !== "Archived") {
            return <Column key={label} label={label} cards={inColumn} now={now} hot={label === "Done"} showRepo={!single} from={from} groups={groupControls} />;
          }
          if (filters.hideArchived) return null;
          // A regular column, but bounded to the most recent archives; the header still reports the total.
          const recent = recentArchived(archivedCards, ARCHIVED_LIMIT);
          const countLabel = recent.length < archivedCards.length ? `${recent.length} of ${archivedCards.length}` : undefined;
          return <Column key={label} label={label} cards={recent} now={now} showRepo={!single} from={from} countLabel={countLabel} groups={groupControls} />;
        })}
      </div>
    </>
  );
}
