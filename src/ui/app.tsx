import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Config, Snapshot, UpdateStatus } from "../shared/types.ts";
import { Activity } from "./activity.tsx";
import { loadSeen, saveSeen, unseenLabel } from "./activityState.ts";
import { api } from "./api.ts";
import { AUTO_REFRESH_OPTIONS, type AutoRefreshInterval, createRefreshLoop, intervalMs, loadInterval, parseInterval, performRefresh, saveInterval } from "./autoRefresh.ts";
import { ChangeDetail } from "./changeDetail.tsx";
import { ConsoleButton, ConsoleOverlay } from "./console.tsx";
import { IntegrationOverlay } from "./integrate.tsx";
import { ProjectConsoleOverlay } from "./projectConsole.tsx";
import { relTime } from "./format.ts";
import { Kanban } from "./kanban.tsx";
import { Overview } from "./overview.tsx";
import { PullProvider } from "./pull.tsx";
import { PullRequestsProvider, PullRequestsView } from "./pullRequests.tsx";
import { enabledOnly } from "./overviewState.ts";
import { backTarget, parseDetailQuery, repoPath, type Route, routeFromPath } from "./routes.ts";
import { EndSessionDialog } from "./endSessionDialog.tsx";
import { OpenWork, SessionProvider } from "./sessions.tsx";
import { environmentWarning, type EnvironmentState } from "./environmentState.ts";
import { Settings } from "./settings.tsx";
import { currentPath, currentQuery, followInApp, href, hrefWithQuery, navigate, onRouteChange } from "./url.ts";
import { applyTheme, loadPreference, nextPreference, resolveTheme, savePreference, type ThemePreference } from "./theme.ts";
import { Help } from "./help.tsx";
import { IconActivity, IconChevronDown, IconClock, IconGitPullRequest, IconHelp, IconKanban, IconLayoutGrid, IconMonitor, IconMoon, IconRefresh, IconSettings, IconSun } from "./icons.tsx";
import { HeroHomeMark, HeroHomeTitle } from "./heroHome.tsx";
import { loadDismissed, saveDismissed, UPDATE_REREAD_MS, UpdateBanner, VersionLabel } from "./updateBanner.tsx";
import { WhatsNew } from "./whatsNew.tsx";
import { SetupWizard } from "./setupWizard.tsx";
import { setupAutoOpens, shouldOpenSetup } from "./setupState.ts";
import { Tour } from "./tour.tsx";
import { loadTourSeen, saveTourSeen, shouldAutoStart, TOUR_ANCHOR, type TourAnchor, tourAutoStarts } from "./tourState.ts";

const THEME_LABEL: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };
const THEME_ICON: Record<ThemePreference, typeof IconSun> = { system: IconMonitor, light: IconSun, dark: IconMoon };

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromPath(currentPath()));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** How often the dashboard repeats a refresh by itself; a per-browser choice, never the server's poll interval. */
  const [autoRefresh, setAutoRefresh] = useState<AutoRefreshInterval>(loadInterval);
  /** The snapshot time a refresh compares against, in a ref so a new snapshot does not rebuild the refresh callback. */
  const generatedAt = useRef<string | undefined>(undefined);
  /** A refresh is in flight. A ref, not state: two callers in one frame must not both get through. */
  const busy = useRef(false);
  /** A one-line outcome of an action taken in an overlay that has since closed, e.g. a dismissed change. */
  const [notice, setNotice] = useState<string>();
  const [, tick] = useState(0);
  const [themePref, setThemePref] = useState<ThemePreference>(loadPreference);
  const [unseen, setUnseen] = useState(0);
  // The main console overlay. Not in the route: opening and closing it leaves the page (and its filters) as it was.
  const [consoleOpen, showConsole] = useState(false);
  // The terminal of an integration started from Settings; same reasoning, and the same need to make the page inert.
  const [integrationId, showIntegration] = useState<string>();
  // The project whose console overlay is open; like the main console, not in the route.
  const [projectConsoleRepoId, showProjectConsole] = useState<string>();
  /** What this machine is missing. Owned here because both Settings and the hero read the same report. */
  const [environment, setEnvironment] = useState<EnvironmentState>({ loading: true });
  /** What the server last learned about newer releases; read here because the banner and Settings both show it. */
  const [update, setUpdate] = useState<UpdateStatus>();
  /** The release version whose banner was dismissed in this browser. */
  const [updateDismissed, setUpdateDismissed] = useState<string | undefined>(loadDismissed);
  /** The configuration request has answered, either way: until then the Console control may still appear. */
  const [configSettled, setConfigSettled] = useState(false);
  // The first-visit tour. Not in the route, like the console: it explains the page without changing it.
  const [tourOpen, setTourOpen] = useState(false);
  /** The tour started by itself during this page load; it does so at most once. */
  const tourAutoStarted = useRef(false);
  /** Where focus was when the tour opened, so it can go back there. */
  const focusBeforeTour = useRef<Element | null>(null);
  /** Whether setup is pending on the server; `undefined` until known, which holds the tour back. */
  const [setupPending, setSetupPending] = useState<boolean>();
  // The setup wizard. Not in the route either: it configures the dashboard rather than being a place to link to.
  const [setupOpen, setSetupOpen] = useState(false);
  /** The wizard opened by itself during this page load; it does so at most once. */
  const setupAutoOpened = useRef(false);

  useEffect(() => onRouteChange(() => setRoute(routeFromPath(currentPath()))), []);

  // Apply the theme, and follow live OS appearance changes while the preference is "system".
  // Layout effect so the colours swap in the same frame as the button label.
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(resolveTheme(themePref, media.matches));
    apply();
    if (themePref !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themePref]);

  const cycleTheme = () => {
    const next = nextPreference(themePref);
    savePreference(next);
    setThemePref(next);
  };

  // How many events are newer than the newest one the user saw in the feed. The very first time nothing counts as
  // unseen: whatever exists becomes the baseline. History only — a failure here is not worth a word.
  const loadUnseen = useCallback(async () => {
    try {
      const seen = loadSeen();
      const page = await api.activity({ limit: 1, since: seen ?? "" });
      if (seen === undefined) {
        if (page.newestId) saveSeen(page.newestId);
        setUnseen(0);
      } else setUnseen(page.newerThanSince ?? 0);
    } catch {
      setUnseen(0);
    }
  }, []);

  const markSeen = useCallback((newestId: string | undefined) => {
    if (newestId) saveSeen(newestId);
    setUnseen(0);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const next = await api.state();
      generatedAt.current = next.generatedAt;
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    void loadUnseen();
  }, [loadUnseen]);

  useEffect(() => {
    void loadState();
    api
      .config()
      .then(setConfig)
      .catch(() => undefined)
      .finally(() => setConfigSettled(true));
  }, [loadState]);

  useEffect(() => {
    // A failed read reads as "set up": a wizard nobody asked for is worse than one that waits for the next load.
    api.setup().then(
      (s) => setSetupPending(s.pending),
      () => setSetupPending(false),
    );
  }, []);

  /**
   * Asks for the environment report. On load, after the configuration was saved, and from **Re-check** — never from the
   * poll or the auto-refresh loop: the report is about this machine, not about the repositories, and computing it starts
   * a process. A failed request keeps the previous report, so the section can say what went wrong beside it.
   */
  const loadEnvironment = useCallback(async (force = false) => {
    setEnvironment((was) => ({ ...was, loading: true }));
    try {
      setEnvironment({ report: await api.environment(force), loading: false });
    } catch (err) {
      setEnvironment((was) => ({ report: was.report, loading: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  useEffect(() => {
    void loadEnvironment();
  }, [loadEnvironment]);

  /**
   * Reads the update status: on load, after a save, and once an hour while the page stays open. The server does the
   * checking (at most daily); this only asks it what it knows. A failed read keeps what was shown.
   */
  const loadUpdate = useCallback(async () => {
    try {
      setUpdate(await api.updateStatus());
    } catch {
      // An older server or a brief outage: no banner is better than a wrong one, and the next read tries again.
    }
  }, []);
  useEffect(() => {
    void loadUpdate();
    const reread = setInterval(() => void loadUpdate(), UPDATE_REREAD_MS);
    return () => clearInterval(reread);
  }, [loadUpdate]);
  const dismissUpdate = (version: string) => {
    saveDismissed(version);
    setUpdateDismissed(version);
  };

  // Re-fetch on the configured poll interval, and re-render the relative ages every minute.
  useEffect(() => {
    const seconds = Math.max(10, config?.pollIntervalSeconds ?? 60);
    const poll = setInterval(() => void loadState(), seconds * 1000);
    const clock = setInterval(() => tick((n) => n + 1), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [config?.pollIntervalSeconds, loadState]);

  const chooseAutoRefresh = (interval: AutoRefreshInterval) => {
    saveInterval(interval);
    setAutoRefresh(interval);
  };

  // One refresh, shared by the Refresh button and the auto-refresh loop, so the two can never scan at once however
  // they interleave. The guard is a ref, not `refreshing`: state updates are batched, so two callers in the same frame
  // would both read `refreshing === false`. Only a refresh the user asked for takes the button over: an automatic one
  // must not flicker the corner every couple of seconds, nor leave the button dead between ticks. What shows an
  // automatic refresh is the `updated` age resetting and the interval control standing marked.
  const refresh = useCallback(async (manual = true) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setRefreshing(true);
    try {
      await performRefresh({
        api,
        before: generatedAt.current,
        // The user is watching the button, so a manual refresh waits for the scan even if it was not the one to start
        // it; an automatic tick takes what there is and re-arms instead of holding the wait open.
        waitForScan: manual,
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        onSnapshot: (next) => {
          generatedAt.current = next.generatedAt;
          setSnapshot(next);
        },
        onError: setError,
      });
    } finally {
      busy.current = false;
      if (manual) setRefreshing(false);
    }
  }, []);

  // Auto-refresh: repeat what Refresh does on the chosen interval, chained from each refresh finishing so a slow scan
  // cannot make ticks pile up. Only the scan and the re-fetch are driven from here — never the pull action. While the
  // page is hidden the chain is held; coming back refreshes at once, which is when the user wants it.
  useEffect(() => {
    const delay = intervalMs(autoRefresh);
    if (delay === 0) return;
    const loop = createRefreshLoop({
      intervalMs: delay,
      run: () => refresh(false), // automatic: quiet, and it does not take the button over
      setTimer: (fire, ms) => setTimeout(fire, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    loop.start();
    if (document.hidden) loop.pause();
    const follow = () => (document.hidden ? loop.pause() : loop.resume());
    document.addEventListener("visibilitychange", follow);
    return () => {
      document.removeEventListener("visibilitychange", follow);
      loop.stop();
    };
  }, [autoRefresh, refresh]);

  // Views only ever see repositories that are enabled right now, even if the last scan predates a Settings change.
  const shown = enabledOnly(snapshot, config);
  const failing = shown?.repos.filter((r) => !r.ok) ?? [];
  // Only shown when a check actually failed: a report that has not arrived, or could not be, warns about nothing.
  const envWarning = environmentWarning(environment);

  // The server rescans after a shared-config save or apply; pick the result up without waiting for the next poll.
  const reloadSoon = () => {
    for (const ms of [1500, 5000]) setTimeout(() => void loadState(), ms);
  };

  // The board on screen: the route's own, or — for a change — the board its detail overlay belongs to, which is also
  // where closing the overlay goes. The detail view keeps `from` in the query, so this stays put while it is open.
  const back = route.view === "change" ? backTarget(parseDetailQuery(currentQuery()).from, route.repoId) : undefined;
  const boardRoute: Route = back ? routeFromPath(back.path) : route;
  // The overlay closes with the feature: nothing may be started while agent sessions are off.
  const consoleShown = consoleOpen && config?.agentSessions.enabled === true;
  const integrationShown = integrationId !== undefined && config?.agentSessions.enabled === true;
  const projectConsoleShown = projectConsoleRepoId !== undefined && config?.agentSessions.enabled === true;
  /** An overlay other than the tour and the wizard: both wait for it to close before starting by themselves. */
  const otherOverlayOpen = route.view === "change" || consoleShown || integrationShown || projectConsoleShown;
  const overlayOpen = otherOverlayOpen || tourOpen || setupOpen;

  useEffect(() => {
    const ready = configSettled && setupPending !== undefined;
    if (!shouldOpenSetup({ enabled: setupAutoOpens(), pending: setupPending === true, alreadyOpened: setupAutoOpened.current, ready, overlayOpen: otherOverlayOpen || tourOpen })) return;
    setupAutoOpened.current = true;
    setSetupOpen(true);
  }, [configSettled, setupPending, otherOverlayOpen, tourOpen]);

  const setupSaved = useCallback(
    (saved: Config) => {
      setConfig(saved);
      reloadSoon();
      // Which checks are needed follows the configuration, as after a save in Settings.
      void loadEnvironment();
    },
    [loadEnvironment, loadState],
  );
  const closeSetup = useCallback((done: boolean) => {
    setSetupOpen(false);
    // Marked done: the tour may follow on a first visit. Not marked: still pending, so the wizard returns next load.
    if (done) setSetupPending(false);
  }, []);

  const startTour = useCallback(() => {
    focusBeforeTour.current = document.activeElement;
    setTourOpen(true);
  }, []);
  const endTour = useCallback(() => {
    saveTourSeen();
    setTourOpen(false);
    const back = focusBeforeTour.current;
    focusBeforeTour.current = null;
    // After the page has stopped being inert, which happens with the render that closes the tour.
    requestAnimationFrame(() => (back instanceof HTMLElement && back.isConnected ? back : document.body).focus?.());
  }, []);

  useEffect(() => {
    const ready = configSettled && setupPending !== undefined;
    const blocked = otherOverlayOpen || setupOpen;
    if (!shouldAutoStart({ enabled: tourAutoStarts(), seen: loadTourSeen(), alreadyStarted: tourAutoStarted.current, ready, overlayOpen: blocked, setupPending: setupPending === true })) return;
    tourAutoStarted.current = true;
    startTour();
  }, [configSettled, setupPending, setupOpen, otherOverlayOpen, startTour]);

  // Moving to another route ends the tour as Skip does: its steps point at a page that is no longer there.
  const routeKey = JSON.stringify(route);
  const tourOpenRef = useRef(tourOpen);
  tourOpenRef.current = tourOpen;
  useEffect(() => {
    if (tourOpenRef.current) endTour();
  }, [routeKey, endTour]);

  const ThemeIcon = THEME_ICON[themePref];
  const link = (path: string, label: ComponentChildren, active: boolean, tour: TourAnchor) => (
    <a
      href={href(path)}
      class={active ? "active" : ""}
      data-tour={tour}
      onClick={(e) => {
        e.preventDefault();
        navigate(path);
      }}
    >
      {label}
    </a>
  );

  return (
    <PullProvider onPulled={reloadSoon}>
    {/* The pull-request cache, read by this view, the projects overview and each repository board. */}
    <PullRequestsProvider>
    {/* Above both the page and the overlay: the detail view's Console tab reads sessions from here too, and the
        end-session dialog it opens must not sit inside the part that goes inert. */}
    <SessionProvider config={config} snapshot={shown} consoleOpen={consoleShown} showConsole={showConsole} integrationId={integrationShown ? integrationId : undefined} showIntegration={showIntegration} projectConsoleRepoId={projectConsoleShown ? projectConsoleRepoId : undefined} showProjectConsole={showProjectConsole} onConfig={setConfig}>
    {/* Everything but the detail overlay: inert while it is open, so the board behind it takes no focus and no clicks. */}
    <div class="app" inert={overlayOpen} aria-hidden={overlayOpen ? "true" : undefined}>
      <UpdateBanner status={update} dismissed={updateDismissed} onDismiss={dismissUpdate} />
      {/* The hero: the product's name, big, over a soft accent glow; below it the navigation, and — continuing the same
          ground — the current view's own header band and filter bar. The status and actions keep their corner. */}
      <header class="topbar hero">
        <div class="hero-brand">
          <HeroHomeMark size={60} />
          <div class="hero-copy">
            {/* The title and, for a release build, the version it runs (read from the same status as the banner). */}
            <div class="hero-title-row">
              <h1 class="hero-title">
                <HeroHomeTitle current={route.view === "overview"}>
                  Spec <span class="hero-accent">Control</span>
                </HeroHomeTitle>
              </h1>
              <VersionLabel status={update} />
            </div>
            <p class="hero-tagline">Mission control for every agent change across your repositories. Never miss a change.</p>
          </div>
          {/* Status and actions: the hero's top corner. */}
          <div class="topbar-end">
            <OpenWork />
            {failing.map((r) => (
              <span class="badge danger" title={r.error}>
                ⚠ {r.name}
              </span>
            ))}
            {envWarning && (
              <a
                class="badge warning"
                href={hrefWithQuery("/settings", "?section=environment")}
                title={envWarning.title}
                onClick={(e) => followInApp(e, "/settings", "?section=environment")}
              >
                ⚠ Environment {envWarning.count}
              </a>
            )}
            {error && <span class="badge danger">API: {error}</span>}
            <WhatsNew />
            <ConsoleButton />
            <button type="button" class="btn sm ghost" onClick={cycleTheme} title="Cycle theme: System → Light → Dark" data-tour={TOUR_ANCHOR.theme}>
              <ThemeIcon />
              Theme: {THEME_LABEL[themePref]}
            </button>
            <span class="status" data-tour={TOUR_ANCHOR.refresh}>
              <span>updated {snapshot ? relTime(snapshot.generatedAt) : "…"}</span>
              <button type="button" class="btn sm" onClick={() => void refresh()} disabled={refreshing}>
                <IconRefresh size={13} />
                {refreshing ? "Scanning…" : "Refresh"}
              </button>
              {/* How often the dashboard refreshes itself. Marked `on` for anything but Off, so whether the board
                  keeps itself current reads at a glance and not only from the value. */}
              <label class={`control select-control status-control ${autoRefresh === "off" ? "" : "on"}`}>
                <IconClock size={12} />
                <select aria-label="Auto-refresh interval" value={autoRefresh} onChange={(e) => chooseAutoRefresh(parseInterval(e.currentTarget.value))}>
                  {AUTO_REFRESH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === "off" ? "Auto: off" : `Auto: ${o.label}`}
                    </option>
                  ))}
                </select>
                <IconChevronDown size={11} />
              </label>
            </span>
          </div>
        </div>
        <nav aria-label="Main">
          {link(
            "/",
            <>
              <IconLayoutGrid />
              Projects
            </>,
            route.view === "overview" || boardRoute.view === "repo",
            TOUR_ANCHOR.projects,
          )}
          {link(
            "/board",
            <>
              <IconKanban />
              All changes
            </>,
            boardRoute.view === "board",
            TOUR_ANCHOR.board,
          )}
          {link(
            "/activity",
            <>
              <IconActivity />
              Activity
              {route.view !== "activity" && unseenLabel(unseen) && (
                <span class="nav-count" title={`${unseen} new since you last looked`}>
                  {unseenLabel(unseen)}
                </span>
              )}
            </>,
            route.view === "activity",
            TOUR_ANCHOR.activity,
          )}
          {link(
            "/pull-requests",
            <>
              <IconGitPullRequest />
              Pull requests
            </>,
            route.view === "pullRequests",
            TOUR_ANCHOR.pullRequests,
          )}
          {link(
            "/settings",
            <>
              <IconSettings />
              Settings
            </>,
            route.view === "settings",
            TOUR_ANCHOR.settings,
          )}
          {link(
            "/help",
            <>
              <IconHelp />
              Help
            </>,
            route.view === "help",
            TOUR_ANCHOR.help,
          )}
        </nav>
      </header>
      <main class="main">
        {notice && (
          <div class="notice app-notice" role="status">
            <span>{notice}</span>
            <button type="button" class="btn sm ghost" onClick={() => setNotice(undefined)} aria-label="Dismiss notice">
              ✕
            </button>
          </div>
        )}
        {route.view === "settings" ? (
          <Settings
            config={config}
            snapshot={shown}
            onSaved={(c) => {
              setConfig(c);
              // Turned off: the banner goes at once, before the server's answer confirms it.
              if (c.updateCheck === false) setUpdate((was) => was && { ...was, enabled: false, available: false });
              void loadUpdate();
              void loadState();
              // The configuration decides which checks are needed at all, so a fresh report is asked for.
              void loadEnvironment();
            }}
            onRescan={reloadSoon}
            environment={environment}
            onRecheckEnvironment={() => void loadEnvironment(true)}
            update={update}
            onUpdate={setUpdate}
          />
        ) : route.view === "help" ? (
          <Help onTour={startTour} onSetup={() => setSetupOpen(true)} />
        ) : route.view === "activity" ? (
          <Activity snapshot={shown} onSeen={markSeen} />
        ) : route.view === "pullRequests" ? (
          <PullRequestsView snapshot={shown} />
        ) : route.view === "overview" ? (
          <Overview
            snapshot={shown}
            config={config}
            onReload={reloadSoon}
            onConfig={(c) => {
              setConfig(c);
              // An enabled repository is scanned by the server; the snapshot follows as soon as the scan is done.
              reloadSoon();
            }}
          />
        ) : (
          // One board for the board, repository and change routes, keyed by its path: opening and closing a change keeps
          // this very instance — its filters, minimized groups and scroll position — while moving between boards starts
          // a new one that reads its filters again.
          <Kanban
            key={boardRoute.view === "repo" ? repoPath(boardRoute.repoId) : "/board"}
            snapshot={shown}
            config={config}
            repoId={boardRoute.view === "repo" ? boardRoute.repoId : undefined}
            onConfig={setConfig}
            query={back?.query}
            onReload={reloadSoon}
          />
        )}
      </main>
    </div>
    {/* Outside the inert part: it is opened from the detail overlay's Console tab as well as from a card. */}
    <EndSessionDialog />
    {route.view === "change" && (
      // Keyed so selection and content start over when moving between changes.
      <ChangeDetail
        key={`${route.repoId}/${route.changeName}`}
        snapshot={shown}
        repoId={route.repoId}
        changeName={route.changeName}
        onDismissed={(text) => {
          setNotice(text);
          reloadSoon();
        }}
      />
    )}
    <ConsoleOverlay />
    <IntegrationOverlay />
    <ProjectConsoleOverlay />
    {tourOpen && <Tour onClose={endTour} />}
    {setupOpen && <SetupWizard config={config} snapshot={snapshot} onSaved={setupSaved} onClose={closeSetup} />}
    </SessionProvider>
    </PullRequestsProvider>
    </PullProvider>
  );
}
