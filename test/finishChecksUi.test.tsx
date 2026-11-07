import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { ChangeSnapshot, PullRequestsResponse, Snapshot } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { FinishChecks } from "../src/ui/finishChecks.tsx";
import { PullRequestsProvider } from "../src/ui/pullRequests.tsx";
import { SessionProvider } from "../src/ui/sessions.tsx";
import { fakeProfile } from "./sessionHelpers.ts";

const original = {
  sessions: api.sessions,
  pullRequests: api.pullRequests,
  finishChecks: api.finishChecks,
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  history: globalThis.history,
  dispatchEvent: globalThis.dispatchEvent,
  PopStateEvent: globalThis.PopStateEvent,
};
let browser: Window;
let root: HTMLElement;
afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  api.sessions = original.sessions;
  api.pullRequests = original.pullRequests;
  api.finishChecks = original.finishChecks;
  globalThis.window = original.window;
  globalThis.document = original.document;
  globalThis.location = original.location;
  globalThis.history = original.history;
  globalThis.dispatchEvent = original.dispatchEvent;
  globalThis.PopStateEvent = original.PopStateEvent;
});

async function setup(state: "merged" | "closed" = "merged") {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  globalThis.location = browser.location as unknown as Location;
  globalThis.history = browser.history as unknown as History;
  globalThis.dispatchEvent = browser.dispatchEvent.bind(browser) as unknown as typeof dispatchEvent;
  globalThis.PopStateEvent = browser.PopStateEvent as unknown as typeof PopStateEvent;
  root = document.createElement("div");
  document.body.appendChild(root);
  const repo = newRepoConfig("/w/acme/demo-ops", true);
  const base = defaultConfig();
  const config = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile()], defaultAgent: "fake" } };
  const card = {
    repoId: repo.id,
    name: "rotate-keys",
    schema: "spec-driven",
    stage: "implementing",
    column: "Implementing",
    tasks: { done: 1, total: 2 },
    artifacts: [],
  } as ChangeSnapshot;
  const snapshot = { repos: [{ id: repo.id, ok: true, changes: [card] }] } as Snapshot;
  api.sessions = async () => ({ sessions: [], agents: [], presets: [], worktrees: [] });
  api.pullRequests = async () =>
    ({
      repos: [
        {
          repoId: repo.id,
          status: "failed",
          fetchedAt: "2026-11-01T10:00:00Z",
          pullRequests: [{ number: 42, head: "feat/rotate-keys", base: "main", state, isCrossRepository: false }],
        },
      ],
    }) as PullRequestsResponse;
  const calls: string[] = [];
  api.finishChecks = async (id, change) => {
    calls.push(`${id}:${change}`);
    throw Error("Another worktree owns this branch; end its session first.");
  };
  await act(async () => {
    render(
      <PullRequestsProvider>
        <SessionProvider config={config} snapshot={snapshot}>
          <FinishChecks card={card} />
        </SessionProvider>
      </PullRequestsProvider>,
      root,
    );
  });
  return { calls };
}

test("Finish checks is named accessibly, explains cache freshness, guards clicks and reports actionable refusals", async () => {
  const { calls } = await setup();
  const button = root.querySelector("button")!;
  expect(button.textContent).toBe("Finish checks");
  expect(button.title).toContain("2026-11-01T10:00:00Z");
  expect(root.textContent).toContain("latest refresh failed");
  await act(async () => {
    button.click();
    button.click();
  });
  expect(calls).toHaveLength(1);
  expect(root.querySelector('[role="status"]')?.textContent).toContain("end its session first");
});

test("closed-unmerged PRs do not offer Finish checks", async () => {
  await setup("closed");
  expect(root.querySelector("button")).toBeNull();
});


test("Finish checks opens the returned session in the change's Console tab", async () => {
  await setup();
  api.finishChecks = async (repoId, change) => ({ id: "follow-up", repoId, change, submitted: true } as Awaited<ReturnType<typeof api.finishChecks>>);
  await act(async () => { root.querySelector("button")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(location.pathname).toContain("rotate-keys");
  expect(location.search).toContain("console");
  expect(location.search).toContain("follow-up");
});
