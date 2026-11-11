import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ShipRequest, ShipResult } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";
import { ShipResultDialog } from "../src/ui/shipResultDialog.tsx";

const originalShip = api.shipSession;
const originalSessions = api.sessions;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let root: HTMLElement;
let browser: Window;
afterEach(() => {
  render(null, root);
  browser.happyDOM.abort();
  api.shipSession = originalShip;
  api.sessions = originalSessions;
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
  return <button type="button" disabled={ui.shippingIds.has("s1")} onClick={() => void ui.ship("s1")}>{ui.shippingIds.has("s1") ? "Shipping…" : "Ship"}</button>;
}
function setup() {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  root = document.createElement("div");
  document.body.appendChild(root);
}
async function click(text: string) {
  const button = [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => { button.click(); });
}

test("Ship submits once without task confirmation and shows its PR and unresolved tasks as text", async () => {
  setup();
  const calls: ShipRequest[] = [];
  api.shipSession = async (_id, request = {}) => { calls.push(request); return result(); };
  await act(async () => { render(<SessionProvider config={null}><Probe /></SessionProvider>, root); });
  await act(async () => { root.querySelector("button")!.click(); root.querySelector("button")!.click(); });
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

test("Ship acknowledges immediately and blocks another request while the server is working", async () => {
  setup();
  let finish!: (value: ShipResult) => void;
  let calls = 0;
  api.shipSession = async () => { calls++; return new Promise<ShipResult>((resolve) => { finish = resolve; }); };
  api.sessions = async () => ({ sessions: [], agents: [], presets: [], worktrees: [] });
  await act(async () => { render(<SessionProvider config={null}><Probe /></SessionProvider>, root); });
  await act(async () => { root.querySelector("button")!.click(); });
  expect(root.querySelector("button")?.textContent).toBe("Shipping…");
  expect((root.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { root.querySelector("button")!.click(); });
  expect(calls).toBe(1);
  await act(async () => { finish(result()); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(root.querySelector("button")?.textContent).toBe("Ship");
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

test("an unavailable PR and unknown tasks are follow-up, never success", async () => {
  setup();
  await act(async () => { render(<ShipResultDialog result={result({ shipped: false, pullRequestState: "unavailable", pullRequestUrl: undefined, taskSummary: { verified: false, total: 0, done: 0, open: [], awaiting: [], truncated: false } })} close={() => {}} review={() => {}} />, root); });
  expect(root.textContent).toContain("Ship needs follow-up");
  expect(root.textContent).toContain("Task state is unknown");
  expect(root.querySelector("a")).toBeNull();
});
