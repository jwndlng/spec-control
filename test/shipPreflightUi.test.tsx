import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { ShipPreflight, ShipRequest, ShipResult } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";
import { ShipResultDialog } from "../src/ui/shipResultDialog.tsx";

const originalShip = api.shipSession;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let root: HTMLElement;
let browser: Window;
const preview: ShipPreflight = {
  token: "preview-a",
  summary: { verified: true, total: 3, done: 1, open: ["Run checks"], awaiting: ["Sign in on the real device"], truncated: false },
};

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
    return request.confirmation || request.finishTasks || request.confirmAllTasks
      ? result()
      : { ...result({ shipped: false, pullRequestUrl: undefined }), preflight: currentPreview };
  };
  await act(async () => {
    render(<SessionProvider config={null}><Probe /></SessionProvider>, root);
  });
  return { calls };
}

async function click(text: string) {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("Ship preflight lists unresolved tasks and cancel does not continue shipping", async () => {
  const { calls } = await setup();
  await click("Ship");
  expect(root.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(root.textContent).toContain("Run checks");
  expect(root.textContent).toContain("Sign in on the real device");
  await click("Cancel");
  expect(calls).toEqual([{}]);
  expect(root.querySelector('[role="alertdialog"]')).toBeNull();
});

for (const state of ["created", "existing"] as const) {
  test(`the ${state} PR has a direct link and an explicit console follow-up`, async () => {
    await setup();
    let reviews = 0;
    await act(async () => { render(<ShipResultDialog result={result({ pullRequestState: state })} close={() => {}} review={() => { reviews++; }} />, root); });
    expect(root.querySelector("a")?.textContent).toContain(state);
    expect(reviews).toBe(0);
    await click("Review feedback or conflicts in console");
    expect(reviews).toBe(1);
    expect(root.textContent).toContain("Ship does not verify checks, complete tasks or merge");
  });
}

test("the Ship menu offers a separate explicit bulk-completion choice", async () => {
  const eligible = { ...preview, summary: { ...preview.summary, truncated: false } };
  const { calls } = await setup(eligible);
  await click("Ship");
  expect(root.textContent).toContain("only when you have completed and verified all listed work");
  await click("Mark all complete and Ship");
  expect(calls[1]).toEqual({ confirmAllTasks: true, confirmation: "preview-a" });
  expect(root.querySelector('[role="alertdialog"]')).toBeNull();
});

test("a changed confirmation preview stays open for review; Escape sends nothing further", async () => {
  const { calls } = await setup();
  const first = api.shipSession;
  api.shipSession = async (id, request) => {
    const response = await first(id, request);
    return request?.confirmation
      ? { ...response, submitted: false, preflight: { ...preview, token: "changed", summary: { ...preview.summary, open: ["A changed check"] } } }
      : response;
  };
  await click("Ship");
  await click("Ship anyway");
  expect(root.textContent).toContain("A changed check");
  await act(async () => {
    document.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  });
  expect(calls).toHaveLength(2);
  expect(root.querySelector('[role="alertdialog"]')).toBeNull();
});
