import { afterEach, expect, test } from "bun:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { Window } from "happy-dom";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { Config } from "../src/shared/types.ts";
import { CustomCommandsEditor } from "../src/ui/projectSettings.tsx";
import type { Tracking } from "../src/ui/untracked.tsx";

let browser: Window | undefined;
let root: HTMLElement | undefined;
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(async () => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
  else Reflect.deleteProperty(globalThis, "window");
  browser = undefined;
  root = undefined;
});

test("custom command editor adds, validates and removes project prefixes with accessible controls", () => {
  const activeBrowser = new Window();
  browser = activeBrowser;
  Object.defineProperty(globalThis, "document", { configurable: true, value: activeBrowser.document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: activeBrowser });
  root = document.createElement("div");
  const config: Config = { ...defaultConfig(), agentSessions: { ...defaultConfig().agentSessions, enabled: true, defaultPermissionProfile: "less-friction" } };
  const repo = { ...newRepoConfig("/w/demo-ops", true), name: "demo-ops", agent: { enabled: true } };
  const calls: unknown[] = [];
  const tracking = { busy: {}, errors: {}, setAgent: (id: string, patch: unknown) => calls.push({ id, patch }) } as unknown as Tracking;
  render(h(CustomCommandsEditor, { repo, config, tracking }), root);

  const input = root.querySelector<HTMLInputElement>("input")!;
  expect(input.getAttribute("aria-label")).toBe("Custom command prefix for demo-ops");
  input.value = "bun run lint";
  act(() => { input.dispatchEvent(new activeBrowser.Event("input", { bubbles: true }) as unknown as Event); });
  const add = root.querySelector<HTMLButtonElement>('button[aria-label="Add custom command for demo-ops"]')!;
  act(() => { add.click(); });
  expect(calls).toEqual([{ id: repo.id, patch: { allowedCommands: ["bun run lint"] } }]);
  input.value = "bun run test";
  act(() => { input.dispatchEvent(new activeBrowser.Event("input", { bubbles: true }) as unknown as Event); });
  act(() => { input.dispatchEvent(new activeBrowser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event); });
  expect(calls.at(-1)).toEqual({ id: repo.id, patch: { allowedCommands: ["bun run test"] } });

  input.value = "bun run lint; echo unsafe";
  act(() => { input.dispatchEvent(new activeBrowser.Event("input", { bubbles: true }) as unknown as Event); });
  act(() => { add.click(); });
  expect(calls).toHaveLength(2);
  expect(root.querySelector('[role="alert"]')?.textContent).toContain("invalid command prefix");

  const savedRepo = { ...repo, agent: { enabled: true, allowedCommands: ["bun run lint"] } };
  render(h(CustomCommandsEditor, { repo: savedRepo, config, tracking }), root);
  expect(root.textContent).toContain("Claude applies these prefixes on the next start or resume");
  const remove = root.querySelector<HTMLButtonElement>('button[aria-label="Remove bun run lint from demo-ops"]')!;
  act(() => { remove.click(); });
  expect(calls.at(-1)).toEqual({ id: repo.id, patch: { allowedCommands: [] } });

  const minimum = { ...config, agentSessions: { ...config.agentSessions, defaultPermissionProfile: "minimum" as const } };
  render(h(CustomCommandsEditor, { repo: savedRepo, config: minimum, tracking }), root);
  expect(root.textContent).toContain("inactive under the minimum");
  expect(root.querySelector(".custom-command-list")?.textContent).toContain("bun run lint");
  const generic = { ...config, agentSessions: { ...config.agentSessions, defaultAgent: "generic", agents: [{ id: "generic", name: "Generic", command: ["generic"], prompts: {} }] } };
  render(h(CustomCommandsEditor, { repo: savedRepo, config: generic, tracking }), root);
  expect(root.textContent).toContain("does not apply project command prefixes");
  const saving = { ...tracking, busy: { [repo.id]: "agent" } } as Tracking;
  render(h(CustomCommandsEditor, { repo: savedRepo, config, tracking: saving }), root);
  expect(root.querySelector('button[aria-label="Add custom command for demo-ops"]')?.hasAttribute("disabled")).toBe(true);
  expect(root.querySelector('button[aria-label="Remove bun run lint from demo-ops"]')?.hasAttribute("disabled")).toBe(true);
});
