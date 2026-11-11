import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ShipRequest, ShipResult } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";
import { ShipResultDialog } from "../src/ui/shipResultDialog.tsx";

const originalShip = api.shipSession;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let root: HTMLElement;
let browser: Window;
afterEach(() => {
  render(null, root);
  browser.happyDOM.abort();
  api.shipSession = originalShip;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
const result = (patch: Partial<ShipResult> = {}): ShipResult => ({
  id: "s1", repoId: "r1", change: "rotate-keys", shipped: true, submitted: true, autoMerge: false,
  pullRequestState: "created", pullRequestUrl: "https://github.com/acme/demo-ops/pull/42",
  taskSummary: { verified: true, total: 3, done: 1, open: ["Verify CI <script>"], awaiting: ["Sign in on the real device"], truncated: true },
  ...patch,
} as ShipResult);
function Probe() {
  const ui = useSessionUi();
  return <button type="button" onClick={() => void ui.ship("s1")}>Ship</button>;
}
async function setup(currentPreview: ShipPreflight = preview) {
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
      ...(!request.confirmation && !request.finishTasks && !request.confirmAllTasks ? { preflight: currentPreview } : { submitted: true }),
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
  expect([...root!.querySelectorAll("button")].some((button) => button.textContent === "Mark all complete and Ship")).toBe(false);
  expect(document.activeElement?.textContent).toBe("Cancel");
  await click("Cancel");
  expect(calls).toEqual([{}]);
  expect(root.querySelector('[role="alertdialog"]')).toBeNull();
  expect(root.querySelector("a")?.href).toBe(result().pullRequestUrl!);
  expect(root.textContent).toContain("Verify CI <script>");
  expect(root.querySelector("script")).toBeNull();
  expect(root.textContent).toContain("Sign in on the real device");
  expect(root.textContent).toContain("list is shortened");
  expect(document.activeElement?.textContent).toBe("Close");
  await click("Close");
  expect(root.querySelector('[role="dialog"]')).toBeNull();
});

for (const state of ["created", "existing"] as const) {
  test(`the ${state} PR has a direct link and an explicit console follow-up`, async () => {
    setup();
    let reviews = 0;
    await act(async () => { render(<ShipResultDialog result={result({ pullRequestState: state })} close={() => {}} review={() => { reviews++; }} />, root); });
    expect(root.querySelector("a")?.textContent).toContain(state);
    expect(reviews).toBe(0);
    await click("Review feedback or conflicts in console");
    expect(reviews).toBe(1);
    expect(root.textContent).toContain("Ship does not verify checks, complete tasks or merge");
  });
}

test("the Ship menu offers a separate explicit bulk-completion choice for complete task summaries", async () => {
  const eligible = { ...preview, summary: { ...preview.summary, truncated: false } };
  const { calls, click } = await setup(eligible);
  await click("Ship");
  expect(root!.textContent).toContain("only when you have completed and verified all listed work");
  await click("Mark all complete and Ship");
  expect(calls[1]).toEqual({ confirmAllTasks: true, confirmation: "preview-a" });
  expect(root!.querySelector('[role="alertdialog"]')).toBeNull();
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
