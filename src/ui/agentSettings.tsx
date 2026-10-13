// Settings section for agent sessions. Off by default; turning it on lets you start an agent CLI in a terminal for a
// change, so the section says plainly what that means. An agent is just a command line and its opening prompts.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AGENT_PRESETS } from "../shared/agentDefaults.ts";
import { DEFAULT_INTEGRATE_PROMPT, DEFAULT_RESOLVE_CONFLICTS_PROMPT, DEFAULT_SHIP_PROMPT, STARTER_PROMPT_KEYS, type AgentAvailability, type AgentProfile, type AgentSessionsConfig, type Config, type KeepAwakeStatus, type PromptKey, type Shortcut, type StarterPromptKey } from "../shared/types.ts";
import { api } from "./api.ts";
import { addShortcut, moveShortcut, removeShortcut, restoredShortcuts } from "./quickReplies.ts";
import { newAgentProfile, parseArgLines } from "./sessionState.ts";
import { followInApp, href } from "./url.ts";

interface Props {
  draft: Config;
  update: (patch: Partial<Config>) => void;
}

const ACTION_LABEL: Record<StarterPromptKey, string> = { draft: "Draft artifacts", implement: "Implement", validate: "Validate", archive: "Archive" };

/** One prompt of a profile and how it is edited; the action prompts are textareas showing their default. */
interface PromptSpec {
  key: PromptKey;
  label: string;
  multiline: boolean;
  placeholder: string;
  note?: ComponentChildren;
}

// Fast-forward has no prompt of its own: it is composed from Draft artifacts, Implement and Ship.
const STARTER_PROMPTS: PromptSpec[] = STARTER_PROMPT_KEYS.map((action) => ({ key: action, label: ACTION_LABEL[action], multiline: false, placeholder: "no prompt — this starter is not offered" }));

const ACTION_PROMPTS: PromptSpec[] = [
  { key: "ship", label: "Ship", multiline: true, placeholder: DEFAULT_SHIP_PROMPT },
  { key: "resolveConflicts", label: "Resolve conflicts", multiline: true, placeholder: DEFAULT_RESOLVE_CONFLICTS_PROMPT },
  {
    key: "integrate",
    label: "Integrate",
    multiline: true,
    placeholder: DEFAULT_INTEGRATE_PROMPT,
    note: (
      <>
        Runs in the folder of a repository that does not use OpenSpec yet, so this prompt and its additional instructions take <strong>no placeholder at all</strong>.
      </>
    ),
  },
];

/** A prompt with its additional instructions directly beneath it: they are appended to this prompt and to no other. */
function PromptField({ spec, agent, onPrompt, onSuffix }: { spec: PromptSpec; agent: AgentProfile; onPrompt: (value: string) => void; onSuffix: (value: string) => void }) {
  const promptId = `agent-${agent.id}-prompt-${spec.key}`;
  const suffixId = `agent-${agent.id}-suffix-${spec.key}`;
  const prompt = agent.prompts[spec.key] ?? "";
  const suffix = agent.promptSuffixes?.[spec.key] ?? "";
  return (
    <div class="agent-prompt">
      <label class="agent-prompt-label" for={promptId}>
        {spec.label}
      </label>
      {spec.note && <span class="hint">{spec.note}</span>}
      {spec.multiline ? (
        <textarea id={promptId} class="input mono" rows={3} placeholder={spec.placeholder} value={prompt} onInput={(e) => onPrompt(e.currentTarget.value)} />
      ) : (
        <input id={promptId} class="input mono" placeholder={spec.placeholder} value={prompt} onInput={(e) => onPrompt(e.currentTarget.value)} />
      )}
      <div class="agent-tools agent-suffix">
        <label class="hint" for={suffixId}>
          + Additional {spec.label} instructions, appended to this prompt as one line
        </label>
        {spec.multiline ? (
          <textarea id={suffixId} class="input mono" rows={2} placeholder="nothing is appended" value={suffix} onInput={(e) => onSuffix(e.currentTarget.value)} />
        ) : (
          <input id={suffixId} class="input mono" placeholder="nothing is appended" value={suffix} onInput={(e) => onSuffix(e.currentTarget.value)} />
        )}
      </div>
    </div>
  );
}

/**
 * Exported for the tests: one profile, hook-free so it can be rendered without a DOM. The header works collapsed — it
 * carries the badges and Make default / Remove agent — and the body is grouped into Command, Change starters and Action
 * prompts. Whether it is expanded is the caller's state (`open`, `onToggle`).
 */
export function AgentEditor({
  agent,
  found,
  isDefault,
  canRemove,
  open,
  onToggle,
  onChange,
  onRemove,
  onDefault,
}: {
  agent: AgentProfile;
  found?: AgentAvailability;
  isDefault: boolean;
  canRemove: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AgentProfile>) => void;
  onRemove: () => void;
  onDefault: () => void;
}) {
  /** An empty prompt is stored as absent: a starter without one is not offered, an action prompt falls back to its default. */
  const setPrompt = (key: PromptKey, value: string) => {
    const prompts = { ...agent.prompts };
    if (value.trim()) prompts[key] = value;
    else delete prompts[key];
    onChange({ prompts });
  };
  /** Additional instructions for one prompt; an empty field is stored as absent, as a removed prompt is. */
  const setSuffix = (key: PromptKey, value: string) => {
    const promptSuffixes = { ...agent.promptSuffixes };
    if (value.trim()) promptSuffixes[key] = value;
    else delete promptSuffixes[key];
    onChange({ promptSuffixes: Object.keys(promptSuffixes).length ? promptSuffixes : undefined });
  };
  const field = (spec: PromptSpec) => <PromptField key={spec.key} spec={spec} agent={agent} onPrompt={(v) => setPrompt(spec.key, v)} onSuffix={(v) => setSuffix(spec.key, v)} />;
  const bodyId = `agent-${agent.id}-fields`;
  return (
    <div class={`agent-card ${open ? "open" : ""}`}>
      <div class="agent-card-head">
        <button type="button" class="agent-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span class="agent-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <strong>{agent.name}</strong> <code>{agent.command[0]}</code>
          {isDefault && <span class="badge">default</span>}
          {found && (found.available ? <span class="badge success" title={found.path}>✓ found</span> : <span class="badge danger">⚠ not found on this machine</span>)}
        </button>
        <span class="agent-card-actions">
          {!isDefault && (
            <button type="button" class="btn sm" onClick={onDefault}>
              Make default
            </button>
          )}
          {canRemove && (
            <button type="button" class="btn sm ghost" onClick={onRemove}>
              Remove agent
            </button>
          )}
        </span>
      </div>
      {open && (
        <div class="agent-card-body" id={bodyId}>
          <div class="agent-group">
            <h4>Command</h4>
            <label class="agent-tools">
              <span class="agent-prompt-label">Name</span>
              <input class="input" value={agent.name} onInput={(e) => onChange({ name: e.currentTarget.value })} />
            </label>
            <label class="agent-tools">
              <span class="agent-prompt-label">Command</span>
              <span class="hint">
                <strong>One argument per line</strong>, no shell. <code>{"{prompt}"}</code> becomes the opening prompt as one argument; without it the prompt is typed into the
                terminal after start.
              </span>
              <textarea class="input mono" rows={Math.max(2, agent.command.length)} value={agent.command.join("\n")} onInput={(e) => onChange({ command: parseArgLines(e.currentTarget.value) })} />
            </label>
            <label class="agent-tools">
              <span class="agent-prompt-label">Resume command</span>
              <span class="hint">Optional, one argument per line: continues the agent's latest conversation in the same worktree.</span>
              <textarea
                class="input mono"
                rows={2}
                value={(agent.resumeCommand ?? []).join("\n")}
                onInput={(e) => onChange({ resumeCommand: parseArgLines(e.currentTarget.value).length ? parseArgLines(e.currentTarget.value) : undefined })}
              />
            </label>
          </div>
          <div class="agent-group">
            <h4>Change starters</h4>
            <p class="hint">
              What each starter on a card asks this agent. An empty prompt means the starter is not offered; additional instructions are appended only when the prompt is set — this
              text alone does not offer the starter. <code>{"{change}"}</code> may be used. <strong>Fast-forward</strong> has no prompt of its own: it sends Draft artifacts,
              then Implement, then Ship, each with its additional instructions, and is offered only while both Draft artifacts and Implement are set.
            </p>
            {STARTER_PROMPTS.map(field)}
          </div>
          <div class="agent-group">
            <h4>Action prompts</h4>
            <p class="hint">
              What <strong>Ship</strong>, <strong>Resolve conflicts</strong> and <strong>Integrate</strong> ask this agent. Empty uses the default shown; additional instructions
              are appended to the prompt — or to the default shown there, so a standing instruction needs no prompt of its own. <code>{"{change}"}</code> may be used in Ship and
              Resolve conflicts. The dashboard commits, merges and pushes nothing itself — it only asks.
            </p>
            {ACTION_PROMPTS.map(field)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Exported for the tests: one button per preset that is not configured yet, the ones whose executable was found first
 * and otherwise in preset order. Found is a hint, never a gate: until availability has loaded, or if it failed, every
 * preset is still offered, unmarked. Adding one appends a copy, which is from then on an ordinary profile.
 */
export function PresetPicker({ agents, presets, onAdd }: { agents: readonly AgentProfile[]; presets?: readonly AgentAvailability[]; onAdd: (profile: AgentProfile) => void }) {
  const configured = new Set(agents.map((a) => a.id));
  const found = (id: string) => presets?.find((p) => p.id === id);
  const offered = AGENT_PRESETS.filter(({ profile }) => !configured.has(profile.id));
  // A stable sort, so presets that are equally found keep their order.
  const ordered = [...offered].sort((a, b) => Number(found(b.profile.id)?.available ?? false) - Number(found(a.profile.id)?.available ?? false));
  return (
    <>
      {ordered.map(({ profile }) => {
        const mark = found(profile.id);
        return (
          <button type="button" class="btn sm ghost" key={profile.id} onClick={() => onAdd(structuredClone(profile))}>
            + {profile.name} preset{" "}
            {mark && (mark.available ? <span class="badge success" title={mark.path}>✓ found</span> : <span class="badge danger">⚠ not found</span>)}
          </button>
        );
      })}
    </>
  );
}

/**
 * The shortcuts of the agent console: what its controls read and what each one types into the running agent. The two are
 * independent, so a one-word control can carry several sentences; the prompt is sent exactly as written, which is why it
 * is one line and takes no placeholder.
 */
export function ShortcutEditor({ shortcuts, onChange }: { shortcuts: Shortcut[]; onChange: (shortcuts: Shortcut[]) => void }) {
  const patch = (id: string, fields: Partial<Shortcut>) => onChange(shortcuts.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  const add = () => onChange(addShortcut(shortcuts));
  return (
    <>
      <h3>Shortcuts</h3>
      <p class="hint">
        The controls beside a session's terminal. The <strong>title</strong> is what the control reads; the{" "}
        <strong>prompt</strong> is what the agent receives, typed exactly as written — <strong>one line, no placeholder</strong>, because a shortcut is offered in every session,
        including those that belong to no change. A shortcut is only ever typed and confirmed the way any text sent for you is: at a selection menu nothing is confirmed. Remove
        them all and the row disappears.
      </p>
      <div class="list">
        {shortcuts.map((shortcut, i) => (
          <div class="agent-shortcut" key={shortcut.id}>
            <input class="input" aria-label={`Title of shortcut ${i + 1}`} placeholder="Title" value={shortcut.title} onInput={(e) => patch(shortcut.id, { title: e.currentTarget.value })} />
            <input
              class="input mono"
              aria-label={`Prompt of shortcut ${i + 1}`}
              placeholder="what the agent receives"
              value={shortcut.prompt}
              onInput={(e) => patch(shortcut.id, { prompt: e.currentTarget.value })}
            />
            <span class="row">
              <button type="button" class="btn sm ghost" aria-label={`Move ${shortcut.title} earlier`} disabled={i === 0} onClick={() => onChange(moveShortcut(shortcuts, i, -1))}>
                ↑
              </button>
              <button
                type="button"
                class="btn sm ghost"
                aria-label={`Move ${shortcut.title} later`}
                disabled={i === shortcuts.length - 1}
                onClick={() => onChange(moveShortcut(shortcuts, i, 1))}
              >
                ↓
              </button>
              <button type="button" class="btn sm ghost" aria-label={`Remove ${shortcut.title}`} onClick={() => onChange(removeShortcut(shortcuts, shortcut.id))}>
                Remove
              </button>
            </span>
          </div>
        ))}
        {shortcuts.length === 0 && <span class="hint">No shortcuts — a session's terminal shows no shortcut row.</span>}
      </div>
      <div class="row">
        <button type="button" class="btn sm" onClick={add}>
          + Add shortcut
        </button>
        <button type="button" class="btn sm ghost" onClick={() => onChange(restoredShortcuts())}>
          Restore defaults
        </button>
      </div>
    </>
  );
}

/** Where the per-project switch and agent went: each project's row or tile on Projects (agent-sessions). */
/**
 * Settings without one profile. The console goes back to the default agent here, in the draft; repositories that chose
 * it do so when Settings saves (`withLatestRepos`), because they are not part of this draft.
 */
export function withoutAgent(settings: AgentSessionsConfig, id: string): AgentSessionsConfig {
  const agents = settings.agents.filter((a) => a.id !== id);
  const { consoleAgent, ...rest } = settings;
  return { ...rest, agents, defaultAgent: settings.defaultAgent === id ? agents[0].id : settings.defaultAgent, ...(consoleAgent && consoleAgent !== id ? { consoleAgent } : {}) };
}

/** Which agent the main console runs: only offered with a choice to make. "default agent" is stored as no choice. */
export function ConsoleAgentPicker({ settings, onChange }: { settings: AgentSessionsConfig; onChange: (consoleAgent: string | undefined) => void }) {
  if (settings.agents.length < 2) return null;
  return (
    <label class="agent-tools">
      <span class="hint">The agent the console starts. A running console keeps its own until you end it.</span>
      <select class="input" aria-label="Console agent" value={settings.consoleAgent ?? ""} onChange={(e) => onChange(e.currentTarget.value || undefined)}>
        <option value="">default agent</option>
        {settings.agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PerProjectNote() {
  return (
    <>
      <h3>Projects</h3>
      <p class="hint per-project">
        Each project has its own <strong>Agent sessions</strong> switch, Enabled unless you turn it off, and — with more than one agent here — its own agent:{" "}
        <a href={href("/")} onClick={(e) => followInApp(e, "/")}>
          set them on Projects
        </a>
        , saved at once.
      </p>
    </>
  );
}

/** How often Settings asks again whether the machine is being kept awake, while it is open. */
const KEEP_AWAKE_POLL_MS = 15_000;

export function AgentSettings({ draft, update }: Props) {
  const [found, setFound] = useState<AgentAvailability[]>([]);
  const [presets, setPresets] = useState<AgentAvailability[] | undefined>(undefined);
  const [keepAwake, setKeepAwake] = useState<KeepAwakeStatus | undefined>(undefined);
  // Availability and keep-awake only: session worktrees are listed, with their work status, in Open work.
  useEffect(() => {
    const load = () =>
      api
        .sessions()
        .then((r) => {
          setFound(r.agents);
          setPresets(r.presets);
          setKeepAwake(r.keepAwake);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), KEEP_AWAKE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const settings = draft.agentSessions;
  // The default profile starts expanded; the others stay collapsed until the user opens them.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([settings.defaultAgent]));
  const toggle = (id: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const set = (patch: Partial<AgentSessionsConfig>) => update({ agentSessions: { ...settings, ...patch } });
  const setAgent = (id: string, patch: Partial<AgentProfile>) => set({ agents: settings.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const addProfile = (profile: AgentProfile) => {
    set({ agents: [...settings.agents, profile] });
    setExpanded((was) => new Set([...was, profile.id]));
  };
  const addAgent = () => {
    addProfile(newAgentProfile({ name: "New agent", command: ["my-agent-cli", "{prompt}"], taken: settings.agents.map((a) => a.id), idBase: "agent" }));
  };
  const removeAgent = (id: string) => update({ agentSessions: withoutAgent(settings, id) });

  return (
    <section class="panel">
      <h2>Agent sessions</h2>
      <AgentSessionsStatement />
      <div class="row">
        <label class="check">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} />
          Enable agent sessions
        </label>
      </div>

      <fieldset class="agent-fields" disabled={!settings.enabled}>
        <h3>Agents</h3>
        <p class="hint">
          Any CLI that runs interactively in a terminal works. Claude Code is preconfigured; Codex and Antigravity are presets, marked with whether they were found on this
          machine. A preset's prompts expect what <code>{"openspec init --tools <tool>"}</code> installs for that agent.
        </p>
        {settings.agents.map((agent) => (
          <AgentEditor
            key={agent.id}
            agent={agent}
            found={found.find((f) => f.id === agent.id)}
            isDefault={agent.id === settings.defaultAgent}
            canRemove={settings.agents.length > 1}
            open={expanded.has(agent.id)}
            onToggle={() => toggle(agent.id)}
            onChange={(patch) => setAgent(agent.id, patch)}
            onRemove={() => removeAgent(agent.id)}
            onDefault={() => set({ defaultAgent: agent.id })}
          />
        ))}
        <div class="row">
          <button type="button" class="btn sm" onClick={addAgent}>
            + Add agent
          </button>
          <PresetPicker agents={settings.agents} presets={presets} onAdd={addProfile} />
        </div>

        <ShortcutEditor shortcuts={settings.shortcuts} onChange={(shortcuts) => set({ shortcuts })} />

        <h3>Fast-forward</h3>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.confirmFastForward !== false}
            onChange={(e) => set({ confirmFastForward: e.currentTarget.checked ? undefined : false })}
          />
          Warn before fast-forwarding
        </label>
        <p class="hint">
          <strong>FF</strong> on a card has the agent write a change's artifacts, implement it and open a pull request without stopping for your review — the pull request is
          the only review. With this on, it asks first.
        </p>

        <h3>Console</h3>
        <label class="agent-tools">
          <span class="hint">
            The console button in the top bar opens the agent chosen here — your default agent unless you pick another — in this folder, outside every change and
            without a prompt. Empty uses{" "}
            <code>~/.spec-control/console/</code>. A folder above your repositories lets it reach them; a folder inside a tracked repository is refused, so it never runs in
            a main checkout. What the agent does there is up to its own permission prompts.
          </span>
          <input
            class="input mono"
            aria-label="Console folder"
            placeholder="~/.spec-control/console"
            value={settings.consoleDir ?? ""}
            onInput={(e) => set({ consoleDir: e.currentTarget.value.trim() || undefined })}
          />
        </label>
        <ConsoleAgentPicker settings={settings} onChange={(consoleAgent) => set({ consoleAgent })} />

        <PerProjectNote />
      </fieldset>

      {/* Outside the fieldset: it is a machine setting, shown whether or not sessions are enabled. */}
      <KeepAwakeSetting status={keepAwake} on={draft.keepAwake !== false} onToggle={(on) => update({ keepAwake: on ? undefined : false })} />
    </section>
  );
}

/**
 * What keep-awake is doing, in words, from the server's status; undefined when there is nothing to say (the demo sends
 * no status). `on` is the switch as drafted, saved or not.
 */
export function keepAwakeState(status: KeepAwakeStatus | undefined, on: boolean): string | undefined {
  if (!status) return undefined;
  if (!status.available) return "Works on macOS only: nothing is started on this machine.";
  if (!on) return "Turned off: the machine sleeps as usual.";
  if (!status.enabled) return "Save to turn it on.";
  const sessions = `${status.sessions} busy ${status.sessions === 1 ? "session" : "sessions"}`;
  if (status.active) return `Keeping this Mac awake right now, for ${sessions}.`;
  if (status.sessions > 0) return `${sessions[0].toUpperCase()}${sessions.slice(1)}, but caffeinate is not running; it is tried again within a minute.`;
  return "Not keeping the machine awake right now: no agent is busy.";
}

/** The Keep awake switch (openspec/specs/keep-awake). Hook-free: the switch belongs to the draft, the status to the server. */
export function KeepAwakeSetting({ status, on, onToggle }: { status: KeepAwakeStatus | undefined; on: boolean; onToggle: (on: boolean) => void }) {
  const state = keepAwakeState(status, on);
  return (
    <>
      <h3>Keep awake</h3>
      <label class="check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.currentTarget.checked)} />
        Keep awake while agents work
      </label>
      <p class="hint">
        While an agent is busy — it reported <code>working</code>, or its terminal printed something in the last five minutes — macOS's own <code>caffeinate</code> keeps
        this Mac from going to sleep on its own, and lets it sleep again once no agent is busy. The display can still sleep, and closing the lid or choosing Sleep still
        sleeps the machine. An agent whose hooks report <code>working</code> through <code>SPEC_CONTROL_STATE_FILE</code> is kept awake through long silent steps too.
      </p>
      {state !== undefined && (
        <p class="hint" aria-live="polite">
          {state}
        </p>
      )}
    </>
  );
}

/** What turning agent sessions on means, stated the same way in Settings and in the setup wizard. */
export function AgentSessionsStatement() {
  return (
    <p class="hint">
      Start an agent CLI for a change straight from its card; it opens in a terminal here in the dashboard — the same program you would run in your own terminal, with its own
      login, settings and permission prompts. <strong>Turning this on lets the dashboard start that program on this machine, and the agent can change files and run commands as
      you allow it to.</strong> Each session works in its own git worktree under <code>~/.spec-control/worktrees/</code>, never in a repository's main checkout — except an{" "}
      <strong>Integrate</strong> session, which runs in the repository folder itself to set it up for OpenSpec. It applies to <strong>every tracked repository</strong>; switch
      individual ones off on Projects.
    </p>
  );
}
