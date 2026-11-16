import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { api } from "../src/ui/api.ts";
import { FileContent, type FileState } from "../src/ui/changeDetail.tsx";
import { renderMarkdown } from "../src/ui/markdown.tsx";

let browser: Window | undefined;
let root: HTMLElement | undefined;
const saved = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame, scan: api.scan };
afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  globalThis.requestAnimationFrame = saved.raf;
  api.scan = saved.scan;
  browser = undefined; root = undefined;
});

test("Mark confirmed is available only for awaiting tasks and prevents duplicate activation", async () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = () => 0;
  root = document.createElement("div");
  const text = "- [x] done\n- [~] verify\n- [ ] open\n";
  const state: FileState = { status: "ok", path: "tasks.md", text };
  let resolve!: () => void;
  const completion = new Promise<void>((r) => { resolve = r; });
  const confirmed: number[] = [];
  await act(() => render(h(FileContent, { state, raw: false, isTasks: true, rendered: renderMarkdown(text), onConfirmTask: async (line) => { confirmed.push(line); await completion; } }), root!));
  const button = root.querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toBe("Mark confirmed");
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes).toHaveLength(3);
  expect(boxes.every((box) => box.disabled)).toBe(true);
  await act(async () => { button.click(); button.click(); await Promise.resolve(); });
  expect(confirmed).toEqual([2]);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Confirming…");
  await act(async () => { resolve(); await completion; });
  expect(button.textContent).toBe("Confirmed");
});

test("the display-only checklist exposes no confirmation action without a handler", () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  root = document.createElement("div");
  const text = "- [~] verify\n";
  render(h(FileContent, { state: { status: "ok", path: "tasks.md", text }, raw: false, isTasks: true, rendered: renderMarkdown(text) }), root);
  expect(root.querySelector("button")).toBeNull();
});

test("a stale confirmation explains the conflict and offers refresh", async () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = () => 0;
  root = document.createElement("div");
  const text = "- [~] verify\n";
  let scans = 0;
  api.scan = async () => { scans += 1; return { started: true }; };
  await act(() => render(h(FileContent, { state: { status: "ok", path: "tasks.md", text }, raw: false, isTasks: true, rendered: renderMarkdown(text), onConfirmTask: async () => { throw new Error("the task file changed; refresh and try again"); } }), root!));
  await act(async () => { root!.querySelector("button")!.click(); await Promise.resolve(); });
  expect(root.querySelector('[role="alert"]')?.textContent).toContain("the task file changed");
  await act(() => { [...root!.querySelectorAll("button")].find((button) => button.textContent === "Refresh")!.click(); });
  expect(scans).toBe(1);
});
