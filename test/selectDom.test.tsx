import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Modal } from "../src/ui/modal.tsx";
import { dismissActiveSelect, Select, type SelectOption } from "../src/ui/select.tsx";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
let browser: Window | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
  root = undefined;
  browser = undefined;
});

async function setup(options: SelectOption[], value = "", onChange = (_value: string) => {}) {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(() => render(<form><Select aria-label="Choice" options={options} value={value} onChange={onChange} /></form>, root!));
  return { root, browser, trigger: root.querySelector<HTMLButtonElement>(".shared-select")! };
}

async function key(target: HTMLElement, browser: Window, value: string, shiftKey = false) {
  await act(() => { target.dispatchEvent(new browser.KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }) as unknown as Event); });
}

test("a labelled trigger opens a controlled listbox; empty values are real choices and same-value commits do not callback", async () => {
  const calls: string[] = [];
  const { trigger, root, browser } = await setup([{ value: "", label: "Choose one" }, { value: "a", label: "Alpha" }], "", (value) => { calls.push(value); });
  expect(trigger.type).toBe("button");
  expect(trigger.getAttribute("aria-label")).toBe("Choice");
  let submits = 0;
  root.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); submits++; });
  await act(() => trigger.click());
  const listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  expect(listbox).not.toBeNull();
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-0");
  await act(() => listbox.querySelector<HTMLElement>("[role=option]")!.click());
  expect(calls).toEqual([]);
  expect(submits).toBe(0);
  expect(root.querySelector("[role=listbox]")).toBeNull();
  await act(() => render(<form><Select aria-label="Choice" options={[{ value: "", label: "Choose one" }, { value: "a", label: "Alpha" }]} value="a" onChange={(value) => { calls.push(value); }} /></form>, root));
  expect(root.querySelector(".shared-select")?.textContent).toContain("Alpha");
  expect(browser).toBeDefined();
});

test("keyboard navigation skips disabled choices and commits once; Escape restores focus without changing", async () => {
  const calls: string[] = [];
  const { trigger, root, browser } = await setup([
    { value: "a", label: "Alpha" }, { value: "x", label: "Unavailable", disabled: true }, { value: "b", label: "Beta" },
  ], "a", (value) => { calls.push(value); });
  await key(trigger, browser, "ArrowDown");
  let listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser, "ArrowDown");
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-2");
  await key(listbox, browser, "Enter");
  expect(calls).toEqual(["b"]);
  expect(document.activeElement).toBe(trigger);
  await act(() => trigger.click());
  listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser, "Escape");
  expect(calls).toEqual(["b"]);
  expect(root.querySelector("[role=listbox]")).toBeNull();
});

test("Home, End, Space, type-ahead and Tab traversal work without submitting a form", async () => {
  const calls: string[] = [];
  const { trigger, root, browser } = await setup([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }], "a", (value) => { calls.push(value); });
  const before = document.createElement("button");
  const after = document.createElement("button");
  before.textContent = "Before";
  after.textContent = "After";
  trigger.before(before);
  trigger.after(after);
  let submits = 0;
  root.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); submits++; });
  await key(trigger, browser, "ArrowDown");
  let listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser, "End");
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-2");
  await key(listbox, browser, "Home");
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-0");
  await key(listbox, browser, "g");
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-2");
  expect(document.querySelectorAll("[role=option]")).toHaveLength(3);
  await key(listbox, browser, " ");
  expect(calls).toEqual(["c"]);
  expect(document.activeElement).toBe(trigger);
  expect(submits).toBe(0);

  await act(() => trigger.click());
  listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser, "Tab");
  expect(document.activeElement).toBe(after);
  await act(() => trigger.click());
  listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser, "Tab", true);
  expect(document.activeElement).toBe(before);
});

test("long lists search locally, announce no matches, and do not commit while filtering", async () => {
  const calls: string[] = [];
  const options = Array.from({ length: 8 }, (_, index) => ({ value: String(index), label: `Choice ${index}` }));
  const { trigger, root } = await setup(options, "0", (value) => { calls.push(value); });
  await act(() => trigger.click());
  const search = document.querySelector<HTMLInputElement>(".select-search")!;
  await act(() => { search.value = "missing"; search.dispatchEvent(new browser!.Event("input", { bubbles: true }) as unknown as Event); });
  expect(document.querySelector("[role=status]")?.textContent).toBe("No options found");
  await key(search, browser!, "Enter");
  expect(calls).toEqual([]);
  expect(root.querySelector(".shared-select")?.textContent).toContain("Choice 0");
  await act(() => { document.body.dispatchEvent(new browser!.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event); });
  expect(document.querySelector(".select-popup")).toBeNull();
});

test("search keeps caller order, matches case-insensitively, and clears when the picker closes", async () => {
  const options = ["alpha", "Beta", "ALPINE", "delta", "echo", "foxtrot", "golf", "hotel"].map((label) => ({ value: label, label }));
  const calls: string[] = [];
  const { trigger, browser } = await setup(options, "delta", (value) => { calls.push(value); });
  await act(() => trigger.click());
  let search = document.querySelector<HTMLInputElement>(".select-search")!;
  await act(() => { search.value = "al"; search.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event); });
  expect([...document.querySelectorAll("[role=option]")].map((option) => option.textContent)).toEqual(["alpha", "ALPINE"]);
  await key(search, browser, "Enter");
  expect(calls).toEqual(["alpha"]);
  await act(() => trigger.click());
  search = document.querySelector<HTMLInputElement>(".select-search")!;
  expect(search.value).toBe("");
});

test("a list with no enabled choices cannot commit and has no active descendant", async () => {
  const calls: string[] = [];
  const { trigger, browser } = await setup([{ value: "a", label: "A", disabled: true }, { value: "b", label: "B", disabled: true }], "a", (value) => { calls.push(value); });
  await act(() => trigger.click());
  const listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
  await key(listbox, browser, "Enter");
  expect(calls).toEqual([]);
});

test("an active choice is reconciled when its option disappears while the list is open", async () => {
  const original = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }];
  const { trigger, root } = await setup(original, "b");
  await act(() => trigger.click());
  const listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
  await key(listbox, browser!, "ArrowDown");
  expect(listbox.getAttribute("aria-activedescendant")).toContain("option-2");
  await act(() => render(<form><Select aria-label="Choice" options={[original[0]!, original[1]!]} value="b" onChange={() => {}} /></form>, root!));
  const updated = document.querySelector<HTMLElement>("[role=listbox]")!;
  expect(updated.getAttribute("aria-activedescendant")).toContain("option-1");
  expect(updated.querySelector("[aria-selected=true]")?.id).toContain("option-1");
});

test("Tab from a long-list search moves past the trigger only once", async () => {
  const options = Array.from({ length: 8 }, (_, index) => ({ value: String(index), label: `Choice ${index}` }));
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(() => render(<form><button type="button">Before</button><Select aria-label="Choice" options={options} value="0" onChange={() => {}} /><button type="button">After</button></form>, root!));
  const trigger = root.querySelector<HTMLButtonElement>(".shared-select")!;
  const after = [...root.querySelectorAll<HTMLButtonElement>("button")].at(-1)!;
  await act(() => trigger.click());
  await key(document.querySelector<HTMLInputElement>(".select-search")!, browser, "Tab");
  expect(document.activeElement).toBe(after);
});

test("a modal gives the open dropdown the first Escape and handles the next one itself", async () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  root = document.createElement("div");
  document.body.appendChild(root);
  let closed = 0;
  await act(() => render(<Modal label="Dialog" title="Dialog" onClose={() => { closed++; }}><Select aria-label="Choice" options={[{ value: "a", label: "Alpha" }]} value="a" onChange={() => {}} /></Modal>, root!));
  const trigger = root.querySelector<HTMLButtonElement>(".shared-select")!;
  await act(() => trigger.click());
  expect(document.querySelector(".select-popup")?.parentElement?.getAttribute("role")).toBe("dialog");
  await key(document.querySelector<HTMLElement>("[role=listbox]")!, browser, "Escape");
  expect(root.querySelector(".select-popup")).toBeNull();
  expect(dismissActiveSelect()).toBe(false);
  expect(closed).toBe(0);
  await key(trigger, browser, "Escape");
  expect(closed).toBe(1);
});

test("the popup is viewport-clamped, opens above when space below is short, and tracks its anchor", async () => {
  const { trigger, browser } = await setup([{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]);
  Object.defineProperty(browser, "innerWidth", { configurable: true, value: 320 });
  Object.defineProperty(browser, "innerHeight", { configurable: true, value: 240 });
  let top = 190;
  trigger.getBoundingClientRect = () => ({ x: 250, y: top, left: 250, top, right: 300, bottom: top + 30, width: 50, height: 30, toJSON: () => ({}) }) as DOMRect;
  await act(() => trigger.click());
  let popup = document.querySelector<HTMLElement>(".select-popup")!;
  expect(popup.parentElement).toBe(document.body);
  expect(Number.parseFloat(popup.style.left)).toBeLessThanOrEqual(312 - Number.parseFloat(popup.style.width));
  expect(popup.style.bottom).toBe("54px");
  top = 30;
  await act(() => { browser!.dispatchEvent(new browser!.Event("scroll") as never); });
  popup = document.querySelector<HTMLElement>(".select-popup")!;
  expect(popup.style.top).toBe("64px");
  top = 250;
  await act(() => { browser!.dispatchEvent(new browser!.Event("scroll") as never); });
  expect(document.querySelector(".select-popup")).toBeNull();
  expect(dismissActiveSelect()).toBe(false);
});

test("opening another dropdown closes the first; outside dismissal leaves outside focus alone", async () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(() => render(<form><Select aria-label="First" options={[{ value: "a", label: "Alpha" }]} value="a" onChange={() => {}} /><Select aria-label="Second" options={[{ value: "b", label: "Beta" }]} value="b" onChange={() => {}} /></form>, root!));
  const [first, second] = [...root.querySelectorAll<HTMLButtonElement>(".shared-select")];
  await act(() => first.click());
  expect(first.getAttribute("aria-expanded")).toBe("true");
  await act(() => second.click());
  expect(first.getAttribute("aria-expanded")).toBe("false");
  expect(second.getAttribute("aria-expanded")).toBe("true");
  expect([...document.querySelectorAll(".select-option")].map((option) => option.textContent)).toEqual(["Beta✓"]);
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  outside.focus();
  await act(() => { outside.dispatchEvent(new browser!.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event); });
  expect(document.activeElement).toBe(outside);
  expect(document.querySelector(".select-popup")).toBeNull();
  outside.remove();
});

test("option pointer selection stays inside the picker, scrolling stays open, and unmount releases ownership", async () => {
  browser = new Window({ url: "http://localhost/" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  root = document.createElement("div");
  document.body.appendChild(root);
  let rowActivations = 0;
  let changes = 0;
  await act(() => render(<div data-testid="row"><Select aria-label="Choice" options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} value="a" onChange={() => { changes++; }} /></div>, root!));
  root.querySelector("[data-testid=row]")?.addEventListener("click", () => { rowActivations++; });
  const trigger = root.querySelector<HTMLButtonElement>(".shared-select")!;
  await act(() => trigger.click());
  const list = document.querySelector<HTMLElement>(".select-options")!;
  await act(() => { list.dispatchEvent(new browser!.Event("scroll", { bubbles: true }) as unknown as Event); });
  expect(document.querySelector(".select-popup")).not.toBeNull();
  await act(() => document.querySelector<HTMLElement>("[role=option]")!.click());
  expect(changes).toBe(0);
  expect(rowActivations).toBe(0);
  expect(dismissActiveSelect()).toBe(false);
  await act(() => render(null, root!));
  expect(dismissActiveSelect()).toBe(false);
});
