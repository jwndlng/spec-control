// Client-side routes. Kept free of DOM access at import time so it can be unit-tested.
export type Route =
  | { view: "overview" }
  | { view: "board" }
  | { view: "activity" }
  | { view: "pullRequests" }
  | { view: "repo"; repoId: string }
  | { view: "change"; repoId: string; changeName: string }
  | { view: "settings" }
  | { view: "help" };

export function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/settings") return { view: "settings" };
  if (path === "/help") return { view: "help" };
  if (path === "/board") return { view: "board" };
  if (path === "/activity") return { view: "activity" };
  if (path === "/pull-requests") return { view: "pullRequests" };
  try {
    const change = /^\/repo\/([^/]+)\/change\/([^/]+)$/.exec(path);
    if (change) return { view: "change", repoId: decodeURIComponent(change[1]), changeName: decodeURIComponent(change[2]) };
    const repo = /^\/repo\/([^/]+)$/.exec(path);
    if (repo) return { view: "repo", repoId: decodeURIComponent(repo[1]) };
  } catch {
    return { view: "overview" };
  }
  return { view: "overview" };
}

/** The Pull requests view; `pullRequestsQuery` builds the query that filters it to one repository. */
export const PULL_REQUESTS_PATH = "/pull-requests";

export function repoPath(repoId: string): string {
  return `/repo/${encodeURIComponent(repoId)}`;
}

export function changePath(repoId: string, changeName: string): string {
  return `${repoPath(repoId)}/change/${encodeURIComponent(changeName)}`;
}

/**
 * The detail view's Console tab, where `artifact` names a tab rather than an artifact. No schema has an artifact of
 * this name (`openspec status` ids are the schema's own), so the two cannot collide.
 */
export const CONSOLE_TAB = "console";
/** A detail-view tab backed by the change snapshot rather than a schema artifact. */
export const PROMPT_TAB = "prompt";

/** What the change detail view keeps in the query string, so a view can be linked and survives a reload. */
export interface DetailQuery {
  /** An artifact id, `PROMPT_TAB`, or `CONSOLE_TAB`. */
  artifact?: string;
  /** Path relative to the change directory. */
  file?: string;
  raw: boolean;
  /** The board the view was opened from: its app path plus query, e.g. `/board?q=sync`. */
  from?: string;
  /** Which of the change's sessions the Console tab shows. */
  session?: string;
}

export function parseDetailQuery(search: string): DetailQuery {
  const p = new URLSearchParams(search);
  return {
    artifact: p.get("artifact") || undefined,
    file: p.get("file") || undefined,
    raw: p.get("raw") === "1",
    from: p.get("from") || undefined,
    session: p.get("session") || undefined,
  };
}

export function serializeDetailQuery(q: DetailQuery): string {
  const p = new URLSearchParams();
  if (q.artifact) p.set("artifact", q.artifact);
  if (q.file) p.set("file", q.file);
  if (q.raw) p.set("raw", "1");
  if (q.from) p.set("from", q.from);
  if (q.session) p.set("session", q.session);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Path and query of the board a card sits on, for the `from` parameter. */
export function boardFrom(path: string, query: string): string {
  return `${path}${query}`;
}

/**
 * Where the back link goes. `from` comes from the URL, so it is only followed when it is a board of this app — a
 * combined or repository board path, optionally with a query; anything else falls back to the repository's board.
 */
export function backTarget(from: string | undefined, repoId: string): { path: string; query: string } {
  const fallback = { path: repoPath(repoId), query: "" };
  if (!from?.startsWith("/") || from.startsWith("//") || from.includes("#") || from.includes("\\")) return fallback;
  const cut = from.indexOf("?");
  const path = cut === -1 ? from : from.slice(0, cut);
  const view = routeFromPath(path).view;
  if (view !== "board" && view !== "repo") return fallback;
  return { path, query: cut === -1 ? "" : from.slice(cut) };
}
