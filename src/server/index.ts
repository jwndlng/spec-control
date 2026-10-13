// CLI entry point: `spec-control [--port N] [--no-open] [--version]`.
import indexHtmlAsset from "../../dist/ui/index.html" with { type: "text" };
import { createFetchHandler, createWebSocketHandlers, startingFetchHandler, type AppState, type TerminalSocketData } from "./api.ts";
import { diffSnapshots, sessionEvent } from "./activity/events.ts";
import { ActivityLog } from "./activity/log.ts";
import { AutoFetcher } from "./autoFetch.ts";
import { readSnapshot } from "./cache.ts";
import { configuredPort, loadConfig } from "./config.ts";
import { describeOutcome, startHomeMigration } from "./homeMigration.ts";
import { KeepAwake } from "./keepAwake.ts";
import { explicitHome, newDefaultHome, oldDefaultHome } from "./paths.ts";
import { Scanner } from "./scanner.ts";
import { confirmIntegration } from "./integration.ts";
import { SessionManager } from "./sessions/manager.ts";
import { pruneMergeScratch } from "./sessions/workStatus.ts";
import { UpdateChecker } from "./updateCheck.ts";
import { VERSION } from "./version.ts";

// With `type: "text"` Bun hands us the file contents; bun-types only knows the HTMLBundle shape.
const indexHtml = indexHtmlAsset as unknown as string;

interface CliArgs {
  port?: number;
  open: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open") args.open = false;
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) args.port = Number(arg.slice("--port=".length));
    else if (arg === "-h" || arg === "--help") {
      console.log(`spec-control ${VERSION}\nusage: spec-control [--port N] [--no-open] [--version]`);
      process.exit(0);
    } else if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (args.port !== undefined && !(Number.isInteger(args.port) && args.port > 0 && args.port < 65536)) {
    console.error("--port must be an integer between 1 and 65535");
    process.exit(2);
  }
  return args;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // no browser available; the URL is printed anyway
  }
}

/** Where the port is read before the migration ran: the explicit home, else whichever default home exists, new first. */
async function homeBeforeMigration(): Promise<string> {
  const explicit = explicitHome();
  if (explicit) return explicit.path;
  return Bun.file(`${newDefaultHome()}/config.json`).exists().then((yes) => (yes ? newDefaultHome() : oldDefaultHome()));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (explicitHome()?.variable === "OPENSPEC_DASHBOARD_HOME") {
    console.warn("warning: OPENSPEC_DASHBOARD_HOME is deprecated and will stop working in a later release; set SPEC_CONTROL_HOME instead");
  }
  // The port first: it is what proves no other instance is serving from the home the migration is about to move. A
  // busy port throws here, before anything is touched.
  const server = Bun.serve<TerminalSocketData>({
    hostname: "127.0.0.1",
    port: args.port ?? (await configuredPort(await homeBeforeMigration())),
    fetch: startingFetchHandler,
    websocket: { message() {} },
  });
  for (const line of describeOutcome(await startHomeMigration())) console.log(line);

  const { config, warning } = await loadConfig();
  if (warning) console.warn(`warning: ${warning}`);
  // Merges of previous runs; they are a scratch store, never state.
  await pruneMergeScratch();

  // History for the Activity view: what changed between consecutive snapshots, plus what the session manager reports.
  const activity = new ActivityLog();
  await activity.load();
  const state: AppState = {
    config,
    activity,
    scanner: new Scanner(
      () => state.config,
      {
        onSnapshots: (previous, next) => {
          // A scan can make a repository eligible (now scanned, now has a remote) or not; the schedule follows it.
          state.autoFetcher?.plan();
          void activity.append(diffSnapshots(previous, next, { now: new Date(), pollIntervalSeconds: state.config.pollIntervalSeconds }));
        },
      },
      (await readSnapshot()) ?? undefined,
    ),
  };
  state.sessions = new SessionManager({
    getConfig: () => state.config,
    getSnapshot: () => state.scanner.snapshot,
    onActivity: (session, what) => void activity.append([sessionEvent(session, state.config.repos.find((r) => r.id === session.repoId)?.name ?? session.repoId, what)]),
    // The marker, not the agent's word: if `openspec/config.yaml` is there now, the repository becomes tracked.
    onIntegrationEnded: (session) => void confirmIntegration(state, session.folder).catch(() => undefined),
    onRunningChanged: () => state.keepAwake?.evaluate(),
  });
  await state.sessions.init();
  // Holds idle sleep off while an agent is busy, with the system's own `caffeinate` (macOS only; off in Settings).
  const sessions = state.sessions;
  state.keepAwake = new KeepAwake({
    getConfig: () => state.config,
    busyCount: (now) => sessions.busyCount(now),
    anyRunning: () => sessions.anyRunning(),
    readReports: () => sessions.readReports(),
  });
  // Every minute by default, for each enabled git project with a remote whose auto fetch the user did not switch off.
  state.autoFetcher = new AutoFetcher({
    getConfig: () => state.config,
    getSnapshot: () => state.scanner.snapshot,
    onMoved: () => {
      state.sessions?.forgetWorktrees();
      state.scanner.trigger();
    },
  });
  state.autoFetcher.plan();
  // About a minute from now, then at most daily; never for `dev` or with Check for new versions off.
  state.updateChecker = new UpdateChecker({ getConfig: () => state.config, version: VERSION });
  await state.updateChecker.load();
  state.updateChecker.plan();
  state.scanner.start();

  server.reload({
    fetch: createFetchHandler({ state, indexHtml }),
    websocket: createWebSocketHandlers(state) as unknown as Bun.WebSocketHandler<TerminalSocketData>,
  });
  const url = `http://127.0.0.1:${server.port}`;
  console.log(`spec-control listening on ${url}`);
  if (args.open) openBrowser(url);

  const shutdown = () => {
    state.scanner.stop();
    state.autoFetcher?.stop();
    state.updateChecker?.stop();
    // Before the sessions end, so no ending session can start it again; `-w` ends it with us anyway.
    state.keepAwake?.stop();
    // Children must not outlive the dashboard; sessions in flight become `interrupted` and can be resumed.
    void (state.sessions?.shutdown() ?? Promise.resolve()).finally(() => {
      server.stop(true);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
