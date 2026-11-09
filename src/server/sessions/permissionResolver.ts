import type { AgentPermissionPolicy, AgentPermissionProfileId, Config, RepoConfig } from "../../shared/types.ts";

export function resolvePermissionPolicy(config: Config, repoId: string, changeName?: string): AgentPermissionPolicy {
  const repo: RepoConfig | undefined = config.repos.find((item) => item.id === repoId);
  const profile: AgentPermissionProfileId = (changeName ? repo?.agentOverrides?.[changeName]?.permissionProfile : undefined)
    ?? repo?.agent?.permissionProfile ?? config.agentSessions.defaultPermissionProfile ?? "minimum";
  const full = profile === "full-automation";
  return { profile, allowFileEdits: profile !== "minimum", allowValidation: profile !== "minimum", allowGitWrite: profile !== "minimum", allowPullRequests: profile !== "minimum", allowMerge: full && config.agentSessions.optInMerge === true, allowCleanup: full && config.agentSessions.optInCleanup === true, optInMerge: config.agentSessions.optInMerge === true, optInCleanup: config.agentSessions.optInCleanup === true };
}
