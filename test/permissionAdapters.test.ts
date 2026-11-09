import { describe, expect, it } from "bun:test";
import { permissionAdapters } from "../src/server/sessions/permissionAdapters.ts";
import type { AgentPermissionPolicy, AgentProfile } from "../src/shared/types.ts";
const agent = (id: string): AgentProfile => ({ id, name: id, command: [id], prompts: {} });
const policy = (profile: AgentPermissionPolicy["profile"]): AgentPermissionPolicy => ({ profile, allowFileEdits: profile !== "minimum", allowValidation: profile !== "minimum", allowGitWrite: profile !== "minimum", allowPullRequests: profile !== "minimum", allowMerge: false, allowCleanup: false, optInMerge: false, optInCleanup: false });
describe("permission adapters", () => {
  it("resolves known adapters and leaves unknown agents untouched", () => {
    const claudeArgs = permissionAdapters.resolve("claude").preview(agent("claude"), policy("less-friction")).args;
    expect(claudeArgs).toContain("acceptEdits");
    expect(claudeArgs).toContain("--allowed-tools");
    expect(claudeArgs).toContain("--disallowed-tools");
    expect(claudeArgs).toContain("rm -rf*");
    expect(claudeArgs).toContain("git push *--force*");
    expect(claudeArgs).toContain("Bash(gh pr merge *)");
    expect(claudeArgs).toContain("Bash(git worktree remove *)");
    expect(permissionAdapters.resolve("codex").preview(agent("codex"), policy("minimum")).args).toEqual(["--sandbox", "read-only", "--ask-for-approval", "on-request"]);
    expect(permissionAdapters.resolve("agy").preview(agent("agy"), policy("full-automation")).args).toContain("auto");
    const antigravitySettings = permissionAdapters.resolve("agy").preview(agent("agy"), policy("full-automation")).settings;
    expect(antigravitySettings?.permissions).toMatchObject({ deny: expect.arrayContaining(["command(regex:^gh pr merge .*)", "command(regex:^git branch -D .*)"]) });
    expect(permissionAdapters.resolve("unknown").preview(agent("unknown"), policy("full-automation")).args).toEqual([]);
  });
});
