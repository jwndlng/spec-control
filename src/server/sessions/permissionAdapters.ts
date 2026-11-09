import type { AdapterResult, AgentPermissionPolicy, AgentProfile } from "../../shared/types.ts";
import { PROTECTED_COMMANDS } from "./protectedCommands.ts";

export interface AgentPermissionAdapter { id: string; preview(agent: AgentProfile, policy: AgentPermissionPolicy): AdapterResult }
const protectedNotes = ["Protected commands always require interactive confirmation."];
const mergeCommands = ["Bash(gh pr merge *)", "Bash(git merge *)"];
const cleanupCommands = ["Bash(git worktree remove *)", "Bash(git branch -D *)", "Bash(git worktree prune*)"];
const gatedCommands = (policy: AgentPermissionPolicy) => [
  ...(!policy.allowMerge ? mergeCommands : []),
  ...(!policy.allowCleanup ? cleanupCommands : []),
];
export class ClaudeAdapter implements AgentPermissionAdapter {
  id = "claude";
  preview(_agent: AgentProfile, p: AgentPermissionPolicy): AdapterResult {
    const mode = p.profile === "minimum" ? "plan" : p.profile === "less-friction" ? "acceptEdits" : "auto";
    const args = ["--permission-mode", mode];
    if (p.profile !== "minimum") args.push("--allowed-tools", "Bash(git status*)", "Bash(git diff*)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push origin *)", "Bash(gh pr *)", "Bash(bun run check*)", "Bash(npm test*)", "--disallowed-tools", ...PROTECTED_COMMANDS, ...gatedCommands(p));
    return { args, limitations: [...protectedNotes] };
  }
}
export class CodexAdapter implements AgentPermissionAdapter {
  id = "codex";
  preview(_agent: AgentProfile, p: AgentPermissionPolicy): AdapterResult { return { args: ["--sandbox", p.profile === "minimum" ? "read-only" : "workspace-write", "--ask-for-approval", "on-request"], limitations: ["Codex applies a workspace sandbox rather than command-level filtering; approval stays on-request so protected commands cannot be auto-approved.", ...protectedNotes] }; }
}
export class AntigravityAdapter implements AgentPermissionAdapter {
  id = "agy";
  preview(_agent: AgentProfile, p: AgentPermissionPolicy): AdapterResult {
    const deny = [...PROTECTED_COMMANDS, ...gatedCommands(p)].map((pattern) => `command(regex:${patternToRegex(pattern.replace(/^Bash\((.*)\)$/, "$1"))})`);
    return {
      args: ["--mode", p.profile === "minimum" ? "plan" : p.profile === "less-friction" ? "accept-edits" : "auto", "--sandbox"],
      limitations: [...protectedNotes, "Antigravity CLI has no documented per-session settings-file flag; fine-grained permissions require its settings.json."],
      settings: { permissions: { allow: p.profile === "minimum" ? [] : ["command(git status)", "command(git diff)", "command(git add)", "command(git commit)", "command(gh pr)"], deny } },
    };
  }
}
function patternToRegex(pattern: string): string {
  return `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}`;
}
export class GenericAdapter implements AgentPermissionAdapter {
  id = "generic";
  preview(): AdapterResult { return { args: [], limitations: ["Unrecognized agent; no permission flags are injected."] }; }
}
export class PermissionAdapterRegistry {
  private readonly adapters = new Map<string, AgentPermissionAdapter>();
  constructor(adapters: AgentPermissionAdapter[] = [new ClaudeAdapter(), new CodexAdapter(), new AntigravityAdapter()]) { for (const adapter of adapters) this.adapters.set(adapter.id, adapter); }
  resolve(id: string): AgentPermissionAdapter { return this.adapters.get(id) ?? new GenericAdapter(); }
}
export const permissionAdapters = new PermissionAdapterRegistry();
