import { describe, expect, it } from "bun:test";
import { resolvePermissionPolicy } from "../src/server/sessions/permissionResolver.ts";
import { defaultAgentSessions } from "../src/shared/agentDefaults.ts";
import type { Config } from "../src/shared/types.ts";

const config = (overrides: Partial<Config> = {}): Config => ({ version: 1, scanRoots: [], ignorePaths: [], repos: [{ id: "123456789abc", path: "/tmp/repo", name: "repo", enabled: true, agent: { enabled: true } }], pollIntervalSeconds: 60, port: 4711, agentSessions: defaultAgentSessions(), ...overrides });
describe("resolvePermissionPolicy", () => {
  it("uses the hierarchy change, repository, global, minimum", () => {
    const c = config({ agentSessions: { ...defaultAgentSessions(), defaultPermissionProfile: "less-friction" }, repos: [{ id: "123456789abc", path: "/tmp/repo", name: "repo", enabled: true, agent: { enabled: true, permissionProfile: "full-automation" }, agentOverrides: { change: { permissionProfile: "minimum" } } }] });
    expect(resolvePermissionPolicy(c, "123456789abc", "change").profile).toBe("minimum");
    expect(resolvePermissionPolicy(c, "123456789abc", "other").profile).toBe("full-automation");
    expect(resolvePermissionPolicy(config(), "missing").profile).toBe("minimum");
  });
  it("resolves command allowances only from their project, independent of change overrides", () => {
    const c = config({ repos: [
      { id: "123456789abc", path: "/tmp/repo", name: "repo", enabled: true, agent: { enabled: true, allowedCommands: ["bun run lint"] }, agentOverrides: { change: { permissionProfile: "minimum" } } },
      { id: "abcdef123456", path: "/tmp/other", name: "other", enabled: true, agent: { enabled: true } },
    ] });
    expect(resolvePermissionPolicy(c, "123456789abc", "change").allowedCommands).toEqual(["bun run lint"]);
    expect(resolvePermissionPolicy(c, "abcdef123456").allowedCommands).toEqual([]);
    expect(resolvePermissionPolicy(config(), "123456789abc").allowedCommands).toEqual([]);
  });
});
