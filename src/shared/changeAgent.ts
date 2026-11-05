import type { AgentProfile, Config, RepoConfig } from "./types.ts";

/** The configured profile for a change: its override, then the repository choice, then the default. */
export function changeAgentId(config: Config, repo: RepoConfig, change: string): string {
  return repo.agent?.changeAgents?.[change] ?? repo.agent?.agentId ?? config.agentSessions.defaultAgent;
}

export function changeAgentFor(config: Config, repo: RepoConfig, change: string): AgentProfile | undefined {
  const id = changeAgentId(config, repo, change);
  return config.agentSessions.agents.find((agent) => agent.id === id);
}
