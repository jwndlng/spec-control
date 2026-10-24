// The Pull requests view, the dialog on a repository board, the cache they and the board's cards read from, and what a
// card and the detail header show of a change's pull request.
//
// GitHub is contacted only from here, and only because the user activated Refresh, opened one of the three views that
// show pull requests — this view, a repository's dialog, a Kanban board — with a stale cache, or an open, visible board
// watches a pull request that is not ready yet (openspec/specs/pull-requests). The page itself requests nothing but the dashboard's own API: the links
// to github.com are ordinary links the user follows.
import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { linkedPullRequest } from "../shared/pullRequestLink.ts";
import { type Readiness, pullRequestReadiness, readinessDetail, readinessRole, readinessWord } from "../shared/pullRequestReadiness.ts";
import type { ChangeSnapshot, PullRequest, PullRequestsResponse, Snapshot } from "../shared/types.ts";
import { api } from "./api.ts";
import { Stat } from "./band.tsx";
import { relTime } from "./format.ts";
import { IconChevronDown, IconGitPullRequest, IconRefresh, IconRotateCcw } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import {
  createPrRefresher,
  DEFAULT_PR_FILTERS,
  ghSetup,
  newestFetchedAt,
  openCount,
  parsePrFilters,
  type PrEntry,
  type PrFilters,
  type PrGroups,
  type PrNotice,
  type PrRepo,
  prAgeAt,
  pullRequestEntries,
  pullRequestNotices,
  pullRequestsQuery,
  serializePrFilters,
} from "./pullRequestsState.ts";
import { assignRepoHues } from "./repoGroups.ts";
import { PULL_REQUESTS_PATH } from "./routes.ts";
import { currentQuery, hrefWithQuery, navigate, replaceQuery } from "./url.ts";

interface PullRequestsUi {
  data?: PullRequestsResponse;
  /** The first read of the cache has not answered yet. */
  loading: boolean;
  /** A refresh is running: for everything, or for one repository. */
  running: string | "all" | undefined;
  error?: string;
  /** Refreshes through the API. `force` skips the freshness window; without it the server decides. */
  refresh(options?: { repoId?: string; force?: boolean }): Promise<void>;
  /** Refreshes only when a shown list is older than the freshness window — what opening a view does. */
  refreshIfStale(repoId?: string): void;
  /** What a board does once, when it opens: `refreshIfStale`, unless the lists are synthetic (the demo). */
  openBoard(repoId?: string): void;
  /** The board's watch: a forced refresh of these repositories, unless a refresh runs or the lists are synthetic. */
  watch(repoIds: string[]): void;
  /** When the last refresh of this page settled; the watch counts from it. */
  lastSettledAt(): number | undefined;
}

const Context = createContext<PullRequestsUi>({
  loading: false,
  running: undefined,
  refresh: async () => {},
  refreshIfStale: () => {},
  openBoard: () => {},
  watch: () => {},
  lastSettledAt: () => undefined,
});

export const usePullRequests = () => useContext(Context);

/**
 * Holds the cached lists for every view. Reading them on mount contacts nothing; only `refresh` does, and only from
 * a Refresh control, a view that shows pull requests opening with a stale cache, or an open board's watch of pull
 * requests that are not ready — never any other timer, a scan or the overview.
 */
export function PullRequestsProvider({ children }: { children: ComponentChildren }) {
  const [data, setData] = useState<PullRequestsResponse>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | "all" | undefined>();
  const [error, setError] = useState<string>();
  const latest = useRef<PullRequestsResponse>();
  // At most one refresh at a time: a second view opening meanwhile joins the one in flight instead of asking again.
  const refresher = useMemo(
    () =>
      createPrRefresher({
        current: () => latest.current,
        fetch: (options) => api.refreshPullRequests(options),
        onStart: setRunning,
        onAnswer: (answer) => {
          latest.current = answer;
          setData(answer);
          setError(undefined);
        },
        onError: setError,
        onSettled: () => setRunning(undefined),
        synthetic: api.syntheticPullRequests === true,
      }),
    [],
  );

  useEffect(() => {
    let live = true;
    api
      .pullRequests()
      .then((answer) => {
        if (!live) return;
        latest.current = answer;
        setData(answer);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const refresh = refresher.refresh;
  const refreshIfStale = useCallback((repoId?: string) => void refresher.refreshIfStale(repoId), [refresher]);
  const openBoard = useCallback((repoId?: string) => void refresher.openBoard(repoId), [refresher]);
  const watch = useCallback((repoIds: string[]) => void refresher.watch(repoIds), [refresher]);

  return (
    <Context.Provider value={{ data, loading, running, error, refresh, refreshIfStale, openBoard, watch, lastSettledAt: refresher.lastSettledAt }}>{children}</Context.Provider>
  );
}

// ---- chips ----

const STATE_CHIP: Record<PullRequest["state"], { text: string; title: string; tone: string }> = {
  open: { text: "Open", title: "Open on GitHub", tone: "" },
  merged: { text: "Merged", title: "Merged", tone: "success" },
  closed: { text: "Closed", title: "Closed without merging", tone: "quiet" },
};

const REVIEW_CHIP: Record<PullRequest["review"], { text: string; title: string; tone: string } | undefined> = {
  approved: { text: "✓ Approved", title: "Review decision: approved", tone: "success" },
  changes_requested: { text: "Changes requested", title: "Review decision: changes requested", tone: "warning" },
  review_required: { text: "Review required", title: "Review decision: review required", tone: "" },
  none: undefined,
};

const CHECKS_CHIP: Record<PullRequest["checks"], { text: string; title: string; tone: string } | undefined> = {
  passing: { text: "✓ Checks", title: "All checks passed", tone: "success" },
  failing: { text: "✕ Checks", title: "At least one check failed", tone: "danger" },
  pending: { text: "… Checks", title: "Checks are still running", tone: "warning" },
  none: undefined,
};

/**
 * Text plus a symbol plus a tooltip — never colour alone. `spoken` puts the tooltip's words in the text a screen reader
 * reads instead of the short symbol form (`✕ Checks` is read as "At least one check failed").
 */
function Chip({ chip, spoken = false }: { chip: { text: string; title: string; tone: string }; spoken?: boolean }) {
  return (
    <span class={`badge pr-chip ${chip.tone}`} title={chip.title}>
      {spoken ? (
        <>
          <span aria-hidden="true">{chip.text}</span>
          <span class="visually-hidden">{chip.title}</span>
        </>
      ) : (
        chip.text
      )}
    </span>
  );
}

// ---- entries ----

const repoHue = (hue: number) => ({ "--repo-hue": String(hue) });

/** The state chip: `Draft` for an open draft, else the state itself. */
function stateChip(pr: PullRequest): { text: string; title: string; tone: string } {
  return pr.draft && pr.state === "open" ? { text: "Draft", title: "A draft pull request", tone: "quiet" } : STATE_CHIP[pr.state];
}

/** The state as one word, as a card and an accessible name say it. */
export function prStateWord(pr: PullRequest): "draft" | "open" | "merged" | "closed" {
  return pr.draft && pr.state === "open" ? "draft" : pr.state;
}

const STATE_SYMBOL: Record<ReturnType<typeof prStateWord>, string> = { open: "○", draft: "◌", merged: "✓", closed: "✕" };

const READINESS_SYMBOL: Record<ReturnType<typeof readinessWord>, string> = {
  ready: "✓",
  draft: "◌",
  conflicts: "⚠",
  "checks failing": "✕",
  "checks running": "…",
  "mergeability unknown": "?",
};

/** When the list a pull request came from was fetched, for a tooltip: readiness is only as fresh as that. */
function fetchedText(fetchedAt: string | undefined, now?: number): string {
  if (!fetchedAt) return "list not fetched in this session";
  const age = relTime(fetchedAt, now);
  return `list fetched ${age === "just now" ? age : `${age} ago`}`;
}

/** A readiness as the card and the header both show it: symbol, word, role and what it waits for. */
function readinessChip(readiness: Readiness, fetchedAt: string | undefined, now?: number): { text: string; title: string; tone: string; word: string; symbol: string } {
  const word = readinessWord(readiness);
  const symbol = READINESS_SYMBOL[word];
  return { text: `${symbol} ${word}`, title: `${readinessDetail(readiness)} (${fetchedText(fetchedAt, now)})`, tone: readinessRole(readiness), word, symbol };
}

/**
 * A card's link to its change's pull request, on the footer's status line. The state is a symbol and a word, with a
 * tooltip; a merged or closed pull request is still shown, more quietly. An open one also says whether it is ready, or
 * the one reason it is not, in its role's colour — a draft's state already says that. A link the user follows — the
 * page itself never requests github.com.
 */
export function CardPullRequest({ pr, repoName, fetchedAt, now, merging }: { pr: PullRequest; repoName: string; fetchedAt?: string; now?: number; merging?: string }) {
  const word = prStateWord(pr);
  const settled = pr.state !== "open";
  const readiness = pullRequestReadiness(pr);
  const chip = readiness && readinessChip(readiness, fetchedAt, now);
  const waits = chip ? `; ${chip.title.charAt(0).toLowerCase()}${chip.title.slice(1)}` : "";
  return (
    <a
      class={`card-pr ${settled ? "settled" : ""} ${word}`}
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${pr.title} — ${stateChip(pr).title.toLowerCase()}${waits}; open on GitHub`}
      aria-label={`Pull request #${pr.number} of ${repoName}, ${word}${chip ? `, ${chip.word === "ready" ? "ready" : `not ready: ${chip.word}`}` : ""}, opens on GitHub`}
    >
      PR #{pr.number}
      <span class="card-pr-state">
        <span aria-hidden="true">{STATE_SYMBOL[word]}</span> {word}
      </span>
      {chip && word !== "draft" && (
        <span class={`card-pr-ready ${chip.tone}`}>
          <span aria-hidden="true">· {chip.symbol}</span> {chip.word}
        </span>
      )}
      {merging && (
        <span class="card-pr-ready" title={`Spec Control ${merging}; the merge shows here once a refresh lists it merged`}>
          <span aria-hidden="true">·</span> {merging}
        </span>
      )}
    </a>
  );
}

/** What the detail header knows about a change's pull request: the linked one (and when its list was fetched), or why there can be none. */
export type DetailPr = { pr: PullRequest; fetchedAt?: string; unavailable?: undefined } | { pr?: undefined; unavailable: string };

/** When the change's repository's list was last fetched, for saying how fresh a readiness is. */
export function listFetchedAt(response: PullRequestsResponse | undefined, repoId: string): string | undefined {
  return response?.repos.find((r) => r.repoId === repoId)?.fetchedAt;
}

/** The linked pull request; else, when the repository's pull requests cannot be read, the reason — said once. */
export function detailPullRequest(change: Pick<ChangeSnapshot, "repoId" | "name" | "branchMatch" | "created" | "recorded">, response: PullRequestsResponse | undefined): DetailPr | undefined {
  const pr = linkedPullRequest(change, response?.repos);
  if (pr) return { pr, fetchedAt: listFetchedAt(response, change.repoId) };
  const list = response?.repos.find((r) => r.repoId === change.repoId);
  if (!response || !list || list.status !== "unavailable") return undefined;
  return { unavailable: ghSetup(response)?.what ?? list.reason ?? "this repository's pull requests cannot be read" };
}

const CONFLICTS_CHIP = { text: "⚠ Conflicts", title: "Conflicts with its base branch", tone: "warning" };

/**
 * The detail header's pull-request line: number, title, state, review, checks, conflicts and — for an open one — its
 * readiness with the card's words, symbols and roles, read-only and as the view shows them.
 */
export function DetailPullRequest({ info }: { info: DetailPr }) {
  if (info.unavailable !== undefined) {
    return (
      <span class="hint detail-pr-unavailable" title="Why no pull request is shown for this change">
        pull requests unavailable: {info.unavailable}
      </span>
    );
  }
  const { pr } = info;
  const review = REVIEW_CHIP[pr.review];
  const checks = CHECKS_CHIP[pr.checks];
  const readiness = pullRequestReadiness(pr);
  const ready = readiness && readinessChip(readiness, info.fetchedAt);
  // The readiness already says "conflicts" when that is its reason; a draft that also conflicts says it here.
  const conflicts = readiness && pr.mergeable === "conflicting" && ready?.word !== "conflicts";
  return (
    <span class="detail-pr">
      <span class="pr-number mono">
        <span class="visually-hidden">Pull request </span>#{pr.number}
      </span>
      <a class="pr-title" href={pr.url} target="_blank" rel="noopener noreferrer" title={`${pr.title} — open on GitHub`}>
        {pr.title}
      </a>
      <Chip chip={stateChip(pr)} spoken />
      {review && <Chip chip={review} spoken />}
      {checks && <Chip chip={checks} spoken />}
      {conflicts && <Chip chip={CONFLICTS_CHIP} spoken />}
      {ready && <Chip chip={ready} spoken />}
    </span>
  );
}

function Entry({ entry, hue, showRepo }: { entry: PrEntry; hue?: number; showRepo: boolean }) {
  const { pr } = entry;
  const age = prAgeAt(pr);
  const verb = pr.state === "open" ? "opened" : pr.state === "merged" ? "merged" : "closed";
  const review = REVIEW_CHIP[pr.review];
  const checks = CHECKS_CHIP[pr.checks];
  return (
    <li class={`pr-entry ${hue === undefined ? "" : "repo-tint"}`} style={hue === undefined ? undefined : repoHue(hue)}>
      <div class="pr-main">
        {showRepo && (
          <span class="repo" title={entry.alsoIn.length ? `also tracked as ${entry.alsoIn.join(", ")}` : (entry.github ?? entry.repoName)}>
            <span class="swatch" />
            {entry.repoName}
          </span>
        )}
        <span class="pr-number mono">#{pr.number}</span>
        {/* A link the user follows; the page itself never requests github.com. */}
        <a class="pr-title" href={pr.url} target="_blank" rel="noopener noreferrer" title={`${pr.title} — open on GitHub`}>
          {pr.title}
        </a>
        {pr.reviewRequestedFromViewer && (
          <span class="badge pr-chip attention" title="Your review is requested on this pull request">
            review requested from you
          </span>
        )}
      </div>
      <div class="pr-meta">
        <Chip chip={stateChip(pr)} />
        {review && <Chip chip={review} />}
        {checks && <Chip chip={checks} />}
        <span class="pr-branch mono truncate" title={`${pr.head} → ${pr.base}`}>
          {pr.head}
        </span>
        {pr.author && <span class="pr-author">{pr.author}</span>}
        <span class="pr-age" title={age ? new Date(age).toLocaleString() : undefined}>
          {verb} {relTime(age)}
          {relTime(age) === "just now" ? "" : " ago"}
        </span>
      </div>
    </li>
  );
}

/** The two groups, as the view and the repository dialog both show them. */
export function PullRequestList({ groups, hues, showRepo }: { groups: PrGroups; hues?: Map<string, number>; showRepo: boolean }) {
  const section = (label: string, entries: PrEntry[]) =>
    entries.length === 0 ? null : (
      <section class="pr-group" aria-label={label}>
        <h2>
          {label}
          <span class="count">{entries.length}</span>
        </h2>
        <ol>
          {entries.map((entry) => (
            <Entry key={`${entry.github ?? entry.repoId}#${entry.pr.number}`} entry={entry} hue={hues?.get(entry.repoId)} showRepo={showRepo} />
          ))}
        </ol>
      </section>
    );
  return (
    <>
      {section("Open", groups.open)}
      {section("Recently merged or closed", groups.closed)}
    </>
  );
}

/** What could not be listed, folded away: reasons belong in the view, not in the middle of the list. */
/**
 * Repositories with nothing listed, in up to two collapsed notes: those that are not on GitHub, which is information,
 * and those whose query failed, marked as a warning.
 */
export function Notices({ notices }: { notices: PrNotice[] }) {
  const offGitHub = notices.filter((n) => n.kind === "not-on-github");
  const failed = notices.filter((n) => n.kind === "failed");
  return (
    <>
      {offGitHub.length > 0 && (
        <details class="pr-notices">
          <summary>
            {offGitHub.length} {offGitHub.length === 1 ? "repository isn't" : "repositories aren't"} on GitHub
          </summary>
          <NoticeList notices={offGitHub} />
        </details>
      )}
      {failed.length > 0 && (
        <details class="pr-notices warn">
          <summary>
            ⚠ {failed.length} {failed.length === 1 ? "repository" : "repositories"} could not be listed
          </summary>
          <NoticeList notices={failed} />
        </details>
      )}
    </>
  );
}

function NoticeList({ notices }: { notices: PrNotice[] }) {
  return (
    <ul>
      {notices.map((n) => (
        <li key={n.repoId}>
          <strong>{n.repoName}</strong>
          {n.kind === "failed" && <span class="badge warning">failed</span>}
          <span class="hint">{n.reason ?? "no reason given"}</span>
          {n.hasList && <span class="hint">showing the last list that was fetched</span>}
        </li>
      ))}
    </ul>
  );
}

function GhSetupNotice({ response }: { response: PullRequestsResponse }) {
  const setup = ghSetup(response);
  if (!setup) return null;
  return (
    <div class="notice warn" role="note">
      <strong>{setup.what}</strong> {setup.how} The dashboard uses your own <code>gh</code> sign-in and never sees a token.
    </div>
  );
}

function FetchAge({ response }: { response: PullRequestsResponse | undefined }) {
  const at = response && newestFetchedAt(response);
  if (!at) return <span class="hint">not fetched yet</span>;
  const age = relTime(at);
  return (
    <span class="hint" title={new Date(at).toLocaleString()}>
      fetched {age === "just now" ? age : `${age} ago`}
    </span>
  );
}

export function RefreshButton({ repoId, compact = false }: { repoId?: string; compact?: boolean }) {
  const ui = usePullRequests();
  const running = ui.running !== undefined;
  return (
    <button
      type="button"
      class={`btn sm ${compact ? "ghost" : ""}`}
      disabled={running}
      title="Ask GitHub for these pull requests now, through your own gh sign-in"
      onClick={() => void ui.refresh({ repoId, force: true })}
    >
      <IconRefresh size={13} />
      {running ? "Refreshing…" : "Refresh"}
    </button>
  );
}

// ---- the view ----

const STATE_LABEL: Record<PrFilters["state"], string> = { all: "Open and recently closed", open: "Open only", closed: "Recently merged or closed" };

export function PullRequestsView({ snapshot }: { snapshot: Snapshot | null }) {
  const ui = usePullRequests();
  const [filters, setFiltersState] = useState<PrFilters>(() => parsePrFilters(currentQuery()));

  const setFilters = (patch: Partial<PrFilters>) => {
    const next = { ...filters, ...patch };
    setFiltersState(next);
    replaceQuery(serializePrFilters(next));
  };

  // Opening the view refreshes when the cached lists are stale — the one place besides Refresh that contacts GitHub.
  const { refreshIfStale, loading } = ui;
  useEffect(() => {
    if (!loading) refreshIfStale();
  }, [loading, refreshIfStale]);

  const repos: PrRepo[] = useMemo(() => (snapshot?.repos ?? []).map((r) => ({ id: r.id, name: r.name })), [snapshot]);
  const hues = useMemo(() => assignRepoHues(repos.map((r) => r.id)), [repos]);
  const data = ui.data;
  const groups = useMemo(() => (data ? pullRequestEntries(data, repos, filters) : { open: [], closed: [] }), [data, repos, filters]);
  const notices = useMemo(() => (data ? pullRequestNotices(data, repos, filters) : []), [data, repos, filters]);
  const total = groups.open.length + groups.closed.length;
  const filtered = filters.repo !== undefined || filters.state !== "all" || filters.mine;
  const awaitingMe = groups.open.filter((e) => e.pr.reviewRequestedFromViewer).length;

  return (
    <>
      <div class="band">
        <div class="band-main">
          <div class="row band-title">
            <h1>
              Pull requests
              <span class="band-sub">open and recently closed, across all tracked repositories</span>
            </h1>
            <span class="divider" aria-hidden="true" />
            <span class="stats">
              <Stat label="Open" value={groups.open.length} />
              <Stat label="Awaiting your review" value={awaitingMe} tone={awaitingMe > 0 ? "success" : undefined} />
            </span>
          </div>
        </div>
        <div class="band-actions">
          <FetchAge response={data} />
          <RefreshButton />
        </div>
      </div>
      <div class="filterbar">
        <div class="filterbar-row">
          <label class="control select-control" for="pr-repo">
            <span>Repository</span>
            <select id="pr-repo" value={filters.repo ?? ""} onChange={(e) => setFilters({ repo: e.currentTarget.value || undefined })}>
              <option value="">All repositories</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
          </label>
          <label class="control select-control" for="pr-state">
            <span>Show</span>
            <select id="pr-state" value={filters.state} onChange={(e) => setFilters({ state: e.currentTarget.value as PrFilters["state"] })}>
              {(["all", "open", "closed"] as PrFilters["state"][]).map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
          </label>
          <button
            type="button"
            class={`control switch-control ${filters.mine ? "on" : ""}`}
            aria-pressed={filters.mine}
            title="Only open pull requests whose review is requested from the signed-in GitHub user"
            onClick={() => setFilters({ mine: !filters.mine })}
          >
            <span class="switch" aria-hidden="true" />
            Review requested from me
          </button>
          {filtered && (
            <button type="button" class="btn sm ghost clear-filters" onClick={() => setFilters(DEFAULT_PR_FILTERS)}>
              <IconRotateCcw size={12} />
              Clear filters
            </button>
          )}
          <span class="spacer" />
          {data?.viewer && <span class="hint">signed in as {data.viewer}</span>}
        </div>
      </div>
      <div class="pull-requests">
        {ui.error && <div class="notice danger">{ui.error}</div>}
        {data && <GhSetupNotice response={data} />}
        <Notices notices={notices} />
        {ui.loading && <div class="hint">Loading…</div>}
        {!ui.loading && total === 0 && (
          <div class="empty pr-empty">
            <h2>{filtered ? "Nothing matches these filters" : "No recent pull requests"}</h2>
            <p class="hint">
              {filtered ? "Try another repository, state, or turn the review filter off." : "Open pull requests and those merged or closed in the last 7 days appear here."}{" "}
              <FetchAge response={data} />
            </p>
          </div>
        )}
        <PullRequestList groups={groups} hues={hues} showRepo={filters.repo === undefined} />
      </div>
    </>
  );
}

// ---- the repository board's control ----

/**
 * The board header's pull requests control and its dialog. Opening it refreshes the repository's list when that list
 * is stale; the board itself never contacts GitHub.
 */
export function RepoPullRequestsButton({ repoId, onOpen }: { repoId: string; onOpen: (opener: HTMLElement) => void }) {
  const ui = usePullRequests();
  const count = openCount(ui.data, repoId);
  const label = count.open === undefined ? "Pull requests" : `${count.open} open ${count.open === 1 ? "PR" : "PRs"}`;
  return (
    <button
      type="button"
      class={`control pr-button ${count.awaitingMe ? "attention" : ""}`}
      aria-haspopup="dialog"
      title={count.open === undefined ? (count.reason ?? "pull requests have not been fetched yet") : "This repository's pull requests on GitHub"}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <IconGitPullRequest size={13} />
      {label}
      {count.awaitingMe > 0 && <span class="control-value">{count.awaitingMe} for you</span>}
    </button>
  );
}

/**
 * The repository's pull requests in a dialog, opened from the board's quick view or its project details. Opening it is
 * one of the ways a stale cache is refreshed (openspec/specs/pull-requests), wherever it was opened from.
 */
export function RepoPullRequestsDialog({ repoId, repoName, onClose, returnFocus }: { repoId: string; repoName: string; onClose: () => void; returnFocus?: () => HTMLElement | null }) {
  const ui = usePullRequests();
  const list = ui.data?.repos.find((r) => r.repoId === repoId);
  const groups = useMemo(
    () => (ui.data ? pullRequestEntries(ui.data, [{ id: repoId, name: repoName }], { ...DEFAULT_PR_FILTERS, repo: repoId }) : { open: [], closed: [] }),
    [ui.data, repoId, repoName],
  );
  const query = pullRequestsQuery(repoId);
  const { refreshIfStale } = ui;
  useEffect(() => refreshIfStale(repoId), [refreshIfStale, repoId]);
  return (
    <Modal
      label={`Pull requests of ${repoName}`}
      title={`Pull requests of ${repoName}`}
      subtitle={
        <>
          <FetchAge response={ui.data} />
          {list?.github ? ` · ${list.github}` : ""}
        </>
      }
      icon={<IconGitPullRequest size={18} />}
      onClose={onClose}
      returnFocus={returnFocus}
      wide
    >
      <div class="pr-dialog">
        <div class="pr-dialog-actions">
          <RefreshButton repoId={repoId} />
          <a
            class="btn sm ghost"
            href={hrefWithQuery(PULL_REQUESTS_PATH, query)}
            onClick={(e) => {
              e.preventDefault();
              onClose();
              navigate(PULL_REQUESTS_PATH, query);
            }}
          >
            Open in Pull requests
          </a>
        </div>
        {ui.error && <div class="notice danger">{ui.error}</div>}
        {ui.data && <GhSetupNotice response={ui.data} />}
        {list && (list.status === "unavailable" || list.status === "failed") && !list.setup && (
          <div class={`notice ${list.status === "failed" ? "warn" : ""}`} role="note">
            {list.reason ?? "this repository's pull requests are unavailable"}
          </div>
        )}
        {groups.open.length + groups.closed.length === 0 ? <p class="hint">No open or recently closed pull requests.</p> : <PullRequestList groups={groups} showRepo={false} />}
      </div>
    </Modal>
  );
}

/** The overview's figure: cached only, and a link into the filtered view. */
export function OpenPrCount({ repoId, compact = false }: { repoId: string; compact?: boolean }) {
  const ui = usePullRequests();
  const count = openCount(ui.data, repoId);
  const query = pullRequestsQuery(repoId);
  if (count.open === undefined) {
    return (
      <span class="zero" title={count.reason ?? "pull requests have not been fetched yet"}>
        ·
      </span>
    );
  }
  const parts = [`${count.open} open pull request${count.open === 1 ? "" : "s"}`];
  if (count.awaitingMe > 0) parts.push(`${count.awaitingMe} awaiting your review`);
  parts.push(count.fetchedAt ? `fetched ${relTime(count.fetchedAt)} ago`.replace("just now ago", "just now") : "never fetched");
  if (count.reason) parts.push(count.reason);
  return (
    <a
      class={`pr-count ${count.awaitingMe ? "attention" : ""} ${compact ? "compact" : ""}`}
      href={hrefWithQuery(PULL_REQUESTS_PATH, query)}
      title={parts.join(" · ")}
      onClick={(e) => {
        // The overview's rows and tiles open the board on a click; this link goes to the Pull requests view instead.
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(PULL_REQUESTS_PATH, query);
      }}
    >
      {count.open}
      {count.awaitingMe > 0 && <span class="for-you">{count.awaitingMe}</span>}
    </a>
  );
}
