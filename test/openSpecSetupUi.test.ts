import { expect, test } from "bun:test";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { FrameworkId } from "../src/shared/types.ts";
import { OpenSpecSetupActionView } from "../src/ui/openSpecSetup.tsx";
import { OpenSpecSetupGuidance, OPENSPEC_SETUP_REQUEST } from "../src/ui/projectConsole.tsx";
import { Copy } from "../src/ui/sessionPanel.tsx";
import { byComponent, byTag, textOf } from "./vnode.ts";

const repo = newRepoConfig("/w/acme/demo-ops", true);
const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } };

test("setup is OpenSpec-only and explains direct edits and unavailable consoles", () => {
  const render = (patch = config, framework?: FrameworkId) =>
    OpenSpecSetupActionView({ repo: patch.repos[0], config: patch, framework, agents: [], onOpen: () => {} });
  expect(textOf(render())).toContain("Codex");
  expect(textOf(render())).toContain("directly in the project folder");
  expect(render(config, "other" as FrameworkId)).toBeNull();
  const off = render({ ...config, agentSessions: { ...config.agentSessions, enabled: false } });
  expect(byTag(off, "button")[0].props.disabled).toBe(true);
  expect(textOf(off)).toContain("Agent sessions are off");
  const excluded = render({ ...config, repos: [{ ...repo, agent: { enabled: false } }] });
  expect(textOf(excluded)).toContain("off for this project");
  const agent = config.agentSessions.agents.find((a) => a.id === config.agentSessions.defaultAgent)!;
  const missing = OpenSpecSetupActionView({ repo, config, agents: [{ id: agent.id, name: agent.name, available: false }], onOpen: () => {} });
  expect(byTag(missing, "button")[0].props.disabled).toBe(true);
  expect(textOf(missing)).toContain("was not found");
});

test("opening is explicit and the request is passed only to the clipboard control", () => {
  let opened = 0;
  const action = OpenSpecSetupActionView({
    repo,
    config,
    agents: [],
    onOpen: () => {
      opened++;
    },
  });
  expect(opened).toBe(0);
  (byTag(action, "button")[0].props.onClick as () => void)();
  expect(opened).toBe(1);
  const guidance = OpenSpecSetupGuidance();
  expect(byComponent(guidance, Copy)[0].props).toMatchObject({ text: OPENSPEC_SETUP_REQUEST, label: "Copy setup request" });
  expect(textOf(guidance)).toContain("Nothing is sent automatically");
  expect(OPENSPEC_SETUP_REQUEST).toContain("Preserve all existing configured tools and project content");
  expect(OPENSPEC_SETUP_REQUEST).toContain("Ask me which tools");
});

test("setup uses the existing console without introducing a submission or project write path", async () => {
  const source = await Bun.file(new URL("../src/ui/openSpecSetup.tsx", import.meta.url)).text();
  expect(source).toContain("ui.showProjectConsole(repo.id, true)");
  expect(source).not.toContain("api.");
  const consoleSource = await Bun.file(new URL("../src/ui/projectConsole.tsx", import.meta.url)).text();
  expect(consoleSource).toContain("projectConsoleToShow(project?.sessions ?? [], shownId)");
  expect(consoleSource).toContain("api.openProjectConsole(repoId)");
  expect(consoleSource).not.toContain("promptSession");
  expect(consoleSource).not.toContain("writeFile");
});

test("demo opens a new project console and preserves it when opened again", async () => {
  const { createDemoApi } = await import("../src/ui/demo/demoApi.ts");
  const api = createDemoApi({ latencyMs: 0 });
  const demoConfig = await api.config();
  const project = demoConfig.repos.find((r) => r.enabled && r.agent?.enabled !== false)!;
  const first = await api.openProjectConsole(project.id);
  const second = await api.openProjectConsole(project.id);
  expect(second.id).toBe(first.id);
  expect(first.worktreePath).toBe(project.path);
  expect(first.state).toBe("running");
  await api.closeSession(first.id, false);
});

test("copying the setup request writes the exact text and confirms after copying", async () => {
  const { Window } = await import("happy-dom");
  const { render, h } = await import("preact");
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied: string | undefined;
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  });
  const host = window.document.createElement("div");
  try {
    render(h(OpenSpecSetupGuidance, {}), host as unknown as HTMLElement);
    expect(copied).toBeUndefined();
    host.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(copied).toBe(OPENSPEC_SETUP_REQUEST);
    expect(host.querySelector("button")!.textContent).toBe("Copied");
  } finally {
    render(null, host as unknown as HTMLElement);
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    await window.happyDOM.close();
  }
});
