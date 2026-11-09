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
});
