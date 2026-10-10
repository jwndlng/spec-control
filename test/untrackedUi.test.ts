import { expect, test } from "bun:test";
import { defaultAgentSessions, defaultConfig } from "../src/server/config.ts";
import type { Config, DiscoverResult, GithubClone, RepoSnapshot } from "../src/shared/types.ts";
import { NewProjectButton } from "../src/ui/newProject.tsx";
import { NothingTracked, PendingTableRow, PendingTile, Row, Tile } from "../src/ui/overview.tsx";
import { overviewRows, untrackedEntries } from "../src/ui/overviewState.ts";
import { FoundSummary } from "../src/ui/settings.tsx";
import { AddGithubButton } from "../src/ui/addGithub.tsx";
import { type CloneActions, DisableButton, type Tracking, UnmanagedSection, type UntrackedSectionProps } from "../src/ui/untracked.tsx";
import { byComponent, byTag, textOf } from "./vnode.ts";

/** Records what the view asks for instead of calling the server. */
function tracking(state: Partial<Pick<Tracking, "busy" | "errors" | "renaming" | "labelsOpen" | "settingsOpen">> = {}) {
  const calls: string[] = [];
  const t: Tracking = {
    busy: state.busy ?? {},
    errors: state.errors ?? {},
    renaming: state.renaming,
    labelsOpen: state.labelsOpen,
    settingsOpen: state.settingsOpen,
    enable: (e) => calls.push(`enable ${e.id}`),
    disable: (id) => calls.push(`disable ${id}`),
    ignore: (e) => calls.push(`ignore ${e.id}`),
    integrate: (e) => calls.push(`integrate ${e.id}`),
    forget: (e) => calls.push(`forget ${e.id}`),
    startRename: (id) => calls.push(`startRename ${id}`),
    cancelRename: () => calls.push("cancelRename"),
    rename: (id, current, next) => calls.push(`rename ${id} ${current}->${next}`),
    setAgent: (id, patch) => calls.push(`agent ${id} ${JSON.stringify(patch)}`),
    setLabels: (id, patch) => calls.push(`labels ${id} ${JSON.stringify(patch)}`),
    setPrTitleConvention: (id, convention) => calls.push(`prTitles ${id} ${convention}`),
    setAutoFetch: (id, minutes) => calls.push(`autoFetch ${id} ${minutes}`),
    setLabelColor: (id, label, hue) => calls.push(`labelColor ${id} ${label} ${hue}`),
    openLabels: (id) => calls.push(`openLabels ${id}`),
    closeLabels: () => calls.push("closeLabels"),
    openSettings: (id) => calls.push(`openSettings ${id}`),
    closeSettings: () => calls.push("closeSettings"),
  };
  return { t, calls };
}

const config: Config = {
  ...defaultConfig(),
  scanRoots: ["/w"],
  agentSessions: { ...defaultAgentSessions(), enabled: true },
  repos: [{ id: "d", path: "/w/acme/demo-agent", name: "demo-agent", enabled: false }],
};
const found: DiscoverResult = {
  candidates: [{ id: "b", path: "/w/acme/beta-soc", name: "beta-soc", enabled: false, sameRemoteAs: [{ name: "pkg-tools", path: "/w/ops/pkg-tools", tracked: true }] }],
  integratable: [{ id: "c", path: "/w/acme/chat-groups", name: "chat-groups" }],
  errors: [],
};

function cloneActions(calls: string[], state: Partial<Pick<CloneActions, "busy" | "errors">> = {}): CloneActions {
  return { busy: state.busy ?? {}, errors: state.errors ?? {}, cancel: (c) => calls.push(`cancel ${c.id}`), retry: (c) => calls.push(`retry ${c.id}`), dismiss: (c) => calls.push(`dismiss ${c.id}`) };
}

function section(patch: Partial<UntrackedSectionProps> = {}) {
  const { t, calls } = tracking();
  const shown: string[] = [];
  const props: UntrackedSectionProps = {
    clones: cloneActions(calls),
    entries: untrackedEntries(config, found),
    discovery: { result: found, running: false },
    hasRoots: true,
    query: "",
    tracking: t,
    runningIntegration: () => undefined,
    showIntegration: (id) => shown.push(id),
    onRediscover: () => calls.push("rediscover"),
    ...patch,
  };
  return { view: UnmanagedSection(props), calls, shown };
}

const buttons = (node: ReturnType<typeof section>["view"]) => byTag(node, "button");
const button = (node: ReturnType<typeof section>["view"], text: string, nth = 0) => buttons(node).filter((b) => textOf(b) === text)[nth];
const click = (b: { props: Record<string, unknown> }) => (b.props.onClick as (e: unknown) => void)({ stopPropagation: () => {} });

test("one headed list of every unmanaged project, by name, each saying what it is", () => {
  const { view } = section();
  const text = textOf(view);
  expect(textOf(byTag(view, "h2")[0])).toBe("Unmanaged projects · 3");
  expect(byTag(view, "h3")).toEqual([]);
  expect(byTag(view, "ul")).toHaveLength(1);
  const entries = byTag(view, "li");
  expect(entries.map((li) => textOf(byTag(li, "span").find((s) => s.props.class === "untracked-name")))).toEqual(["beta-soc", "chat-groups", "demo-agent"]);
  const labels = byTag(view, "span").filter((s) => String(s.props.class).includes("untracked-kind"));
  expect(labels.map(textOf)).toEqual(["OpenSpec", "no OpenSpec", "disabled"]);
  expect(String(labels[1].props.title)).toContain("no branch and no undo");
  expect(text).toContain("/w/acme/chat-groups");
  expect(text).toContain("same remote as pkg-tools");
});

test("Enable, Ignore, Integrate and Forget go to the matching entry; only a disabled repository offers Forget, and no Ignore", () => {
  const { view, calls } = section();
  // beta-soc (OpenSpec), chat-groups (no OpenSpec), demo-agent (disabled)
  expect(buttons(view).map(textOf)).toEqual(["Rediscover", "Enable", "Ignore", "Integrate", "Ignore", "Enable", "Forget"]);
  click(button(view, "Enable", 0));
  click(button(view, "Ignore", 0));
  click(button(view, "Integrate"));
  click(button(view, "Ignore", 1));
  click(button(view, "Enable", 1));
  click(button(view, "Forget"));
  click(button(view, "Rediscover"));
  expect(calls).toEqual(["enable b", "ignore b", "integrate c", "ignore c", "enable d", "forget d", "rediscover"]);
  expect(String(button(view, "Ignore").props.title)).toContain("Settings");
  const forgetTitle = String(button(view, "Forget").props.title);
  expect(forgetTitle).toContain("labels and agent settings");
  expect(forgetTitle).toContain("offered again as a discovered repository");
});

test("an action in progress shows it and blocks the entry; a failure is shown on that entry only", () => {
  const { t } = tracking({ busy: { b: "enable" }, errors: { c: "the default agent was not found" } });
  const { view } = section({ tracking: t });
  const enabling = button(view, "Enabling…");
  expect(enabling.props.disabled).toBe(true);
  expect(button(view, "Ignore", 0).props.disabled).toBe(true);
  expect(button(view, "Enable").props.disabled).toBe(false); // demo-agent's
  const alerts = byTag(view, "span").filter((s) => s.props.role === "alert");
  expect(alerts.map(textOf)).toEqual(["the default agent was not found"]);
});

test("Integrate unavailable: the reason is stated once, the entry stays listed and the button is inactive", () => {
  const { view } = section({ integrateOff: "agent sessions are disabled" });
  expect(textOf(view)).toContain("Integrate is unavailable: agent sessions are disabled.");
  expect(textOf(view).match(/unavailable/g)).toHaveLength(1);
  expect(button(view, "Integrate").props.disabled).toBe(true);
  expect(button(view, "Integrate").props.title).toBe("agent sessions are disabled");
  expect(byTag(view, "li")).toHaveLength(3);
});

test("a running integration is offered as Setting up…, which shows its session", () => {
  const { view, shown } = section({ runningIntegration: (path) => (path === "/w/acme/chat-groups" ? "int-1" : undefined) });
  expect(button(view, "Integrate")).toBeUndefined();
  click(button(view, "Setting up…"));
  expect(shown).toEqual(["int-1"]);
});

test("no workspace root: a link to the roots settings, no Rediscover", () => {
  const { view } = section({ hasRoots: false, entries: untrackedEntries(config, undefined), discovery: { running: false } });
  expect(buttons(view).map(textOf)).toEqual(["Enable", "Forget"]);
  const link = byTag(view, "a")[0];
  expect(String(link.props.href)).toContain("section=roots");
  expect(textOf(view)).toContain("No workspace root yet");
});

test("discovery running, a root error and a search without matches are all said", () => {
  const errors = [{ root: "/w/gone", message: "does not exist" }];
  const running = section({ discovery: { result: { ...found, errors }, running: true } }).view;
  expect(textOf(running)).toContain("discovering…");
  expect(button(running, "Discovering…").props.disabled).toBe(true);
  expect(textOf(running)).toContain("/w/gone: does not exist");
  expect(byTag(running, "a").some((a) => String(a.props.href).includes("section=roots"))).toBe(true);

  const none = section({ entries: [], query: "zzz" }).view;
  expect(textOf(none)).toContain("No unmanaged project matches “zzz”.");
  expect(textOf(section({ entries: [] }).view)).toContain("Every repository under the workspace roots is managed.");
});

test("Disable is in the settings dialog, not on a row or tile; it disables without opening the repository", () => {
  const repo: RepoSnapshot = { id: "a", name: "alpha-infra", path: "/w/alpha-infra", ok: true, scannedAt: "2026-10-01T00:00:00Z", isGit: true, worktrees: [], changes: [] };
  const [row] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [repo] });
  const managed: Config = { ...config, repos: [...config.repos, { id: "a", path: "/w/alpha-infra", name: "alpha-infra", enabled: true }] };
  const { t, calls } = tracking();
  for (const node of [Row({ row, now: 0, tracking: t, config: managed }), Tile({ row, now: 0, tracking: t, config: managed })]) {
    expect(byTag(node, "button").filter((b) => String(b.props["aria-label"]).startsWith("Disable"))).toHaveLength(0);
  }
  const [btn] = byTag(DisableButton({ id: "a", name: "alpha-infra", tracking: t }), "button");
  expect(btn.props["aria-label"]).toBe("Disable alpha-infra");
  let stopped = false;
  (btn.props.onClick as (e: unknown) => void)({ stopPropagation: () => (stopped = true) });
  expect(stopped).toBe(true);
  expect(calls).toEqual(["disable a"]);

  const busy = byTag(DisableButton({ id: "a", name: "alpha-infra", tracking: tracking({ busy: { a: "disable" }, errors: {} }).t }), "button")[0];
  expect(textOf(busy)).toBe("Disabling…");
  expect(busy.props.disabled).toBe(true);
  // A failure is reported on the project itself, on the row as on the tile.
  const failed = tracking({ errors: { a: "repository not found" } }).t;
  for (const node of [Row({ row, now: 0, tracking: failed, config: managed }), Tile({ row, now: 0, tracking: failed, config: managed })]) {
    expect(textOf(node)).toContain("repository not found");
  }
});

test("a just-enabled repository shows as Scanning… in both layouts; nothing tracked offers New project in place", () => {
  const pending = { id: "p", name: "beta-soc", path: "/w/acme/beta-soc", hint: "acme" };
  const row = PendingTableRow({ row: pending, columns: 6 });
  expect(textOf(row)).toContain("Scanning…");
  expect(textOf(row)).toContain("acme/");
  expect(byTag(row, "td")[0].props.colSpan).toBe(6);
  expect(textOf(PendingTile({ row: pending }))).toContain("Scanning…");

  const empty = NothingTracked({ config });
  expect(textOf(empty)).toContain("No repositories tracked yet");
  expect(byComponent(empty, NewProjectButton)).toHaveLength(1);
  // project-creation: New project stands next to the link to Settings.
  const settings = byTag(empty, "a").find((a) => textOf(a) === "Open Settings");
  expect(String(settings?.props.href)).toContain("/settings?section=roots");
});

test("Settings counts what discovery found and points to Projects instead of listing it", () => {
  const both = FoundSummary({ candidates: 2, integratable: 1 });
  expect(textOf(both)).toContain("Found 2 using OpenSpec and 1 without OpenSpec, not tracked yet");
  expect(byTag(both, "a")[0].props.href).toBe("/");
  expect(textOf(FoundSummary({ candidates: 0, integratable: 0 }))).toBe("Every repository under these roots is tracked.");
});

const clone = (patch: Partial<GithubClone> & Pick<GithubClone, "id" | "repo" | "name" | "state">): GithubClone => ({
  root: "/w/acme",
  path: `/w/acme/${patch.name}`,
  startedAt: "2026-10-10T10:00:00Z",
  ...patch,
});

test("a running clone and a failed one are listed with their owner/name and path; the running one offers Cancel, the failed one Retry and Dismiss", () => {
  const clones = [
    clone({ id: "clone-1", repo: "acme/beta-soc", name: "beta-soc-gh", state: "cloning", progress: { phase: "receiving", percent: 62, updatedAt: "2026-10-10T10:00:40Z" } }),
    clone({ id: "clone-2", repo: "acme/missing-repo", name: "missing-repo", state: "failed", reason: "Repository not found." }),
    clone({ id: "clone-3", repo: "acme/done-repo", name: "done-repo", state: "tracked" }),
  ];
  const { view, calls } = section({ entries: untrackedEntries(config, found, clones), now: Date.parse("2026-10-10T10:00:40Z") });
  expect(textOf(byTag(view, "h2")[0])).toBe("Unmanaged projects · 5");
  const labels = byTag(view, "span").filter((s) => String(s.props.class).includes("untracked-kind"));
  expect(labels.map(textOf)).toEqual(["OpenSpec", "Cloning…", "no OpenSpec", "disabled", "clone failed"]);
  const text = textOf(view);
  expect(text).toContain("acme/beta-soc");
  expect(text).toContain("/w/acme/beta-soc-gh");
  expect(text).toContain("Repository not found.");
  expect(text).not.toContain("done-repo");
  const running = byTag(view, "li")[1];
  expect(byTag(running, "button").map(textOf)).toEqual(["Cancel"]);
  const [bar] = byTag(running, "progress");
  expect(bar.props).toMatchObject({ max: 100, value: 62, "aria-valuetext": "receiving objects, 62 percent" });
  expect(textOf(running)).toContain("receiving objects · 62% · 40 s");
  expect(byTag(view, "progress")).toHaveLength(1);
  click(button(view, "Cancel"));
  click(button(view, "Retry"));
  click(button(view, "Dismiss"));
  expect(calls).toEqual(["cancel clone-1", "retry clone-2", "dismiss clone-2"]);
});

test("a queued clone offers Cancel with a waiting bar; a cancelled one is labelled and offers Retry and Dismiss", () => {
  const clones = [
    clone({ id: "clone-4", repo: "acme/alpha-tools", name: "alpha-tools", state: "queued" }),
    clone({ id: "clone-5", repo: "acme/zeta-docs", name: "zeta-docs", state: "cancelled" }),
  ];
  const calls: string[] = [];
  const { view } = section({ entries: untrackedEntries(config, found, clones), clones: cloneActions(calls, { busy: { "clone-4": "cancel" } }), now: Date.parse("2026-10-10T10:00:12Z") });
  const labels = byTag(view, "span").filter((s) => String(s.props.class).includes("untracked-kind"));
  expect(labels.map(textOf)).toEqual(["queued", "OpenSpec", "no OpenSpec", "disabled", "clone cancelled"]);
  const queued = byTag(view, "li")[0];
  expect(button(queued, "Cancelling…").props.disabled).toBe(true);
  const [bar] = byTag(queued, "progress");
  expect(bar.props.value).toBeUndefined();
  expect(bar.props["aria-valuetext"]).toBe("queued, waiting for a free slot");
  expect(textOf(queued)).toContain("waiting for a free slot · 12 s");
  const cancelled = byTag(view, "li").at(-1);
  expect(byTag(cancelled, "progress")).toEqual([]);
  expect(byTag(cancelled, "button").map(textOf)).toEqual(["Retry", "Dismiss"]);
});

test("a retry in progress blocks the failed entry; its failure is shown on it", () => {
  const calls: string[] = [];
  const entries = untrackedEntries(config, found, [clone({ id: "clone-2", repo: "acme/missing-repo", name: "missing-repo", state: "failed", reason: "x" })]);
  const { view } = section({ entries, clones: cloneActions(calls, { busy: { "clone-2": "retry" }, errors: { "clone-2": "/w/acme/missing-repo already exists" } }) });
  expect(button(view, "Retrying…").props.disabled).toBe(true);
  expect(button(view, "Dismiss").props.disabled).toBe(true);
  expect(byTag(view, "span").filter((s) => s.props.role === "alert").map(textOf)).toEqual(["/w/acme/missing-repo already exists"]);
});

test("the empty overview offers Add from GitHub next to New project", () => {
  const empty = NothingTracked({ config });
  const offered = byComponent(empty, AddGithubButton);
  expect(offered).toHaveLength(1);
  expect(offered[0].props.small).toBe(false);
});
