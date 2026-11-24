import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { WorktreePath } from "../src/ui/changeDetail.tsx";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
let browser: Window | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  root = undefined;
  browser = undefined;
});

async function setup(writeText: (text: string) => Promise<void>) {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText } } });
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(() => render(<WorktreePath path="/w/acme/api" />, root!));
}

test("copy icon writes exactly the absolute path and announces success only after clipboard resolves", async () => {
  const writes: string[] = [];
  await setup(async (path) => { writes.push(path); });
  const button = root!.querySelector<HTMLButtonElement>('button[aria-label="Copy worktree path /w/acme/api"]')!;
  expect(button).toBeDefined();
  button.focus();
  expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(writes).toEqual(["/w/acme/api"]);
  expect(root!.querySelector<HTMLButtonElement>('button[aria-label="Copied"]')).toBeDefined();
});

test("clipboard failure does not announce a successful copy", async () => {
  await setup(async () => { throw new Error("clipboard refused"); });
  const button = root!.querySelector<HTMLButtonElement>('button[aria-label="Copy worktree path /w/acme/api"]')!;
  await act(async () => button.click());
  expect(root!.querySelector<HTMLButtonElement>('button[aria-label="Copy worktree path /w/acme/api"]')).toBeDefined();
  expect(root!.querySelector('[aria-live="polite"]')?.textContent).toBe("");
});
