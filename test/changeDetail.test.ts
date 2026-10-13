import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeArtifactEntry, ChangeSnapshot, PullRequest, PullRequestsResponse, RepoPullRequests, RepoSnapshot } from "../src/shared/types.ts";
import { ApiError } from "../src/ui/api.ts";
import {
  ArtifactTabs,
  absoluteFilePath,
  artifactLabel,
  ChangeNotFound,
  closeOnEscape,
  DetailHeader,
  DetailOverlay,
  detailClose,
  FileContent,
  FileList,
  type FileState,
  fileFailure,
  nextFileState,
  nextListing,
  resolveSelection,
  taskProgress,
  TERMINAL_SELECTOR,
} from "../src/ui/changeDetail.tsx";
import { type Card, ChangeCard, ConsoleLink, CopyButton, cardLink, consoleTarget, initialFilters } from "../src/ui/kanban.tsx";
import { renderMarkdown } from "../src/ui/markdown.tsx";
import { detailPullRequest } from "../src/ui/pullRequests.tsx";
import { backTarget, CONSOLE_TAB, parseDetailQuery, routeFromPath, serializeDetailQuery } from "../src/ui/routes.ts";
import { FIXTURES } from "./helpers.ts";
import { byComponent, byTag, elements, textOf } from "./vnode.ts";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const change: ChangeSnapshot = {
  repoId: "r1",
  name: "multi-tenant-sync",
  schema: "spec-driven",
  artifacts: [],
  tasks: { done: 4, total: 12 },
  created: "2026-03-02",
  lastActivityAt: "2026-03-07T12:00:00Z",
  branchMatch: "feat/multi-tenant-sync",
  stage: "implementing",
  column: "Implementing",
  warnings: ["could not read artifacts: unknown schema 'custom'"],
};
const repo: RepoSnapshot = { id: "r1", name: "forum-admin", path: "/w/acme/forum-admin", ok: true, scannedAt: "2026-03-10T12:00:00Z", isGit: true, worktrees: [], changes: [change] };
const DIR = "/w/acme/forum-admin/openspec/changes/multi-tenant-sync";

const artifacts: ChangeArtifactEntry[] = [
  { id: "proposal", status: "done", files: [{ path: "proposal.md", bytes: 10 }] },
  { id: "specs", status: "done", files: [{ path: "specs/dashboard-api/spec.md", bytes: 10 }, { path: "specs/kanban-board/spec.md", bytes: 10 }] },
  { id: "design", status: "ready", files: [] },
  { id: "tasks", status: "blocked", files: [] },
];

const copyTexts = (node: Parameters<typeof elements>[0]) => Object.fromEntries(byComponent(node, CopyButton).map((b) => [b.props.label as string, b.props.text as string]));
const classed = (node: Parameters<typeof elements>[0], cls: string) => elements(node).filter((el) => String(el.props.class ?? "").split(" ").includes(cls));

const noop = () => {};

test("header: repository link, change name, close control, warnings — and the state the card leaves out", () => {
  const header = DetailHeader({ repo, change, onClose: noop });
  expect(textOf(classed(header, "change-name")[0])).toBe("multi-tenant-sync");
  const links = byTag(header, "a");
  expect(links.map((a) => [textOf(a).trim(), a.props.href])).toEqual([["forum-admin", "/repo/r1"]]);
  expect(classed(header, "detail-close").map((b) => b.props["aria-label"])).toEqual(["Close"]);
  const text = textOf(header);
  expect(text).toContain("could not read artifacts: unknown schema 'custom'");
  // Column, tasks and the last update moved here from the card, and so did the branch.
  for (const label of ["Implementing", "4/12", "updated"]) expect(text).toContain(label);
  expect(classed(header, "meter")).toHaveLength(1);
  // The detail view's task bar keeps its bare count; only the card names the unit.
  expect(textOf(classed(classed(header, "meter")[0], "value")[0]).trim()).toBe("4/12");
  expect(elements(header).some((el) => String(el.props.title ?? "").includes("a branch or worktree matches this change"))).toBe(true);
  // Still not repeated: creation date and schema.
  for (const label of ["created", "2026-03-02", "spec-driven"]) expect(text).not.toContain(label);
  // no copy actions in the header any more
  expect(byComponent(header, CopyButton)).toEqual([]);

  const archived = DetailHeader({ repo, change: { ...change, archived: "2026-03-09", column: "Archived", tasks: null, warnings: undefined }, onClose: noop });
  expect(textOf(archived)).toContain("archived 2026-03-09");
  expect(classed(archived, "notice")).toEqual([]);
  expect(textOf(archived)).not.toContain("active copy left");
  // an active copy left next to the archive in the main checkout: a warning, with the directory to remove in its tooltip
  const leftover = DetailHeader({ repo, change: { ...change, archived: "2026-03-09", column: "Archived", branchMatch: undefined, otherCheckouts: [{ path: "/w/acme/forum-admin", branch: "main", isMain: true, column: "Done" }] }, onClose: noop });
  const badge = classed(leftover, "warning").find((el) => textOf(el).includes("active copy left · Done"));
  expect(String(badge?.props.title)).toContain("openspec/changes/multi-tenant-sync/");

  // A change that is gone from the snapshot has only its name: no facts row.
  expect(classed(DetailHeader({ repo, change: { name: "gone" }, onClose: noop }), "detail-facts")).toEqual([]);
});

test("the detail view shows the prompt as plain text, without the form's heading", () => {
  const prompted = { ...change, prompt: "# Prompt\n\nLog every mutation <b>now</b>\n" };
  const note = classed(DetailHeader({ repo, change: prompted, onClose: noop }), "detail-prompt")[0];
  expect(textOf(byTag(note, "p")[0])).toBe("Log every mutation <b>now</b>");
  expect(classed(DetailHeader({ repo, change, onClose: noop }), "detail-prompt")).toEqual([]);
});

test("the repository link keeps the filters of that repository's board when the view came from it", () => {
  const repoHref = (from?: string) => byTag(DetailHeader({ repo, change, from, onClose: noop }), "a")[0].props.href;
  expect(repoHref("/repo/r1?q=sync")).toBe("/repo/r1?q=sync");
  expect(repoHref("/board?q=sync")).toBe("/repo/r1");
  expect(repoHref("https://example.com/")).toBe("/repo/r1");
  expect(repoHref(undefined)).toBe("/repo/r1");
});

test("the overlay is a modal dialog named after the change, on a backdrop", () => {
  const view = DetailOverlay({ label: "Change multi-tenant-sync", onClose: noop, children: DetailHeader({ repo, change, onClose: noop }) });
  expect(String(view.props.class)).toContain("detail-overlay");
  const dialogs = elements(view).filter((el) => el.props.role === "dialog");
  expect(dialogs.length).toBe(1);
  expect(dialogs[0].props["aria-modal"]).toBe("true");
  expect(dialogs[0].props["aria-label"]).toContain("multi-tenant-sync");
  expect(dialogs[0].props.tabIndex).toBe(-1); // focusable, so the focus can move into it on open
});

test("close control, backdrop and Escape all lead to the same board", () => {
  for (const [from, expected] of [
    ["/board?q=sync", { path: "/board", query: "?q=sync" }],
    ["/repo/r1?active=5", { path: "/repo/r1", query: "?active=5" }],
    ["https://example.com/", { path: "/repo/r1", query: "" }],
    [undefined, { path: "/repo/r1", query: "" }],
  ] as const) {
    const went: { path: string; query: string }[] = [];
    const close = detailClose(from, "r1", (path, query) => went.push({ path, query }));
    const overlay = DetailOverlay({ label: "x", onClose: close, children: DetailHeader({ repo, change, from, onClose: close }) });

    // the close control
    (classed(overlay, "detail-close")[0].props.onClick as () => void)();
    // the backdrop: a press and a click on the backdrop itself
    const backdrop = {};
    (overlay.props.onMouseDown as (e: unknown) => void)({ target: backdrop, currentTarget: backdrop });
    (overlay.props.onClick as (e: unknown) => void)({ target: backdrop, currentTarget: backdrop });
    // Escape
    closeOnEscape(close)({ key: "Escape", defaultPrevented: false, preventDefault: noop } as unknown as KeyboardEvent);

    expect(went).toEqual([expected, expected, expected]);
    expect(backTarget(from, "r1")).toEqual(expected);
  }
});

test("only a press and click on the backdrop itself close, and only Escape among keys", () => {
  let closed = 0;
  const overlay = DetailOverlay({ label: "x", onClose: () => closed++, children: null });
  const down = overlay.props.onMouseDown as (e: unknown) => void;
  const click = overlay.props.onClick as (e: unknown) => void;
  const backdrop = {};
  const panel = {};
  // a click inside the panel bubbles up with another target
  down({ target: panel, currentTarget: backdrop });
  click({ target: panel, currentTarget: backdrop });
  // a text selection dragged out of the panel: pressed inside, released on the backdrop
  click({ target: backdrop, currentTarget: backdrop });
  expect(closed).toBe(0);

  const onKey = closeOnEscape(() => closed++);
  onKey({ key: "Enter", defaultPrevented: false, preventDefault: noop } as unknown as KeyboardEvent);
  onKey({ key: "Escape", defaultPrevented: true, preventDefault: noop } as unknown as KeyboardEvent); // someone else handled it
  expect(closed).toBe(0);
});

test("not found names what was asked for and links to the overview", () => {
  const unknownChange = ChangeNotFound({ repo, repoId: "r1", changeName: "gone-away" });
  expect(textOf(unknownChange)).toContain("forum-admin");
  expect(textOf(unknownChange)).toContain("gone-away");
  expect(byTag(unknownChange, "a")[0].props.href).toBe("/");
  const unknownRepo = ChangeNotFound({ repoId: "nope", changeName: "gone-away" });
  expect(textOf(unknownRepo)).toContain("nope");
  expect(textOf(unknownRepo)).toContain("gone-away");
});

test("tabs: schema order, state on every tab, artifacts without files not selectable", () => {
  const picked: string[] = [];
  const tabs = byTag(ArtifactTabs({ artifacts, selected: "specs", onSelect: (id) => picked.push(id) }), "button");
  expect(tabs.map((t) => textOf(t))).toEqual(["Proposaldone", "Specsdone", "Designready", "Tasksblocked"]);
  expect(tabs.map((t) => t.props.disabled)).toEqual([false, false, true, true]);
  expect(tabs.map((t) => t.props["aria-selected"])).toEqual([false, true, false, false]);
  (tabs[0].props.onClick as () => void)();
  expect(picked).toEqual(["proposal"]);
  expect(artifactLabel("release-notes")).toBe("Release notes");
});

test("the Console tab comes last and is selectable whatever the artifacts are in", () => {
  const withConsole = byTag(ArtifactTabs({ artifacts, selected: CONSOLE_TAB, onSelect: () => {}, console: true }), "button");
  expect(withConsole.map((tab) => textOf(tab))).toEqual(["Proposaldone", "Specsdone", "Designready", "Tasksblocked", "Console"]);
  // Last, selectable, and carrying no artifact state: the Console tab is not an artifact.
  expect(withConsole[4].props.disabled).toBeFalsy();
  expect(withConsole[4].props["aria-selected"]).toBe(true);

  // A change with no artifact file at all still has a selectable Console tab.
  const noFiles = artifacts.map((a) => ({ ...a, files: [], status: "ready" as const }));
  const bare = byTag(ArtifactTabs({ artifacts: noFiles, selected: CONSOLE_TAB, onSelect: () => {}, console: true }), "button");
  expect(bare.slice(0, 4).every((tab) => tab.props.disabled)).toBe(true);
  expect(bare[4].props.disabled).toBeFalsy();

  // Feature off for the repository: no Console tab at all.
  expect(byTag(ArtifactTabs({ artifacts, selected: "proposal", onSelect: () => {} }), "button").map((tab) => textOf(tab))).not.toContain("Console");
});

test("selection: URL wins when it exists, stale artifact or file falls back without an error", () => {
  expect(resolveSelection(artifacts, {})).toEqual({ artifactId: "proposal", file: "proposal.md" });
  expect(resolveSelection(artifacts, { artifact: "specs" })).toEqual({ artifactId: "specs", file: "specs/dashboard-api/spec.md" });
  expect(resolveSelection(artifacts, { artifact: "specs", file: "specs/kanban-board/spec.md" })).toEqual({ artifactId: "specs", file: "specs/kanban-board/spec.md" });
  expect(resolveSelection(artifacts, { artifact: "specs", file: "specs/gone/spec.md" })).toEqual({ artifactId: "specs", file: "specs/dashboard-api/spec.md" });
  expect(resolveSelection(artifacts, { artifact: "design" })).toEqual({ artifactId: "proposal", file: "proposal.md" }); // exists, but has no file
  expect(resolveSelection(artifacts, { artifact: "nope", file: "../../etc/passwd" })).toEqual({ artifactId: "proposal", file: "proposal.md" });
  expect(resolveSelection(artifacts.map((a) => ({ ...a, files: [] })), { artifact: "specs" })).toEqual({});
  expect(resolveSelection([], {})).toEqual({});
  // The Console tab is selectable whenever it is offered — which is now decided per repository, not per change.
  expect(resolveSelection(artifacts, { artifact: CONSOLE_TAB }, true)).toEqual({ artifactId: CONSOLE_TAB });
  expect(resolveSelection([], { artifact: CONSOLE_TAB }, true)).toEqual({ artifactId: CONSOLE_TAB });
  // No Console tab (agent sessions off for the repository): fall back to the first artifact with content, no error.
  expect(resolveSelection(artifacts, { artifact: CONSOLE_TAB }, false)).toEqual({ artifactId: "proposal", file: "proposal.md" });
});

test("file list only for multi-file artifacts, first file selected by default", () => {
  expect(FileList({ artifact: artifacts[0], selected: "proposal.md", onSelect: () => {} })).toBeNull();
  const picked: string[] = [];
  const selected = resolveSelection(artifacts, { artifact: "specs" }).file;
  const buttons = byTag(FileList({ artifact: artifacts[1], selected, onSelect: (p) => picked.push(p) }), "button");
  expect(buttons.map((b) => [textOf(b), b.props["aria-current"]])).toEqual([["specs/dashboard-api/spec.md", "true"], ["specs/kanban-board/spec.md", undefined]]);
  (buttons[1].props.onClick as () => void)();
  expect(picked).toEqual(["specs/kanban-board/spec.md"]);
});

test("tasks artifact: read-only checklist with done/total from the file on screen", () => {
  const text = readFileSync(join(FIXTURES, "demo-ops", "openspec", "changes", "cloud-deployment", "tasks.md"), "utf8");
  expect(taskProgress(text)).toEqual({ done: 4, awaiting: 0, total: 10 });
  expect(taskProgress("1. [X] a\n* [ ] b\n  - [x] c\nnot [x] a task")).toEqual({ done: 2, awaiting: 0, total: 3 });
  const view = FileContent({ state: { status: "ok", path: "tasks.md", text }, raw: false, isTasks: true, rendered: renderMarkdown(text) });
  expect(textOf(view)).toContain("4/10");
  const boxes = byTag(view, "input");
  expect(boxes.map((b) => b.props.checked)).toEqual([true, true, true, true, false, false, false, false, false, false]);
  // not operable: disabled, and no handler that could send anything
  for (const box of boxes) {
    expect(box.props.disabled).toBe(true);
    expect(Object.keys(box.props).filter((k) => k.startsWith("on"))).toEqual([]);
  }
  // other artifacts get no progress bar
  expect(textOf(FileContent({ state: { status: "ok", path: "proposal.md", text }, raw: false, isTasks: false, rendered: renderMarkdown(text) }))).not.toContain("4/10");
});

test("tasks artifact: the three checkbox states render distinctly, none of them operable", () => {
  const text = ["## 1. Work", "", "- [x] 1.1 built and checked", "- [~] 1.2 check it in the browser", "- [ ] 1.3 still open", ""].join("\n");
  expect(taskProgress(text)).toEqual({ done: 1, awaiting: 1, total: 3 });
  const view = FileContent({ state: { status: "ok", path: "tasks.md", text }, raw: false, isTasks: true, rendered: renderMarkdown(text) });

  const boxes = byTag(view, "input");
  expect(boxes.map((b) => [b.props.checked, b.props.indeterminate, b.props["aria-checked"]])).toEqual([
    [true, undefined, undefined],
    [false, true, "mixed"],
    [false, undefined, undefined],
  ]);
  // Clicking any of them sends nothing: every box is disabled and carries no handler at all.
  for (const box of boxes) {
    expect(box.props.disabled).toBe(true);
    expect(Object.keys(box.props).filter((k) => k.startsWith("on"))).toEqual([]);
  }
  // The awaiting item is marked as such, and reads as its own words: the marker is not left in the text.
  const items = byTag(view, "li");
  expect(items.map((li) => li.props.class)).toEqual(["task", "task awaiting", "task"]);
  expect(textOf(items[1])).toBe("1.2 check it in the browser");
  // And the view says in words how many await validation.
  expect(textOf(view)).toContain("1 + 1 awaiting / 3");
  expect(textOf(view)).toContain("1 task awaits your validation");
  expect(textOf(FileContent({ state: { status: "ok", path: "tasks.md", text: "- [x] a\n- [ ] b\n" }, raw: false, isTasks: true, rendered: renderMarkdown("- [x] a\n- [ ] b\n") }))).not.toContain("await");
});

test("raw shows the source verbatim instead of the rendering", () => {
  const text = "## Why\n\n- [x] **done**\n";
  const raw = FileContent({ state: { status: "ok", path: "proposal.md", text }, raw: true, isTasks: false, rendered: renderMarkdown(text) });
  expect(byTag(raw, "pre").map(textOf)).toEqual([text]);
  expect(byTag(raw, "h2")).toEqual([]);
  // the toggle lives in the query, not per file: it survives selecting another file and a reload
  expect(parseDetailQuery("?artifact=specs&file=specs%2Fa%2Fspec.md&raw=1").raw).toBe(true);
});

test("error and oversize states stay inside the content area", () => {
  const tooLarge = fileFailure("huge.md", new ApiError(413, "file is larger than 1048576 bytes"));
  expect(tooLarge.status).toBe("too-large");
  expect(absoluteFilePath(`${DIR}/`, "specs/a/spec.md")).toBe(`${DIR}/specs/a/spec.md`);
  const big = FileContent({ state: tooLarge, raw: false, isTasks: false, rendered: null, filePath: absoluteFilePath(DIR, "huge.md") });
  expect(textOf(big)).toContain("too large to display");
  expect(copyTexts(big)).toEqual({ "Copy file path": `${DIR}/huge.md` });

  const gone = fileFailure("design.md", new ApiError(404, "no such file in this change"));
  expect(gone).toEqual({ status: "error", path: "design.md", message: "no such file in this change" });
  const view = FileContent({ state: gone, raw: false, isTasks: false, rendered: null });
  expect(textOf(view)).toBe("Could not read design.md: no such file in this change");
  expect(fileFailure("x.md", "offline").status).toBe("error");
});

test("an unchanged poll keeps the very same state objects, a changed one replaces them", () => {
  const shown: FileState = { status: "ok", path: "tasks.md", text: "- [ ] a\n" };
  expect(nextFileState(shown, { status: "ok", path: "tasks.md", text: "- [ ] a\n" })).toBe(shown);
  expect(nextFileState(shown, { status: "ok", path: "tasks.md", text: "- [x] a\n" })).not.toBe(shown);
  expect(nextFileState(shown, { status: "ok", path: "design.md", text: "- [ ] a\n" })).not.toBe(shown);
  const failed: FileState = { status: "error", path: "tasks.md", message: "boom" };
  expect(nextFileState(failed, { status: "error", path: "tasks.md", message: "boom" })).toBe(failed);
  expect(nextFileState(failed, shown)).toBe(shown);
  expect(nextFileState(null, shown)).toBe(shown);

  const listing = { change: { repoId: "r1", name: "x", schema: "spec-driven", dir: DIR, archived: false }, artifacts };
  expect(nextListing(listing, structuredClone(listing))).toBe(listing);
  const grown = structuredClone(listing);
  grown.artifacts[2].files.push({ path: "design.md", bytes: 5 }); // an artifact written on disk: its tab becomes selectable
  expect(nextListing(listing, grown)).toBe(grown);
});

const card: Card = { ...change, repoName: "forum-admin", repoPath: "/w/acme/forum-admin", hue: 120 };

test("Show details is a card's only link, carrying the board and its filters", () => {
  const link = cardLink(card, "/board?q=sync&archived=0");
  expect(link.path).toBe("/repo/r1/change/multi-tenant-sync");
  expect(routeFromPath(link.path)).toEqual({ view: "change", repoId: "r1", changeName: "multi-tenant-sync" });
  expect(backTarget(parseDetailQuery(link.query).from, "r1")).toEqual({ path: "/board", query: "?q=sync&archived=0" });

  {
    const view = ChangeCard({ card, now: NOW, from: "/board?q=sync" });
    const anchors = byTag(view, "a");
    expect(anchors.map((a) => a.props.href)).toEqual(["/repo/r1/change/multi-tenant-sync?from=%2Fboard%3Fq%3Dsync"]);
    expect(textOf(anchors[0]).trim()).toBe("Show details");
    expect(anchors[0].props["aria-label"]).toBe("Show details of multi-tenant-sync");
    // the change name is plain text, and the card has no copy action any more
    expect(textOf(classed(view, "name")[0])).toBe("multi-tenant-sync");
    expect(byComponent(view, CopyButton)).toEqual([]);
  }
  const archived = ChangeCard({ card: { ...card, archived: "2026-03-09" }, now: NOW, from: "/board" });
  expect(byTag(archived, "a").map((a) => textOf(a).trim())).toEqual(["Show details"]);
});

test("a card shows only what an overview needs, and leaves the rest to the detail view", () => {
  const detailed: Card = {
    ...card,
    prompt: "Log every mutation",
    artifacts: [
      { id: "proposal", status: "done" },
      { id: "design", status: "done" },
    ],
  };
  const view = ChangeCard({ card: detailed, now: NOW, from: "/board" });
  // no button or session starter inside the link: only its decorative chevron
  expect(elements(byTag(view, "a")[0].props.children).map((el) => el.type)).toEqual(["svg", "path"]);
  const text = textOf(view);
  for (const part of ["multi-tenant-sync", "4/12", "3d ago", "Show details"]) expect(text).toContain(part);
  // Repository (its group names it), branch, prompt and completed phases are not on the card.
  for (const part of ["forum-admin", "feat/multi-tenant-sync", "prompt", "Log every mutation"]) expect(text).not.toContain(part);
  expect(classed(view, "artifacts")).toEqual([]);
  // The top row: the name, and under it when the change was last updated.
  const top = classed(view, "card-top")[0];
  expect(textOf(classed(top, "name")[0])).toBe("multi-tenant-sync");
  expect(textOf(classed(top, "age")[0])).toBe("updated 3d ago");
  // The name comes first and shares the top with nothing but the console link's slot; the session status is in the
  // footer now, so no status line sits between the age and the progress bar.
  const topChildren = [top.props.children].flat() as { type: unknown; props: { class?: string } }[];
  expect(topChildren.map((el) => el.props.class ?? el.type)).toEqual(["card-title", ConsoleLink]);
  expect(classed(view, "card-status")).toEqual([]);
  // The progress bar names what it counts: tasks once the change is past Drafts, artifacts while drafting.
  expect(textOf(classed(view, "value")[0])).toBe("4/12 Tasks");
  const drafting = ChangeCard({ card: { ...detailed, stage: "drafts", column: "Drafts" }, now: NOW, from: "/board" });
  expect(textOf(classed(drafting, "value")[0])).toBe("2/2 Artifacts");
  // No coloured card edge: the card itself is not repository-tinted.
  expect(String(elements(view)[0].props.class).split(" ")).not.toContain("repo-tint");
});

test("the console quick link opens the detail view on its Console tab and keeps the board", () => {
  const target = consoleTarget(card, "/board?q=sync");
  expect(target.path).toBe("/repo/r1/change/multi-tenant-sync");
  expect(parseDetailQuery(target.query)).toMatchObject({ artifact: CONSOLE_TAB, from: "/board?q=sync" });

  // Every card carries the link's slot, in the card's top and nowhere else, whatever the change's session history is:
  // whether it draws anything is `consoleTabAvailable`'s call, which is a repository's setting (see workStatusUi).
  for (const one of [card, { ...card, archived: "2026-03-09" }]) {
    const view = ChangeCard({ card: one, now: NOW, from: "/board" });
    expect(byComponent(view, ConsoleLink)).toHaveLength(1);
    expect(byComponent(classed(view, "card-top")[0], ConsoleLink)).toHaveLength(1);
    expect(byComponent(classed(view, "meta")[0], ConsoleLink)).toEqual([]);
  }
});

test("a board behind the detail view takes its filters from the query it is given", () => {
  expect(initialFilters("?q=sync", undefined).q).toBe("sync");
  // a repository board drops a stray repo filter
  expect(initialFilters("?q=sync&repos=r2", "r1")).toMatchObject({ q: "sync", repos: [] });
  // the detail view's own query carries no filter
  expect(initialFilters("?artifact=specs&from=%2Fboard%3Fq%3Dsync", undefined).q).toBe("");
});

test("the Console tab comes after the artifacts, carries no state, and stays selectable when they are all empty", () => {
  const picked: string[] = [];
  const tabs = byTag(ArtifactTabs({ artifacts, selected: CONSOLE_TAB, onSelect: (id) => picked.push(id), console: true }), "button");
  expect(tabs.map((t) => textOf(t))).toEqual(["Proposaldone", "Specsdone", "Designready", "Tasksblocked", "Console"]);
  // Not an artifact: no state pill, never disabled, and it is the selected one here.
  expect(tabs[4].props.disabled).toBeFalsy();
  expect(tabs.map((t) => t.props["aria-selected"])).toEqual([false, false, false, false, true]);
  (tabs[4].props.onClick as () => void)();
  expect(picked).toEqual([CONSOLE_TAB]);

  // A change whose artifacts are all unwritten can still be watched.
  const empty = byTag(ArtifactTabs({ artifacts: artifacts.map((a) => ({ ...a, files: [] })), selected: CONSOLE_TAB, onSelect: () => {}, console: true }), "button");
  expect(empty.every((t, i) => (i < 4 ? t.props.disabled === true : t.props.disabled !== true))).toBe(true);

  // Without a session there is no Console tab at all.
  expect(byTag(ArtifactTabs({ artifacts, selected: "proposal", onSelect: () => {} }), "button")).toHaveLength(4);
});

test("selection: the console wins when the change has one, and falls back to an artifact when it does not", () => {
  expect(resolveSelection(artifacts, { artifact: CONSOLE_TAB }, true)).toEqual({ artifactId: CONSOLE_TAB });
  // A change with no session: a console link is stale like any other, so it falls back without an error.
  expect(resolveSelection(artifacts, { artifact: CONSOLE_TAB }, false)).toEqual({ artifactId: "proposal", file: "proposal.md" });
  // The console is selectable even when nothing has been written yet.
  expect(resolveSelection([], { artifact: CONSOLE_TAB }, true)).toEqual({ artifactId: CONSOLE_TAB });
  expect(resolveSelection([], { artifact: CONSOLE_TAB }, false)).toEqual({});
  // A file in the query is ignored on the console; it belongs to an artifact.
  expect(resolveSelection(artifacts, { artifact: CONSOLE_TAB, file: "proposal.md" }, true)).toEqual({ artifactId: CONSOLE_TAB });
});

test("the selected tab and session survive the URL in both directions", () => {
  const q = { raw: false, artifact: CONSOLE_TAB, session: "s-1", from: "/board?q=sync" };
  const round = parseDetailQuery(serializeDetailQuery(q));
  expect(round.artifact).toBe(CONSOLE_TAB);
  expect(round.session).toBe("s-1");
  expect(round.from).toBe("/board?q=sync");
  // Nothing extra when there is no console to point at.
  expect(serializeDetailQuery({ raw: false })).toBe("");
  expect(parseDetailQuery("?artifact=console").session).toBeUndefined();
});

test("Escape reaches the agent while the keyboard is in the terminal, and closes from anywhere else", () => {
  let closed = 0;
  const onKey = closeOnEscape(() => closed++);
  const esc = (target: unknown) => onKey({ key: "Escape", defaultPrevented: false, preventDefault: noop, target } as unknown as KeyboardEvent);

  // Inside the terminal: the agent gets it, the overlay stays.
  esc({ closest: (sel: string) => (sel === TERMINAL_SELECTOR ? {} : null) });
  expect(closed).toBe(0);

  // On the tab strip, or on anything with no DOM ancestry at all: the overlay closes.
  esc({ closest: () => null });
  esc(undefined);
  expect(closed).toBe(2);
});

test("a poll changes neither the selected tab nor the selected session", () => {
  // The selection lives in the URL, and an unchanged re-fetch keeps the previous listing object, so the memo that
  // resolves it does not even recompute: the console cannot be swapped out underneath the user by a refresh.
  const query = { raw: false, artifact: CONSOLE_TAB, session: "s-2", from: "/board" };
  const listing = { change: { name: "c", dir: "/w/c" }, artifacts } as never;
  const refetched = JSON.parse(JSON.stringify(listing));
  expect(nextListing(listing, refetched)).toBe(listing);

  const before = resolveSelection(artifacts, query, true);
  const after = resolveSelection(artifacts, parseDetailQuery(serializeDetailQuery(query)), true);
  expect(after).toEqual(before);
  expect(after).toEqual({ artifactId: CONSOLE_TAB });
  expect(parseDetailQuery(serializeDetailQuery(query)).session).toBe("s-2");
});

// ---- the change's pull request in the header ----

const headerPr: PullRequest = {
  number: 125,
  title: "Add the validate phase",
  url: "https://github.com/acme/forum-admin/pull/125",
  author: "octo",
  head: "feat/multi-tenant-sync",
  base: "main",
  draft: false,
  state: "open",
  createdAt: "2026-03-09T12:00:00Z",
  review: "approved",
  reviewRequestedFromViewer: false,
  checks: "failing",
  mergeable: "mergeable",
};
const prResponse = (patch: Partial<RepoPullRequests> = {}, pullRequests: PullRequest[] = [headerPr]): PullRequestsResponse => ({
  repos: [{ repoId: "r1", github: "acme/forum-admin", status: "ok", fetchedAt: "2026-03-10T11:58:00Z", pullRequests, ...patch }],
});
const headerWith = (response: PullRequestsResponse | undefined, c: ChangeSnapshot = change) => DetailHeader({ repo, change: c, onClose: noop, pullRequest: detailPullRequest(c, response) });

test("header: the change's pull request beside its branch — number, title link, state, review and checks", () => {
  const header = headerWith(prResponse());
  const facts = classed(header, "detail-facts")[0];
  const line = classed(facts, "detail-pr")[0];
  expect(line).toBeDefined();
  // Beside the branch: the pull request follows the branch badge in the facts row.
  const order = elements(facts).map((el) => String(el.props.class ?? "")).filter((c) => c === "detail-pr" || c.includes("branch"));
  expect(order.indexOf("detail-pr")).toBeGreaterThan(0);
  const text = textOf(line);
  expect(text).toContain("#125");
  const link = byTag(line, "a")[0];
  expect(link.props.href).toBe("https://github.com/acme/forum-admin/pull/125");
  expect(link.props.target).toBe("_blank");
  expect(link.props.rel).toBe("noopener noreferrer");
  expect(textOf(link)).toBe("Add the validate phase");
  // State, review decision and checks as the Pull requests view says them, with words a screen reader reads.
  const chips = classed(line, "pr-chip");
  expect(chips.map((c) => c.props.title)).toEqual(["Open on GitHub", "Review decision: approved", "At least one check failed", expect.stringContaining("Not ready: at least one check failed")]);
  expect(chips.map((c) => textOf(classed(c, "visually-hidden")))).toEqual(["Open on GitHub", "Review decision: approved", "At least one check failed", expect.stringContaining("Not ready")]);
  expect(text).toContain("✕ Checks");
  // Its readiness, in the card's words and role, with when the list was fetched.
  expect(text).toContain("✕ checks failing");
  expect(String(chips[3].props.class)).toContain("danger");
  expect(String(chips[3].props.title)).toContain("list fetched");
});

test("header: no pull request means the branch alone, with nothing in its place", () => {
  const header = headerWith(prResponse({}, []));
  expect(classed(header, "detail-pr")).toEqual([]);
  expect(classed(header, "detail-pr-unavailable")).toEqual([]);
  expect(textOf(header)).toContain("feat/multi-tenant-sync");
  expect(classed(headerWith(undefined), "detail-pr")).toEqual([]);
  expect(classed(DetailHeader({ repo, change, onClose: noop }), "detail-pr")).toEqual([]);
});

test("header: an archived change shows the pull request of its archive branch", () => {
  const archived: ChangeSnapshot = { ...change, archived: "2026-03-09", column: "Archived", stage: "archived", branchMatch: undefined };
  const archivePr: PullRequest = { ...headerPr, number: 131, url: "https://github.com/acme/forum-admin/pull/131", head: "chore/archive-multi-tenant-sync" };
  const header = headerWith(prResponse({}, [{ ...headerPr, state: "merged", mergedAt: "2026-03-09T10:00:00Z" }, archivePr]), archived);
  const line = classed(header, "detail-pr")[0];
  expect(textOf(line)).toContain("#131");
  expect(byTag(line, "a")[0]?.props.href).toBe(archivePr.url);
});

test("header: no way to act on the pull request", () => {
  const line = classed(headerWith(prResponse({}, [{ ...headerPr, review: "review_required", checks: "pending" }])), "detail-pr")[0];
  expect(byTag(line, "button")).toEqual([]);
  expect(byTag(line, "form")).toEqual([]);
  expect(byTag(line, "a")).toHaveLength(1);
  expect(textOf(line)).not.toMatch(/approve\b|merge\b|comment|close\b|reopen/i);
});

test("header: unavailable pull requests are explained once, with the capability's reason", () => {
  const missing = headerWith(prResponse({ status: "unavailable", setup: "gh-missing", reason: "gh: command not found" }));
  const notes = classed(missing, "detail-pr-unavailable");
  expect(notes).toHaveLength(1);
  expect(textOf(notes[0])).toBe("pull requests unavailable: The GitHub CLI is not installed.");
  expect(classed(missing, "detail-pr")).toEqual([]);

  const notGithub = headerWith(prResponse({ status: "unavailable", github: undefined, reason: "origin is not on github.com" }, []));
  expect(classed(notGithub, "detail-pr-unavailable").map((n) => textOf(n))).toEqual(["pull requests unavailable: origin is not on github.com"]);

  // Never fetched and failed are not "unavailable": a failed list still links from its last good copy.
  expect(classed(headerWith(prResponse({ status: "never", fetchedAt: undefined }, [])), "detail-pr-unavailable")).toEqual([]);
  expect(classed(headerWith(prResponse({ status: "failed", reason: "timed out" })), "detail-pr")).toHaveLength(1);
});

test("the header lists what the change depends on, with states in words, and what depends on it", () => {
  const changes: ChangeSnapshot[] = [
    { ...change, name: "add-billing-schema", stage: "done", column: "Done", warnings: undefined },
    { ...change, name: "add-billing-api", stage: "implementing", column: "Implementing", warnings: undefined, requiredBy: ["add-billing-docs", "add-billing-ui"] },
    {
      ...change, name: "add-billing-ui", stage: "ready", column: "Ready", blocked: true,
      warnings: ['depends on "add-billing-scheme", but no change of that name exists'],
      dependsOn: [
        { name: "add-billing-schema", state: "met" },
        { name: "add-billing-api", state: "waiting" },
        { name: "add-billing-scheme", state: "missing" },
      ],
    },
  ];
  const billing: RepoSnapshot = { ...repo, changes };
  const ui = DetailHeader({ repo: billing, change: changes[2], from: "/board?q=billing", onClose: noop });
  const deps = classed(ui, "detail-deps")[0];
  expect(textOf(deps)).toContain("blocked — Implement is held back");
  expect(classed(deps, "dep-met").map(textOf)).toEqual(["add-billing-schema — met"]);
  expect(classed(deps, "dep-waiting").map(textOf)).toEqual(["add-billing-api — waiting"]);
  // Known names link to their detail view, keeping the board; a missing one is text.
  expect(byTag(deps, "a").map((a) => [textOf(a), a.props.href])).toEqual([
    ["add-billing-schema", "/repo/r1/change/add-billing-schema?from=%2Fboard%3Fq%3Dbilling"],
    ["add-billing-api", "/repo/r1/change/add-billing-api?from=%2Fboard%3Fq%3Dbilling"],
  ]);
  expect(textOf(classed(deps, "dep-missing")[0])).toBe("add-billing-scheme — missing");
  expect(textOf(ui)).toContain('depends on "add-billing-scheme", but no change of that name exists');

  const api = classed(DetailHeader({ repo: billing, change: changes[1], onClose: noop }), "detail-deps")[0];
  expect(textOf(api)).toContain("Required by");
  expect(byTag(api, "li").map(textOf)).toEqual(["add-billing-docs", "add-billing-ui"]);
  expect(byTag(api, "a").map(textOf)).toEqual(["add-billing-ui"]); // add-billing-docs is not in this snapshot

  expect(classed(DetailHeader({ repo: billing, change: changes[0], onClose: noop }), "detail-deps")).toEqual([]);
});
