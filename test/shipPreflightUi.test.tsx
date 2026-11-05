import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ShipPreflight, ShipRequest, ShipResult } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";

const originalShip = api.shipSession;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let root: HTMLElement | undefined;
let browser: Window | undefined;
afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  api.shipSession = originalShip;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
const preview: ShipPreflight = {
  token: "preview-a",
  summary: { verified: true, total: 3, done: 1, open: ["Verify CI <script>"], awaiting: ["Sign in on the real device"], truncated: true },
};
function Probe() {
  const ui = useSessionUi();
  return (
    <button type="button" onClick={() => void ui.ship("s1")}>
      Ship
    </button>
  );
}
async function setup() {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  root = document.createElement("div");
  document.body.appendChild(root);
  const calls: ShipRequest[] = [];
  api.shipSession = async (_id, request = {}) => {
    calls.push(request);
    return {
      id: "s1",
      submitted: false,
      autoMerge: false,
      ...(!request.confirmation && !request.finishTasks ? { preflight: preview } : { submitted: true }),
    } as ShipResult;
  };
  await act(async () => {
    render(
      <SessionProvider config={null}>
        <Probe />
      </SessionProvider>,
      root!,
    );
  });
  const click = async (text: string) => {
    const button = [...root!.querySelectorAll("button")].find((b) => b.textContent === text)!;
    expect(button).toBeDefined();
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { calls, click };
}

test("Ship dialog renders readable tasks as text, focuses Cancel, and cancels without shipping", async () => {
  const { calls, click } = await setup();
  await click("Ship");
  expect(root!.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(root!.textContent).toContain("Verify CI <script>");
  expect(root!.querySelector("script")).toBeNull();
  expect(root!.textContent).toContain("Sign in on the real device");
  expect(root!.textContent).toContain("list is shortened");
  expect(document.activeElement?.textContent).toBe("Cancel");
  await click("Cancel");
  expect(calls).toEqual([{}]);
  expect(root!.querySelector('[role="alertdialog"]')).toBeNull();
});

test("Finish tasks and Ship anyway send distinct explicit requests; double-click sends once", async () => {
  const { calls, click } = await setup();
  await act(async () => {
    const button = root!.querySelector("button")!;
    button.click();
    button.click();
  });
  expect(calls).toEqual([{}]);
  await click("Finish tasks");
  expect(calls).toEqual([{}, { finishTasks: true }]);
  await click("Ship");
  await click("Ship anyway");
  expect(calls[3]).toEqual({ confirmation: "preview-a" });
});

test("a changed confirmation preview stays open for review; Escape sends nothing further", async () => {
  const { calls, click } = await setup();
  const first = api.shipSession;
  api.shipSession = async (id, request) => {
    const result = await first(id, request);
    return request?.confirmation
      ? { ...result, submitted: false, preflight: { ...preview, token: "changed", summary: { ...preview.summary, open: ["A changed check"] } } }
      : result;
  };
  await click("Ship");
  await click("Ship anyway");
  expect(root!.textContent).toContain("A changed check");
  await act(async () => {
    document.dispatchEvent(new browser!.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  });
  expect(calls).toHaveLength(2);
  expect(root!.querySelector('[role="alertdialog"]')).toBeNull();
});
