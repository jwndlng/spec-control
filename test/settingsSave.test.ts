import { expect, test } from "bun:test";
import { defaultConfig } from "../src/server/config.ts";
import { rebaseDraft } from "../src/ui/settings.tsx";

const base = { ...defaultConfig(), scanRoots: ["/w/acme"], ignorePaths: [] };
const repo = { id: "0123456789ab", path: "/w/acme/demo-ops", name: "demo-ops", enabled: true };

test("a clone tracked while Settings was open stays tracked, and the edit is saved without asking", () => {
  const draft = { ...base, pollIntervalSeconds: 120 };
  const current = { ...base, repos: [repo] };
  const { config, conflicts } = rebaseDraft(draft, base, current);
  expect(conflicts).toEqual([]);
  expect(config).toEqual({ ...current, pollIntervalSeconds: 120 });
});

test("an ignore path added from the overview survives an edit of another setting", () => {
  const draft = { ...base, pollIntervalSeconds: 120 };
  const current = { ...base, ignorePaths: ["/w/acme/mirror"] };
  const { config, conflicts } = rebaseDraft(draft, base, current);
  expect(conflicts).toEqual([]);
  expect(config.ignorePaths).toEqual(["/w/acme/mirror"]);
  expect(config.pollIntervalSeconds).toBe(120);
});

test("a label colour chosen meanwhile survives, and one removed meanwhile stays removed", () => {
  const draft = { ...base, scanRoots: ["/w/acme", "/w/beta"] };
  expect(rebaseDraft(draft, base, { ...base, labelColors: { client: 290 } }).config.labelColors).toEqual({ client: 290 });
  const coloured = { ...base, labelColors: { client: 290 } };
  const { config, conflicts } = rebaseDraft({ ...coloured, scanRoots: ["/w/acme", "/w/beta"] }, coloured, base);
  expect(conflicts).toEqual([]);
  expect("labelColors" in config).toBe(false);
  expect(config.scanRoots).toEqual(["/w/acme", "/w/beta"]);
});

test("the same setting changed in two tabs is a conflict; the user's value is shown over the newer one", () => {
  const draft = { ...base, pollIntervalSeconds: 120 };
  const current = { ...base, pollIntervalSeconds: 90, ignorePaths: ["/w/acme/mirror"] };
  const { config, conflicts } = rebaseDraft(draft, base, current);
  expect(conflicts).toEqual(["pollIntervalSeconds"]);
  expect(config.pollIntervalSeconds).toBe(120);
  expect(config.ignorePaths).toEqual(["/w/acme/mirror"]);
  // Saving the rebased draft against the newer config again: nothing left to decide.
  expect(rebaseDraft(config, current, current).conflicts).toEqual([]);
  // Both tabs chose the same value: nothing to decide either.
  expect(rebaseDraft(draft, base, { ...base, pollIntervalSeconds: 120 }).conflicts).toEqual([]);
});

test("Agent sessions is compared as a whole, so an edit there and a fast-forward-warning change elsewhere conflict", () => {
  const draft = { ...base, agentSessions: { ...base.agentSessions, enabled: true } };
  const current = { ...base, agentSessions: { ...base.agentSessions, confirmFastForward: false } };
  expect(rebaseDraft(draft, base, current).conflicts).toEqual(["agentSessions"]);
  // Untouched in the draft: the newer value is taken without a conflict.
  const { config, conflicts } = rebaseDraft({ ...base, pollIntervalSeconds: 90 }, base, current);
  expect(conflicts).toEqual([]);
  expect(config.agentSessions.confirmFastForward).toBe(false);
});

test("setup stays the server's and the key order of nested objects does not count as an edit", () => {
  const reordered = { ...base, agentSessions: Object.fromEntries(Object.entries(base.agentSessions).reverse()) as typeof base.agentSessions };
  const { config, conflicts } = rebaseDraft(reordered, base, { ...base, setup: "pending" as const, agentSessions: { ...base.agentSessions, confirmFastForward: false } });
  expect(conflicts).toEqual([]);
  expect(config.setup).toBe("pending");
  expect(config.agentSessions.confirmFastForward).toBe(false);
});
