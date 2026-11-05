import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { api } from "../src/ui/api.ts";
import { type Card } from "../src/ui/kanban.tsx";
import { SessionControls, SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";
import type { ChangeSession, PullRequest, SessionWorktree } from "../src/shared/types.ts";
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

const running: ChangeSession = {
  id: "archive-session", repoId: repo.id, change: card.name, action: "archive", agentId: "fake", agentName: "Fake",
  state: "running", worktreePath: "/w/archive", branch: "chore/archive-rotate-keys", createdAt: "2026-11-04", updatedAt: "2026-11-04", resumable: true,
};
const merged = { state: "merged" } as PullRequest;
let ending: string | undefined;
function ObserveEnd() {
  ending = useSessionUi().endingId;
  return null;
}
async function setup(options: { archived?: boolean; session?: ChangeSession; pr?: PullRequest; worktrees?: SessionWorktree[]; enabled?: boolean; excluded?: boolean; place?: "card" | "console" } = {}) {
  browser = new Window({ url: "http://localhost/board" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  root = document.createElement("div");
  document.body.appendChild(root);
  ending = undefined;
  api.sessions = async () => ({ sessions: [options.session ?? running], agents: [], presets: [], worktrees: options.worktrees ?? [] });
  const settings = { ...config, repos: [{ ...repo, agent: { ...repo.agent, enabled: !options.excluded } }], agentSessions: { ...config.agentSessions, enabled: options.enabled !== false } };
  const change = { ...card, archived: options.archived === false ? undefined : "2026-11-04" };
  await act(() => render(<SessionProvider config={settings}><SessionControls card={change} place={options.place ?? "card"} pullRequest={options.pr} /><ObserveEnd /></SessionProvider>, root!));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "End session");
}

test("archived merged PR opens confirmation for the running session without ending it", async () => {
  const button = await setup({ pr: merged });
  expect(button).toBeDefined();
  expect(ending).toBeUndefined();
  await act(() => button!.click());
  expect(ending).toBe(running.id);
  expect(browser!.location.pathname).toBe("/board");
});

test("the session's own merged worktree offers End session without PR metadata", async () => {
  expect(await setup({ worktrees: [{ repoId: repo.id, name: card.name, change: card.name, action: "archive", path: running.worktreePath, work: { state: "merged", base: "main" } }] })).toBeDefined();
});

for (const [name, options] of Object.entries({
  active: { archived: false, pr: merged },
  unmerged: { pr: { state: "open" } as PullRequest },
  unknown: {},
  ended: { session: { ...running, state: "exited" as const }, pr: merged },
  autoEnded: { session: { ...running, autoEnded: { pr: 58, at: "2026-11-04", removed: false } }, pr: merged },
  disabled: { enabled: false, pr: merged },
  excluded: { excluded: true, pr: merged },
  console: { place: "console" as const, pr: merged },
  otherWorktree: { worktrees: [{ repoId: repo.id, name: card.name, change: card.name, action: "archive" as const, path: "/w/other", work: { state: "merged" as const, base: "main" } }] },
})) {
  test(`no card End session for ${name}`, async () => {
    expect(await setup(options)).toBeUndefined();
  });
}
