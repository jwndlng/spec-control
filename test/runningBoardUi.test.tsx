import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { ChangeSession, ChangeSnapshot, Snapshot } from "../src/shared/types.ts";
import { api } from "../src/ui/api.ts";
import { Kanban } from "../src/ui/kanban.tsx";
import { backTarget, parseDetailQuery } from "../src/ui/routes.ts";
import { SessionProvider, useSessionUi } from "../src/ui/sessions.tsx";
import { href, navigateUrl, setRoutingMode } from "../src/ui/url.ts";

const originals = {
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  history: globalThis.history,
  sessions: api.sessions,
};
let browser: Window;
let root: HTMLElement;
afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  Object.assign(globalThis, { window: originals.window, document: originals.document, location: originals.location, history: originals.history });
  api.sessions = originals.sessions;
  setRoutingMode("path");
});

for (const mode of ["path", "hash"] as const) {
  for (const single of [false, true]) {
    test(`running board updates, reloads, returns and clears in ${mode} routing, single=${single}`, async () => {
      const repoConfig = newRepoConfig("/w/acme/demo-ops", true);
      const route = single ? `/repo/${repoConfig.id}` : "/board";
      browser = new Window({ url: `http://localhost${navigateUrl({ pathname: "/demo/index.html" }, route, mode, "?layout=stack")}` });
      Object.assign(globalThis, { window: browser, document: browser.document, location: browser.location, history: browser.history });
      setRoutingMode(mode);
      root = document.createElement("div");
      document.body.appendChild(root);
      const change = (name: string, archived = false): ChangeSnapshot => ({
        repoId: repoConfig.id,
        name,
        schema: "spec-driven",
        artifacts: [],
        tasks: { done: 1, total: 1 },
        stage: archived ? "archived" : "done",
        column: archived ? "Archived" : "Done",
        lastActivityAt: "2020-01-01T00:00:00Z",
        ...(archived ? { archived: "2020-01-01", checkout: { path: repoConfig.path, isMain: true } } : {}),
      });
      const changes = [change("rotate-keys"), change("idle-one"), ...Array.from({ length: 27 }, (_, i) => change(`archive-${i}`, true))];
      const snapshot: Snapshot = {
        generatedAt: "2026-11-10T12:00:00Z",
        repos: [{ ...repoConfig, name: "demo-ops", ok: true, scannedAt: "2026-11-10T12:00:00Z", changes, isGit: true, worktrees: [] }],
      };
      const base = defaultConfig();
      let enabled = true;
      let sessions: ChangeSession[] = [];
      let reads = 0;
      api.sessions = async () => {
        reads++;
        return { sessions, agents: [], presets: [], worktrees: [] };
      };
      let refresh = async () => {};
      function Probe() {
        refresh = useSessionUi().refresh;
        return null;
      }
      const mount = async () => {
        await act(async () =>
          render(
            <SessionProvider config={{ ...base, repos: [repoConfig], agentSessions: { ...base.agentSessions, enabled } }} snapshot={snapshot}>
              <Probe />
              <Kanban snapshot={snapshot} config={null} repoId={single ? repoConfig.id : undefined} />
            </SessionProvider>,
            root,
          ),
        );
      };
      const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.trim() === text)!;
      const count = () => root.querySelectorAll("article.card").length;
      await mount();
      expect(count()).toBe(2);
      const beforeToggle = reads;
      await act(() => button("Show running").click());
      expect(reads).toBe(beforeToggle);
      expect(browser.location.search).toContain("running=1");
      expect(count()).toBe(0);
      expect(button("Show running").getAttribute("aria-checked")).toBe("true");
      const live = (name: string): ChangeSession => ({
        id: name,
        repoId: repoConfig.id,
        change: name,
        action: name.startsWith("archive") ? "archive" : "implement",
        agentId: "fake",
        agentName: "Fake",
        state: "running",
        worktreePath: "/w/fake/worktree",
        createdAt: "2026-11-10T10:00:00Z",
        updatedAt: "2026-11-10T10:00:00Z",
        resumable: false,
      });
      sessions = [live("rotate-keys")];
      await act(() => refresh());
      expect(count()).toBe(1);
      expect(root.querySelector(".showing")?.textContent).toContain("1 change");
      // A real rendered card's detail link carries the board and all filters back in either routing mode.
      const link = [...root.querySelectorAll<HTMLAnchorElement>("article.card a")].find((a) => a.getAttribute("href")?.includes("from="))!;
      expect(link).toBeDefined();
      const detail = new URL(link.href, browser.location.href);
      const back = backTarget(parseDetailQuery(detail.search).from, repoConfig.id);
      expect(back).toEqual({ path: route, query: "?running=1&layout=stack" });
      expect(href(back.path, mode, back.query)).toContain(mode === "hash" ? `#${route}` : route);
      await act(() => render(null, root));
      await mount();
      expect(count()).toBe(1);
      expect(button("Show running").getAttribute("aria-checked")).toBe("true");
      sessions = [{ ...live("rotate-keys"), state: "exited" }];
      await act(() => refresh());
      expect(count()).toBe(0);
      sessions = [live("rotate-keys"), ...changes.filter((c) => c.archived).map((c) => live(c.name))];
      await act(() => refresh());
      if (!single) {
        const collapsed = root.querySelector<HTMLButtonElement>('.repo-group button[aria-expanded="false"]');
        expect(collapsed).not.toBeNull();
        await act(() => collapsed!.click());
      }
      expect([...root.querySelectorAll(".stat")].find((el) => el.textContent?.includes("To archive"))?.textContent).toContain("2");
      expect([...root.querySelectorAll(".stat")].find((el) => el.textContent?.includes("Open"))?.textContent).toContain("1");
      expect(count()).toBe(26); // 1 active plus the existing archive bound of 25.
      expect(root.querySelector(".showing")?.textContent).toContain("26 changes");
      expect(root.textContent).toContain("25 of 27");
      await act(() => button("Hide archived").click());
      expect(count()).toBe(1);
      await act(() => button("Clear filters").click());
      expect(browser.location.search).toBe("?layout=stack");
      expect(count()).toBe(27); // Both active cards plus bounded archives retained by their running sessions.
      // Reload a saved running filter with sessions disabled: no session request, switch and clear still work.
      await act(() => render(null, root));
      browser.history.replaceState(null, "", navigateUrl({ pathname: "/demo/index.html" }, route, mode, "?running=1&layout=stack"));
      enabled = false;
      const beforeDisabled = reads;
      await mount();
      expect(reads).toBe(beforeDisabled);
      expect(count()).toBe(0);
      await act(() => button("Show running").click());
      expect(browser.location.search).toBe("?layout=stack");
      expect(count()).toBe(2);
    });
  }
}
