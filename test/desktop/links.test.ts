import { expect, test } from "bun:test";
import { eventUrl, externalTarget, navigationEvent, navigationRules, newWindowTarget, REPEAT_WINDOW_MS, shouldOpen, windowForPort } from "../../desktop/src/logic/links.ts";

test("the server's own origin stays in the window", () => {
  expect(externalTarget("http://127.0.0.1:4711/", 4711)).toEqual({ kind: "internal" });
  expect(externalTarget("http://127.0.0.1:4711/repos/demo-ops?x=1#y", 4711)).toEqual({ kind: "internal" });
});

test("another loopback port or host name is another origin and goes to the browser", () => {
  expect(externalTarget("http://127.0.0.1:4712/", 4711)).toEqual({ kind: "external", url: "http://127.0.0.1:4712/" });
  expect(externalTarget("http://localhost:4711/", 4711)).toEqual({ kind: "external", url: "http://localhost:4711/" });
});

test("web and mail links go to the default browser", () => {
  expect(externalTarget("https://github.com/acme/demo-ops/pull/7", 4711)).toEqual({ kind: "external", url: "https://github.com/acme/demo-ops/pull/7" });
  expect(externalTarget("mailto:someone@example.com", 4711)).toEqual({ kind: "external", url: "mailto:someone@example.com" });
});

test("file, script, custom schemes and garbage are dropped", () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "vscode://file/w/acme", "x-apple.systempreferences:", "data:text/html,hi", "not a url", ""]) {
    expect(externalTarget(url, 4711)).toEqual({ kind: "drop" });
  }
});

test("the navigation rules block everything but the server's origin, last match winning", () => {
  expect(navigationRules(4711)).toEqual(["^*", "http://127.0.0.1:4711/*"]);
});

// The payloads Electrobun 2.0.2 delivers to `webview.on(...)`, as its main-process SDK builds them (design.md, Context).
const PR = "https://github.com/acme/demo-ops/pull/7";
const blocked = { detail: JSON.stringify({ url: PR, allowed: false }) };
const allowed = { detail: JSON.stringify({ url: "http://127.0.0.1:4711/repos/demo-ops", allowed: true }) };
const newWindow = { detail: { url: PR, isCmdClick: false, modifierFlags: 0 } };
const didNavigate = { detail: "http://127.0.0.1:4711/repos/demo-ops" };

test("a blocked will-navigate, whose detail is a JSON string, reports its URL and allowed: false", () => {
  expect(navigationEvent(blocked)).toEqual({ url: PR, allowed: false });
  expect(eventUrl(blocked)).toBe(PR);
});

test("an allowed will-navigate is not reported as blocked", () => {
  expect(navigationEvent(allowed)).toEqual({ url: "http://127.0.0.1:4711/repos/demo-ops", allowed: true });
});

test("new-window-open, already parsed, and did-navigate, a plain URL, report a URL and no allowed flag", () => {
  expect(navigationEvent(newWindow)).toEqual({ url: PR });
  expect(navigationEvent({ detail: JSON.stringify({ url: PR, isCmdClick: true }) })).toEqual({ url: PR });
  expect(navigationEvent(didNavigate)).toEqual({ url: "http://127.0.0.1:4711/repos/demo-ops" });
});

test("an event's URL is found in the shapes Electrobun sends", () => {
  expect(eventUrl("https://github.com/")).toBe("https://github.com/");
  expect(eventUrl({ url: "https://github.com/", allowed: false })).toBe("https://github.com/");
  expect(eventUrl({ detail: JSON.stringify({ url: "https://github.com/", isCmdClick: false }) })).toBe("https://github.com/");
  expect(eventUrl({ detail: "https://github.com/" })).toBe("https://github.com/");
  expect(eventUrl(undefined)).toBeUndefined();
  expect(eventUrl({ other: 1 })).toBeUndefined();
  expect(navigationEvent({ detail: { url: 7, allowed: false } })).toBeUndefined();
});

test("one click reported as two events opens the browser once; another URL or a later click opens again", () => {
  expect(shouldOpen(PR, 1000, undefined)).toBe(true);
  expect(shouldOpen(PR, 1000 + REPEAT_WINDOW_MS - 1, { url: PR, at: 1000 })).toBe(false);
  expect(shouldOpen("https://github.com/acme/demo-ops/issues/3", 1001, { url: PR, at: 1000 })).toBe(true);
  expect(shouldOpen(PR, 1000 + REPEAT_WINDOW_MS, { url: PR, at: 1000 })).toBe(true);
});

test("Port changed before Retry: the window moves to the new origin's root, with its rules", () => {
  expect(windowForPort({ windowPort: 4711, port: 4712 })).toEqual({ reload: true, rules: ["^*", "http://127.0.0.1:4712/*"], url: "http://127.0.0.1:4712/" });
  // Judged against the new port, the old origin is another origin and the new one stays in the window.
  expect(externalTarget("http://127.0.0.1:4711/board", 4712)).toEqual({ kind: "external", url: "http://127.0.0.1:4711/board" });
  expect(externalTarget("http://127.0.0.1:4712/board", 4712)).toEqual({ kind: "internal" });
});

test("Same port: Retry keeps the window's page", () => {
  expect(windowForPort({ windowPort: 4711, port: 4711 })).toEqual({ reload: false });
});

test("Same-origin link that asks for a new tab goes to the browser, never into the window", () => {
  expect(newWindowTarget("http://127.0.0.1:4711/repo/demo-ops", 4711)).toEqual({ kind: "external", url: "http://127.0.0.1:4711/repo/demo-ops" });
  expect(newWindowTarget("https://github.com/acme/demo-ops", 4711)).toEqual({ kind: "external", url: "https://github.com/acme/demo-ops" });
  expect(newWindowTarget("javascript:alert(1)", 4711)).toEqual({ kind: "drop" });
  expect(newWindowTarget("not a url", 4711)).toEqual({ kind: "drop" });
});

test("In-window navigation is unchanged: the server's own pages stay in the window", () => {
  expect(externalTarget("http://127.0.0.1:4711/repo/demo-ops/change/rotate-keys", 4711)).toEqual({ kind: "internal" });
});
