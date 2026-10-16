// The app's main process: Electrobun wiring only (openspec/specs/desktop-app). Every decision that can be tested lives
// in ./logic and is tested by the root `bun test`; this file connects those decisions to windows, menus and the
// bundled `spec-control` binary. The page gets no preload script, no RPC and no injected script: it is the server's
// own page on its own loopback origin.
import Electrobun, { ApplicationMenu, BrowserWindow, Tray, Utils } from "electrobun/main";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { appHome, configuredPortFor, portHome } from "./logic/home.ts";
import { appOrigin, eventUrl, externalTarget, type LastOpened, navigationEvent, navigationRules, shouldOpen } from "./logic/links.ts";
import { acquireLock } from "./logic/lock.ts";
import { countRunning, quitPlan, quitQuestion, stopServer } from "./logic/quit.ts";
import { loginShellPath } from "./logic/shellPath.ts";
import { decideStart, listeningPort, probeVersion, waitForServer } from "./logic/start.ts";

const RELEASES_URL = "https://github.com/jwndlng/spec-control/releases";
const OUTPUT_LINES = 40;

interface ElectrobunEvent {
  data?: unknown;
  response?: unknown;
}

const homeInputs = { env: process.env, userHome: homedir() };

/** The binary `electrobun.config.ts` copies into the bundle as `bin/spec-control`. */
function bundledBinary(): string {
  const candidates = [join(import.meta.dir, "..", "bin", "spec-control"), join(dirname(process.execPath), "..", "Resources", "app", "bin", "spec-control")];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

/** What the bundled binary says it is: the release tag, `dev` in a local build. */
function bundledVersion(binary: string): string {
  try {
    return new TextDecoder().decode(Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "ignore" }).stdout).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const binary = bundledBinary();
const appVersion = bundledVersion(binary);

let releaseLock: (() => Promise<void>) | undefined;
let toolsPath: string | undefined;
let port = 0;
let child: ReturnType<typeof Bun.spawn> | undefined;
/** The last lines the server printed, shown when it fails to start or stops by itself. */
let output: string[] = [];
let mainWindow: BrowserWindow | undefined;
let lastUrl: string | undefined;
/** The last link handed to the browser, so one click reported as two events opens it once. */
let lastOpened: LastOpened | undefined;
let quitting = false;
let quitInFlight = false;
let stopping = false;

async function takeLock(): Promise<"ok" | "held"> {
  if (releaseLock) return "ok";
  const home = await appHome(homeInputs);
  if (!home) return "ok"; // only the pre-rename home exists: the server moves it first, the lock is taken after that
  const lock = await acquireLock(home);
  if (lock.kind === "held") return "held";
  releaseLock = lock.release;
  return "ok";
}

function remember(text: string): void {
  output = [...output, ...text.split("\n").filter((line) => line.trim() !== "")].slice(-OUTPUT_LINES);
}

async function relay(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) remember(decoder.decode(chunk, { stream: true }));
}

function openExternally(url: string): void {
  Utils.openExternal(url);
}

/** A link the page asked to follow: the server's own pages stay in the window, web and mail links go to the browser. */
function follow(url: string | undefined, inWindow: boolean): void {
  if (!url) return;
  const target = externalTarget(url, port);
  if (target.kind === "external") {
    const now = Date.now();
    if (!shouldOpen(target.url, now, lastOpened)) return;
    lastOpened = { url: target.url, at: now };
    openExternally(target.url);
  } else if (target.kind === "internal" && !inWindow) mainWindow?.webview.loadURL(url);
}

function showWindow(title: string): void {
  if (mainWindow) {
    mainWindow.setTitle(title);
    mainWindow.show();
    mainWindow.activate();
    return;
  }
  const win = new BrowserWindow({ title, url: `${appOrigin(port)}/`, frame: { width: 1360, height: 860 } });
  win.webview.setNavigationRules(navigationRules(port));
  // A blocked navigation is a link to another origin: it opens in the browser and the window stays where it is.
  win.webview.on("will-navigate", (event: unknown) => {
    const navigation = navigationEvent((event as ElectrobunEvent).data);
    if (navigation?.allowed === false) follow(navigation.url, true);
  });
  // `target="_blank"` and `window.open` never open a window of their own.
  win.webview.on("new-window-open", (event: unknown) => follow(eventUrl((event as ElectrobunEvent).data), false));
  for (const name of ["did-navigate", "did-navigate-in-page"]) {
    win.webview.on(name, (event: unknown) => {
      const url = eventUrl((event as ElectrobunEvent).data);
      if (url && externalTarget(url, port).kind === "internal") lastUrl = url;
    });
  }
  // Closing hides: the server, the sessions and the page's state (an open terminal, the scroll) stay as they are.
  win.on("will-close", (event: unknown) => {
    if (quitting) return;
    (event as ElectrobunEvent).response = { allow: false };
    win.hide();
  });
  mainWindow = win;
}

function windowTitle(attached: { version: string } | undefined): string {
  if (!attached) return "Spec Control";
  const mismatch = attached.version !== appVersion ? ` — the app is ${appVersion}` : "";
  return `Spec Control — attached to a server started elsewhere (${attached.version})${mismatch}`;
}

async function retryOrQuit(title: string, message: string): Promise<void> {
  const { response } = await Utils.showMessageBox({ type: "warning", title, message, buttons: ["Retry", "Quit"], defaultId: 0, cancelId: 1 });
  if (response === 0) await start();
  else finalQuit();
}

async function startServer(): Promise<void> {
  output = [];
  stopping = false;
  // Not `--port`: the binary reads its own configured port, so the app and the command line always agree on it.
  const spawned = Bun.spawn([binary, "--no-open"], {
    env: { ...process.env, PATH: toolsPath },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  child = spawned;
  let exited = false;
  void spawned.exited.then(() => {
    exited = true;
  });
  void relay(spawned.stdout);
  void relay(spawned.stderr);

  const outcome = await waitForServer({ port, exited: () => exited });
  const announced = listeningPort(output.join("\n"));
  if (outcome === "ready" && (announced === undefined || announced === port)) {
    void spawned.exited.then(() => {
      if (child === spawned && !stopping && !quitting) {
        child = undefined;
        void retryOrQuit("Spec Control stopped", `The server stopped unexpectedly.\n\n${output.join("\n")}`);
      }
    });
    if ((await takeLock()) === "held") return finalQuit(); // the server has moved the pre-rename home by now
    showWindow(windowTitle(undefined));
    return;
  }
  if (!exited) {
    stopping = true;
    await stopServer(spawned);
  }
  child = undefined;
  const why = outcome === "timeout" ? "did not answer within 15 seconds" : announced !== undefined && announced !== port ? `listened on port ${announced} instead of ${port}` : "exited";
  await retryOrQuit("Spec Control could not start", `The server ${why}.\n\n${output.join("\n") || "It printed nothing."}`);
}

async function start(): Promise<void> {
  const home = await portHome(homeInputs);
  port = await configuredPortFor(home);
  const decision = decideStart(await probeVersion(port), port);
  if (decision.action === "attach") {
    showWindow(windowTitle({ version: decision.version }));
    return;
  }
  if (decision.action === "blocked") {
    await retryOrQuit(
      `Port ${port} is in use`,
      `Another program is using port ${port} (${decision.detail}), so Spec Control cannot start there.\n\nStop that program, or set a different "port" in ${join(home, "config.json")}, then choose Retry.`,
    );
    return;
  }
  await startServer();
}

function finalQuit(): void {
  quitting = true;
  void (releaseLock?.() ?? Promise.resolve()).finally(() => Utils.quit(0));
}

/** Quit (design D6): ask while sessions run in a server the app started, stop it like Ctrl+C, then exit. */
async function requestQuit(): Promise<void> {
  if (quitInFlight) return;
  quitInFlight = true;
  try {
    const owned = child;
    let running = 0;
    if (owned) {
      try {
        const res = await fetch(`${appOrigin(port)}/api/sessions`, { signal: AbortSignal.timeout(2000) });
        running = countRunning(await res.json());
      } catch {
        // unreadable: nothing to name, so nothing to ask about
      }
    }
    const plan = quitPlan({ ownsServer: owned !== undefined, running });
    if (plan.kind === "confirm") {
      const question = quitQuestion(plan.running);
      const { response } = await Utils.showMessageBox({ type: "question", title: question.title, message: question.message, buttons: question.buttons, defaultId: 1, cancelId: 1 });
      if (response !== 0) return;
    }
    if (owned && plan.kind !== "exit") {
      stopping = true;
      await stopServer(owned);
    }
    finalQuit();
  } finally {
    quitInFlight = false;
  }
}

function showMain(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.activate();
  }
}

function reload(): void {
  mainWindow?.webview.loadURL(lastUrl ?? `${appOrigin(port)}/`);
}

function zoom(by: number | undefined): void {
  const view = mainWindow?.webview;
  if (!view) return;
  view.setPageZoom(by === undefined ? 1 : Math.min(3, Math.max(0.5, view.getPageZoom() + by)));
}

function handleAction(action: unknown): void {
  if (action === "open") showMain();
  else if (action === "releases") openExternally(RELEASES_URL);
  else if (action === "quit") void requestQuit();
  else if (action === "reload") reload();
  else if (action === "zoom-in") zoom(0.1);
  else if (action === "zoom-out") zoom(-0.1);
  else if (action === "zoom-reset") zoom(undefined);
}

function setUpMenus(): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: "Spec Control",
      submenu: [
        { role: "about" },
        { label: "Releases Page", action: "releases" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "separator" },
        { label: "Quit Spec Control", action: "quit", accelerator: "q" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", action: "reload", accelerator: "r" },
        { type: "separator" },
        { label: "Actual Size", action: "zoom-reset", accelerator: "0" },
        { label: "Zoom In", action: "zoom-in", accelerator: "=" },
        { label: "Zoom Out", action: "zoom-out", accelerator: "-" },
        { type: "separator" },
        { role: "toggleFullScreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, { type: "separator" }, { label: "Spec Control", action: "open" }],
    },
  ]);
  Electrobun.events.on("application-menu-clicked", (event: unknown) => handleAction(((event as ElectrobunEvent).data as { action?: unknown })?.action));

  const tray = new Tray({ image: "views://assets/tray-Template.png", template: true, width: 18, height: 18 });
  tray.setMenu([
    { type: "normal", label: "Open Spec Control", action: "open" },
    { type: "normal", label: "Releases Page", action: "releases" },
    { type: "divider" },
    { type: "normal", label: "Quit Spec Control", action: "quit" },
  ]);
  tray.on("tray-clicked", (event: unknown) => handleAction(((event as ElectrobunEvent).data as { action?: unknown })?.action));
}

// `before-quit` cannot wait for anything, so it is always cancelled and the quit is decided asynchronously; the final
// `Utils.quit` passes once `quitting` is set.
Electrobun.events.on("before-quit", (event: unknown) => {
  if (quitting) return;
  (event as ElectrobunEvent).response = { allow: false };
  void requestQuit();
});
// A Dock click, or a second launch LaunchServices sent here, brings the window back.
Electrobun.events.on("reopen", () => showMain());

if ((await takeLock()) === "held") {
  // Another copy of the app runs; LaunchServices brings that one forward.
  quitting = true;
  Utils.quit(0);
} else {
  setUpMenus();
  toolsPath = (await loginShellPath(process.env.SHELL)).path;
  await start();
}
