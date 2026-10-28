// Auto-refresh: how often the dashboard repeats what the Refresh button does. Pure resolution logic plus thin
// localStorage effects (same shape as theme.ts), and a scheduler that owns the chain without knowing about Preact,
// the API or the DOM. The interval is a per-browser preference: it is never written to the dashboard's config and
// never changes the server's `pollIntervalSeconds`.
import { storageKey } from "./storage.ts";

export const AUTO_REFRESH_STORAGE_KEY = storageKey("autoRefresh");

/** `"off"` and the three cadences offered; nothing else is a valid choice. */
export type AutoRefreshInterval = "off" | "2s" | "5s" | "10s";

/** The control's options, in the order it offers them. `ms` is 0 for `off`, which is the only one that never ticks. */
export const AUTO_REFRESH_OPTIONS: readonly { value: AutoRefreshInterval; label: string; ms: number }[] = [
  { value: "off", label: "Off", ms: 0 },
  { value: "2s", label: "2s", ms: 2_000 },
  { value: "5s", label: "5s", ms: 5_000 },
  { value: "10s", label: "10s", ms: 10_000 },
];

/** Tolerant: an absent, empty or unrecognised value means off, so a stored value from another version cannot stick. */
export function parseInterval(raw: string | null | undefined): AutoRefreshInterval {
  const match = AUTO_REFRESH_OPTIONS.find((o) => o.value === raw);
  return match && match.value !== "off" ? match.value : "off";
}

export function intervalMs(interval: AutoRefreshInterval): number {
  return AUTO_REFRESH_OPTIONS.find((o) => o.value === interval)?.ms ?? 0;
}

export function intervalLabel(interval: AutoRefreshInterval): string {
  return AUTO_REFRESH_OPTIONS.find((o) => o.value === interval)?.label ?? "Off";
}

export function loadInterval(): AutoRefreshInterval {
  try {
    return parseInterval(localStorage.getItem(AUTO_REFRESH_STORAGE_KEY));
  } catch {
    return "off";
  }
}

/** Off removes the key rather than storing it, so a default that changes later is not shadowed by an old write. */
export function saveInterval(interval: AutoRefreshInterval): void {
  try {
    if (interval === "off") localStorage.removeItem(AUTO_REFRESH_STORAGE_KEY);
    else localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, interval);
  } catch {
    // Storage unavailable: the choice still applies for this page session.
  }
}

/** Whatever the injected timer returns; the loop only ever hands it back to `clearTimer`. */
export type TimerHandle = unknown;

export interface RefreshLoopOptions {
  /** How long to wait after one refresh finishes before starting the next. */
  intervalMs: number;
  /** One refresh. Rejections are swallowed: the caller reports them, the interval carries on. */
  run: () => Promise<unknown>;
  setTimer: (fire: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
}

export interface RefreshLoop {
  /** Schedules the first tick one interval from now. Starting an already started loop does nothing. */
  start(): void;
  /** Cancels the pending tick for good; a refresh already in flight is left to finish without rescheduling. */
  stop(): void;
  /** Holds the chain, e.g. while the page is hidden. */
  pause(): void;
  /** Refreshes once straight away and restarts the chain, unless a refresh is already in flight. */
  resume(): void;
  /** For tests and for the effect's own assertions: is a refresh in flight right now? */
  isRefreshing(): boolean;
}

/**
 * Chains `setTimer` from the end of each refresh rather than firing on a fixed schedule: an interval shorter than a
 * refresh then degrades to "as fast as refreshes finish" instead of queueing ticks. A tick that comes due while a
 * refresh is in flight — one the user started, say — is dropped and the chain re-armed, never queued. Everything the
 * loop touches is injected, so no timer path can reach anything but `run`.
 */
export function createRefreshLoop({ intervalMs: delay, run, setTimer, clearTimer }: RefreshLoopOptions): RefreshLoop {
  let handle: TimerHandle;
  let pending = false;
  let active = false;
  let paused = false;
  let inFlight = false;

  const cancel = () => {
    if (pending) clearTimer(handle);
    pending = false;
    handle = undefined;
  };

  const schedule = () => {
    cancel();
    if (!active || paused) return;
    pending = true;
    handle = setTimer(tick, delay);
  };

  const tick = () => {
    pending = false;
    handle = undefined;
    if (!active || paused) return;
    // A refresh is already running: drop this tick rather than queue it, and re-arm from here.
    if (inFlight) {
      schedule();
      return;
    }
    void fire();
  };

  const fire = async () => {
    inFlight = true;
    try {
      await run();
    } catch {
      // Reported where the refresh itself reports; a failure must not end the interval.
    } finally {
      inFlight = false;
      schedule();
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      paused = false;
      schedule();
    },
    stop() {
      active = false;
      paused = false;
      cancel();
    },
    pause() {
      if (!active || paused) return;
      paused = true;
      cancel();
    },
    resume() {
      if (!active || !paused) return;
      paused = false;
      // In flight already: its own completion re-arms the chain, so do not start a second one.
      if (inFlight) return;
      void fire();
    },
    isRefreshing() {
      return inFlight;
    },
  };
}

/**
 * Whether a fetched snapshot may replace the shown one: snapshots only move forward, so a poll that answers after a
 * refresh cannot step the board back to an earlier scan. `generatedAt` values are ISO strings and compare as text; an
 * equal one is taken, so an unchanged poll still counts as an answer.
 */
export function newerSnapshot(shown: string | undefined, next: string): boolean {
  return shown === undefined || next >= shown;
}

export interface RefreshOptions<S extends { generatedAt: string }> {
  /** Narrowed on purpose: a refresh can reach the scan and the snapshot, and nothing else. */
  api: { scan(): Promise<{ started: boolean }>; state(): Promise<S> };
  /** The snapshot time to compare against, so an unrelated snapshot already in hand does not end the wait. */
  before: string | undefined;
  /** Called with the snapshot the scan produced. */
  onSnapshot: (snapshot: S) => void;
  /** Called with a message when the scan or a fetch failed, and with `null` when the refresh came through. */
  onError: (message: string | null) => void;
  /**
   * Whether to keep waiting for a snapshot newer than `before` when the scan was not started by this call. True for
   * the button, where the user is watching it; false on an automatic tick, where a scan someone else is running is
   * reason to take what there is and re-arm rather than hold the wait open.
   */
  waitForScan: boolean;
  /** Waits `ms`; injected so a test can drive the wait without real time passing. */
  delay: (ms: number) => Promise<void>;
}

/** How long a refresh waits for a scan to land, and how often it looks. A scan usually takes a second or two. */
export const REFRESH_POLL_MS = 500;
export const REFRESH_POLL_TRIES = 40;

/**
 * One refresh: trigger a scan, then take the snapshot it produced. Shared by the Refresh button and the auto-refresh
 * loop, so the two behave identically. It reaches `scan` and `state` and nothing else — in particular no timer path
 * can reach the pull action, which stays bound to the user's explicit request.
 */
export async function performRefresh<S extends { generatedAt: string }>({
  api,
  before,
  onSnapshot,
  onError,
  waitForScan,
  delay,
}: RefreshOptions<S>): Promise<void> {
  try {
    const { started } = await api.scan();
    if (started || waitForScan) {
      for (let i = 0; i < REFRESH_POLL_TRIES; i++) {
        await delay(REFRESH_POLL_MS);
        const next = await api.state();
        if (next.generatedAt !== before) {
          onSnapshot(next);
          break;
        }
      }
    } else {
      // Someone else's scan is running: take what there is rather than holding a 20-second wait open at a 2s cadence.
      const next = await api.state();
      if (next.generatedAt !== before) onSnapshot(next);
    }
    onError(null);
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}
