// How a project's own settings are stored (project-overview: "Each managed project carries its own settings"), and
// which of them apply to a project. Shared by the server's per-setting routes and the setup wizard's Project settings
// step, so a value is stored the same way whichever of them saved it: a default is the absence of its key.
import { type AgentPermissionProfileId, type AutoFetchSeconds, type Config, DEFAULT_AUTO_FETCH_SECONDS, type PrTitleConvention, type RepoConfig, repoAgentEnabled } from "./types.ts";

/** A change to a project's agent settings; `agentId: null` means the default agent. */
export interface RepoAgentPatch {
  enabled?: boolean;
  agentId?: string | null;
  autoMergeDocs?: boolean;
  permissionProfile?: AgentPermissionProfileId | null;
}

/** A repository without agent settings is included (`repoAgentEnabled`), so the first change starts from `{ enabled: true }`. */
export function withRepoAgent(repo: RepoConfig, patch: RepoAgentPatch): RepoConfig {
  const agent: NonNullable<RepoConfig["agent"]> = { enabled: true, ...repo.agent };
  if (typeof patch.enabled === "boolean") agent.enabled = patch.enabled;
  if (patch.agentId === null) delete agent.agentId;
  else if (typeof patch.agentId === "string") agent.agentId = patch.agentId;
  // Off is the absence of the key, so a configuration never carries `autoMergeDocs: false`.
  if (patch.autoMergeDocs === true) agent.autoMergeDocs = true;
  else if (patch.autoMergeDocs === false) delete agent.autoMergeDocs;
  if (patch.permissionProfile === null) delete agent.permissionProfile;
  else if (patch.permissionProfile !== undefined) agent.permissionProfile = patch.permissionProfile;
  return { ...repo, agent };
}

/** `conventional-commits` sets the convention; `null` removes the key. */
export function withPrTitleConvention({ prTitleConvention: _old, ...repo }: RepoConfig, convention: PrTitleConvention | null): RepoConfig {
  return convention ? { ...repo, prTitleConvention: convention } : repo;
}

/** An offered interval sets it, `0` saves Off, and the default (every minute) removes the key. */
export function withAutoFetch({ autoFetchSeconds: _old, ...repo }: RepoConfig, seconds: AutoFetchSeconds | 0): RepoConfig {
  return seconds === DEFAULT_AUTO_FETCH_SECONDS ? repo : { ...repo, autoFetchSeconds: seconds };
}

/** The five settings of a project's settings dialog, in its order. */
export const PROJECT_SETTINGS = ["agentSessions", "agent", "prTitles", "autoMergeDocs", "autoFetch"] as const;
export type ProjectSetting = (typeof PROJECT_SETTINGS)[number];

/**
 * Whether the settings dialog shows `setting` for `repo`: Agent with a choice to make and sessions on for the project,
 * Docs auto-merge only where Ship exists (git, the project's sessions enabled), PR titles and Auto fetch only for git.
 * `repo` is judged as given, so a caller can pass it with edits not saved yet applied.
 */
export function settingApplies(setting: ProjectSetting, repo: RepoConfig, config: Config, isGit: boolean): boolean {
  switch (setting) {
    case "agentSessions":
      return true;
    case "agent":
      return config.agentSessions.agents.length >= 2 && config.agentSessions.enabled && repoAgentEnabled(repo);
    case "autoMergeDocs":
      return isGit && repoAgentEnabled(repo);
    case "prTitles":
    case "autoFetch":
      return isGit;
  }
}
