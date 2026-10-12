import { expect, test } from "bun:test";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { CLAUDE_PROFILE, CODEX_PROFILE } from "../src/shared/agentDefaults.ts";
import type { Config, EnvironmentReport, RepoConfig } from "../src/shared/types.ts";
import { NOTHING_SAVED } from "../src/ui/setupState.ts";
import {
  AgentsStep,
  type AgentsView,
  ConsoleStep,
  type ConsoleView,
  DoneStep,
  ProjectSettingsStep,
  type ProjectSettingsView,
  SystemCheckStep,
  WelcomeStep,
  WizardFrame,
  WorkspaceStep,
  type WorkspaceView,
} from "../src/ui/setupWizard.tsx";
import { byTag, elements, textOf } from "./vnode.ts";

const noop = () => {};
/** Activates a button the test expects to be there. */
const press = (el: { props: Record<string, unknown> } | undefined) => {
  if (!el) throw new Error("no such button");
  (el.props.onClick as () => void)();
};

test("the wizard is a dialog named as the setup, showing its position and every step", () => {
  const frame = WizardFrame({ step: 4, onContinue: noop, onBack: noop, onSkip: noop, children: "body" });
  const dialog = byTag(frame, "div").find((el) => el.props.role === "dialog");
  expect(dialog?.props["aria-modal"]).toBe("true");
  expect(String(dialog?.props["aria-label"])).toContain("setup");
  const text = textOf(frame);
  expect(text).toContain("5 of 7");
  const steps = byTag(byTag(frame, "ol")[0], "li");
  expect(steps.map(textOf)).toEqual(["Welcome, done", "System check, done", "Workspace, done", "Agents, done", "Console", "Project settings", "Done"]);
  expect(steps.filter((li) => li.props["aria-current"] === "step").map(textOf)).toEqual(["Console"]);
  // Steps passed are done: green (the `past` class) with a check mark; the current and later ones are not.
  expect(steps.map((li) => li.props.class)).toEqual(["past", "past", "past", "past", "current", "", ""]);
  expect(steps.map((li) => byTag(li, "svg").length)).toEqual([1, 1, 1, 1, 0, 0, 0]);
  expect(byTag(frame, "button").map(textOf)).toEqual(["Skip setup", "Back", "Continue"]);
});

test("the step list opens every step up to the furthest one reached, and none beyond it", () => {
  const opened: number[] = [];
  const frame = WizardFrame({ step: 3, reachable: 5, onStep: (i) => opened.push(i), onContinue: noop, onBack: noop, onSkip: noop, children: "" });
  const items = byTag(byTag(frame, "ol")[0], "li");
  const links = items.map((li) => byTag(li, "button")[0]);
  expect(links.map((b) => b !== undefined)).toEqual([true, true, true, false, true, true, false]);
  for (const b of links) if (b) (b.props.onClick as () => void)();
  expect(opened).toEqual([0, 1, 2, 4, 5]);
  expect(String(links[4]?.props.title)).toContain("Save this step");
  expect(String(links[1]?.props.title)).toContain("Back to");
  // While a step saves, the list cannot be used.
  const busy = WizardFrame({ step: 3, reachable: 5, onStep: noop, busy: true, onContinue: noop, children: "" });
  expect(byTag(byTag(busy, "ol")[0], "button").every((b) => b.props.disabled === true)).toBe(true);
  // Without a handler it only shows where the user is.
  expect(byTag(byTag(WizardFrame({ step: 3, onContinue: noop, children: "" }), "ol")[0], "button")).toHaveLength(0);
});

test("a blocked Continue says why, and no later step opens from the list", () => {
  const frame = WizardFrame({ step: 3, reachable: 5, onStep: noop, continueBlocked: "Choose at least one agent to continue.", onContinue: noop, onBack: noop, onSkip: noop, children: "" });
  const next = byTag(frame, "button").find((el) => textOf(el) === "Continue");
  expect(next?.props.disabled).toBe(true);
  expect(textOf(frame)).toContain("Choose at least one agent to continue.");
  const links = byTag(byTag(frame, "ol")[0], "li").map((li) => byTag(li, "button").length > 0);
  // Welcome, System check and Workspace still open (Back); Console and Project settings, though reached, do not.
  expect(links).toEqual([true, true, true, false, false, false, false]);
});

test("Welcome has no Back, Done no Skip, and a pending Skip asks first", () => {
  expect(byTag(WizardFrame({ step: 0, onContinue: noop, onSkip: noop, children: "" }), "button").map(textOf)).toEqual(["Skip setup", "Continue"]);
  expect(byTag(WizardFrame({ step: 6, onContinue: noop, onBack: noop, continueLabel: "Finish", children: "" }), "button").map(textOf)).toEqual(["Back", "Finish"]);
  const confirming = WizardFrame({ step: 1, onContinue: noop, onSkip: noop, confirmingSkip: true, onConfirmSkip: noop, onCancelSkip: noop, children: "" });
  expect(textOf(confirming)).toContain("not saved");
  expect(byTag(confirming, "button").map(textOf)).toEqual(["Keep going", "Skip setup"]);
});

test("Welcome names the five topics, that steps can be skipped, and Help", () => {
  const text = textOf(WelcomeStep());
  for (const word of ["Workspace", "Agents", "Console", "Project settings", "System check", "skipped", "Settings", "Help"]) expect(text).toContain(word);
});

test("Welcome shows the steps as an ordered list, the connectors and the Ready node hidden", () => {
  const step = WelcomeStep();
  const list = byTag(step, "ol").find((el) => el.props["aria-label"] === "What setup covers");
  const items = byTag(list, "li");
  expect(items.map((li) => textOf(byTag(li, "strong")[0]))).toEqual(["System check", "Workspace", "Agents", "Console", "Project settings"]);
  expect(items.map((li) => textOf(li).slice(0, 1))).toEqual(["1", "2", "3", "4", "5"]);
  for (const li of items) expect(byTag(li, "span").find((el) => el.props.class === "setup-flow-mark")?.props["aria-hidden"]).toBe("true");
  const ready = byTag(step, "div").find((el) => String(el.props.class).includes("setup-flow-end"));
  expect(ready?.props["aria-hidden"]).toBe("true");
  expect(textOf(ready)).toContain("Ready");
});

const workspace = (patch: Partial<WorkspaceView> = {}): WorkspaceView => ({
  configuredRoots: [],
  entered: ["/w/acme"],
  missing: new Map(),
  suggestions: ["/home/demo/Workspace"],
  input: "",
  discovering: false,
  unchecked: new Set(),
  picker: true,
  picking: false,
  discovery: {
    candidates: [
      { id: "a1", path: "/w/acme/alpha-infra", name: "alpha-infra", enabled: false },
      { id: "d1", path: "/w/acme/demo-ops", name: "demo-ops", enabled: false },
    ],
    integratable: [{ id: "c1", path: "/w/acme/chat-groups", name: "chat-groups" }],
    errors: [],
  },
  ...patch,
});

test("found projects are listed checked, an unchecked one is not, and repositories without OpenSpec point to the overview", () => {
  const step = WorkspaceStep({ view: workspace({ unchecked: new Set(["/w/acme/demo-ops"]) }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  const boxes = byTag(step, "input").filter((el) => el.props.type === "checkbox");
  expect(boxes.map((el) => el.props.checked)).toEqual([true, false]);
  const text = textOf(step);
  expect(text).toContain("2 projects with OpenSpec were found");
  expect(text).toContain("One git repository without OpenSpec was found");
  expect(text).toContain("projects overview");
});

test("a suggestion adds its folder, and a missing root is marked", () => {
  const added: string[] = [];
  const step = WorkspaceStep({ view: workspace({ missing: new Map([["/w/acme", "does not exist"]]) }), onInput: noop, onAdd: (p) => added.push(p), onRemove: noop, onToggle: noop, onPick: noop });
  const suggestion = byTag(step, "button").find((el) => textOf(el).includes("/home/demo/Workspace"));
  expect(suggestion).toBeDefined();
  (suggestion!.props.onClick as () => void)();
  expect(added).toEqual(["/home/demo/Workspace"]);
  expect(textOf(step)).toContain("not found — does not exist");
});

test("Choose folder… opens the dialog, waits while it is open, and is not offered without a picker", () => {
  let picked = 0;
  const step = WorkspaceStep({ view: workspace(), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: () => picked++ });
  const choose = byTag(step, "button").find((el) => textOf(el) === "Choose folder…");
  (choose!.props.onClick as () => void)();
  expect(picked).toBe(1);
  const waiting = byTag(WorkspaceStep({ view: workspace({ picking: true }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop }), "button").find((el) => textOf(el).includes("folder dialog"));
  expect(waiting?.props.disabled).toBe(true);
  const none = WorkspaceStep({ view: workspace({ picker: false }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  expect(byTag(none, "button").some((el) => textOf(el).includes("Choose folder"))).toBe(false);
  expect(byTag(none, "input").some((el) => el.props["aria-label"] === "Folder to add")).toBe(true);
  const failed = WorkspaceStep({ view: workspace({ pickError: "no display." }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  expect(textOf(failed)).toContain("type the path instead");
  const again = WorkspaceStep({ view: workspace({ pickedAgain: "/w/acme" }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  expect(textOf(again)).toContain("/w/acme is already listed");
});

const agentHandlers = { onRecheck: noop, onEnable: noop, onCheck: noop, onAddCustom: noop, onCustomChange: noop, onRemoveCustom: noop, onDefault: noop };
const agents = (patch: Partial<AgentsView> = {}): AgentsView => ({
  savedEnabled: false,
  enable: false,
  choices: [
    { id: "codex", name: "Codex", configured: false, available: true },
    { id: "claude", name: "Claude Code", configured: true, available: true },
    { id: "agy", name: "Antigravity", configured: false, available: false },
  ],
  checked: ["codex", "claude"],
  custom: [],
  defaultOptions: [
    { id: "codex", name: "Codex", available: true },
    { id: "claude", name: "Claude Code", available: true },
  ],
  defaultAgent: "claude",
  installs: [],
  ...patch,
});

test("the Agents step states the risks and lists every agent with a checkbox, configured ones locked", () => {
  const step = AgentsStep({ view: agents(), ...agentHandlers });
  expect(textOf(step)).toContain("change files and run commands");
  expect(textOf(step)).toContain("worktree");
  const boxes = byTag(byTag(step, "fieldset")[0], "input").filter((el) => el.props.type === "checkbox");
  expect(boxes.map((el) => [el.props.checked, el.props.disabled])).toEqual([
    [true, false],
    [true, true],
    [false, false],
  ]);
  expect(textOf(step)).toContain("not found");
  expect(textOf(step)).toContain("added when you continue");
  const select = byTag(step, "select").find((el) => el.props["aria-label"] === "Default agent");
  expect(select?.props.value).toBe("claude");
  expect(byTag(select, "option").map(textOf)).toEqual(["Codex", "Claude Code"]);
});

test("checking an agent and adding a custom one are reported", () => {
  const calls: unknown[] = [];
  const step = AgentsStep({ view: agents(), ...agentHandlers, onCheck: (id, on) => calls.push([id, on]), onAddCustom: () => calls.push("add") });
  const agy = byTag(byTag(step, "fieldset")[0], "input").filter((el) => el.props.type === "checkbox")[2];
  (agy.props.onChange as (e: unknown) => void)({ currentTarget: { checked: true } });
  (byTag(step, "button").find((el) => textOf(el).includes("Add another agent"))!.props.onClick as () => void)();
  expect(calls).toEqual([["agy", true], "add"]);
});

test("without a checked agent there is no default to choose yet", () => {
  const step = AgentsStep({ view: agents({ checked: [], defaultOptions: [], choices: agents().choices.map((c) => ({ ...c, configured: false })) }), ...agentHandlers });
  expect(byTag(step, "select").some((el) => el.props["aria-label"] === "Default agent")).toBe(false);
  expect(textOf(step)).toContain("Check at least one agent");
  // Nothing is locked: every agent can be checked or unchecked.
  expect(byTag(byTag(step, "fieldset")[0], "input").filter((el) => el.props.type === "checkbox").every((el) => el.props.disabled === false)).toBe(true);
});

test("an incomplete custom agent says what is missing", () => {
  const step = AgentsStep({ view: agents({ custom: [{ key: "1", name: "My agent", command: "" }] }), ...agentHandlers });
  expect(textOf(step)).toContain("Enter the command");
  const ok = AgentsStep({ view: agents({ custom: [{ key: "1", name: "My agent", command: "my-agent" }] }), ...agentHandlers });
  expect(textOf(ok)).toContain("edited in Settings");
});

test("a checked agent that is missing shows how to install it, and the switch cannot turn sessions off", () => {
  const install = [{ text: "Install Antigravity.", command: "curl -fsSL https://antigravity.google/install.sh | bash" }];
  const step = AgentsStep({ view: agents({ installs: [{ name: "Antigravity", steps: install }], savedEnabled: true, enable: true }), ...agentHandlers });
  expect(byTag(step, "code").map(textOf)).toContain("curl -fsSL https://antigravity.google/install.sh | bash");
  expect(textOf(step)).toContain("Antigravity was not found");
  const toggle = byTag(step, "input").find((el) => el.props.type === "checkbox");
  expect(toggle?.props.checked).toBe(true);
  expect(toggle?.props.disabled).toBe(true);
  // Agents are checked here, not in the System check.
  expect(textOf(step)).not.toContain("System check");
  expect(textOf(step)).toContain("Check again");
});

test("Check again looks the agents up again and shows that it works", () => {
  let calls = 0;
  const step = AgentsStep({ view: agents(), ...agentHandlers, onRecheck: () => calls++ });
  const button = byTag(step, "button").find((el) => textOf(el).includes("Check again"));
  (button!.props.onClick as () => void)();
  expect(calls).toBe(1);
  const working = byTag(AgentsStep({ view: agents({ checking: true }), ...agentHandlers }), "button").find((el) => textOf(el).includes("Checking…"));
  expect(working?.props.disabled).toBe(true);
  // Once found, the install instructions are gone: they follow the view's `installs`, which the lookup decides.
  expect(textOf(AgentsStep({ view: agents({ installs: [] }), ...agentHandlers }))).not.toContain("was not found");
});

const consoleView = (patch: Partial<ConsoleView> = {}): ConsoleView => ({
  sessionsOn: true,
  agents: [
    { id: "claude", name: "Claude Code", available: true },
    { id: "codex", name: "Codex", available: true },
  ],
  defaultName: "Claude Code",
  ...patch,
});

test("the Console step explains the console and offers the default agent or any profile", () => {
  const step = ConsoleStep({ view: consoleView(), onChoose: noop });
  const text = textOf(step);
  for (const words of ["no project and no change", "top bar", "console folder", "across"]) expect(text).toContain(words);
  const select = byTag(step, "select")[0];
  expect(byTag(select, "option").map(textOf)).toEqual(["Default agent (Claude Code)", "Claude Code", "Codex"]);
  expect(select.props.value).toBe("");
  const chosen: unknown[] = [];
  const picked = ConsoleStep({ view: consoleView({ choice: "codex" }), onChoose: (id) => chosen.push(id) });
  expect(byTag(picked, "select")[0].props.value).toBe("codex");
  (byTag(picked, "select")[0].props.onChange as (e: unknown) => void)({ currentTarget: { value: "" } });
  expect(chosen).toEqual([undefined]);
});

test("with one profile the console names it, and with sessions off it says when it becomes available", () => {
  const one = ConsoleStep({ view: consoleView({ agents: [{ id: "claude", name: "Claude Code" }], sessionsOn: false }), onChoose: noop });
  expect(byTag(one, "select")).toHaveLength(0);
  expect(textOf(one)).toContain("The console runs Claude Code");
  expect(textOf(one)).toContain("once you switch them on");
});

const repoAt = (path: string, patch: Partial<RepoConfig> = {}): RepoConfig => ({ ...newRepoConfig(path, true), ...patch });
function settingsView(patch: Partial<ProjectSettingsView> = {}): ProjectSettingsView {
  const base = defaultConfig();
  const config: Config = { ...base, agentSessions: { ...base.agentSessions, enabled: true, agents: [CLAUDE_PROFILE, CODEX_PROFILE] } };
  const projects = [repoAt("/w/acme/alpha-infra"), repoAt("/w/acme/demo-ops"), repoAt("/w/acme/beta-notes")];
  config.repos = projects;
  return { config, projects, isGit: (id) => id !== projects[2].id, mode: "all", all: {}, each: new Map(), index: 0, ...patch };
}
const settingsHandlers = { onMode: noop, onChange: noop, onIndex: noop, onHelp: noop };
const labelsOf = (node: unknown) => byTag(node as never, "select").map((el) => String(el.props["aria-label"]));

test("Same settings for all projects shows every setting with its default and which projects it skips", () => {
  const step = ProjectSettingsStep({ view: settingsView(), ...settingsHandlers });
  expect(labelsOf(step)).toEqual(["Agent sessions for all projects", "Agent for all projects", "PR titles for all projects", "Docs auto-merge for all projects", "Auto fetch for all projects"]);
  const text = textOf(step);
  expect(text).toContain("Default: Enabled.");
  expect(text).toContain("Default: Every minute.");
  expect(text).toContain("Not set for beta-notes, which is not a git repository.");
  expect(text).not.toContain("Applies to");
  expect(text).not.toContain("saved at once");
  expect(byTag(step, "input").filter((el) => el.props.type === "radio").map((el) => el.props.checked)).toEqual([true, false]);
});

test("each setting's explanation is behind a help icon, in an overlay", () => {
  const closed = ProjectSettingsStep({ view: settingsView(), ...settingsHandlers });
  // Not inline: only the default and the count are shown.
  expect(textOf(closed)).not.toContain("only fetches");
  const helpButtons = byTag(closed, "button").filter((el) => String(el.props["aria-label"]).startsWith("About "));
  expect(helpButtons.map((el) => [el.props["aria-label"], el.props["aria-expanded"]])).toEqual([
    ["About Agent sessions", false],
    ["About Agent", false],
    ["About PR titles", false],
    ["About Docs auto-merge", false],
    ["About Auto fetch", false],
  ]);
  const toggled: string[] = [];
  const open = ProjectSettingsStep({ view: settingsView({ help: "autoFetch" }), ...settingsHandlers, onHelp: (s) => toggled.push(s) });
  const button = byTag(open, "button").find((el) => el.props["aria-label"] === "About Auto fetch");
  expect(button?.props["aria-expanded"]).toBe(true);
  const overlay = byTag(open, "span").find((el) => el.props.id === button?.props["aria-controls"]);
  expect(textOf(overlay)).toContain("only fetches");
  expect(byTag(open, "span").filter((el) => el.props.class === "setup-help-overlay")).toHaveLength(1);
  (button!.props.onClick as () => void)();
  expect(toggled).toEqual(["autoFetch"]);
});

test("the settings that need git are marked as such", () => {
  const rows = byTag(ProjectSettingsStep({ view: settingsView(), ...settingsHandlers }), "div").filter((el) => el.props.class === "setup-setting");
  const marked = rows.map((row) => textOf(row).includes("Requires a git repository"));
  expect(marked).toEqual([false, false, true, true, true]);
});

test("a mixed value reads Keep each project's setting", () => {
  const view = settingsView();
  view.projects = [repoAt("/w/acme/alpha-infra", { autoFetchSeconds: 300 }), ...view.projects.slice(1)];
  const autoFetch = byTag(ProjectSettingsStep({ view, ...settingsHandlers }), "select").find((el) => el.props["aria-label"] === "Auto fetch for all projects");
  expect(autoFetch?.props.value).toBe("keep");
  expect(textOf(byTag(autoFetch, "option")[0])).toBe("Keep each project's setting");
});

test("Individual settings walks through the projects one at a time", () => {
  const view = settingsView({ mode: "individual", index: 1 });
  const step = ProjectSettingsStep({ view, ...settingsHandlers });
  expect(textOf(step)).toContain("Project 2 of 3");
  expect(textOf(step)).toContain("demo-ops");
  const buttons = byTag(step, "button")
    .filter((el) => !String(el.props["aria-label"] ?? "").startsWith("About "))
    .map((el) => [textOf(el), el.props.disabled]);
  expect(buttons).toEqual([
    ["Previous project", false],
    ["Next project", false],
  ]);
  // A folder without git shows no git-only settings.
  const beta = ProjectSettingsStep({ view: settingsView({ mode: "individual", index: 2 }), ...settingsHandlers });
  expect(labelsOf(beta)).toEqual(["Agent sessions for beta-notes", "Agent for beta-notes"]);
});

test("projects still being scanned are waited for, and without projects the step says so", () => {
  const view = settingsView();
  const reading = ProjectSettingsStep({ view: { ...view, isGit: (id) => (id === view.projects[0].id ? undefined : true) }, ...settingsHandlers });
  expect(textOf(reading)).toContain("Reading alpha-infra");
  expect(byTag(reading, "select")).toHaveLength(0);
  const empty = ProjectSettingsStep({ view: { ...view, projects: [] }, ...settingsHandlers });
  expect(textOf(empty)).toContain("No project is tracked yet");
});

const reportWith = (status: "warning" | "ok"): EnvironmentReport => ({
  checkedAt: "2026-10-09T10:00:00.000Z",
  status,
  checks: [
    { id: "git", label: "git", status: "ok", found: "/usr/bin/git" },
    status === "warning"
      ? { id: "github-cli", label: "GitHub CLI", status: "warning", found: "`gh` not found on the PATH", remedy: "Install the GitHub CLI.", instructions: [{ text: "Install it.", command: "brew install gh" }, { text: "Sign in.", command: "gh auth login" }] }
      : { id: "github-cli", label: "GitHub CLI", status: "ok", found: "/usr/local/bin/gh" },
  ],
});

test("the System check lists a missing gh with copyable install and login commands", () => {
  const step = SystemCheckStep({ report: reportWith("warning"), loading: false, onRecheck: noop });
  expect(textOf(step)).toContain("Warning");
  expect(byTag(step, "code").map(textOf)).toEqual(["brew install gh", "gh auth login"]);
  expect(elements(step).filter((el) => typeof el.type === "function" && el.props.label === "Copy")).toHaveLength(2);
  expect(textOf(step)).not.toContain("Everything needed is in place");
  expect(textOf(step)).toContain("pull requests and issues");
  expect(textOf(step)).toContain("worktree");
});

test("the System check is a visual report: a headline with the count in place, then one card per check", () => {
  const five: EnvironmentReport = {
    checkedAt: "2026-10-09T10:00:00.000Z",
    status: "warning",
    checks: [
      { id: "dashboard-home", label: "Dashboard home", status: "ok", found: "writable: /home/demo/.spec-control" },
      { id: "git", label: "git", status: "ok", found: "/usr/bin/git" },
      { id: "git-identity", label: "Git committer identity", status: "ok", found: "Demo User <demo@example.invalid>" },
      { id: "openspec-cli", label: "OpenSpec CLI", status: "ok", found: "/usr/local/bin/openspec" },
      reportWith("warning").checks[1],
    ],
  };
  const step = SystemCheckStep({ report: five, loading: false, onRecheck: noop });
  const hero = byTag(step, "div").find((el) => String(el.props.class).startsWith("setup-system-hero"));
  expect(String(hero?.props.class)).toContain("attention");
  expect(textOf(hero)).toContain("4 of 5 in place");
  expect(byTag(hero, "button").map(textOf)).toEqual(["Re-check"]);
  const list = byTag(step, "ul").find((el) => el.props["aria-label"] === "What was checked");
  const cards = byTag(list, "li").filter((li) => String(li.props.class).startsWith("setup-check "));
  expect(cards.map((li) => textOf(byTag(li, "strong")[0]))).toEqual(["Dashboard home", "git", "Git committer identity", "OpenSpec CLI", "GitHub CLI"]);
  expect(cards.map((li) => String(li.props.class).replace("setup-check ", ""))).toEqual(["ok", "ok", "ok", "ok", "warning"]);
  for (const card of cards) {
    const icon = byTag(card, "span").find((el) => el.props.class === "setup-check-icon");
    expect(icon?.props["aria-hidden"]).toBe("true");
    expect(byTag(icon, "svg")).toHaveLength(1);
  }
  expect(textOf(cards[0])).toContain("In place");
  // The fix lives inside the card that needs it, and only there.
  expect(byTag(cards[4], "code").map(textOf)).toEqual(["brew install gh", "gh auth login"]);
  expect(cards.slice(0, 4).every((li) => byTag(li, "code").length === 0)).toBe(true);
  const ok = byTag(SystemCheckStep({ report: reportWith("ok"), loading: false, onRecheck: noop }), "div").find((el) => String(el.props.class).startsWith("setup-system-hero"));
  expect(String(ok?.props.class)).toContain("ok");
});

test("all in place is said plainly, and Re-check shows that it works", () => {
  expect(textOf(SystemCheckStep({ report: reportWith("ok"), loading: false, onRecheck: noop }))).toContain("Everything needed is in place");
  const working = byTag(SystemCheckStep({ report: reportWith("ok"), loading: true, onRecheck: noop }), "button")[0];
  expect(textOf(working)).toContain("Checking…");
  expect(working.props.disabled).toBe(true);
  expect(textOf(SystemCheckStep({ loading: false, error: "offline", onRecheck: noop }))).toContain("could not be checked");
});

test("Done is a visual ending: a headline, one card per step with its icon and mark, and what comes next", () => {
  const summary = { ...NOTHING_SAVED, rootsAdded: ["/w/acme"], tracked: 2, agentsAdded: ["Codex", "Antigravity"], projectsChanged: 3, agentSessions: true, defaultAgent: "Codex", agents: 3, checked: true, remaining: [], agentsMissing: [], clonesRunning: 0 };
  const done = DoneStep({ summary, firstStart: true });
  expect(textOf(done)).toContain("You're all set");
  expect(textOf(done)).toContain("ready for your 2 projects");
  const list = byTag(done, "ul").find((el) => el.props["aria-label"] === "What setup did");
  const cards = byTag(list, "li");
  expect(cards.map((li) => textOf(byTag(li, "span").find((el) => el.props.class === "setup-done-name")))).toEqual(["System check", "Workspace", "Agents", "Console", "Project settings"]);
  for (const card of cards) expect(byTag(card, "svg").length).toBeGreaterThan(0);
  expect(cards.map((li) => String(li.props.class).replace("setup-done-card ", ""))).toEqual(["done", "done", "done", "done", "done"]);
  expect(textOf(cards[2])).toContain("added Codex and Antigravity");
  expect(textOf(cards[3])).toContain("Codex");
  expect(textOf(cards[4])).toContain("3 projects");
  expect(textOf(done)).toContain("short tour");
  expect(textOf(DoneStep({ summary }))).not.toContain("short tour");

  const left = DoneStep({ summary: { ...summary, remaining: ["GitHub CLI"] } });
  expect(textOf(left)).toContain("one thing is left to fix");
  const system = byTag(byTag(left, "ul")[0], "li")[0];
  expect(String(system.props.class)).toContain("attention");
  expect(textOf(system)).toContain("Needs attention");
  expect(textOf(system)).toContain("GitHub CLI");

  // An agent still missing: Agents needs attention and names it, the System check is done.
  const agent = DoneStep({ summary: { ...summary, agentsMissing: ["Antigravity"] } });
  expect(textOf(agent)).toContain("one thing is left to fix");
  const [systemCard, , agentsCard] = byTag(byTag(agent, "ul")[0], "li");
  expect(String(systemCard.props.class)).toContain("done");
  expect(String(agentsCard.props.class)).toContain("attention");
  expect(textOf(agentsCard)).toContain("Antigravity");
});


// ---- workspace folder and GitHub repositories (add-github-repositories) ----

const githubView = (patch: Partial<NonNullable<WorkspaceView["github"]>> = {}): NonNullable<WorkspaceView["github"]> => ({ listed: [], clones: {}, refused: {}, ...patch });

test("a missing root is offered Create folder, and marked to be created on Continue once chosen", () => {
  const created: string[] = [];
  const missing = new Map([["/w/acme", "does not exist"]]);
  const step = WorkspaceStep({ view: workspace({ missing }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop, onCreate: (p) => created.push(p) });
  expect(textOf(step)).toContain("not found");
  const create = byTag(step, "button").find((b) => textOf(b) === "Create folder");
  press(create);
  expect(created).toEqual(["/w/acme"]);
  const marked = WorkspaceStep({ view: workspace({ missing, toCreate: new Set(["/w/acme"]) }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  expect(textOf(marked)).toContain("created on Continue");
  expect(textOf(marked)).not.toContain("not found");
  expect(byTag(marked, "button").some((b) => textOf(b) === "Don't create")).toBe(true);
  const refused = WorkspaceStep({ view: workspace({ missing, toCreate: new Set(["/w/acme"]), createErrors: new Map([["/w/acme", "its parent folder /w does not exist"]]) }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  expect(textOf(refused)).toContain("Could not create it: its parent folder /w does not exist");
});

test("with no root and nothing to suggest, creating ~/Workspace is proposed", () => {
  const proposed: string[] = [];
  const step = WorkspaceStep({ view: workspace({ entered: [], suggestions: [], proposed: "/home/demo/Workspace" }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop, onPropose: (p) => proposed.push(p) });
  const button = byTag(step, "button").find((b) => textOf(b) === "Create /home/demo/Workspace");
  press(button);
  expect(proposed).toEqual(["/home/demo/Workspace"]);
});

test("Continue says a workspace folder is needed while there is none, and Skip setup stays", () => {
  const frame = WizardFrame({ step: 2, onContinue: noop, onBack: noop, onSkip: noop, continueBlocked: "A workspace folder is needed: choose one or create a new one.", children: "" });
  const buttons = byTag(frame, "button");
  expect(buttons.find((b) => textOf(b) === "Continue")?.props.disabled).toBe(true);
  expect(textOf(frame)).toContain("A workspace folder is needed");
  expect(buttons.find((b) => textOf(b) === "Skip setup")?.props.disabled).toBeFalsy();
});

test("GitHub repositories are listed with their target, removable before Continue, and a failure offers Retry", () => {
  const calls: string[] = [];
  const listed = [
    { repo: "acme/beta-soc", root: "/w/acme", name: "beta-soc", path: "/w/acme/beta-soc" },
    { repo: "acme/missing-repo", root: "/w/acme", name: "missing-repo", path: "/w/acme/missing-repo" },
    { repo: "acme/chat-groups", root: "/w/acme", name: "chat-groups", path: "/w/acme/chat-groups" },
  ];
  const clones = {
    "/w/acme/beta-soc": { id: "c1", repo: "acme/beta-soc", root: "/w/acme", name: "beta-soc", path: "/w/acme/beta-soc", state: "tracked" as const, startedAt: "" },
    "/w/acme/missing-repo": { id: "c2", repo: "acme/missing-repo", root: "/w/acme", name: "missing-repo", path: "/w/acme/missing-repo", state: "failed" as const, reason: "Repository not found.", startedAt: "" },
  };
  const step = WorkspaceStep({
    view: workspace({ github: githubView({ listed, clones }) }),
    onInput: noop,
    onAdd: noop,
    onRemove: noop,
    onToggle: noop,
    onPick: noop,
    onAddGithub: () => calls.push("open"),
    onRemoveGithub: (p) => calls.push(`remove ${p}`),
    onRetryGithub: (p) => calls.push(`retry ${p}`),
  });
  const text = textOf(step);
  expect(text).toContain("→ /w/acme/beta-soc");
  expect(text).toContain("tracked");
  expect(text).toContain("Repository not found.");
  expect(text).toContain("cloned on Continue");
  const buttons = byTag(step, "button");
  press(buttons.find((b) => textOf(b) === "Add from GitHub"));
  press(buttons.find((b) => textOf(b) === "Retry"));
  press(buttons.find((b) => b.props["aria-label"] === "Remove acme/chat-groups"));
  // A repository whose clone started can no longer be removed.
  expect(buttons.some((b) => b.props["aria-label"] === "Remove acme/beta-soc")).toBe(false);
  expect(calls).toEqual(["open", "retry /w/acme/missing-repo", "remove /w/acme/chat-groups"]);
});

test("a refused repository keeps its reason with its folder name editable", () => {
  const renamed: string[] = [];
  const listed = [{ repo: "acme/chat-groups", root: "/w/acme", name: "chat-groups", path: "/w/acme/chat-groups" }];
  const step = WorkspaceStep({
    view: workspace({ github: githubView({ listed, refused: { "/w/acme/chat-groups": "/w/acme/chat-groups already exists" } }) }),
    onInput: noop,
    onAdd: noop,
    onRemove: noop,
    onToggle: noop,
    onPick: noop,
    onRenameGithub: (path, name) => renamed.push(`${path} ${name}`),
  });
  expect(textOf(step)).toContain("/w/acme/chat-groups already exists");
  const folder = byTag(step, "input").find((i) => i.props["aria-label"] === "Folder name for acme/chat-groups");
  expect(folder?.props.value).toBe("chat-groups");
  ((folder as NonNullable<typeof folder>).props.onInput as (e: unknown) => void)({ target: { value: "chat-groups-gh" } });
  expect(renamed).toEqual(["/w/acme/chat-groups chat-groups-gh"]);
  expect(byTag(step, "button").some((b) => textOf(b) === "Retry")).toBe(true);
});

test("the Done step lists the clones setup started with their progress, Cancel and Retry, and Finish says they go on", () => {
  const now = Date.parse("2026-10-10T10:00:40Z");
  const clones = [
    { id: "c1", repo: "acme/beta-soc", root: "/w/acme", name: "beta-soc", path: "/w/acme/beta-soc", state: "cloning" as const, progress: { phase: "receiving" as const, percent: 40, updatedAt: "2026-10-10T10:00:40Z" }, startedAt: "2026-10-10T10:00:00Z" },
    { id: "c2", repo: "acme/chat-groups", root: "/w/acme", name: "chat-groups", path: "/w/acme/chat-groups", state: "failed" as const, reason: "Repository not found.", startedAt: "2026-10-10T10:00:00Z" },
  ];
  const calls: string[] = [];
  const actions = { busy: {}, errors: {}, cancel: (c: { id: string }) => calls.push(`cancel ${c.id}`), retry: (c: { id: string }) => calls.push(`retry ${c.id}`), dismiss: (c: { id: string }) => calls.push(`dismiss ${c.id}`) };
  const summary = { ...NOTHING_SAVED, cloned: ["acme/beta-soc", "acme/chat-groups"], clonePaths: clones.map((c) => c.path), agentSessions: false, agents: 1, checked: true, remaining: [], agentsMissing: [], clonesRunning: 1 };
  const done = DoneStep({ summary, clones, cloneActions: actions, now });
  const section = byTag(done, "section").find((el) => el.props["aria-label"] === "GitHub clones");
  const [running, failed] = byTag(section, "li");
  expect(byTag(running, "progress")[0].props).toMatchObject({ value: 40, "aria-valuetext": "receiving objects, 40 percent" });
  expect(textOf(running)).toContain("acme/beta-soc");
  expect(textOf(failed)).toContain("Repository not found.");
  press(byTag(running, "button").find((b) => textOf(b) === "Cancel"));
  press(byTag(failed, "button").find((b) => textOf(b) === "Retry"));
  expect(calls).toEqual(["cancel c1", "retry c2"]);
  const workspaceCard = byTag(byTag(done, "ul")[0], "li")[1];
  expect(textOf(workspaceCard)).toContain("1 still running");
  expect(textOf(done)).toContain("The clone still running goes on; follow it under Unmanaged projects.");
  // Nothing started: no clone section.
  expect(byTag(DoneStep({ summary: { ...summary, cloned: [], clonePaths: [], clonesRunning: 0 } }), "section")).toEqual([]);
});

test("Add from GitHub in the step is inactive with its reason", () => {
  const step = WorkspaceStep({ view: workspace({ github: githubView({ off: "git was not found on this machine" }) }), onInput: noop, onAdd: noop, onRemove: noop, onToggle: noop, onPick: noop });
  const button = byTag(step, "button").find((b) => textOf(b) === "Add from GitHub");
  expect(button?.props.disabled).toBe(true);
  expect(textOf(step)).toContain("Add from GitHub is unavailable: git was not found on this machine.");
});
