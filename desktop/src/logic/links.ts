// Which URLs stay in the app window and which go to the default browser (design D5). The window shows only the
// loopback origin of the server; every other web or mail link is handed to the system, anything else is dropped.

export type LinkTarget = { kind: "internal" } | { kind: "external"; url: string } | { kind: "drop" };

/** The server's own origin; the only one the window may show. */
export function appOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Electrobun's navigation rules, last match wins: block everything, then allow the server's origin. */
export function navigationRules(port: number): string[] {
  return ["^*", `${appOrigin(port)}/*`];
}

export function externalTarget(raw: string, port: number): LinkTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "drop" };
  }
  if (url.origin === appOrigin(port)) return { kind: "internal" };
  if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return { kind: "external", url: url.href };
  return { kind: "drop" };
}

/** What an Electrobun navigation event reports: the URL, and for `will-navigate` whether the navigation rules allowed it. */
export interface NavigationEvent {
  url: string;
  allowed?: boolean;
}

/**
 * Reads an Electrobun 2.0.2 navigation event's `data`. `will-navigate` arrives as `{ detail: '{"url":…,"allowed":…}' }`
 * with `detail` still a JSON string; `new-window-open` as `{ detail: { url, isCmdClick, … } }`, already parsed;
 * `did-navigate` as `{ detail: "<url>" }`. A string that is not JSON is the URL itself.
 */
export function navigationEvent(data: unknown): NavigationEvent | undefined {
  if (typeof data === "string") {
    try {
      return navigationEvent(JSON.parse(data));
    } catch {
      return { url: data };
    }
  }
  if (data && typeof data === "object") {
    const record = data as { url?: unknown; allowed?: unknown; detail?: unknown };
    if (typeof record.url === "string") return typeof record.allowed === "boolean" ? { url: record.url, allowed: record.allowed } : { url: record.url };
    if (record.detail !== undefined) return navigationEvent(record.detail);
  }
  return undefined;
}

/** The URL an Electrobun navigation event carries, in any of the shapes `navigationEvent` reads. */
export function eventUrl(data: unknown): string | undefined {
  return navigationEvent(data)?.url;
}

/** How long the same URL is not handed to the browser again: one click can report it as two events (design D2). */
export const REPEAT_WINDOW_MS = 1000;

export interface LastOpened {
  url: string;
  at: number;
}

/** Whether to hand `url` to the browser at `now`, given the last URL handed over; skips the second event of one click. */
export function shouldOpen(url: string, now: number, last: LastOpened | undefined): boolean {
  return !last || last.url !== url || now - last.at >= REPEAT_WINDOW_MS;
}
