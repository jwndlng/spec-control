import type { AgentAvailability, Config, FrameworkId, RepoConfig } from "../shared/types.ts";
import { projectConsoleUnavailable } from "./sessionState.ts";
import { useSessionUi } from "./sessions.tsx";

export function OpenSpecSetupAction({ repo, config, onClose }: { repo: RepoConfig; config: Config; onClose: () => void }) {
  const ui = useSessionUi();
  const framework = ui.snapshot?.repos.find((r) => r.id === repo.id)?.framework;
  return OpenSpecSetupActionView({
    repo,
    config,
    framework,
    agents: ui.agents,
    onOpen: () => {
      onClose();
      ui.showProjectConsole(repo.id, true);
    },
  });
}

export function OpenSpecSetupActionView({
  repo,
  config,
  framework,
  agents,
  onOpen,
}: {
  repo: RepoConfig;
  config: Config;
  framework?: FrameworkId;
  agents: readonly AgentAvailability[];
  onOpen: () => void;
}) {
  if (!repo.enabled || (framework !== undefined && framework !== "openspec")) return null;
  const reason =
    projectConsoleUnavailable(config, agents, repo.id) ??
    (!config.agentSessions.enabled ? "Agent sessions are off — turn them on in Settings › Agent sessions" : undefined);
  return (
    <div>
      <button type="button" class="btn sm" disabled={!!reason} title={reason} onClick={onOpen}>
        Update OpenSpec setup
      </button>
      <p class="hint">Add tool support such as Codex or refresh generated instructions. The project console's agent works directly in the project folder.</p>
      {reason && <p class="hint">{reason}</p>}
    </div>
  );
}
