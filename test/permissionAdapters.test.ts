import { describe, expect, it } from "bun:test";
import { permissionAdapters } from "../src/server/sessions/permissionAdapters.ts";
import type { AgentPermissionPolicy, AgentProfile } from "../src/shared/types.ts";
const agent = (id: string): AgentProfile => ({ id, name: id, command: [id], prompts: {} });
const policy = (profile: AgentPermissionPolicy["profile"], allowedCommands: string[] = []): AgentPermissionPolicy => ({ profile, allowFileEdits: profile !== "minimum", allowValidation: profile !== "minimum", allowGitWrite: profile !== "minimum", allowPullRequests: profile !== "minimum", allowMerge: false, allowCleanup: false, optInMerge: false, optInCleanup: false, allowedCommands });
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
    expect(permissionAdapters.resolve("codex").preview(agent("codex"), policy("less-friction", ["bun run lint"])).args).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]);
    expect(permissionAdapters.resolve("agy").preview(agent("agy"), policy("full-automation")).args).toContain("auto");
    expect(permissionAdapters.resolve("agy").preview(agent("agy"), policy("less-friction", ["bun run lint"])).args).toEqual(["--mode", "accept-edits", "--sandbox"]);
    const antigravitySettings = permissionAdapters.resolve("agy").preview(agent("agy"), policy("full-automation")).settings;
    expect(antigravitySettings?.permissions).toMatchObject({ deny: expect.arrayContaining(["command(regex:^gh pr merge .*)", "command(regex:^git branch -D .*)"]) });
    expect(permissionAdapters.resolve("unknown").preview(agent("unknown"), policy("full-automation")).args).toEqual([]);
  });

  it("adds exact and trailing-argument Claude rules only outside minimum and reports unsupported runtimes", () => {
    const custom = policy("less-friction", ["bun run lint"]);
    const claude = permissionAdapters.resolve("claude").preview(agent("claude"), custom);
    expect(claude.args).toContain("Bash(bun run lint)");
    expect(claude.args).toContain("Bash(bun run lint *)");
    const minimum = permissionAdapters.resolve("claude").preview(agent("claude"), { ...custom, profile: "minimum" });
    expect(minimum.args).not.toContain("Bash(bun run lint)");
    expect(minimum.limitations.join(" ")).toContain("inactive");
    expect(permissionAdapters.resolve("codex").preview(agent("codex"), custom).limitations.join(" ")).toContain("not applied");
    expect(permissionAdapters.resolve("agy").preview(agent("agy"), custom).limitations.join(" ")).toContain("not applied");
    expect(permissionAdapters.resolve("unknown").preview(agent("unknown"), custom).limitations.join(" ")).toContain("not applied");
  });
});
