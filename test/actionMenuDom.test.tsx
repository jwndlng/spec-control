import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { api } from "../src/ui/api.ts";
import { ChangeCard, type Card } from "../src/ui/kanban.tsx";
import { SessionProvider } from "../src/ui/sessions.tsx";
import { fakeProfile } from "./sessionHelpers.ts";

const repo = newRepoConfig("/w/acme/demo-ops", true);
const base = defaultConfig();
const config = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile()], defaultAgent: "fake" } };
const card: Card = {
  repoId: repo.id, name: "rotate-keys", repoName: "demo", repoPath: repo.path, hue: 0,
  schema: "spec-driven", stage: "ready", column: "Ready", tasks: null, artifacts: [
    { id: "proposal", status: "done", required: true },
    { id: "tasks", status: "done", required: true },
    { id: "design", status: "ready", required: false },
  ],
};
const originalSessions = api.sessions;
const originalOpen = api.openSession;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalRaf = globalThis.requestAnimationFrame;
let root: HTMLElement | undefined;
let browser: Window | undefined;

afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  api.sessions = originalSessions;
  api.openSession = originalOpen;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  root = undefined;
  browser = undefined;
});

async function setup() {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  root = document.createElement("div");
  document.body.appendChild(root);
  const calls: string[] = [];
  api.sessions = async () => ({ sessions: [], agents: [], presets: [], worktrees: [] });
  api.openSession = async (_repo, _change, action) => { calls.push(action); return { id: "session" } as Awaited<ReturnType<typeof api.openSession>>; };
  await act(() => render(<SessionProvider config={config}><main data-board="open"><ChangeCard card={card} now={Date.now()} from="/board" /></main></SessionProvider>, root!));
  const arrow = root.querySelector<HTMLButtonElement>(".split-arrow");
  expect(arrow).not.toBeNull();
  return { arrow: arrow!, calls, root, browser, flushFrames: () => { for (const frame of frames.splice(0)) frame(0); } };
}

test("a card's arrow opens its menu and starts only the selected action without leaving the board", async () => {
  const { arrow, calls, root, browser } = await setup();
  await act(() => arrow.click());
  const menu = root.querySelector<HTMLElement>('[role="menu"]');
  expect(menu).not.toBeNull();
  expect(arrow.getAttribute("aria-expanded")).toBe("true");
  expect(arrow.getAttribute("aria-controls")).toBe(menu!.id);
  expect(menu!.getAttribute("aria-label")).toBe("More actions for rotate-keys");
  const item = menu!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(item.textContent).toBe("Draft artifacts");
  await act(() => item.click());
  expect(calls).toEqual(["draft"]);
  expect(root.querySelector('[role="menu"]')).toBeNull();
  expect(root.querySelector('[data-board="open"]')).not.toBeNull();
  expect(browser.location.pathname).toBe("/board");
});

test("keyboard, focus, outside click and scroll keep the menu accessible and dismissible", async () => {
  const { arrow, root, browser, flushFrames } = await setup();
  const key = async (target: HTMLElement, value: string) => {
    await act(() => { target.dispatchEvent(new browser.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }) as unknown as Event); });
  };
  expect(arrow.getAttribute("aria-haspopup")).toBe("menu");
  await key(arrow, "ArrowDown");
  let item = root.querySelector<HTMLElement>('[role="menuitem"]')!;
  expect(item).not.toBeNull();
  expect(item.tabIndex).toBe(0);
  flushFrames();
  expect(document.activeElement).toBe(item);
  await key(item, "Escape");
  expect(root.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(arrow);
  await act(() => arrow.click());
  await act(() => { document.body.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true }) as unknown as Event); });
  expect(root.querySelector('[role="menu"]')).toBeNull();
  await act(() => arrow.click());
  await act(() => { browser.dispatchEvent(new browser.Event("scroll")); });
  expect(root.querySelector('[role="menu"]')).toBeNull();
  await act(() => arrow.click());
  item = root.querySelector<HTMLElement>('[role="menuitem"]')!;
  await key(item, "Tab");
  expect(root.querySelector('[role="menu"]')).toBeNull();
});
