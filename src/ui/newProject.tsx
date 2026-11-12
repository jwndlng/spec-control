// New project (project-creation spec): a folder in one of the workspace roots, `git init`, then the agent's
// integration session in it. The dialog only collects the root and the name; the server checks everything again.
import { useMemo, useRef, useState } from "preact/hooks";
import { isProjectName, newProjectUnavailable, type Config } from "../shared/types.ts";
import { api, ApiError } from "./api.ts";
import { focusOnce } from "./focus.ts";
import { IconFolderGit, IconPlus } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { useSessionUi } from "./sessions.tsx";
import { Select } from "./select.tsx";

/** Joins a root and a name for display, without doubling a trailing separator. */
const joined = (root: string, name: string) => `${root.replace(/[\\/]+$/, "")}/${name}`;

/** The **New project** button and its dialog. */
export function NewProjectButton({ config, small = true }: { config: Config | null; small?: boolean }) {
  const ui = useSessionUi();
  const [open, setOpen] = useState(false);
  if (!config) return null;
  return (
    <>
      <NewProjectTrigger off={newProjectUnavailable(config, ui.agents)} small={small} onOpen={() => setOpen(true)} />
      {open && <NewProjectDialog roots={config.scanRoots} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The button itself. Inactive, with the reason as its tooltip and in its accessible name, when `off` gives one. */
export function NewProjectTrigger({ off, small, onOpen }: { off: string | undefined; small: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      class={small ? "btn sm" : "btn"}
      disabled={off !== undefined}
      title={off ? `New project is unavailable: ${off}` : "Create a folder in a workspace root, git init it, and let your agent set up OpenSpec there"}
      aria-label={off ? `New project, unavailable: ${off}` : "New project"}
      onClick={onOpen}
    >
      <IconPlus size={12} /> New project
    </button>
  );
}

export function NewProjectDialog({ roots, onClose }: { roots: string[]; onClose: () => void }) {
  const ui = useSessionUi();
  const [root, setRoot] = useState(roots.length === 1 ? roots[0] : "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  };
  const focusFirst = useMemo(focusOnce, []);
  const [focusRoot] = useState(roots.length > 1);

  const trimmed = name.trim();
  const nameError =
    trimmed === "" ? "required" : isProjectName(trimmed) ? null : "a letter or digit first, then letters, digits, '.', '_' or '-' (not ending in .git)";
  const validRoot = roots.includes(root) ? root : "";
  const canSubmit = nameError === null && validRoot !== "" && !busy;

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { session } = await api.createProject(validRoot, trimmed);
      await ui.refresh();
      setBusy(false);
      onClose();
      ui.showIntegration(session.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      label="New project"
      title="New project"
      subtitle="A new folder with an empty git repository; your agent then sets it up for OpenSpec"
      icon={<IconFolderGit size={18} />}
      onClose={onClose}
      canClose={() => !busyRef.current}
    >
      <form class="new-change" onSubmit={onSubmit} aria-label="New project">
        {roots.length > 1 && (
          <div class="row">
            <div class="new-change-project">
              <span>Workspace root</span>
              <Select class="input" aria-label="Workspace root" value={validRoot} triggerRef={focusRoot ? focusFirst : undefined} onChange={setRoot} options={[{ value: "", label: "Choose a workspace root" }, ...roots.map((root) => ({ value: root, label: root }))]} />
              {validRoot === "" && <span class="hint">choose a workspace root</span>}
            </div>
          </div>
        )}
        <div class="row">
          <label class="new-change-name">
            <span>Folder name</span>
            <input
              class="input"
              type="text"
              value={name}
              placeholder="gamma-tools"
              ref={focusRoot ? undefined : focusFirst}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
            {trimmed !== "" && nameError && <span class="hint danger">{nameError}</span>}
          </label>
        </div>
        <p class="hint">
          Creates <span class="mono">{validRoot ? joined(validRoot, trimmed || "<name>") : "<workspace root>/<name>"}</span> and runs{" "}
          <span class="mono">git init</span> in it — nothing else, no commit and no remote. Your default agent then starts in that folder to run{" "}
          <span class="mono">openspec init</span>; once <span class="mono">openspec/config.yaml</span> exists, the project is tracked.
        </p>
        {error && <div class="notice danger">{error}</div>}
        <div class="row actions">
          <button type="submit" class="btn primary" disabled={!canSubmit}>
            {busy ? "Creating…" : "Create project"}
          </button>
          <button type="button" class="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
