// A managed project's own settings on the overview (project-overview: "Each managed project carries its own settings"):
// Rename beside the name, everything else in the settings dialog that the gear on a row or tile opens.
import { expect, test } from "bun:test";
import { defaultAgentSessions, defaultConfig } from "../src/server/config.ts";
import { CONVENTIONAL_COMMITS_SHIP_SENTENCE, type Config, type RepoSnapshot } from "../src/shared/types.ts";
import { REPO_HUES } from "../src/shared/hues.ts";
import { LabelColorPicker, labelTitle, RepoLabelsEditor } from "../src/ui/labels.tsx";
import { Modal, restoreFocus } from "../src/ui/modal.tsx";
import { PendingTableRow, PendingTile, Row, Tile } from "../src/ui/overview.tsx";
import { overviewRows } from "../src/ui/overviewState.ts";
import { ProjectConsoleButton } from "../src/ui/projectConsole.tsx";
import { AUTO_MERGE_HINT, ProjectSettingsDialog, RenameField, RepoLabelsDialog, SESSIONS_OFF, settingsButtonOf } from "../src/ui/projectSettings.tsx";
import { overviewDialogs, type Tracking } from "../src/ui/untracked.tsx";
import { PullButton } from "../src/ui/pull.tsx";
import { OpenPrCount } from "../src/ui/pullRequests.tsx";
import { byComponent, byTag, elements, textOf } from "./vnode.ts";

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

const snapshotRepo: RepoSnapshot = { id: "a", name: "alpha-infra", path: "/w/alpha-infra", ok: true, scannedAt: "2026-10-01T00:00:00Z", isGit: true, worktrees: [], changes: [] };
const [row] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [snapshotRepo] });
const myAgent = { id: "my-agent", name: "My agent", command: ["my-agent-cli", "{prompt}"], prompts: {} };

function configWith(patch: { sessions?: boolean; agents?: number; agent?: Config["repos"][number]["agent"] } = {}): Config {
  const sessions = defaultAgentSessions();
  return {
    ...defaultConfig(),
    agentSessions: { ...sessions, enabled: patch.sessions ?? true, agents: patch.agents === 2 ? [...sessions.agents, myAgent] : sessions.agents },
    repos: [{ id: "a", path: "/w/alpha-infra", name: "alpha-infra", enabled: true, ...(patch.agent ? { agent: patch.agent } : {}) }],
  };
}

const layouts = (config: Config, t: Tracking) => [Row({ row, now: 0, tracking: t, config }), Tile({ row, now: 0, tracking: t, config })];
/** The settings dialog's `Modal`; it uses hooks, so its children are walked through its props. */
const modalOf = (config: Config, t: Tracking, r = row) => byComponent(ProjectSettingsDialog({ repo: config.repos[0], config, isGit: r.isGit, tracking: t }), Modal)[0];
const dialog = (config: Config, t: Tracking, r = row) => modalOf(config, t, r).props.children;
const switchOf = (node: unknown) => byTag(node as never, "button").find((b) => b.props.role === "switch");
const click = (el: { props: Record<string, unknown> }) => {
  let stopped = false;
  (el.props.onClick as (e: unknown) => void)({ stopPropagation: () => (stopped = true), preventDefault: () => {} });
  return stopped;
};

test("the agent-session switch is in the settings dialog, Enabled by default, saved without opening the board", () => {
  const { t, calls } = tracking();
  const toggle = switchOf(dialog(configWith(), t));
  expect(toggle?.props["aria-checked"]).toBe(true);
  expect(toggle?.props["aria-label"]).toBe("Agent sessions for alpha-infra");
  expect(textOf(toggle)).toBe("Enabled");
  expect(click(toggle!)).toBe(true);
  expect(calls).toEqual(['agent a {"enabled":false}']);

  const off = tracking();
  const disabled = switchOf(dialog(configWith({ agent: { enabled: false } }), off.t));
  expect(textOf(disabled)).toBe("Disabled");
  click(disabled!);
  expect(off.calls).toEqual(['agent a {"enabled":true}']);
});

test("with agent sessions off globally the dialog shows the project's setting as a link to the Agent sessions settings", () => {
  const { t, calls } = tracking();
  const node = dialog(configWith({ sessions: false, agent: { enabled: false } }), t);
  expect(switchOf(node)).toBeUndefined();
  const link = byTag(node, "a").find((a) => String(a.props.class).includes("agent-toggle"));
  expect(String(link?.props.href)).toBe("/settings?section=agents");
  expect(String(link?.props.class)).toContain("off-globally");
  expect(textOf(link)).toBe("Disabled");
  expect(link?.props.title).toBe(SESSIONS_OFF);
  expect(calls).toEqual([]);
});

const selectNamed = (prefix: string) => (node: unknown) => byTag(node as never, "select").filter((s) => String(s.props["aria-label"]).startsWith(prefix));
const agentSelects = selectNamed("Agent for ");
const prTitleSelects = selectNamed("PR titles for ");

test("the agent picker appears only with two agents and sessions on for the project; default agent clears the choice", () => {
  const picker = (config: Config) => agentSelects(dialog(config, tracking().t));
  expect(picker(configWith())).toHaveLength(0);
  expect(picker(configWith({ agents: 2, agent: { enabled: false } }))).toHaveLength(0);
  expect(picker(configWith({ agents: 2, sessions: false }))).toHaveLength(0);

  const { t, calls } = tracking();
  const [select] = agentSelects(dialog(configWith({ agents: 2, agent: { enabled: true, agentId: "my-agent" } }), t));
  expect(select.props.value).toBe("my-agent");
  expect(byTag(select, "option").map(textOf)).toEqual(["default agent", "Claude Code", "My agent"]);
  (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "" } });
  expect(calls).toEqual(['agent a {"agentId":null}']);
});

test("every git project offers a PR titles picker in its dialog, with agent sessions off too, saved without opening the board", () => {
  const { t, calls } = tracking();
  for (const config of [configWith(), configWith({ sessions: false }), configWith({ agent: { enabled: false } })]) {
    const [select] = prTitleSelects(dialog(config, t));
    expect(select.props["aria-label"]).toBe("PR titles for alpha-infra");
    expect(select.props.value).toBe("");
    expect(String(select.props.title)).toContain(CONVENTIONAL_COMMITS_SHIP_SENTENCE);
    expect(byTag(select, "option").map(textOf)).toEqual(["No convention", "Conventional Commits"]);
    expect(click(select)).toBe(true);
    (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "conventional-commits" } });
  }
  expect(calls).toEqual(Array(3).fill("prTitles a conventional-commits"));

  const set = tracking();
  const withConvention: Config = { ...configWith(), repos: [{ ...configWith().repos[0], prTitleConvention: "conventional-commits" }] };
  const [select] = prTitleSelects(dialog(withConvention, set.t));
  expect(select.props.value).toBe("conventional-commits");
  (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "" } });
  expect(set.calls).toEqual(["prTitles a null"]);
});

test("the PR titles picker is not offered for a folder without git, and is inactive while a setting saves", () => {
  const [plain] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...snapshotRepo, isGit: false }] });
  expect(prTitleSelects(dialog(configWith(), tracking().t, plain))).toHaveLength(0);
  expect(prTitleSelects(dialog(configWith(), tracking({ busy: { a: "prTitles" } }).t))[0].props.disabled).toBe(true);
});

const autoFetchSelects = selectNamed("Auto fetch for ");

test("every git project offers an Auto fetch drop-down in its dialog, every minute by default, with agent sessions off too, saved at once", () => {
  const { t, calls } = tracking();
  for (const config of [configWith(), configWith({ sessions: false }), configWith({ agent: { enabled: false } })]) {
    const [select] = autoFetchSelects(dialog(config, t));
    expect(select.props["aria-label"]).toBe("Auto fetch for alpha-infra");
    expect(select.props.value).toBe("60");
    expect(String(select.props.title)).toContain("only fetches");
    expect(String(select.props.title)).toContain("every minute, unless you switch it off");
    expect(String(select.props.title)).toContain("Pull");
    expect(byTag(select, "option").map(textOf)).toEqual(["Off", "Every 15 seconds", "Every 30 seconds", "Every minute", "Every 5 minutes", "Every 10 minutes", "Every 15 minutes", "Every 30 minutes", "Every hour"]);
    expect(click(select)).toBe(true);
    (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "15" } });
  }
  expect(calls).toEqual(Array(3).fill("autoFetch a 15"));

  const set = tracking();
  const withAutoFetch: Config = { ...configWith(), repos: [{ ...configWith().repos[0], autoFetchSeconds: 15 }] };
  const [select] = autoFetchSelects(dialog(withAutoFetch, set.t));
  expect(select.props.value).toBe("15");
  (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "0" } });
  (select.props.onChange as (e: unknown) => void)({ currentTarget: { value: "60" } });
  expect(set.calls).toEqual(["autoFetch a 0", "autoFetch a 60"]);

  const off: Config = { ...configWith(), repos: [{ ...configWith().repos[0], autoFetchSeconds: 0 }] };
  expect(autoFetchSelects(dialog(off, set.t))[0].props.value).toBe("0");
});

test("no Auto fetch drop-down for a folder without git; inactive while a setting saves", () => {
  const [plain] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...snapshotRepo, isGit: false }] });
  expect(autoFetchSelects(dialog(configWith(), tracking().t, plain))).toHaveLength(0);
  expect(autoFetchSelects(dialog(configWith(), tracking({ busy: { a: "autoFetch" } }).t))[0].props.disabled).toBe(true);
});

const fetchNotes = (node: unknown) => byTag(node as never, "span").filter((s) => String(s.props.class).includes("fetch-note"));

test("a git project shows its fetch note beside Pull on its row and tile, with its own interval; a folder without git none", () => {
  const fetched = { ...snapshotRepo, hasRemote: true, lastFetchedAt: "2026-10-01T00:00:00Z" };
  const [fetchedRow] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [fetched] });
  const config: Config = { ...configWith(), repos: [{ ...configWith().repos[0], autoFetchSeconds: 1800 }] };
  for (const node of [Row({ row: fetchedRow, now: 0, tracking: tracking().t, config }), Tile({ row: fetchedRow, now: 0, tracking: tracking().t, config })]) {
    const [badge] = fetchNotes(node);
    expect(textOf(badge)).toBe("fetched just now");
    expect(String(badge.props.title)).toContain("every 30 minutes");
  }
  const [plain] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...fetched, isGit: false }] });
  expect(fetchNotes(Row({ row: plain, now: 0, tracking: tracking().t, config }))).toHaveLength(0);
});

test("Rename turns the name into a field: Enter and blur save, Escape cancels, each once", () => {
  const { t, calls } = tracking();
  for (const node of layouts(configWith(), t)) {
    const pencil = byTag(node, "button").find((b) => b.props["aria-label"] === "Rename alpha-infra");
    expect(click(pencil!)).toBe(true);
  }
  expect(calls).toEqual(["startRename a", "startRename a"]);

  const editing = tracking({ renaming: "a" });
  for (const node of layouts(configWith(), editing.t)) {
    expect(byTag(node, "input").filter((i) => i.props["aria-label"] === "New name for alpha-infra")).toHaveLength(1);
    expect(byTag(node, "a").some((a) => String(a.props.class) === "repo-link")).toBe(false);
  }

  const field = byTag(RenameField({ id: "a", name: "alpha-infra", tracking: editing.t }), "input")[0];
  expect(field.props.defaultValue).toBe("alpha-infra");
  const key = (k: string, el: { value: string; dataset: Record<string, string> }) =>
    (field.props.onKeyDown as (e: unknown) => void)({ key: k, currentTarget: el, stopPropagation: () => {}, preventDefault: () => {} });
  const blur = (el: { value: string; dataset: Record<string, string> }) => (field.props.onBlur as (e: unknown) => void)({ currentTarget: el });
  editing.calls.length = 0;

  const saved = { value: "Beta SOC", dataset: {} };
  key("Enter", saved);
  blur(saved);
  const cancelled = { value: "x", dataset: {} };
  key("Escape", cancelled);
  blur(cancelled);
  const left = { value: "Gamma", dataset: {} };
  blur(left);
  // A blank name is refused by `rename` and the field stays open, so a later Enter still saves.
  const blank = { value: " ", dataset: {} };
  key("Enter", blank);
  blank.value = "Delta";
  key("Enter", blank);
  expect(editing.calls).toEqual(["rename a alpha-infra->Beta SOC", "cancelRename", "rename a alpha-infra->Gamma", "rename a alpha-infra-> ", "rename a alpha-infra->Delta"]);
});

test("Labels in the settings dialog opens the project's labels dialog, whose edits are saved at once", () => {
  const { t, calls } = tracking({ settingsOpen: "a" });
  const button = byTag(dialog(configWith(), t), "button").find((b) => b.props["aria-label"] === "Labels of alpha-infra");
  expect(click(button!)).toBe(true);
  expect(calls).toEqual(["openLabels a"]);

  const config = configWith();
  const open = tracking({ labelsOpen: "a", busy: { a: "labels" }, errors: { a: "invalid config" } });
  const labels = RepoLabelsDialog({ repo: config.repos[0], repos: config.repos, detected: [{ label: "go", marker: "go.mod" }], tracking: open.t });
  const [modal] = byComponent(labels, Modal);
  (modal.props.onClose as () => void)();
  const [editor] = byComponent(modal.props.children, RepoLabelsEditor);
  expect(editor.props.detected).toEqual([{ label: "go", marker: "go.mod" }]);
  (editor.props.onChange as (patch: unknown) => void)({ labels: ["client"] });
  expect(open.calls).toEqual(["closeLabels", 'labels a {"labels":["client"]}']);
  expect(textOf(modal.props.children)).toContain("Saving…");
  expect(textOf(modal.props.children)).toContain("invalid config");
  expect(labelTitle({ label: "client", kind: "custom" })).not.toContain("Settings");
});

/** Stands in for the page while a dialog's `returnFocus` looks for the project's gear. */
function withGears<T>(ids: string[], run: (focused: string[]) => T): T {
  const focused: string[] = [];
  const gears = ids.map((id) => ({ dataset: { projectSettings: id }, isConnected: true, focus: () => focused.push(id) }));
  const saved = globalThis.document;
  Object.assign(globalThis, { document: { querySelectorAll: (selector: string) => (selector === "[data-project-settings]" ? gears : []) } });
  try {
    return run(focused);
  } finally {
    Object.assign(globalThis, { document: saved });
  }
}

test("closing the settings or the labels dialog returns focus to the gear of that project", () => {
  const config = configWith();
  const t = tracking().t;
  const settings = modalOf(config, t);
  const [labels] = byComponent(RepoLabelsDialog({ repo: config.repos[0], repos: config.repos, detected: [], tracking: t }), Modal);
  for (const modal of [settings, labels]) {
    const find = modal.props.returnFocus as () => HTMLElement | null;
    withGears(["b", "a"], (focused) => {
      restoreFocus(find);
      expect(focused).toEqual(["a"]);
    });
  }
  // Disabled meanwhile: the gear is gone, so focus stays where the browser puts it.
  withGears(["b"], (focused) => {
    restoreFocus(settingsButtonOf("a"));
    expect(focused).toEqual([]);
  });
  const detached = { isConnected: false, focus: () => expect.unreachable() } as unknown as HTMLElement;
  restoreFocus(() => detached);
});

test("the labels dialog hands the shared label colours to the editor and saves a colour choice through tracking", () => {
  const config = configWith();
  const open = tracking({ labelsOpen: "a", errors: { a: "hue must be null or a whole number from 0 to 359" } });
  const dialog = RepoLabelsDialog({ repo: config.repos[0], repos: config.repos, detected: [{ label: "go", marker: "go.mod" }], labelColors: { client: 290 }, tracking: open.t });
  const [modal] = byComponent(dialog, Modal);
  const [editor] = byComponent(modal.props.children, RepoLabelsEditor);
  expect(editor.props.colors).toEqual({ client: 290 });
  const onColor = editor.props.onColor as (label: string, hue: number | null) => void;
  onColor("client", 27);
  onColor("go", 190);
  onColor("client", null);
  expect(open.calls).toEqual(["labelColor a client 27", "labelColor a go 190", "labelColor a client null"]);
  // A failed save keeps the colour and shows the reason in the dialog.
  expect(textOf(modal.props.children)).toContain("hue must be null");
});

test("the colour picker offers Auto and every assignable hue, marks the current choice and reports the one chosen", () => {
  const chosen: (number | null)[] = [];
  const picker = LabelColorPicker({ label: "Client", colors: { client: 295 }, onChoose: (hue) => chosen.push(hue) });
  expect(picker.props["aria-label"]).toBe("Colour of Client");
  const options = byTag(picker, "button");
  expect(options).toHaveLength(REPO_HUES.length + 1);
  expect(textOf(options[0])).toContain("Auto");
  // 295 is stored, 290 is the nearest hue the palette has: that one is pressed, and nothing else.
  expect(options.filter((o) => o.props["aria-pressed"]).map((o) => o.props["aria-label"])).toEqual([`Colour ${REPO_HUES.indexOf(290) + 1} of ${REPO_HUES.length}`]);
  (options[0].props.onClick as () => void)();
  (options[1].props.onClick as () => void)();
  expect(chosen).toEqual([null, REPO_HUES[0]]);
  const auto = LabelColorPicker({ label: "go", colors: undefined, onChoose: () => {} });
  expect(byTag(auto, "button")[0].props["aria-pressed"]).toBe(true);
});

const autoMergeOf = (node: unknown) => byTag(node as never, "button").find((b) => String(b.props["aria-label"]).startsWith("Auto-merge docs-only"));

test("a git project with agent sessions offers auto-merge of docs-only pull requests in its dialog, Off by default, saved at once", () => {
  const { t, calls } = tracking();
  const toggle = autoMergeOf(dialog(configWith(), t));
  expect(toggle?.props.role).toBe("switch");
  expect(toggle?.props["aria-checked"]).toBe(false);
  expect(toggle?.props["aria-label"]).toBe("Auto-merge docs-only pull requests for alpha-infra");
  expect(String(toggle?.props.title)).toContain(AUTO_MERGE_HINT);
  // The dialog names the setting on the line, so its switch reads just the state.
  expect(textOf(toggle)).toBe("Off");
  // The tooltip names both actions, which leave the pull request open; the merge is asked for once it is ready
  // (agent-merges-docs-prs), never through GitHub's auto-merge, and never for a pull request without checks.
  expect(AUTO_MERGE_HINT).toContain("Ship and Archive ask the agent to open its pull request and not to merge it");
  expect(AUTO_MERGE_HINT).toContain("asks that session's agent to merge it");
  expect(AUTO_MERGE_HINT).toContain("one without any checks is not merged this way");
  expect(AUTO_MERGE_HINT).not.toMatch(/enable auto-merge|GitHub's auto-merge/i);
  // …and what happens once it has merged (auto-merge-cleanup).
  expect(AUTO_MERGE_HINT).toContain("ends its session and removes its worktree when that is safe");
  expect(click(toggle!)).toBe(true);
  expect(calls).toEqual(['agent a {"autoMergeDocs":true}']);

  const on = tracking();
  const onToggle = autoMergeOf(dialog(configWith({ agent: { enabled: true, autoMergeDocs: true } }), on.t));
  expect(textOf(onToggle)).toBe("On");
  click(onToggle!);
  expect(on.calls).toEqual(['agent a {"autoMergeDocs":false}']);

  expect(autoMergeOf(dialog(configWith(), tracking({ busy: { a: "agent" } }).t))?.props.disabled).toBe(true);
});

test("no auto-merge toggle for a project without git or with its agent sessions disabled; inactive while sessions are off", () => {
  const [plainRow] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...snapshotRepo, isGit: false }] });
  const t = tracking().t;
  expect(autoMergeOf(dialog(configWith(), t, plainRow))).toBeUndefined();
  expect(autoMergeOf(dialog(configWith({ agent: { enabled: false, autoMergeDocs: true } }), t))).toBeUndefined();

  const off = tracking();
  const node = dialog(configWith({ sessions: false, agent: { enabled: true, autoMergeDocs: true } }), off.t);
  expect(autoMergeOf(node)).toBeUndefined();
  const link = byTag(node, "a").find((a) => String(a.props.class).includes("auto-merge-toggle"));
  expect(String(link?.props.href)).toBe("/settings?section=agents");
  expect(textOf(link)).toBe("On");
  expect(off.calls).toEqual([]);
});

test("a project still being scanned offers none of its settings and no gear", () => {
  const pending = { id: "p", name: "beta-soc", path: "/w/acme/beta-soc" };
  for (const node of [PendingTableRow({ row: pending, columns: 6 }), PendingTile({ row: pending })]) {
    expect(byTag(node, "button")).toHaveLength(0);
    expect(byTag(node, "select")).toHaveLength(0);
    expect(byTag(node, "input")).toHaveLength(0);
  }
});

test("without a config entry yet, a row and a tile show no gear and no settings", () => {
  for (const node of [Row({ row, now: 0, tracking: tracking().t }), Tile({ row, now: 0, tracking: tracking().t })]) {
    expect(switchOf(node)).toBeUndefined();
    expect(byTag(node, "button").filter((b) => b.props["data-project-settings"])).toHaveLength(0);
    const labels = byTag(node, "button").map((b) => String(b.props["aria-label"]));
    expect(labels.some((l) => /^(Rename|Labels|Disable|Settings)/.test(l))).toBe(false);
  }
});

/** The actions of a row's last cell or a tile's footer, in order. */
const actionsOf = (node: unknown) =>
  elements((node as { props: { children: never } }).props.children).flatMap((el) =>
    el.type === ProjectConsoleButton ? ["Console"] : el.type === PullButton ? ["Pull"] : el.props["data-project-settings"] ? ["Settings"] : [],
  );

/** Every setting, Labels and Disable control, by its accessible name. */
const settingControls = (node: unknown) =>
  [...byTag(node as never, "button"), ...byTag(node as never, "select"), ...byTag(node as never, "a")].map((el) => String(el.props["aria-label"])).filter((n) => /^(Agent|PR titles|Auto-merge|Auto fetch|Labels|Disable)/.test(n));

test("a row has no Agent sessions column: its actions are Console, Pull and the gear, with no setting, Labels or Disable", () => {
  for (const config of [configWith({ agents: 2 }), configWith({ sessions: false })]) {
    const node = Row({ row, now: 0, tracking: tracking().t, config });
    expect(settingControls(node)).toEqual([]);
    expect(byTag(node, "td").some((td) => String(td.props.class).includes("agent-cell"))).toBe(false);
    const actions = byTag(node, "td").find((td) => td.props.class === "row-actions");
    expect(actionsOf(actions)).toEqual(["Console", "Pull", "Settings"]);
  }
});

test("the gear names the project, opens the same dialog from a row and a tile, and never opens the board", () => {
  const { t, calls } = tracking();
  for (const node of layouts(configWith(), t)) {
    const [gear] = byTag(node, "button").filter((b) => b.props["data-project-settings"] === "a");
    expect(gear.props["aria-label"]).toBe("Settings of alpha-infra");
    expect(String(gear.props.title)).toContain("Settings");
    expect(click(gear)).toBe(true);
  }
  expect(calls).toEqual(["openSettings a", "openSettings a"]);

  // One dialog component for both layouts, named for the project.
  const modal = modalOf(configWith(), t);
  expect(modal.props.label).toBe("Settings of alpha-infra");
  expect(modal.props.title).toBe("Settings");
  expect(modal.props.subtitle).toBe("alpha-infra");
  (modal.props.onClose as () => void)();
  expect(calls.at(-1)).toBe("closeSettings");
});

// project-overview: "Tiles have one size and one layout" — fixed zones, the actions and the gear in the footer.
const classOf = (el: { props: Record<string, unknown> }) => String(el.props.class ?? "");
const zone = (node: unknown, name: string) => elements(node as never).find((el) => classOf(el).split(" ").includes(name));
const settingLines = (node: unknown) => elements(node as never).filter((el) => classOf(el).split(" ").includes("setting-line")).map((el) => textOf(byTag(el, "span").find((s) => classOf(s) === "setting-label")));

test("a tile has its zones in order, its header holds no action but Rename, and its footer Console, Pull and the gear", () => {
  const node = Tile({ row, now: 0, tracking: tracking().t, config: configWith() });
  const order = elements(node).map((el) => classOf(el).split(" ")[0]).filter((c) => ["tile-head", "tile-badges", "tile-figures", "tile-checkouts", "tile-foot"].includes(c));
  expect(order).toEqual(["tile-head", "tile-badges", "tile-figures", "tile-checkouts", "tile-foot"]);
  expect(byTag(zone(node, "tile-head"), "button").map((b) => b.props["aria-label"])).toEqual(["Rename alpha-infra"]);
  const foot = zone(node, "tile-foot");
  expect(actionsOf(foot)).toEqual(["Console", "Pull", "Settings"]);
  // No panel on the tile: the settings are only in the dialog.
  expect(byTag(node, "details")).toHaveLength(0);
  expect(settingControls(node)).toEqual([]);
});

test("a tile shows open, to archive and open PRs as figures; without open changes the totals give way to a note", () => {
  const busy = Tile({ row: { ...row, open: 3, toArchive: 1 }, now: 0, tracking: tracking().t, config: configWith() });
  const figures = elements(zone(busy, "tile-figures")).filter((el) => classOf(el).startsWith("tile-figure "));
  expect(figures.map((f) => textOf(byTag(f, "span").find((s) => classOf(s) === "label")))).toEqual(["open", "to archive", "open PRs"]);
  expect(textOf(byTag(figures[0], "span")[0])).toBe("3");
  expect(classOf(figures[1])).toContain("success");
  expect(byComponent(figures[2], OpenPrCount)).toHaveLength(1);
  // No count per stage (project-overview-remove-kanban-data).
  expect(textOf(busy)).not.toContain("Drafts");

  const idle = Tile({ row, now: 0, tracking: tracking().t, config: configWith() });
  const idleFigures = elements(zone(idle, "tile-figures")).filter((el) => classOf(el).startsWith("tile-figure "));
  expect(idleFigures.map((f) => textOf(byTag(f, "span").find((s) => classOf(s) === "label")))).toEqual(["open PRs"]);
  expect(textOf(zone(idle, "tile-idle"))).toBe("no open changes");
});

// repository-pull: on the overview Pull is a bordered button like Console, not a ghost one.
test("a row and a tile give Pull the overview look", () => {
  for (const node of layouts(configWith(), tracking().t)) {
    const [pull] = byComponent(node, PullButton);
    expect(pull.props.variant).toBe("overview");
  }
});

test("a folder without git offers no Pull on its tile, and a failed scan none either", () => {
  const [plainRow] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...snapshotRepo, isGit: false }] });
  expect(byComponent(Tile({ row: plainRow, now: 0, tracking: tracking().t, config: configWith() }), PullButton)).toHaveLength(0);
  expect(byComponent(Tile({ row: { ...row, ok: false }, now: 0, tracking: tracking().t, config: configWith() }), PullButton)).toHaveLength(0);
});

test("the settings dialog lists its lines in order, then Disable set apart; a setting that does not apply leaves no line", () => {
  const t = tracking().t;
  expect(settingLines(dialog(configWith({ agents: 2 }), t))).toEqual(["Agent sessions", "Agent", "PR titles", "Docs auto-merge", "Auto fetch", "Labels", "Stop tracking"]);
  expect(settingLines(dialog(configWith(), t))).toEqual(["Agent sessions", "PR titles", "Docs auto-merge", "Auto fetch", "Labels", "Stop tracking"]);
  const [plainRow] = overviewRows({ generatedAt: "2026-10-01T00:00:00Z", repos: [{ ...snapshotRepo, isGit: false }] });
  expect(settingLines(dialog(configWith(), t, plainRow))).toEqual(["Agent sessions", "Labels", "Stop tracking"]);
  expect(settingLines(dialog(configWith({ agent: { enabled: false } }), t))).toEqual(["Agent sessions", "PR titles", "Auto fetch", "Labels", "Stop tracking"]);
  // The console is an action on the row and tile, not a setting.
  expect(byComponent(dialog(configWith(), t), ProjectConsoleButton)).toHaveLength(0);
});

test("Disable from the dialog disables without opening the board; while it saves and when it fails the dialog says so", () => {
  const { t, calls } = tracking({ settingsOpen: "a" });
  const disable = byTag(dialog(configWith(), t), "button").find((b) => b.props["aria-label"] === "Disable alpha-infra");
  expect(click(disable!)).toBe(true);
  expect(calls).toEqual(["disable a"]);

  const saving = dialog(configWith(), tracking({ busy: { a: "disable" } }).t);
  expect(textOf(saving)).toContain("Disabling…");
  const failed = dialog(configWith(), tracking({ errors: { a: "repository not found" } }).t);
  const alerts = elements(failed).filter((el) => el.props.role === "alert");
  expect(alerts.map(textOf)).toEqual(["repository not found"]);
  // A setting that could not be saved is reported there too, and its switch is free again.
  const refused = dialog(configWith(), tracking({ errors: { a: "config is read-only" } }).t);
  expect(textOf(refused)).toContain("config is read-only");
  expect(switchOf(refused)?.props.disabled).toBe(false);
});

test("Labels replaces the settings dialog; a disabled project closes its own, and only its own", () => {
  expect(overviewDialogs({}, { type: "openSettings", id: "a" })).toEqual({ settingsOpen: "a" });
  expect(overviewDialogs({ settingsOpen: "a" }, { type: "openLabels", id: "a" })).toEqual({ labelsOpen: "a" });
  expect(overviewDialogs({ labelsOpen: "a" }, { type: "closeLabels" })).toEqual({ labelsOpen: undefined });
  expect(overviewDialogs({ settingsOpen: "a" }, { type: "closeSettings" })).toEqual({ settingsOpen: undefined });
  expect(overviewDialogs({ settingsOpen: "a" }, { type: "disabled", id: "a" })).toEqual({ settingsOpen: undefined });
  expect(overviewDialogs({ settingsOpen: "b" }, { type: "disabled", id: "a" })).toEqual({ settingsOpen: "b" });
  // At most one: opening the settings of another project closes whatever was open.
  expect(overviewDialogs({ labelsOpen: "a" }, { type: "openSettings", id: "b" })).toEqual({ settingsOpen: "b" });
});
