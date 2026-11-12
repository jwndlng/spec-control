// How a project's own settings are stored and when they apply — shared by the per-setting routes and the setup wizard.
import { expect, test } from "bun:test";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { CODEX_PROFILE } from "../src/shared/agentDefaults.ts";
import { settingApplies, withAutoFetch, withPrTitleConvention, withRepoAgent } from "../src/shared/repoSettings.ts";
import type { Config } from "../src/shared/types.ts";

const repo = () => newRepoConfig("/w/acme/demo-ops", true);

test("agent settings start from enabled, and Off and the default agent are the absence of their key", () => {
  expect(withRepoAgent(repo(), { autoMergeDocs: true }).agent).toEqual({ enabled: true, autoMergeDocs: true });
  const set = withRepoAgent(repo(), { enabled: false, agentId: "codex", autoMergeDocs: true });
  expect(set.agent).toEqual({ enabled: false, agentId: "codex", autoMergeDocs: true });
  expect(withRepoAgent(set, { agentId: null, autoMergeDocs: false }).agent).toEqual({ enabled: false });
});

test("project command lists replace atomically and clear to absence", () => {
  const original = { ...repo(), agent: { enabled: true, agentId: "codex", allowedCommands: ["bun run old"] } };
  expect(withRepoAgent(original, { allowedCommands: ["bun run lint"] }).agent).toEqual({ enabled: true, agentId: "codex", allowedCommands: ["bun run lint"] });
  expect(withRepoAgent(original, { allowedCommands: [] }).agent).toEqual({ enabled: true, agentId: "codex" });
  expect(withRepoAgent(original, { allowedCommands: null }).agent).toEqual({ enabled: true, agentId: "codex" });
  expect(withRepoAgent(original, {}).agent).toEqual(original.agent);
});

test("no convention removes the key", () => {
  const set = withPrTitleConvention(repo(), "conventional-commits");
  expect(set.prTitleConvention).toBe("conventional-commits");
  expect("prTitleConvention" in withPrTitleConvention(set, null)).toBe(false);
});

test("every minute removes the key, Off is saved", () => {
  expect(withAutoFetch(repo(), 0).autoFetchSeconds).toBe(0);
  expect(withAutoFetch(repo(), 300).autoFetchSeconds).toBe(300);
  expect("autoFetchSeconds" in withAutoFetch({ ...repo(), autoFetchSeconds: 0 }, 60)).toBe(false);
});

test("settings apply under the dialog's rules", () => {
  const one: Config = { ...defaultConfig(), agentSessions: { ...defaultConfig().agentSessions, enabled: true } };
  const two: Config = { ...one, agentSessions: { ...one.agentSessions, agents: [...one.agentSessions.agents, CODEX_PROFILE] } };
  const r = repo();
  expect(settingApplies("agent", r, one, true)).toBe(false);
  expect(settingApplies("agent", r, two, true)).toBe(true);
  expect(settingApplies("agent", withRepoAgent(r, { enabled: false }), two, true)).toBe(false);
  expect(settingApplies("autoMergeDocs", r, two, true)).toBe(true);
  expect(settingApplies("autoMergeDocs", r, two, false)).toBe(false);
  expect(settingApplies("prTitles", r, two, false)).toBe(false);
  expect(settingApplies("autoFetch", r, two, true)).toBe(true);
  expect(settingApplies("agentSessions", r, two, false)).toBe(true);
});
