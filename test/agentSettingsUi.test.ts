import { expect, test } from "bun:test";
import { AGENT_PRESETS, ANTIGRAVITY_PROFILE, CLAUDE_PROFILE } from "../src/shared/agentDefaults.ts";
import type { AgentAvailability, AgentProfile, AgentSessionsConfig, KeepAwakeStatus, PromptKey } from "../src/shared/types.ts";
import { defaultConfig, validateConfig } from "../src/server/config.ts";
import { AgentEditor, ConsoleAgentPicker, KeepAwakeSetting, keepAwakeState, PerProjectNote, PresetPicker, ShortcutEditor, withoutAgent } from "../src/ui/agentSettings.tsx";
import { byTag, elements, textOf } from "./vnode.ts";

const profile = (patch: Partial<AgentProfile> = {}): AgentProfile => ({ id: "fake", name: "Fake Agent", command: ["fake", "{prompt}"], prompts: { implement: "implement {change}" }, ...patch });

/** Every additional-instructions control, in the order the editor lays them out. */
function suffixFields(agent: AgentProfile) {
  let patch: Partial<AgentProfile> | undefined;
  const tree = AgentEditor({ agent, isDefault: true, canRemove: false, open: true, onToggle: () => {}, onChange: (p) => (patch = p), onRemove: () => {}, onDefault: () => {} });
  const fields = elements(tree).filter((el) => (el.type === "input" || el.type === "textarea") && el.props.placeholder === "nothing is appended");
  const type = (index: number, value: string) => {
    (fields[index].props.onInput as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
    return patch;
  };
  return { fields, type, tree };
}

const KEYS: PromptKey[] = ["draft", "implement", "validate", "archive", "ship", "resolveConflicts", "merge", "integrate"];

test("the editor offers additional instructions beside every prompt, and shows what is saved", () => {
  const { fields, tree } = suffixFields(profile({ promptSuffixes: { implement: "Run the linter.", ship: "Add the checklist." } }));
  // One per prompt: the four starters, Ship, Resolve conflicts, Merge and Integrate.
  expect(fields).toHaveLength(KEYS.length);
  expect(fields.filter((f) => f.type === "textarea")).toHaveLength(4); // Ship, Resolve conflicts, Merge and Integrate keep their textareas
  expect(fields.map((f) => f.props.value)).toEqual(["", "Run the linter.", "", "", "Add the checklist.", "", "", ""]);

  // Each field says what it does, so the one-line rule and the placeholder rules are not a surprise.
  const hints = textOf(tree);
  expect(hints).toContain("Additional Implement instructions");
  expect(hints).toContain("as one line");
  expect(hints).toContain("this text alone does not offer the starter");
  expect(hints).toContain("or to the default shown there"); // Ship works without a prompt of its own
  expect(hints).toContain("no placeholder at all"); // Integrate
});

test("typing stores the text under its own key; clearing a field removes it", () => {
  const { type } = suffixFields(profile({ promptSuffixes: { implement: "Run the linter." } }));
  // A new key is added beside the one already saved.
  expect(type(KEYS.indexOf("archive"), "Tell me what you archived.")?.promptSuffixes).toEqual({ implement: "Run the linter.", archive: "Tell me what you archived." });
  // Blank is nothing to append, so the key goes rather than being saved as whitespace.
  expect(type(KEYS.indexOf("implement"), "   ")?.promptSuffixes).toBeUndefined();
  expect(type(KEYS.indexOf("implement"), "")?.promptSuffixes).toBeUndefined();

  // With another key still set, only the cleared one goes.
  const two = suffixFields(profile({ promptSuffixes: { implement: "Run the linter.", ship: "Add the checklist." } }));
  expect(two.type(KEYS.indexOf("ship"), "")?.promptSuffixes).toEqual({ implement: "Run the linter." });
  expect(two.type(KEYS.indexOf("integrate"), "Ask me first.")?.promptSuffixes).toEqual({ implement: "Run the linter.", ship: "Add the checklist.", integrate: "Ask me first." });
});

test("Agent sessions settings point to Projects for the per-project switch and agent, and list no repository", async () => {
  const { PerProjectNote } = await import("../src/ui/agentSettings.tsx");
  const { byTag } = await import("./vnode.ts");
  const note = PerProjectNote();
  expect(textOf(note)).toContain("set them on Projects");
  expect(byTag(note, "a")[0].props.href).toBe("/");
  expect(byTag(note, "input")).toHaveLength(0);
  const source = await Bun.file(new URL("../src/ui/agentSettings.tsx", import.meta.url)).text();
  expect(source).not.toContain("draft.repos");
});

/** An editor with recorded callbacks, for the header and grouping tests. */
function editor(over: Partial<Parameters<typeof AgentEditor>[0]> = {}) {
  const calls: string[] = [];
  const tree = AgentEditor({
    agent: profile(),
    isDefault: false,
    canRemove: true,
    open: false,
    onToggle: () => calls.push("toggle"),
    onChange: () => calls.push("change"),
    onRemove: () => calls.push("remove"),
    onDefault: () => calls.push("default"),
    ...over,
  });
  return { tree, calls };
}

test("a collapsed profile's header offers Make default and Remove agent, and shows no fields", () => {
  const { tree, calls } = editor();
  const buttons = byTag(tree, "button");
  const toggle = buttons.find((b) => b.props.class === "agent-toggle");
  expect(toggle?.props["aria-expanded"]).toBe(false);
  expect(textOf(toggle)).toContain("Fake Agent");
  const labels = buttons.map((b) => textOf(b).trim());
  expect(labels).toContain("Make default");
  expect(labels).toContain("Remove agent");
  expect(byTag(tree, "input")).toHaveLength(0);
  expect(byTag(tree, "textarea")).toHaveLength(0);
  expect(byTag(tree, "h4")).toHaveLength(0);

  const makeDefault = buttons.find((b) => textOf(b).trim() === "Make default");
  // Optional calls: a missing button leaves `calls` empty, which the expectations below catch.
  (makeDefault?.props.onClick as (() => void) | undefined)?.();
  expect(calls).toEqual(["default"]);
  (toggle?.props.onClick as (() => void) | undefined)?.();
  expect(calls).toEqual(["default", "toggle"]);
});

test("the default profile's header offers neither action when it is the only one", () => {
  const labels = byTag(editor({ isDefault: true, canRemove: false }).tree, "button").map((b) => textOf(b).trim());
  expect(labels).not.toContain("Make default");
  expect(labels).not.toContain("Remove agent");
});

test("an expanded profile groups its fields as Command, Change starters and Action prompts", () => {
  const { tree } = editor({ open: true });
  expect(byTag(tree, "h4").map((h) => textOf(h))).toEqual(["Command", "Change starters", "Action prompts"]);
  const toggle = byTag(tree, "button").find((b) => b.props.class === "agent-toggle");
  expect(toggle?.props["aria-expanded"]).toBe(true);
  expect(byTag(tree, "div").some((d) => d.props.id === toggle?.props["aria-controls"])).toBe(true);
});

test("each prompt's additional instructions follow that prompt before the next prompt begins", () => {
  const { tree } = editor({ open: true });
  // Every prompt and instructions field in document order, as P (prompt) or S (additional instructions).
  const order = elements(tree)
    .filter((el) => (el.type === "input" || el.type === "textarea") && el.props.placeholder !== undefined)
    .map((el) => (el.props.placeholder === "nothing is appended" ? "S" : "P"))
    .join("");
  expect(order).toBe("PS".repeat(KEYS.length));
  // Labelled in the same order as the prompts.
  const labels = elements(tree)
    .filter((el) => el.props.class === "agent-prompt-label")
    .map((el) => textOf(el));
  expect(labels).toEqual(["Name", "Command", "Resume command", "Draft artifacts", "Implement", "Validate", "Archive", "Ship", "Resolve conflicts", "Merge", "Integrate"]);
});

test("the Agent sessions section is grouped as Agents, Shortcuts, Fast-forward, Console, Projects and lists no worktree", async () => {
  expect(textOf(byTag(ShortcutEditor({ shortcuts: [], onChange: () => {} }), "h3")[0])).toBe("Shortcuts");
  expect(textOf(byTag(PerProjectNote(), "h3")[0])).toBe("Projects");
  // AgentSettings uses hooks, so its order is read from its source.
  const source = await Bun.file(new URL("../src/ui/agentSettings.tsx", import.meta.url)).text();
  const body = source.slice(source.indexOf("export function AgentSettings"));
  const at = ["<h2>Agent sessions</h2>", "<h3>Agents</h3>", "<ShortcutEditor", "<h3>Fast-forward</h3>", "<h3>Console</h3>", "<PerProjectNote"].map((s) => body.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(source).not.toContain("Session worktrees");
  expect(source).not.toContain("worktreePath");
  expect(body.match(/<h2>/g)).toHaveLength(1);
});

/** The preset buttons as `[label, mark]`, in the order they are shown, and a way to click one. */
function picker(agents: AgentProfile[], presets?: AgentAvailability[]) {
  const added: AgentProfile[] = [];
  const buttons = byTag(PresetPicker({ agents, presets, onAdd: (p) => added.push(p) }), "button");
  const rows = buttons.map((b) => {
    const text = textOf(b).replace(/\s+/g, " ").trim();
    return [text.replace(/ (✓ found|⚠ not found)$/, ""), text.match(/(✓ found|⚠ not found)$/)?.[1] ?? ""];
  });
  const click = (label: string) => (buttons[rows.findIndex(([l]) => l === label)].props.onClick as () => void)();
  return { rows, click, added };
}

test("the preset picker offers the unconfigured presets, found ones first, each marked", () => {
  const presets: AgentAvailability[] = [
    { id: "codex", name: "Codex", available: false },
    { id: "agy", name: "Antigravity", available: true, path: "/usr/local/bin/agy" },
  ];
  const { rows, click, added } = picker([structuredClone(CLAUDE_PROFILE)], presets);
  expect(rows).toEqual([
    ["+ Antigravity preset", "✓ found"],
    ["+ Codex preset", "⚠ not found"],
  ]);
  // Adding copies the preset: equal to it, but the user's to edit without touching the preset itself.
  click("+ Antigravity preset");
  expect(added).toEqual([ANTIGRAVITY_PROFILE]);
  expect(added[0]).not.toBe(ANTIGRAVITY_PROFILE);
  added[0].prompts.implement = "edited {change}";
  expect(ANTIGRAVITY_PROFILE.prompts.implement).not.toBe("edited {change}");
});

test("a configured preset is not offered again, edited or not; a removed one is", () => {
  const editedAgy = { ...structuredClone(ANTIGRAVITY_PROFILE), name: "My agy", command: ["agy", "{prompt}"] };
  expect(picker([structuredClone(CLAUDE_PROFILE), editedAgy]).rows.map(([l]) => l)).toEqual(["+ Codex preset"]);
  // Without the Claude Code profile it is offered again, in preset order while nothing is found.
  const none: AgentAvailability[] = [
    { id: "claude", name: "Claude Code", available: false },
    { id: "codex", name: "Codex", available: false },
  ];
  expect(picker([editedAgy], none).rows).toEqual([
    ["+ Claude Code preset", "⚠ not found"],
    ["+ Codex preset", "⚠ not found"],
  ]);
});

test("before availability has loaded every preset is offered, unmarked, in preset order", () => {
  expect(picker([{ id: "fake", name: "Fake", command: ["fake", "{prompt}"], prompts: {} }]).rows).toEqual([
    ["+ Claude Code preset", ""],
    ["+ Codex preset", ""],
    ["+ Antigravity preset", ""],
  ]);
  expect(picker(AGENT_PRESETS.map((p) => structuredClone(p.profile))).rows).toEqual([]);
});

test("Fast-forward has no prompt field of its own, and its warning is a setting that reads ticked until switched off", async () => {
  const tree = AgentEditor({ agent: profile({ prompts: { draft: "d {change}", implement: "i {change}" } }), isDefault: true, canRemove: false, open: true, onToggle: () => {}, onChange: () => {}, onRemove: () => {}, onDefault: () => {} });
  const ids = elements(tree).map((el) => String(el.props.id ?? ""));
  expect(ids.some((id) => id.includes("fastForward"))).toBe(false);
  expect(textOf(tree)).toContain("Fast-forward has no prompt of its own");
  const source = await Bun.file(new URL("../src/ui/agentSettings.tsx", import.meta.url)).text();
  expect(source).toContain("checked={settings.confirmFastForward !== false}");
  expect(source).toContain("Warn before fast-forwarding");
});

const sessions = (patch: Partial<AgentSessionsConfig> = {}): AgentSessionsConfig => ({
  enabled: true,
  agents: [CLAUDE_PROFILE, ANTIGRAVITY_PROFILE],
  defaultAgent: CLAUDE_PROFILE.id,
  shortcuts: [],
  ...patch,
});

test("the console agent is offered only with a choice to make, with the default agent first", () => {
  expect(ConsoleAgentPicker({ settings: sessions({ agents: [CLAUDE_PROFILE] }), onChange: () => {} })).toBeNull();
  const tree = ConsoleAgentPicker({ settings: sessions(), onChange: () => {} });
  const select = byTag(tree, "select")[0];
  expect(select.props["aria-label"]).toBe("Console agent");
  expect(select.props.value).toBe(""); // no choice reads as the default agent
  expect(byTag(tree, "option").map((o) => [o.props.value, textOf(o)])).toEqual([
    ["", "default agent"],
    [CLAUDE_PROFILE.id, CLAUDE_PROFILE.name],
    [ANTIGRAVITY_PROFILE.id, ANTIGRAVITY_PROFILE.name],
  ]);
  expect(byTag(ConsoleAgentPicker({ settings: sessions({ consoleAgent: ANTIGRAVITY_PROFILE.id }), onChange: () => {} }), "select")[0].props.value).toBe(ANTIGRAVITY_PROFILE.id);
});

test("choosing a profile stores it; choosing the default agent stores no choice", () => {
  const chosen: (string | undefined)[] = [];
  const select = byTag(ConsoleAgentPicker({ settings: sessions(), onChange: (v) => chosen.push(v) }), "select")[0];
  const pick = (value: string) => (select.props.onChange as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
  pick(ANTIGRAVITY_PROFILE.id);
  pick("");
  expect(chosen).toEqual([ANTIGRAVITY_PROFILE.id, undefined]);
});

test("removing the console's profile sends the console back to the default agent, and the result saves", () => {
  const after = withoutAgent(sessions({ consoleAgent: ANTIGRAVITY_PROFILE.id }), ANTIGRAVITY_PROFILE.id);
  expect(after.agents.map((a) => a.id)).toEqual([CLAUDE_PROFILE.id]);
  expect("consoleAgent" in after).toBe(false);
  expect(() => validateConfig({ ...defaultConfig(), agentSessions: after })).not.toThrow();
  // Removing another profile keeps the choice; removing the default picks a new default.
  const three = sessions({ agents: [CLAUDE_PROFILE, ANTIGRAVITY_PROFILE, profile()], consoleAgent: ANTIGRAVITY_PROFILE.id });
  expect(withoutAgent(three, "fake").consoleAgent).toBe(ANTIGRAVITY_PROFILE.id);
  expect(withoutAgent(three, CLAUDE_PROFILE.id)).toMatchObject({ defaultAgent: ANTIGRAVITY_PROFILE.id, consoleAgent: ANTIGRAVITY_PROFILE.id });
});

test("the Console group offers the agent picker after the folder and says which agent the console starts", async () => {
  const source = await Bun.file(new URL("../src/ui/agentSettings.tsx", import.meta.url)).text();
  const body = source.slice(source.indexOf("export function AgentSettings"));
  const at = ["<h3>Console</h3>", 'aria-label="Console folder"', "<ConsoleAgentPicker", "<PerProjectNote"].map((s) => body.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(body).toContain("opens the agent chosen here");
  expect(body).not.toContain("opens your default agent");
});

const keepAwake = (patch: Partial<KeepAwakeStatus> = {}): KeepAwakeStatus => ({ available: true, enabled: true, active: false, sessions: 0, ...patch });

test("the keep-awake hint says what the server is doing right now, and nothing without a status", () => {
  expect(keepAwakeState(keepAwake({ active: true, sessions: 2 }), true)).toBe("Keeping this Mac awake right now, for 2 busy sessions.");
  expect(keepAwakeState(keepAwake({ active: true, sessions: 1 }), true)).toBe("Keeping this Mac awake right now, for 1 busy session.");
  expect(keepAwakeState(keepAwake(), true)).toBe("Not keeping the machine awake right now: no agent is busy.");
  expect(keepAwakeState(keepAwake({ sessions: 1 }), true)).toContain("caffeinate is not running");
  expect(keepAwakeState(keepAwake({ available: false }), true)).toBe("Works on macOS only: nothing is started on this machine.");
  expect(keepAwakeState(keepAwake({ enabled: false, sessions: 1 }), false)).toBe("Turned off: the machine sleeps as usual.");
  expect(keepAwakeState(keepAwake({ enabled: false }), true)).toBe("Save to turn it on.");
  expect(keepAwakeState(undefined, true)).toBeUndefined(); // the demo sends none
});

test("Keep awake while agents work reads ticked until switched off, says display and lid still sleep, and stores only false", async () => {
  const toggled: boolean[] = [];
  const tree = KeepAwakeSetting({ status: keepAwake({ available: false }), on: true, onToggle: (on) => toggled.push(on) });
  const text = textOf(tree);
  expect(text).toContain("Keep awake while agents work");
  expect(text).toContain("display can still sleep");
  expect(text).toContain("closing the lid");
  expect(text).toContain("macOS only");
  const box = byTag(tree, "input")[0];
  expect(box.props.checked).toBe(true);
  (box.props.onChange as (e: { currentTarget: { checked: boolean } }) => void)({ currentTarget: { checked: false } });
  expect(toggled).toEqual([false]);
  expect(byTag(KeepAwakeSetting({ status: undefined, on: false, onToggle: () => {} }), "p")).toHaveLength(1); // no status line
  const source = await Bun.file(new URL("../src/ui/agentSettings.tsx", import.meta.url)).text();
  expect(source).toContain("on={draft.keepAwake !== false}");
  expect(source).toContain("update({ keepAwake: on ? undefined : false })");
  // Shown whether or not sessions are enabled: after the fieldset the Enable switch disables.
  expect(source.indexOf("<KeepAwakeSetting")).toBeGreaterThan(source.indexOf("</fieldset>"));
});
