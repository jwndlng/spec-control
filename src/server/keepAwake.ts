// Keep awake (openspec/specs/keep-awake): while an agent session is busy, the system's own `caffeinate` holds an idle
// sleep assertion for the dashboard, and it is ended as soon as no session is busy any more.
//
// `-i` prevents idle system sleep only — the display still sleeps, and so does closing the lid or choosing Sleep — and
// `-w <pid>` makes `caffeinate` end by itself when the server's process ends, however it ends, so a crash never leaves
// the machine awake. Nothing about power settings is changed or persisted. At most one child runs; it is started without
// a shell, by absolute path, with no input, its output discarded and its working directory in the dashboard home.
//
// `evaluate()` runs when a session starts or ends, when the configuration changes, when the session list is requested,
// and once a minute while any session runs (re-reading the agents' reports first, so a report counts without a browser
// open). No timer exists while no session runs, the setting is off or keep-awake is unavailable.
import { accessSync, constants, statSync } from "node:fs";
import type { Config, KeepAwakeStatus } from "../shared/types.ts";
import { dashboardHome } from "./paths.ts";
import type { ReportedState } from "./sessions/reportedState.ts";

export const CAFFEINATE = "/usr/bin/caffeinate";
/** Output this recent keeps a session without a current report busy: agents run silent tool calls for minutes. */
export const BUSY_WINDOW_MS = 5 * 60_000;
/** How often keep-awake looks again while a session runs; also the least time between restarts of a child that died. */
export const EVALUATE_INTERVAL_MS = 60_000;

/** What decides whether a session is busy: nothing else, and never the agent's output. */
export interface BusyInput {
  /** The agent's process runs. */
  running: boolean;
  /** When its terminal last produced output that counts as activity (ms since the epoch). */
  lastOutputAt?: number;
  /** The agent's current report, if any. */
  current?: ReportedState;
}

/** A current `working` report holds through silence, a current `waiting` one releases at once; else recent output decides. */
export function isBusy({ running, lastOutputAt, current }: BusyInput, now: number): boolean {
  if (!running) return false;
  if (current === "working") return true;
  if (current === "waiting") return false;
  return lastOutputAt !== undefined && now - lastOutputAt <= BUSY_WINDOW_MS;
}

/** The process keep-awake holds: just enough of `Bun.Subprocess` to end it and to notice it ended. */
export interface HeldProcess {
  kill(): void;
  exited: Promise<unknown>;
}

export interface KeepAwakeDeps {
  getConfig: () => Config;
  /** How many sessions are busy at `now`. */
  busyCount: (now: number) => number;
  /** Whether any session runs at all. */
  anyRunning: () => boolean;
  /** Re-reads the agents' reports; the periodic evaluation runs it first. */
  readReports: () => Promise<void>;
  /** Test seams; the defaults are the real thing. */
  command?: string;
  platform?: NodeJS.Platform;
  pid?: number;
  now?: () => number;
  intervalMs?: number;
  spawn?: (argv: string[], cwd: string) => HeldProcess;
}

function spawnQuietly(argv: string[], cwd: string): HeldProcess {
  return Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

function executableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class KeepAwake {
  /** macOS with an executable `caffeinate`; decided once, at start. */
  readonly available: boolean;
  private readonly command: string;
  private child?: HeldProcess;
  /** When the current or last child was started; with `died`, what rate-limits a restart. */
  private lastStartAt = 0;
  /** The last child ended without being asked to. */
  private died = false;
  private busy = 0;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;

  constructor(private readonly deps: KeepAwakeDeps) {
    this.command = deps.command ?? CAFFEINATE;
    this.available = (deps.platform ?? process.platform) === "darwin" && executableFile(this.command);
  }

  private get enabled(): boolean {
    return this.deps.getConfig().keepAwake !== false;
  }

  /** Holds the machine awake while a session is busy and the setting is on, releases it otherwise, and (dis)arms the timer. */
  evaluate(): void {
    if (this.stopped) return;
    const now = (this.deps.now ?? Date.now)();
    this.busy = this.deps.busyCount(now);
    if (this.available && this.enabled && this.busy > 0) this.hold(now);
    else this.release();
    this.plan();
  }

  /** For `GET /api/sessions`: as of the last `evaluate()`. */
  status(): KeepAwakeStatus {
    return { available: this.available, enabled: this.enabled, active: this.child !== undefined, sessions: this.busy };
  }

  /** Shutdown: ends the child and the timer, and nothing starts again. */
  stop(): void {
    this.stopped = true;
    this.release();
    this.plan();
  }

  private hold(now: number): void {
    if (this.child) return;
    // A child that died on its own (a sandbox refusing it, the user killing it) is tried again at most once a minute.
    if (this.died && now - this.lastStartAt < (this.deps.intervalMs ?? EVALUATE_INTERVAL_MS)) return;
    this.lastStartAt = now;
    this.died = false;
    let child: HeldProcess;
    try {
      child = (this.deps.spawn ?? spawnQuietly)([this.command, "-i", "-w", String(this.deps.pid ?? process.pid)], dashboardHome());
    } catch {
      this.died = true;
      return;
    }
    this.child = child;
    void child.exited.then(
      () => this.ended(child),
      () => this.ended(child),
    );
  }

  private ended(child: HeldProcess): void {
    if (this.child !== child) return; // released on purpose
    this.child = undefined;
    this.died = true;
  }

  private release(): void {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    try {
      child.kill();
    } catch {
      // already gone
    }
  }

  /** A timer only while it can matter: a session runs, the setting is on and keep-awake is available. */
  private plan(): void {
    const wanted = !this.stopped && this.available && this.enabled && this.deps.anyRunning();
    if (wanted && this.timer === undefined) {
      this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? EVALUATE_INTERVAL_MS);
      this.timer.unref?.();
    } else if (!wanted && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Whether the periodic evaluation is armed; for tests. */
  get timerArmed(): boolean {
    return this.timer !== undefined;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.deps.readReports().catch(() => undefined);
      this.evaluate();
    } finally {
      this.ticking = false;
    }
  }
}
