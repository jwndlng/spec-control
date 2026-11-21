// The session panel's header actions run one at a time (fix-form-and-dialog-interactions 3.1): the pure guard, and the
// panel's source, which uses hooks and so is read rather than rendered.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { oneAtATime } from "../src/ui/sessionState.ts";

const panel = readFileSync(join(import.meta.dir, "..", "src", "ui", "sessionPanel.tsx"), "utf8");
const sessionsSource = readFileSync(join(import.meta.dir, "..", "src", "ui", "sessions.tsx"), "utf8");
const detailSource = readFileSync(join(import.meta.dir, "..", "src", "ui", "changeDetail.tsx"), "utf8");
const projectSettingsSource = readFileSync(join(import.meta.dir, "..", "src", "ui", "projectSettings.tsx"), "utf8");

/** A request that stays in flight until the test lets it finish. */
function pending() {
  let finish: (ok: boolean) => void = () => {};
  const done = new Promise<void>((resolve, reject) => (finish = (ok) => (ok ? resolve() : reject(new Error("refused")))));
  return { done, finish };
}

test("a second activation while one is in flight sends no request, and the actions read busy until it finishes", async () => {
  const running = { current: false };
  const busy: boolean[] = [];
  const act = oneAtATime(running, (b) => busy.push(b));
  let requests = 0;
  const request = pending();
  const ship = async () => {
    requests++;
    await request.done;
  };
  // A double-click on Ship: both clicks arrive before the re-render that disables the button.
  const first = act(ship);
  const second = act(ship);
  await second;
  expect(requests).toBe(1);
  expect(busy).toEqual([true]);
  request.finish(true);
  await first;
  expect(busy).toEqual([true, false]);
  // Enabled again: the next activation sends.
  await act(async () => {
    requests++;
  });
  expect(requests).toBe(2);
});

test("a failed request enables the actions again", async () => {
  const running = { current: false };
  const busy: boolean[] = [];
  const act = oneAtATime(running, (b) => busy.push(b));
  await expect(act(() => Promise.reject(new Error("resume refused")))).rejects.toThrow("resume refused");
  expect(running.current).toBe(false);
  expect(busy).toEqual([true, false]);
});

test("the panel's header actions go through the guard and are disabled while one runs", () => {
  expect(panel).toContain("oneAtATime(");
  const header = panel.slice(panel.indexOf('<header class="session-head">'), panel.indexOf("</header>"));
  const consolePanel = panel.slice(panel.indexOf("export function ConsolePanel"), panel.indexOf("export function ShipOperationStatus"));
  expect(header).toContain("disabled={acting}");
  expect(header).toContain("disabled={!merge.enabled || acting}");
  expect(header).toContain('<details class="console-settings">');
  expect(header).toContain('<summary aria-label="Console settings" title="Console settings">');
  expect(header).not.toContain('<details class="console-settings" open');
  expect(header).toContain('aria-label={`Session actions for ${session?.change ?? "selected session"}`}');
  expect(header).not.toContain('<span class="console-action-heading">Session actions</span>');
  expect(header).toContain("console-head-actions");
  expect(header).toContain("{showPullRequestActions && (");
  expect(header).toContain("{showChangeActions && (");
  expect(consolePanel).toContain("{showSessionActions && (");
  expect(panel).toContain("const showPullRequestActions = showFinishChecks || (!!canResolve && !!session && !inSplit(\"resolveConflicts\")) || (!!merge && !!session && !inSplit(\"merge\"));");
  expect(panel).toContain("const showChangeActions = !lifecycleActionsInTimeline && !!(session && card && receiving && sessionsEnabledFor(ui.config, card.repoId) && (split?.main || split?.menu.length));");
  expect(panel).toContain("{card && !lifecycleActionsInTimeline && (");
  expect(panel).toContain("const showSessionActions = !!session;");
  expect(consolePanel).not.toContain("⇪ Ship");
  expect(consolePanel).not.toContain("Commit this change, push its branch, and open or reuse a pull request.");
  expect(consolePanel).not.toContain("ship-operation-status");
  expect(header).toContain('aria-label="Pull request actions"');
  expect(header).toContain('aria-label="Change actions"');
  expect(panel).not.toContain("session-actions-menu");
  const sessionGroup = panel.slice(panel.indexOf('aria-label={`Session actions for'), panel.indexOf("</section>", panel.indexOf('aria-label={`Session actions for')));
  for (const action of ["▶ Resume", "Clean up", "Delete record", "<OpenInEditor"]) expect(sessionGroup).toContain(action);
  expect(sessionGroup).not.toContain("console-action-heading");
  // Operation progress and recovery render in the timeline delivery checkpoint.
  expect(panel).toContain("export function ShipOperationStatus");
  expect(panel).toContain("aria-live={operation.state === \"failed\" ? \"assertive\" : \"polite\"}");
  expect(detailSource).toContain("<ShipOperationStatus session={implementationSession} />");
  expect(detailSource).toContain("ShipOperationStatus session={archiveSession}");
  expect(panel).toContain("Ship outcome unknown:");
  expect(panel).toContain("shipOperationDismissed(operation.operationId)");
  for (const call of ["api.resolveConflicts(session.id)", "api.mergeSession(session.id)", "api.resumeSession(session.id)", "api.deleteSession(session.id)"]) {
    const at = header.indexOf(call);
    if (call.includes("api.resumeSession") || call.includes("api.deleteSession")) {
      expect(consolePanel.indexOf(call)).toBeGreaterThan(0);
      expect(consolePanel.slice(Math.max(0, consolePanel.indexOf(call) - 150), consolePanel.indexOf(call))).toContain("act(");
    } else {
      expect(header.indexOf(call)).toBeGreaterThan(0);
      expect(header.slice(Math.max(0, header.indexOf(call) - 120), header.indexOf(call))).toContain("act(");
    }
  }
});

test("the agent picker in the console pane renders when multiple agents exist, and displays running agent hint when different", () => {
  const picker = panel.slice(panel.indexOf('<div class="row change-agent-picker">'), panel.indexOf("{agentError &&"));
  const disclosure = panel.slice(panel.indexOf('<details class="console-settings">'), panel.indexOf("{agentError &&"));
  expect(picker).toContain("<Select aria-label=\"Change agent\"");
  expect(picker).not.toContain("<select");
  expect(disclosure).toContain("<ChangePermissionPicker");
  expect(disclosure).not.toContain("open &&");
  expect(panel).toContain("ui.config.agentSessions.agents.length > 1");
  expect(panel).toContain("setChangeAgent(repoId, change, agentId || null)");
  expect(panel).toContain("This session uses {session.agentName}; the next session starts {nextAgent.name}.");
  expect(panel).toContain('<div class="notice danger" role="status">');
  const saveAgent = panel.slice(panel.indexOf("const chooseAgent = async"), panel.indexOf("const canResolve"));
  expect(saveAgent).toContain("ui.saveConfig(await api.setChangeAgent");
  expect(saveAgent).not.toContain("ui.start(");
});

test("the Console owns the change permission picker; project settings keep their own", () => {
  expect(panel).toContain('<ChangePermissionPicker key={`${repoId}/${change}`}');
  expect(panel).toContain('<div class="console-change-settings">');
  expect(panel.indexOf('<ChangePermissionPicker key={`${repoId}/${change}`}')).toBeGreaterThan(panel.indexOf('<div class="row change-agent-picker">'));
  expect(detailSource).not.toContain("ChangePermissionPicker");
  expect(projectSettingsSource).toContain("PermissionProfilePicker({ repo, config, tracking })");
  expect(projectSettingsSource).toContain('aria-label={`Permission profile for ${repo.name}`}');
});

test("cards show the overriding profile's name with its tooltip and cards without an override show no agent name", () => {
  expect(sessionsSource).toContain('class="change-agent-name"');
  expect(sessionsSource).toContain('title="This change uses this agent instead of the project\'s"');
  expect(sessionsSource).toContain('place === "card" && ui.config?.repos.find((repo) => repo.id === card.repoId)?.agent?.changeAgents?.[card.name]');
  expect(sessionsSource).toContain("{agent?.name}</span>");
});



// Exercise the real buttons and refresh through the session provider without starting an agent or terminal.
import { Window } from "happy-dom";
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { act as domAct } from "preact/test-utils";
import { defaultConfig } from "../src/server/config.ts";
import type { ChangeSession } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { ConsoleSessionList } from "../src/ui/sessionPanel.tsx";
import { consoleSession, consoleSessions } from "../src/ui/sessionState.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";

const originalApi = { sessions: api.sessions, deleteSession: api.deleteSession };
const originalDom = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame };
let browser: Window | undefined;
let root: HTMLElement | undefined;
afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  Object.assign(api, originalApi);
  globalThis.window = originalDom.window;
  globalThis.document = originalDom.document;
  globalThis.requestAnimationFrame = originalDom.raf;
  root = undefined;
  browser = undefined;
});
const record = (id: string, state: ChangeSession["state"] = "exited"): ChangeSession => ({
  id, state, agentId: "fake", agentName: "Fake", repoId: "demo", change: "rotate-keys", action: "implement",
  worktreePath: "/w/acme/demo-ops", branch: "feat/rotate-keys", createdAt: id, updatedAt: id, resumable: false,
});
async function consoleList(selected = "2", initial = [record("3", "running"), record("2"), record("1", "failed")]) {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = () => 0;
  root = document.createElement("div");
  let records = initial;
  const deleted: string[] = [];
  const selections: string[] = [];
  let refreshes = 0;
  api.sessions = async () => { refreshes++; return { sessions: records, agents: [], presets: [], worktrees: [] }; };
  api.deleteSession = async (id) => { deleted.push(id); records = records.filter((s) => s.id !== id); return { deleted: true }; };
  function List() {
    const ui = useSessionUi();
    const [chosen, choose] = useState(selected);
    const sessions = consoleSessions(ui.sessions, "demo", "rotate-keys");
    const current = consoleSession(sessions, chosen);
    return h("div", null,
      h("output", null, current?.id),
      h(ConsoleSessionList, { sessions, selected: current?.id, onSelect: (id) => { selections.push(id); choose(id); } }),
    );
  }
  const config = defaultConfig();
  config.agentSessions.enabled = true;
  await domAct(() => render(h(SessionProvider, { config, children: h(List, {}) }), root!));
  const remove = (id: string) => root!.querySelectorAll<HTMLButtonElement>(".console-session-remove")[id === "2" ? 0 : 1]!;
  return { root: root!, remove, deleted, selections, refreshes: () => refreshes };
}

test("console rows offer sibling removal buttons only for ended sessions and omit a single session's list", async () => {
  const view = await consoleList();
  const rows = view.root.querySelectorAll(".console-session");
  expect(rows).toHaveLength(3);
  expect(rows[0]!.querySelector('[aria-label="Remove console"]')).toBeNull();
  for (const row of [rows[1]!, rows[2]!]) {
    const button = row.querySelector('[aria-label="Remove console"]')!;
    expect(button.parentElement === row).toBe(true);
    expect(row.querySelector(".console-session-select")!.contains(button)).toBe(false);
  }
  await domAct(async () => { view.remove("1").click(); await Bun.sleep(0); });
  await domAct(async () => { view.remove("2").click(); await Bun.sleep(0); });
  expect(view.root.querySelector("nav") === null).toBe(true);
  expect(view.root.querySelector("output")!.textContent).toBe("3");
});

test("removing the selected console refreshes records and selects the most recent remaining console", async () => {
  const view = await consoleList();
  const before = view.refreshes();
  await domAct(async () => { view.remove("2").click(); await Bun.sleep(0); });
  expect(view.deleted).toEqual(["2"]);
  expect(view.selections).toEqual(["3"]);
  expect(view.refreshes()).toBe(before + 1);
  expect(view.root.querySelector("output")!.textContent).toBe("3");
  expect(view.root.querySelectorAll(".console-session")).toHaveLength(2);
});

test("removing another console preserves selection and stops the removal click from bubbling", async () => {
  const view = await consoleList();
  let bubbled = false;
  view.root.addEventListener("click", () => { bubbled = true; });
  await domAct(async () => { view.remove("1").click(); await Bun.sleep(0); });
  expect(bubbled).toBe(false);
  expect(view.deleted).toEqual(["1"]);
  expect(view.selections).toEqual([]);
  expect(view.root.querySelector("output")!.textContent).toBe("2");
});

test("pending deletion ignores repeated clicks and failure keeps the selection and reports the error", async () => {
  const view = await consoleList();
  const request = pending();
  let requests = 0;
  api.deleteSession = async () => { requests++; await request.done; return { deleted: true }; };
  const button = view.remove("2");
  await domAct(() => { button.click(); button.click(); });
  expect(requests).toBe(1);
  expect(button.disabled).toBe(true);
  const before = view.refreshes();
  await domAct(async () => { request.finish(false); await request.done.catch(() => {}); });
  expect(view.root.querySelector('[role="alert"]')!.textContent).toBe("refused");
  expect(button.disabled).toBe(false);
  expect(view.selections).toEqual([]);
  expect(view.root.querySelector("output")!.textContent).toBe("2");
  expect(view.refreshes()).toBe(before);
});

test("Custom session has a label and no-prompt tooltip and uses the shared starter rendering", () => {
  expect(sessionsSource).toContain('custom: "Custom session"');
  expect(sessionsSource).toContain("without an opening prompt");
  expect(panel).toContain('custom: "Custom session"');
});
