// The projects overview's Unmanaged projects section: one list of everything the user can bring into the overview —
// disabled repositories, discovered OpenSpec repositories, git repositories without OpenSpec and GitHub clones queued,
// running, failed or cancelled — each labelled with what it is and offered the actions that fit it (Enable, Ignore,
// Integrate; for a clone, Cancel while it is queued or runs and Retry and Dismiss once it failed or was cancelled), each
// saved at once. The view is hook-free so tests can walk it; `useTracking` and `useCloneActions` hold what changes.
import { useState } from "preact/hooks";
import type { AutoFetchSeconds, Config, PrTitleConvention, RepoConfig } from "../shared/types.ts";
import { api, type RepoAgentPatch } from "./api.ts";
import { type CloneActions, CloneRow } from "./cloneRow.tsx";
import { IconEyeOff } from "./icons.tsx";
import type { DiscoveryState } from "./discoveryState.ts";
import type { UntrackedEntry, UntrackedKind } from "./overviewState.ts";
import { useSessionUi } from "./sessions.tsx";

export type { CloneActions } from "./cloneRow.tsx";
import { followInApp, hrefWithQuery } from "./url.ts";

export type TrackingAction = "enable" | "disable" | "ignore" | "integrate" | "forget" | "rename" | "agent" | "labels" | "prTitles" | "autoFetch";

/**
 * The overview's per-repository actions and their state, keyed by repository id: bringing a repository in or out
 * (Enable, Disable, Ignore, Integrate, Forget), a managed project's own settings (name, agent sessions, labels,
 * pull request titles) and which of its dialogs is open.
 * Every one is saved at once.
 */
export interface Tracking {
  busy: Record<string, TrackingAction>;
  errors: Record<string, string>;
  enable(entry: UntrackedEntry): void;
  disable(id: string): void;
  ignore(entry: UntrackedEntry): void;
  integrate(entry: UntrackedEntry): void;
  forget(entry: UntrackedEntry): void;
  /** The project whose name is an input right now; one at a time. */
  renaming?: string;
  startRename(id: string): void;
  cancelRename(): void;
  /** Saves a trimmed, changed name; a blank one is refused in place and an unchanged one closes without a request. */
  rename(id: string, current: string, next: string): void;
  setAgent(id: string, patch: RepoAgentPatch): void;
  setLabels(id: string, patch: Pick<RepoConfig, "labels" | "hiddenLabels">): void;
  setPrTitleConvention(id: string, convention: PrTitleConvention | null): void;
  setAutoFetch(id: string, seconds: AutoFetchSeconds | 0): void;
  /** A label's colour, chosen in the labels dialog of `id` (whose busy and error state it uses) and shared by every repository. */
  setLabelColor(id: string, label: string, hue: number | null): void;
  /** The project whose labels dialog is open. */
  labelsOpen?: string;
  /** Replaces the settings dialog, if one is open, with the labels dialog of `id`. */
  openLabels(id: string): void;
  closeLabels(): void;
  /** The project whose settings dialog is open. */
  settingsOpen?: string;
  openSettings(id: string): void;
  closeSettings(): void;
}

/** Which per-project dialog is open on the overview: at most one of each, and never both. */
export interface OverviewDialogs {
  settingsOpen?: string;
  labelsOpen?: string;
}

export type OverviewDialogEvent =
  | { type: "openSettings" | "openLabels" | "disabled"; id: string }
  | { type: "closeSettings" | "closeLabels" };

/**
 * Labels replaces the settings dialog instead of stacking on it, so two Escape handlers never compete; a project that
 * was disabled closes its settings dialog, so a later Enable does not bring back a stale one.
 */
export function overviewDialogs(state: OverviewDialogs, event: OverviewDialogEvent): OverviewDialogs {
  switch (event.type) {
    case "openSettings":
      return { settingsOpen: event.id };
    case "closeSettings":
      return { ...state, settingsOpen: undefined };
    case "openLabels":
      return { labelsOpen: event.id };
    case "closeLabels":
      return { ...state, labelsOpen: undefined };
    case "disabled":
      return state.settingsOpen === event.id ? { ...state, settingsOpen: undefined } : state;
  }
}

export const NAME_REQUIRED = "A name is required.";

/**
 * Runs one action per repository at a time. A saved config goes straight to the app shell, so the repository moves
 * between the tracked list and the section before any scan; Enable and Ignore also re-run discovery, whose answer
 * changed with the config.
 */
export function useTracking({ onConfig, rediscover }: { onConfig: (config: Config) => void; rediscover: () => void }): Tracking {
  const ui = useSessionUi();
  const [busy, setBusy] = useState<Record<string, TrackingAction>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string>();
  const [dialogs, setDialogs] = useState<OverviewDialogs>({});
  const dialog = (event: OverviewDialogEvent) => setDialogs((d) => overviewDialogs(d, event));
  const run = async (id: string, action: TrackingAction, work: () => Promise<void>) => {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: action }));
    setErrors(({ [id]: _old, ...rest }) => rest);
    try {
      await work();
    } catch (err) {
      // The entry stays where it was; the reason is shown on it.
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(({ [id]: _done, ...rest }) => rest);
    }
  };
  const save = (then?: () => void) => async (config: Config) => {
    onConfig(config);
    then?.();
  };
  return {
    busy,
    errors,
    enable: (entry) => void run(entry.id, "enable", () => api.trackRepo(entry.path).then(save(rediscover))),
    disable: (id) => void run(id, "disable", () => api.setRepoEnabled(id, false).then(save(() => dialog({ type: "disabled", id })))),
    ignore: (entry) => void run(entry.id, "ignore", () => api.ignorePath(entry.path).then(save(rediscover))),
    integrate: (entry) =>
      void run(entry.id, "integrate", async () => {
        const session = await api.startIntegration(entry.path);
        await ui.refresh();
        ui.showIntegration(session.id);
      }),
    forget: (entry) => void run(entry.id, "forget", () => api.forgetRepo(entry.id).then(save(rediscover))),
    renaming,
    startRename: (id) => {
      setErrors(({ [id]: _old, ...rest }) => rest);
      setRenaming(id);
    },
    cancelRename: () => setRenaming(undefined),
    rename: (id, current, next) => {
      const name = next.trim();
      if (!name) {
        setErrors((e) => ({ ...e, [id]: NAME_REQUIRED }));
        return;
      }
      if (name === current) return setRenaming(undefined);
      void run(id, "rename", () => api.renameRepo(id, name).then(save(() => setRenaming(undefined))));
    },
    setAgent: (id, patch) => void run(id, "agent", () => api.setRepoAgent(id, patch).then(save())),
    setLabels: (id, patch) => void run(id, "labels", () => api.setRepoLabels(id, patch).then(save())),
    setPrTitleConvention: (id, convention) => void run(id, "prTitles", () => api.setRepoPrTitleConvention(id, convention).then(save())),
    setAutoFetch: (id, seconds) => void run(id, "autoFetch", () => api.setRepoAutoFetch(id, seconds).then(save())),
    setLabelColor: (id, label, hue) => void run(id, "labels", () => api.setLabelColor(label, hue).then(save())),
    labelsOpen: dialogs.labelsOpen,
    openLabels: (id) => {
      setErrors(({ [id]: _old, ...rest }) => rest);
      dialog({ type: "openLabels", id });
    },
    closeLabels: () => dialog({ type: "closeLabels" }),
    settingsOpen: dialogs.settingsOpen,
    openSettings: (id) => {
      setErrors(({ [id]: _old, ...rest }) => rest);
      dialog({ type: "openSettings", id });
    },
    closeSettings: () => dialog({ type: "closeSettings" }),
  };
}

/** Each entry says in words what it is; the tooltip says what that means and what its actions do. */
export const KIND_LABELS: Record<UntrackedKind, { label: string; title: string }> = {
  disabled: { label: "disabled", title: "Managed before and switched off: not scanned and not on the boards. Enable brings it back." },
  discovered: { label: "OpenSpec", title: "Uses OpenSpec and is not managed yet. Enable starts scanning it." },
  integratable: {
    label: "no OpenSpec",
    title: "A git repository that does not use OpenSpec yet. Integrate starts your agent in it to run openspec init — in the checkout itself, with no branch and no undo; it is managed once openspec/config.yaml exists.",
  },
  // A clone's row says its own state (`cloneOutcome`): queued, Cloning…, clone failed or clone cancelled.
  clone: { label: "clone", title: "Being cloned from GitHub. One that uses OpenSpec is managed once the clone has finished; one without it is listed here to integrate." },
};

export const FORGET_HINT =
  "Forget: remove this repository from the dashboard, with its name, labels and agent settings, saved at once. If it is still under a workspace root, it is offered again as a discovered repository.";

export const IGNORE_HINT = "Add this path to the ignored paths, saved at once — remove it under Settings › Workspace roots to undo";

export interface UntrackedSectionProps {
  /** After search; ordered by `untrackedEntries`. */
  entries: UntrackedEntry[];
  discovery: DiscoveryState;
  hasRoots: boolean;
  /** The overview's search, for the "nothing matches" text. */
  query: string;
  tracking: Tracking;
  /** Why Integrate cannot be offered at all; stated once for the section. */
  integrateOff?: string;
  clones: CloneActions;
  /** The page's clock, for a clone's elapsed time; refreshed by the clone list's poll. */
  now?: number;
  /** The running integration session for a folder, if any. */
  runningIntegration: (path: string) => string | undefined;
  showIntegration: (id: string) => void;
  onRediscover: () => void;
}

function SettingsRootsLink({ children }: { children: string }) {
  return (
    <a href={hrefWithQuery("/settings", "?section=roots")} onClick={(e) => followInApp(e, "/settings", "?section=roots")}>
      {children}
    </a>
  );
}

function Entry({ entry, props }: { entry: UntrackedEntry; props: UntrackedSectionProps }) {
  const { tracking, integrateOff } = props;
  if (entry.clone) return <CloneRow clone={entry.clone} now={props.now ?? Date.now()} actions={props.clones} />;
  const busy = tracking.busy[entry.id];
  const error = tracking.errors[entry.id];
  const running = entry.kind === "integratable" ? props.runningIntegration(entry.path) : undefined;
  return (
    <li class={`untracked-entry ${entry.kind}`}>
      <span class="untracked-label">
        <span class="untracked-name">{entry.name}</span>
        <span class={`badge untracked-kind ${entry.kind}`} title={KIND_LABELS[entry.kind].title}>
          {KIND_LABELS[entry.kind].label}
        </span>
      </span>
      {entry.hint && <span class="untracked-meta path-hint mono">{entry.hint}/</span>}
      {entry.sameRemoteAs && (
        <span class="untracked-meta badge" title={`same origin remote as:\n${entry.sameRemoteAs.map((r) => `${r.path}${r.tracked ? " (tracked)" : ""}`).join("\n")}`}>
          same remote as {[...new Set(entry.sameRemoteAs.map((r) => r.name))].join(", ")}
        </span>
      )}
      <code class="untracked-path" title={entry.path}>
        {entry.path}
      </code>
      <span class="untracked-actions">
        {entry.kind === "integratable" ? (
          running ? (
            <button type="button" class="btn sm" onClick={() => props.showIntegration(running)}>
              Setting up…
            </button>
          ) : (
            <button
              type="button"
              class="btn sm"
              disabled={integrateOff !== undefined || busy !== undefined}
              title={integrateOff ?? `Run openspec init in ${entry.path} — your agent works in the checkout itself, with no branch and no undo`}
              onClick={() => tracking.integrate(entry)}
            >
              {busy === "integrate" ? "Starting…" : "Integrate"}
            </button>
          )
        ) : (
          <button
            type="button"
            class="btn sm"
            disabled={busy !== undefined}
            title={entry.kind === "disabled" ? "Switch it back on, saved at once" : "Track this repository, saved at once"}
            onClick={() => tracking.enable(entry)}
          >
            {busy === "enable" ? "Enabling…" : "Enable"}
          </button>
        )}
        {entry.kind === "disabled" ? (
          <button type="button" class="btn sm ghost" disabled={busy !== undefined} title={FORGET_HINT} onClick={() => tracking.forget(entry)}>
            {busy === "forget" ? "Forgetting…" : "Forget"}
          </button>
        ) : (
          <button type="button" class="btn sm ghost" disabled={busy !== undefined} title={IGNORE_HINT} onClick={() => tracking.ignore(entry)}>
            {busy === "ignore" ? "Ignoring…" : "Ignore"}
          </button>
        )}
      </span>
      {error && (
        <span class="untracked-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

/** Below the managed projects: everything that could be brought in, in one list, each with the actions that fit it. */
export function UnmanagedSection(props: UntrackedSectionProps) {
  const { entries, discovery, hasRoots, query } = props;
  const rootErrors = discovery.result?.errors ?? [];
  const anyIntegratable = entries.some((e) => e.kind === "integratable");
  return (
    <section class="untracked" aria-labelledby="unmanaged-title">
      <header class="overview-section-head">
        <h2 id="unmanaged-title" class="overview-section-title">
          Unmanaged projects <span class="untracked-count">· {entries.length}</span>
        </h2>
        {discovery.running && <span class="hint">discovering…</span>}
        <span class="spacer" />
        {hasRoots && (
          <button type="button" class="btn sm" onClick={props.onRediscover} disabled={discovery.running}>
            {discovery.running ? "Discovering…" : "Rediscover"}
          </button>
        )}
      </header>
      {!hasRoots && (
        <p class="hint">
          No workspace root yet: <SettingsRootsLink>add one in Settings</SettingsRootsLink> to discover the repositories under it.
        </p>
      )}
      {rootErrors.map((e) => (
        <div class="notice warn" key={e.root}>
          {e.root}: {e.message} — <SettingsRootsLink>check the workspace roots</SettingsRootsLink>
        </div>
      ))}
      {discovery.error && <div class="notice danger">Discovery failed: {discovery.error}</div>}
      {anyIntegratable && props.integrateOff && <div class="notice">Integrate is unavailable: {props.integrateOff}.</div>}
      {entries.length > 0 && (
        <ul class="untracked-list">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} props={props} />
          ))}
        </ul>
      )}
      {entries.length === 0 && hasRoots && !discovery.running && (
        <p class="hint">
          {query.trim() ? `No unmanaged project matches “${query}”.` : discovery.result ? "Every repository under the workspace roots is managed." : ""}
        </p>
      )}
    </section>
  );
}

/**
 * A tracked repository's Disable, in its settings dialog: saved at once, and never opens the repository the row or tile
 * stands for. An icon; the accessible name and the tooltip say what it does. A failure's reason is shown by the dialog.
 */
export function DisableButton({ id, name, tracking }: { id: string; name: string; tracking: Tracking }) {
  const busy = tracking.busy[id];
  return (
    <button
      type="button"
      class="btn sm ghost icon-only"
      title={`Disable: stop tracking ${name}: no more scans, off the boards. It is listed under Unmanaged projects below, where Enable brings it back.`}
      aria-label={`Disable ${name}`}
      disabled={busy !== undefined}
      onClick={(e) => {
        e.stopPropagation(); // in an overview row or tile, a click must not open the repository
        tracking.disable(id);
      }}
    >
      {busy === "disable" ? "Disabling…" : <IconEyeOff />}
    </button>
  );
}
