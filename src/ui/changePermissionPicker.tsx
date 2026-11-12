import { useEffect, useRef, useState } from "preact/hooks";
import type { AgentPermissionProfileId } from "../shared/types.ts";
import { api } from "./api.ts";
import { Select } from "./select.tsx";
import { useSessionUi } from "./sessions.tsx";

export const permissionLabel: Record<AgentPermissionProfileId, string> = {
  minimum: "Minimum",
  "less-friction": "Less friction",
  "full-automation": "Full automation",
};

/** Mounted with the repository/change as its key; feedback never follows navigation. */
export function ChangePermissionPicker({ repoId, changeName }: { repoId: string; changeName: string }) {
  const ui = useSessionUi();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const config = ui.config;
  const repo = config?.repos.find((r) => r.id === repoId);
  if (!config || !repo) return null;
  const inherited = repo.agent?.permissionProfile ?? config.agentSessions.defaultPermissionProfile ?? "minimum";
  const selected = repo.agentOverrides?.[changeName]?.permissionProfile ?? "";
  const effective = selected || inherited;
  const running = ui.sessions.find((s) => s.repoId === repoId && s.change === changeName && s.state === "running");
  const active = running?.permissionProfile;
  const save = async (value: string) => {
    if (pending.current) return;
    pending.current = true;
    setStatus("Saving…");
    setError(undefined);
    try {
      const saved = await api.setChangePermissionProfile(repoId, changeName, value ? value as AgentPermissionProfileId : null);
      ui.saveConfig(saved);
      if (mounted.current) setStatus("Saved");
    } catch (err) {
      if (mounted.current) {
        setStatus("");
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      pending.current = false;
    }
  };
  return <div class="detail-permission-picker">
    <span>Permission profile for this change</span>
    <Select aria-label="Permission profile for this change" value={selected} disabled={status === "Saving…"} onChange={(value) => void save(value)} options={[
      { value: "", label: `Inherit from project (${permissionLabel[inherited]})` },
      ...Object.entries(permissionLabel).map(([value, label]) => ({ value, label })),
    ]} />
    <p class="hint">Applies only to this change, on the next session start.</p>
    <span role="status">{status}</span>
    {error && <span class="notice danger" role="alert">{error}</span>}
    {active && active !== effective && <p class="hint">The running session uses {permissionLabel[active]}; the next session start uses {permissionLabel[effective]}.</p>}
  </div>;
}
