import { useEffect, useRef, useState } from "preact/hooks";
import type { Config, DiscoveredRepo, DiscoverResult, IntegratableRepo, RepoConfig, Snapshot, UpdateStatus } from "../shared/types.ts";
import { isReleaseVersion } from "../shared/versions.ts";
import { AgentSettings } from "./agentSettings.tsx";
import { api, ApiError, ConfigConflictError, revisionOf } from "./api.ts";
import { EnvironmentPanel } from "./environment.tsx";
import { environmentAttention, environmentCount, type EnvironmentState } from "./environmentState.ts";
import { type NavSection, SectionList, SectionNav, type SectionPage, useSectionNav } from "./sectionNav.tsx";
import { SECTION_IDS } from "./settingsSections.ts";
import { SharedConfigPanel } from "./sharedConfig.tsx";
import { releaseUrl } from "./updateBanner.tsx";
import { followInApp, href } from "./url.ts";

export const SETTINGS_PAGE: SectionPage = {
  prefix: "settings",
  known: SECTION_IDS,
  layout: ".settings-layout",
  scroller: ".settings-scroll",
  label: "Settings sections",
  path: "/settings",
  keepQuery: false,
};

interface Props {
  config: Config | null;
  snapshot: Snapshot | null;
  onSaved: (config: Config) => void;
  /** Something changed that the next scan will pick up (shared config saved or applied). */
  onRescan: () => void;
  /** The latest environment report, owned by the app shell: the hero reads the same one. */
  environment: EnvironmentState;
  /** **Re-check**: asks for a fresh report. Nothing about it belongs to the page's draft. */
  onRecheckEnvironment: () => void;
  /** What the server last learned about newer releases, owned by the app shell: the banner reads the same one. */
  update: UpdateStatus | undefined;
  /** **Check now** answered: the shell keeps the new status, so the banner follows at once. */
  onUpdate: (status: UpdateStatus) => void;
}

export function Settings({ config, snapshot, onSaved, onRescan, environment, onRecheckEnvironment, update: updateStatus, onUpdate }: Props) {
  const [draft, setDraft] = useState<Config | null>(config);
  // The saved config the draft was seeded from: its revision goes with a save, and what differs from it is the edit.
  const [base, setBase] = useState<Config | null>(config);
  const [dirty, setDirty] = useState(false);
  const [newRoot, setNewRoot] = useState("");
  const [newIgnore, setNewIgnore] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveredRepo[]>([]);
  const [integratable, setIntegratable] = useState<IntegratableRepo[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const discoverSeq = useRef(0);
  const [discoverErrors, setDiscoverErrors] = useState<DiscoverResult["errors"]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "danger"; text: string; issues?: string[] } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string>();

  useEffect(() => {
    if (config && !dirty) {
      setDraft(config);
      setBase(config);
    }
  }, [config, dirty]);

  // Defined before the early return below: the effect that calls it also runs for a render that returned early
  // (Settings opened directly, config still loading), where a later `const` would not be initialised yet.
  /**
   * Read-only preview of what is under `roots` and outside `ignorePaths` (usually the unsaved draft values).
   * Runs overlap when they are edited quickly; only the latest response is applied.
   */
  const runDiscovery = async (roots: string[], ignorePaths: string[]) => {
    const seq = ++discoverSeq.current;
    if (roots.length === 0) {
      setCandidates([]);
      setIntegratable([]);
      setDiscoverErrors([]);
      setDiscovered(false);
      setDiscovering(false);
      return;
    }
    setDiscovering(true);
    try {
      const result = await api.discover(roots, ignorePaths);
      if (seq !== discoverSeq.current) return;
      setCandidates(result.candidates);
      setIntegratable(result.integratable);
      setDiscoverErrors(result.errors);
      setDiscovered(true);
    } catch (err) {
      if (seq !== discoverSeq.current) return;
      setMessage({ kind: "danger", text: err instanceof Error ? err.message : String(err), issues: err instanceof ApiError ? err.issues : [] });
    } finally {
      if (seq === discoverSeq.current) setDiscovering(false);
    }
  };

  const loaded = config !== null;
  useEffect(() => {
    if (config && config.scanRoots.length > 0) void runDiscovery(config.scanRoots, config.ignorePaths);
  }, [loaded]);

  // Hooks first: the ids are all the hook needs, and they are known before the draft is.
  const scroller = useRef<HTMLDivElement>(null);
  const sectionIds = draft ? ["roots", "scanning", "agents", ...(config ? ["shared-config"] : []), "updates", "environment"] : [];
  const nav = useSectionNav(scroller, sectionIds, SETTINGS_PAGE);

  if (!draft) return <div class="settings">Loading…</div>;

  const update = (patch: Partial<Config>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
    setMessage(null);
  };

  const addRoot = () => {
    const root = newRoot.trim();
    if (!root || draft.scanRoots.includes(root)) return;
    setRoots([...draft.scanRoots, root]);
    setNewRoot("");
  };

  const setRoots = (scanRoots: string[]) => {
    update({ scanRoots });
    void runDiscovery(scanRoots, draft.ignorePaths);
  };

  const setIgnorePaths = (ignorePaths: string[]) => {
    update({ ignorePaths });
    void runDiscovery(draft.scanRoots, ignorePaths);
  };
  const ignore = (path: string) => {
    if (!draft.ignorePaths.includes(path)) setIgnorePaths([...draft.ignorePaths, path]);
  };
  const addIgnore = () => {
    const path = newIgnore.trim();
    if (!path) return;
    ignore(path);
    setNewIgnore("");
  };

  const save = async () => {
    setSaving(true);
    try {
      // Sent with the revision the draft was seeded from. Saved elsewhere since: the edits are moved onto the current
      // config and saved at once when nobody else changed the same settings; otherwise the user decides.
      let seed = base ?? draft;
      let edited = draft;
      let next = withLatestRepos(draft, config);
      let saved: Config | undefined;
      for (let attempt = 0; !saved; attempt++) {
        try {
          saved = await api.saveConfig(next, revisionOf(seed));
        } catch (err) {
          if (!(err instanceof ConfigConflictError)) throw err;
          const rebased = rebaseDraft(edited, seed, err.config);
          onSaved(err.config);
          if (rebased.conflicts.length > 0 || attempt > 0) {
            setDraft(rebased.config);
            setBase(err.config);
            setMessage({ kind: "warn", text: "Settings were changed elsewhere while this page was open. Your edits are shown over the newer values; save again to keep them." });
            return;
          }
          seed = err.config;
          edited = rebased.config;
          next = rebased.config;
        }
      }
      setDraft(saved);
      setBase(saved);
      setDirty(false);
      setMessage({ kind: "ok", text: "Saved." });
      onSaved(saved);
      void runDiscovery(saved.scanRoots, saved.ignorePaths); // forgotten repos become candidates again
    } catch (err) {
      setMessage({ kind: "danger", text: err instanceof Error ? err.message : String(err), issues: err instanceof ApiError ? err.issues : [] });
    } finally {
      setSaving(false);
    }
  };

  /** **Check now**: outside the draft, like Re-check; the answer goes to the shell, which the banner reads. */
  const checkForUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(undefined);
    try {
      onUpdate(await api.checkForUpdate());
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Discovery here only answers "what is under these roots": the repositories themselves are listed, enabled and
  // integrated on the projects overview, so the config the app holds is the latest word on which are tracked.
  const trackedIds = new Set((config ?? draft).repos.map((r) => r.id));
  const untrackedCandidates = candidates.filter((c) => !trackedIds.has(c.id)).length;
  const untrackedIntegratable = integratable.filter((r) => !trackedIds.has(r.id)).length;

  // One list drives both the navigation and the page, so a panel cannot exist without its navigation entry.
  const sections: NavSection[] = [
    {
      id: "roots",
      label: "Workspace roots",
      content: (
        <section class="panel">
          <h2>Workspace roots</h2>
          <p class="hint">Directories to search (4 levels deep) for repositories containing <code>openspec/config.yaml</code>. Discovery runs whenever the roots change and only previews what it finds — nothing is tracked until you enable it on Projects.</p>
          <div class="list">
            {draft.scanRoots.map((root) => (
              <div class="row">
                <code class="grow">{root}</code>
                <button type="button" class="btn sm ghost" onClick={() => setRoots(draft.scanRoots.filter((r) => r !== root))}>
                  remove
                </button>
              </div>
            ))}
            {draft.scanRoots.length === 0 && <span class="hint">No roots yet — try <code>~/Workspace</code>.</span>}
          </div>
          <div class="row">
            <input class="input mono grow" placeholder="/absolute/path or ~/Workspace" value={newRoot} onInput={(e) => setNewRoot(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addRoot()} />
            <button type="button" class="btn" onClick={addRoot} disabled={!newRoot.trim()}>
              Add root
            </button>
            <button type="button" class="btn" onClick={() => runDiscovery(draft.scanRoots, draft.ignorePaths)} disabled={discovering || draft.scanRoots.length === 0}>
              {discovering ? "Discovering…" : "Rediscover"}
            </button>
          </div>
          {discoverErrors.map((e) => (
            <div class="notice warn">
              {e.root}: {e.message}
            </div>
          ))}
          {draft.scanRoots.length > 0 && (
            <p class="hint found-summary" aria-live="polite">
              {discovering ? "Discovering…" : discovered ? <FoundSummary candidates={untrackedCandidates} integratable={untrackedIntegratable} /> : null}
            </p>
          )}
          <h3>Ignored paths</h3>
          <p class="hint">Discovery skips these directories and everything below them. Ignored paths only affect discovery: a repository that is already tracked stays tracked until you forget it on Projects.</p>
          <div class="list">
            {draft.ignorePaths.map((path) => (
              <div class="row">
                <code class="grow">{path}</code>
                <button type="button" class="btn sm ghost" onClick={() => setIgnorePaths(draft.ignorePaths.filter((p) => p !== path))}>
                  remove
                </button>
              </div>
            ))}
            {draft.ignorePaths.length === 0 && <span class="hint">Nothing ignored.</span>}
          </div>
          <div class="row">
            <input class="input mono grow" placeholder="/absolute/path or ~/Workspace/mirror" value={newIgnore} onInput={(e) => setNewIgnore(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addIgnore()} />
            <button type="button" class="btn" onClick={addIgnore} disabled={!newIgnore.trim()}>
              Ignore path
            </button>
          </div>
        </section>
      ),
    },
    {
      id: "scanning",
      label: "Scanning",
      content: (
        <section class="panel">
          <h2>Scanning</h2>
          <div class="row">
            <label class="check">
              Poll every
              <input class="input num" type="number" min={10} value={draft.pollIntervalSeconds} onInput={(e) => update({ pollIntervalSeconds: Number(e.currentTarget.value) })} />
              seconds
            </label>
            <span class="hint">· port {draft.port} (change in <code>~/.spec-control/config.json</code>, restart to apply)</span>
          </div>
        </section>
      ),
    },
    { id: "agents", label: "Agent sessions", content: <AgentSettings draft={draft} update={update} /> },
    // Works on the saved config, not the draft above: it has its own save and only ever targets tracked repositories.
    ...(config ? [{ id: "shared-config", label: "Shared OpenSpec config", content: <SharedConfigPanel config={config} snapshot={snapshot} onApplied={onRescan} /> }] : []),
    {
      id: "updates",
      label: "Updates",
      content: (
        <UpdatesPanel
          status={updateStatus}
          on={draft.updateCheck !== false}
          onToggle={(on) => update({ updateCheck: on ? undefined : false })}
          checking={checkingUpdate}
          error={updateError}
          onCheck={() => void checkForUpdate()}
        />
      ),
    },
    // Last: it configures nothing, and it is where the hero's environment indicator links to. Outside the draft, so
    // re-checking never marks the page as having unsaved changes.
    {
      id: "environment",
      label: "Environment",
      count: environmentCount(environment),
      attention: environmentAttention(environment),
      countTitle: "checks that need attention",
      content: <EnvironmentPanel state={environment} onRecheck={onRecheckEnvironment} />,
    },
  ];

  return (
    <>
      {/* One scroll area for the whole page: the navigation moves with the sections, and the wheel works anywhere. */}
      <div class="settings-scroll" ref={scroller}>
        <div class="settings-layout">
          <SectionNav page={SETTINGS_PAGE} sections={sections} current={nav.current} anchor={nav.anchor} onJump={nav.jump} />
          <div class="settings">
            <SectionList page={SETTINGS_PAGE} sections={sections} sectionClass="settings-section" />
          </div>
        </div>
      </div>
      <div class="savebar">
        <button type="button" class="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && <span class="badge warning">unsaved changes</span>}
        {message && (
          <span class={`notice ${message.kind}`}>
            {message.text}
            {message.issues?.length ? ` — ${message.issues.join("; ")}` : ""}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * What Settings saves: its draft, with the repositories as the app last received them. Every repository setting is
 * changed on the projects overview and saved at once there, so a draft seeded before such a change must not undo it.
 * A repository whose agent profile was removed in this draft goes back to the default agent, as removing it promises.
 */
export function withLatestRepos(draft: Config, latest: Config | null): Config {
  const profiles = new Set(draft.agentSessions.agents.map((a) => a.id));
  const repos = (latest ?? draft).repos.map((repo) => {
    if (!repo.agent) return repo;
    const changeAgents = Object.fromEntries(Object.entries(repo.agent.changeAgents ?? {}).filter(([, id]) => profiles.has(id)));
    const changeAgentsChanged = Object.keys(changeAgents).length !== Object.keys(repo.agent.changeAgents ?? {}).length;
    if ((!repo.agent.agentId || profiles.has(repo.agent.agentId)) && !changeAgentsChanged) return repo;
    const { agentId: _removed, changeAgents: _oldChangeAgents, ...agent } = repo.agent;
    const updatedAgent: NonNullable<RepoConfig["agent"]> = agent;
    if (_removed && profiles.has(_removed)) updatedAgent.agentId = _removed;
    if (Object.keys(changeAgents).length) updatedAgent.changeAgents = changeAgents;
    return { ...repo, agent: updatedAgent };
  });
  return { ...draft, repos };
}

/** Equal as JSON, whatever the order of object keys. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)].filter((k) => x[k] !== undefined || y[k] !== undefined));
  return [...keys].every((k) => sameValue(x[k], y[k]));
}

/**
 * Settings' draft moved onto a config saved elsewhere since the draft was seeded from `base`: every top-level setting
 * the user edited (where the draft differs from `base`) keeps the draft's value, every other one takes `current`'s, the
 * repositories come from `current` as `withLatestRepos` takes them and `setup` stays the server's. `conflicts` names
 * the edited settings that were also changed elsewhere, to something else; when there are none the result can be
 * saved without asking.
 */
export function rebaseDraft(draft: Config, base: Config, current: Config): { config: Config; conflicts: string[] } {
  const d = draft as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const c = current as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(c), ...Object.keys(d)])) {
    if (key === "repos" || key === "setup") continue;
    const edited = !sameValue(d[key], b[key]);
    const value = edited ? d[key] : c[key];
    if (edited && !sameValue(b[key], c[key]) && !sameValue(d[key], c[key])) conflicts.push(key);
    if (value !== undefined) next[key] = value;
  }
  if (current.setup !== undefined) next.setup = current.setup;
  return { config: withLatestRepos({ ...(next as unknown as Config), repos: current.repos }, current), conflicts };
}

/** The Workspace roots section's answer to "what did discovery find": counts and the way to Projects, never a list. */
export function FoundSummary({ candidates, integratable }: { candidates: number; integratable: number }) {
  if (candidates === 0 && integratable === 0) return <>Every repository under these roots is tracked.</>;
  const parts = [candidates > 0 ? `${candidates} using OpenSpec` : "", integratable > 0 ? `${integratable} without OpenSpec` : ""].filter(Boolean);
  return (
    <>
      Found {parts.join(" and ")}, not tracked yet —{" "}
      <a href={href("/")} onClick={(e) => followInApp(e, "/")}>
        enable or integrate them on Projects
      </a>
      . Save first if you changed the roots.
    </>
  );
}

/** Why Check now cannot run, in words; undefined when it can. `on` is the switch as drafted, saved or not. */
export function updateCheckBlocked(status: UpdateStatus | undefined, on: boolean): string | undefined {
  if (status && !isReleaseVersion(status.current)) {
    return status.current === "dev" ? "Development builds do not check for new versions." : status.current === "demo" ? "The demo does not check for new versions." : "This build does not check for new versions.";
  }
  if (!on) return "Turned off: nothing is requested.";
  if (status && !status.enabled) return "Save to turn checking on.";
  return undefined;
}

/** The last check in words: when, and what came of it. */
export function lastCheckText(status: UpdateStatus): string {
  if (status.outcome === "never" || status.checkedAt === undefined) return "Not checked yet.";
  const when = new Date(status.checkedAt).toLocaleString();
  if (status.outcome === "failed") return `The last check, ${when}, failed${status.latest ? ` — the latest release known is ${status.latest}` : ""}.`;
  return status.available ? `Checked ${when}: ${status.latest} is available.` : `Checked ${when}: up to date.`;
}

/** The Updates section (openspec/specs/update-notice). Hook-free: the switch belongs to the draft, the status to the shell. */
export function UpdatesPanel({ status, on, onToggle, checking, error, onCheck }: { status: UpdateStatus | undefined; on: boolean; onToggle: (on: boolean) => void; checking: boolean; error: string | undefined; onCheck: () => void }) {
  const blocked = updateCheckBlocked(status, on);
  return (
    <section class="panel">
      <h2>Updates</h2>
      <p class="hint">
        Once a day Spec Control asks github.com for the tag of its latest release: one request that carries only the version you run, nothing about you, this machine or your
        projects. When a newer release exists, a banner at the top says so. Nothing is downloaded or installed.
      </p>
      <label class="check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.currentTarget.checked)} />
        Check for new versions
      </label>
      <div class="row">
        <span>
          Running <code>{status?.current ?? "…"}</code>
        </span>
        <button type="button" class="btn sm" onClick={onCheck} disabled={checking || blocked !== undefined || status === undefined}>
          {checking ? "Checking…" : "Check now"}
        </button>
        {blocked !== undefined && <span class="hint">{blocked}</span>}
      </div>
      {status && isReleaseVersion(status.current) && (
        <p class="hint" aria-live="polite">
          {lastCheckText(status)}
          {status.available && status.latest && (
            <>
              {" "}
              <a href={releaseUrl(status.latest)} target="_blank" rel="noopener noreferrer">
                Release notes
              </a>
            </>
          )}
        </p>
      )}
      {error !== undefined && <div class="notice danger">The check could not run: {error}</div>}
    </section>
  );
}
