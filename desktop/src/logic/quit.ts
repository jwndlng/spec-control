// Quitting (design D6): a server the app attached to is never signalled; one it started is stopped like `Ctrl+C`,
// after asking while agent sessions run, so they end as resumable.

export type QuitPlan = { kind: "exit" } | { kind: "confirm"; running: number } | { kind: "stop" };

export function quitPlan({ ownsServer, running }: { ownsServer: boolean; running: number }): QuitPlan {
  if (!ownsServer) return { kind: "exit" };
  return running > 0 ? { kind: "confirm", running } : { kind: "stop" };
}

/** Running sessions in a `GET /api/sessions` body; anything unreadable counts as none. */
export function countRunning(body: unknown): number {
  const sessions = (body as { sessions?: unknown })?.sessions;
  if (!Array.isArray(sessions)) return 0;
  return sessions.filter((s) => (s as { state?: unknown })?.state === "running").length;
}

export function quitQuestion(running: number): { title: string; message: string; buttons: [string, string] } {
  const sessions = running === 1 ? "1 running agent session" : `${running} running agent sessions`;
  return {
    title: `Stop ${sessions}?`,
    message: `Quitting Spec Control stops its server and ${sessions}. They can be resumed the next time you open it.`,
    buttons: ["Quit", "Cancel"],
  };
}

export interface StoppableChild {
  kill(signal?: NodeJS.Signals | number): void;
  exited: Promise<unknown>;
}

/** SIGTERM, then up to `graceMs` for the server to end its sessions, and only then SIGKILL. */
export async function stopServer(child: StoppableChild, graceMs = 10_000): Promise<"stopped" | "killed"> {
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([child.exited.then(() => "stopped" as const), new Promise<"killed">((resolve) => (timer = setTimeout(() => resolve("killed"), graceMs)))]);
  clearTimeout(timer);
  if (outcome === "killed") {
    child.kill("SIGKILL");
    await child.exited;
  }
  return outcome;
}

/**
 * Every exit stops the server the app started (desktop-window-fixes D1), the same way as Quit; `undefined` — attached
 * to a server started elsewhere, or nothing running — stops nothing.
 */
export async function stopOwned(owned: StoppableChild | undefined, graceMs?: number): Promise<"none" | "stopped" | "killed"> {
  if (!owned) return "none";
  return stopServer(owned, graceMs);
}
