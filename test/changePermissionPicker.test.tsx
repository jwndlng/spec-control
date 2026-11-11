import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { defaultConfig } from "../src/server/config.ts";
import type { ChangeArtifacts, ChangeSession, Config, Snapshot, SessionWorktree } from "../src/shared/types.ts";
import { revisionOf, api } from "../src/ui/api.ts";
import { ChangeDetail } from "../src/ui/changeDetail.tsx";
import { ChangePermissionPicker } from "../src/ui/changePermissionPicker.tsx";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";
import { consoleSession } from "../src/ui/sessionState.ts";
import { SessionProvider } from "../src/ui/sessions.tsx";

const originalApi = { openSession: api.openSession, resumeSession: api.resumeSession, openTerminal: api.openTerminal, sessions: api.sessions, changeArtifacts: api.changeArtifacts, artifactFile: api.artifactFile, setChangePermissionProfile: api.setChangePermissionProfile };
const originalDom = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, location: globalThis.location, history: globalThis.history };
let browser: Window;
let root: HTMLElement;
afterEach(async () => {
  if (root) await act(async () => { render(null, root); await Bun.sleep(0); });
  await Bun.sleep(10);
  browser?.happyDOM.abort();
  Object.assign(api, originalApi);
  Object.assign(globalThis, originalDom);
});
const configForTest = (): Config => ({ ...defaultConfig(), agentSessions: { ...defaultConfig().agentSessions, enabled: true }, repos: [{ id: "demo", name: "Demo", path: "/w/acme/demo", enabled: true, agentOverrides: { one: { agentId: "other" } } }] });
const record = (profile?: ChangeSession["permissionProfile"]): ChangeSession => ({ id: "running", state: "running", agentId: "fake", agentName: "Fake", repoId: "demo", change: "one", action: "implement", worktreePath: "/w/acme/demo", createdAt: "2026-11-10", updatedAt: "2026-11-10", resumable: false, permissionProfile: profile });
async function setup(config = configForTest(), records: ChangeSession[] = [], detail = false, worktrees: SessionWorktree[] = []) {
  browser = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, { window: browser, document: browser.document, HTMLElement: browser.HTMLElement, location: browser.location, history: browser.history, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  root = document.createElement("div");
  document.body.append(root);
  api.sessions = async () => ({ sessions: records, agents: [], worktrees, presets: [] });
  api.changeArtifacts = async (_repo, name) => ({ change: { repoId: "demo", schema: "spec-driven", archived: false, name, dir: "/w/acme/demo/openspec/changes/one" }, artifacts: [{ id: "proposal", status: "done", files: [{ path: "proposal.md", bytes: 10 }] }] }) as ChangeArtifacts;
  api.artifactFile = async () => ({ path: "proposal.md", text: "# Proposal", bytes: 10 });
  let setConfig!: (value: Config) => void;
  let setName!: (name: string) => void;
  let setSnapshot!: (value: Snapshot) => void;
  const snapshot = { generatedAt: "2026-11-10", repos: [{ id: "demo", name: "Demo", path: "/w/acme/demo", isGit: false, worktrees: [], changes: [{ name: "one", column: "Drafts", archived: false, artifacts: [], tasks: null, lastModified: null }] }] } as unknown as Snapshot;
  function Harness() {
    const [current, update] = useState(config);
    const [name, navigate] = useState("one");
    const [state, scan] = useState(snapshot);
    setConfig = update; setName = navigate; setSnapshot = scan;
    return <SessionProvider config={current} snapshot={state} onConfig={update}>
      {detail ? <ChangeDetail snapshot={state} repoId="demo" changeName={name} /> : <ChangePermissionPicker key={name} repoId="demo" changeName={name} />}
    </SessionProvider>;
  }
  await act(async () => { render(<Harness />, root); });
  const choose = async (value: string) => {
    const trigger = root.querySelector<HTMLButtonElement>(".shared-select")!;
    await act(() => trigger.click());
    const values = ["", "minimum", "less-friction", "full-automation"];
    const option = document.querySelectorAll<HTMLElement>("[role=option]")[values.indexOf(value)];
    await act(() => option?.click());
  };
  return { choose, config: async (next: Config) => act(() => setConfig(next)), navigate: async (name: string) => act(() => setName(name)), snapshot: async (next: Snapshot) => act(() => setSnapshot(next)), initialSnapshot: snapshot };
}
const selection = () => root.querySelector<HTMLButtonElement>(".shared-select")!;
const selectedLabel = () => root.querySelector(".shared-select-label")?.textContent;
const text = () => root.textContent!;

test("inheritance resolves project, global and Minimum and preserves explicit equal choice", async () => {
  const config = configForTest();
  const view = await setup(config);
  expect(selectedLabel()).toBe("Inherit from project (Minimum)");
  expect(text()).toContain("Inherit from project (Minimum)");
  config.agentSessions.defaultPermissionProfile = "less-friction";
  await view.config(structuredClone(config));
  expect(text()).toContain("Inherit from project (Less friction)");
  config.repos[0].agent = { enabled: true, permissionProfile: "full-automation" };
  config.repos[0].agentOverrides!.one.permissionProfile = "full-automation";
  await view.config(structuredClone(config));
  expect(selectedLabel()).toBe("Full automation");
  expect(selectedLabel()).toBe("Full automation");
});

test("deferred saves disable duplicates, retain acknowledged value on refusal, and support retry and clearing", async () => {
  const config = configForTest();
  const calls: unknown[] = [];
  let resolve!: (config: Config) => void;
  let reject!: (error: Error) => void;
  api.setChangePermissionProfile = (repo, name, value) => {
    calls.push([repo, name, value]);
    return new Promise<Config>((yes, no) => { resolve = yes; reject = no; });
  };
  const view = await setup(config);
  await view.choose("minimum");
  expect(selection().disabled).toBe(true);
  expect(root.querySelector('[role="status"]')!.textContent).toBe("Saving…");
  await view.choose("full-automation");
  expect(calls).toEqual([["demo", "one", "minimum"]]);
  await act(async () => { reject(new Error("Refused by server")); await Bun.sleep(0); });
  expect(selectedLabel()).toBe("Inherit from project (Minimum)");
  expect(selection().disabled).toBe(false);
  expect(root.querySelector('[role="alert"]')!.textContent).toBe("Refused by server");
  await view.choose("minimum");
  const saved = structuredClone(config);
  saved.repos[0].agentOverrides!.one.permissionProfile = "minimum";
  await act(async () => { resolve(saved); await Bun.sleep(0); });
  expect(selectedLabel()).toBe("Minimum");
  expect(root.querySelector('[role="status"]')!.textContent).toBe("Saved");
  expect(root.querySelector('[role="alert"]')).toBeNull();
  await view.choose("");
  await act(async () => { resolve(config); await Bun.sleep(0); });
  expect(calls.at(-1)).toEqual(["demo", "one", null]);
  expect(selectedLabel()).toBe("Inherit from project (Minimum)");
});

for (const failure of [false, true]) test(`navigation hides late ${failure ? "error" : "success"} feedback`, async () => {
  let finish!: () => void;
  api.setChangePermissionProfile = () => new Promise<Config>((resolve, reject) => { finish = () => failure ? reject(new Error("Old refusal")) : resolve(configForTest()); });
  const view = await setup();
  await view.choose("less-friction");
  await view.navigate("two");
  expect(selection().disabled).toBe(false);
  await act(async () => { finish(); await Bun.sleep(0); });
  expect(root.querySelector('[role="status"]')!.textContent).toBe("");
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

test("running profile uses recorded running session, ignores ended history and updates with inherited settings", async () => {
  const config = configForTest();
  const records = [{ ...record("full-automation"), id: "history", state: "exited" as const }, record("minimum")];
  expect(consoleSession(records, "history")!.state).toBe("exited");
  const view = await setup(config, records);
  expect(text()).not.toContain("The running session uses");
  config.agentSessions.defaultPermissionProfile = "less-friction";
  await view.config(structuredClone(config));
  expect(text()).toContain("The running session uses Minimum; the next session start uses Less friction.");
  config.repos[0].agentOverrides!.one.permissionProfile = "minimum";
  await view.config(structuredClone(config));
  expect(text()).not.toContain("The running session uses");
});
for (const records of [[], [record()]]) test(`no invented running profile for ${records.length ? "legacy record" : "no session"}`, async () => {
  await setup(configForTest(), records);
  expect(text()).not.toContain("The running session uses");
});

test("detail retains one accessible picker and pending feedback across tabs; ineligible views have none", async () => {
  let finish!: (config: Config) => void;
  api.setChangePermissionProfile = () => new Promise<Config>((resolve) => { finish = resolve; });
  const view = await setup(configForTest(), [], true);
  expect(root.querySelectorAll('[aria-label="Permission profile for this change"]')).toHaveLength(1);
  await view.choose("less-friction");
  const tab = () => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Console")!;
  await act(() => tab().click());
  expect(root.querySelectorAll('[aria-label="Permission profile for this change"]')).toHaveLength(1);
  expect(text()).toContain("Saving…");
  const saved = configForTest(); saved.repos[0].agentOverrides!.one.permissionProfile = "less-friction";
  await act(async () => { finish(saved); await Bun.sleep(0); });
  expect(selectedLabel()).toBe("Less friction");
  const proposal = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith("Proposal"))!;
  await act(() => proposal.click());
  expect(selectedLabel()).toBe("Less friction");
  const archived = structuredClone(view.initialSnapshot);
  archived.repos[0].changes[0].archived = "2026-11-10";
  await view.snapshot(archived);
  await act(() => tab().click());
  expect(root.querySelectorAll("select")).toHaveLength(0);
  await view.navigate("missing");
  expect(root.querySelectorAll("select")).toHaveLength(0);
  await view.navigate("one");
  await view.snapshot(view.initialSnapshot);
  const disabled = configForTest(); disabled.agentSessions.enabled = false;
  await view.config(disabled);
  expect(root.querySelectorAll("select")).toHaveLength(0);
});

test("a missing change with a surviving Console worktree has no permission picker", async () => {
  const worktree: SessionWorktree = { repoId: "demo", name: "one", change: "one", action: "implement", path: "/w/acme/demo", work: { state: "clean", base: "main" } };
  const view = await setup(configForTest(), [], true, [worktree]);
  const missing = structuredClone(view.initialSnapshot);
  missing.repos[0].changes = [];
  await view.snapshot(missing);
  expect(text()).toContain("This change is no longer in the repository");
  expect(root.querySelector('[role="tab"]')!.textContent).toBe("Console");
  expect(root.querySelectorAll("select")).toHaveLength(0);
});

test("saving while running changes only the saved choice, with no start, resume or terminal connection", async () => {
  const records = [record("minimum")];
  const before = structuredClone(records);
  const effects: string[] = [];
  api.openSession = async () => { effects.push("start"); throw new Error("unexpected start"); };
  api.resumeSession = async () => { effects.push("resume"); throw new Error("unexpected resume"); };
  api.openTerminal = () => { effects.push("terminal"); throw new Error("unexpected terminal"); };
  api.setChangePermissionProfile = async () => {
    const saved = configForTest();
    saved.repos[0].agentOverrides!.one.permissionProfile = "less-friction";
    return saved;
  };
  const view = await setup(configForTest(), records);
  await view.choose("less-friction");
  expect(text()).toContain("The running session uses Minimum; the next session start uses Less friction.");
  expect(records).toEqual(before);
  expect(effects).toEqual([]);
});

test("demo setting and clearing preserve other overrides/settings and never change sessions", async () => {
  const demo = createDemoApi({ latencyMs: 0, now: () => Date.parse("2026-11-10T12:00:00Z") });
  const initial = await demo.config();
  const state = await demo.state();
  const repo = state.repos.find((r) => r.changes.some((c) => !c.archived))!;
  const name = repo.changes.find((c) => !c.archived)!.name;
  const configured = structuredClone(initial);
  configured.repos.find((r) => r.id === repo.id)!.agentOverrides = { [name]: { agentId: "demo-agent" }, another: { permissionProfile: "less-friction" } };
  configured.agentSessions.defaultPermissionProfile = "less-friction";
  const before = await demo.saveConfig(configured, revisionOf(initial));
  const sessions = await demo.sessions();
  const overridden = await demo.setChangePermissionProfile(repo.id, name, "full-automation");
  expect(overridden.repos.find((r) => r.id === repo.id)!.agentOverrides?.[name]?.permissionProfile).toBe("full-automation");
  const cleared = await demo.setChangePermissionProfile(repo.id, name, null);
  expect(cleared).toEqual(before);
  expect(await demo.sessions()).toEqual(sessions);
});
