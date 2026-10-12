// The setup wizard (openspec/specs/setup-wizard): seven steps over the dimmed page — Welcome, System check, Workspace,
// Agents, Console, Project settings, Done. Each step saves when the user continues, through the routes Settings
// and the overview already use, and only adds or changes what the user touched. The step views are hook-free, so tests
// render them without a DOM; `SetupWizard` holds the state.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { agentInstallSteps } from "../shared/agentDefaults.ts";
import { PROJECT_SETTINGS, type ProjectSetting, settingApplies } from "../shared/repoSettings.ts";
import type { AgentAvailability, AgentProfile, Config, DiscoverResult, EnvironmentReport, GithubClone, InstructionStep, RepoConfig, SetupState, Snapshot } from "../shared/types.ts";
import { AddGithubDialog } from "./addGithub.tsx";
import { type CloneActions, CloneRow } from "./cloneRow.tsx";
import { githubClones, useCloneActions, useGithubClones } from "./githubClonesState.ts";
import { cloneOutcome, isCloneActive, joinPath } from "./githubState.ts";
import { AgentSessionsStatement } from "./agentSettings.tsx";
import { api } from "./api.ts";
import { CommandSteps } from "./commandSteps.tsx";
import { IconCheck, IconFolder, IconFolderGit, IconGitBranch, IconGitPullRequest, IconHelp, IconKanban, IconMonitor, IconPencil, IconRefresh, IconScan, IconSettings, IconTerminal } from "./icons.tsx";
import { AgentSelect, AUTO_FETCH_TITLE, AUTO_MERGE_HINT, AutoFetchSelect, autoFetchLabel, KEEP_EACH, KEEP_EACH_LABEL, PR_TITLES_TITLE, PrTitlesSelect } from "./projectSettings.tsx";
import {
  type AgentChoice,
  agentChoices,
  agentsReady,
  agentsSave,
  allInPlace,
  type CustomAgent,
  consoleSave,
  DONE_MARK_LABEL,
  type DoneCard,
  doneCards,
  customAgentProblem,
  defaultAgentOptions,
  expandHome,
  initiallyChecked,
  isAbsoluteRoot,
  leftToFix,
  NOTHING_SAVED,
  continueWorkspaceStep,
  githubRootChoices,
  type ListedRepo,
  proposedWorkspace,
  workspaceRootReady,
  type ProjectSettingsMode,
  preselectedAgent,
  projectSettingsSave,
  SETTING_DEFAULTS,
  SETUP_STEPS,
  type SettingsDraft,
  type SetupSaved,
  type SetupSummary,
  GIT_ONLY_SETTINGS,
  settingsProjects,
  settingValue,
  setupSummary,
  sharedSetting,
  skippedNote,
  withDraft,
} from "./setupState.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The frame every step shares: the step list with the current one marked, the step's body, and its controls. */
export function WizardFrame({
  step,
  reachable = step,
  onStep,
  children,
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueBlocked,
  busy = false,
  onSkip,
  confirmingSkip = false,
  onConfirmSkip,
  onCancelSkip,
  headingRef,
}: {
  step: number;
  /** The furthest step reached; the steps up to it can be opened from the step list. */
  reachable?: number;
  /** Opens a step from the step list. Absent: the list only shows where the user is. */
  onStep?: (step: number) => void;
  children: preact.ComponentChildren;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  /** Why Continue cannot be used yet; it is then disabled, with this said beside it, and no later step opens. */
  continueBlocked?: string;
  busy?: boolean;
  /** Absent on Done, which offers Finish instead. */
  onSkip?: () => void;
  confirmingSkip?: boolean;
  onConfirmSkip?: () => void;
  onCancelSkip?: () => void;
  headingRef?: preact.Ref<HTMLHeadingElement>;
}) {
  return (
    <div class="overlay modal-overlay setup-overlay">
      <div class="modal wide setup-wizard" role="dialog" aria-modal="true" aria-label="Spec Control setup">
        <header class="modal-head setup-head">
          <div class="modal-title">
            <p class="setup-position">
              Setup · {step + 1} of {SETUP_STEPS.length}
            </p>
            <h2 ref={headingRef} tabIndex={-1}>
              {SETUP_STEPS[step]}
            </h2>
          </div>
          <ol class="setup-steps" aria-label="Setup steps">
            {SETUP_STEPS.map((name, i) => {
              const label = (
                <>
                  {i < step && <IconCheck size={12} />}
                  {name}
                  {i < step && <span class="visually-hidden">, done</span>}
                </>
              );
              // Any step up to the furthest one reached can be opened; one not reached yet only through Continue.
              const open = onStep && i !== step && i <= reachable && (i < step || continueBlocked === undefined);
              return (
                <li key={name} class={i === step ? "current" : i < step ? "past" : i <= reachable ? "reached" : ""} aria-current={i === step ? "step" : undefined}>
                  {open ? (
                    <button type="button" class="setup-step-link" onClick={() => onStep(i)} disabled={busy} title={i < step ? `Back to ${name}` : `Save this step and go to ${name}`}>
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ol>
        </header>
        <div class="modal-body setup-body">{children}</div>
        <footer class="setup-actions">
          {confirmingSkip ? (
            <>
              <span class="hint">Skip setup? What you entered on this step is not saved.</span>
              <span class="setup-actions-end">
                <button type="button" class="btn" onClick={onCancelSkip}>
                  Keep going
                </button>
                <button type="button" class="btn danger" onClick={onConfirmSkip}>
                  Skip setup
                </button>
              </span>
            </>
          ) : (
            <>
              {onSkip && (
                <button type="button" class="btn ghost" onClick={onSkip} disabled={busy}>
                  Skip setup
                </button>
              )}
              <span class="setup-actions-end">
                {continueBlocked && (
                  <span id="setup-continue-blocked" class="hint setup-blocked">
                    {continueBlocked}
                  </span>
                )}
                {onBack && (
                  <button type="button" class="btn" onClick={onBack} disabled={busy}>
                    Back
                  </button>
                )}
                <button type="button" class="btn primary" onClick={onContinue} disabled={busy || continueBlocked !== undefined} aria-describedby={continueBlocked ? "setup-continue-blocked" : undefined}>
                  {busy ? "Saving…" : continueLabel}
                </button>
              </span>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The steps ahead, as the Welcome diagram shows them: its node's icon, the step's name and one line on what it sets up. */
export const WELCOME_FLOW = [
  { name: "System check", Icon: IconScan, line: "whether the tools it relies on are installed, and how to install what is missing." },
  { name: "Workspace", Icon: IconFolderGit, line: "where your projects live, so Spec Control can find them." },
  { name: "Agents", Icon: IconTerminal, line: "the agent CLIs you work with, and which one starts by default." },
  { name: "Console", Icon: IconMonitor, line: "the agent you talk to about anything that is not one change, across all your projects." },
  { name: "Project settings", Icon: IconSettings, line: "how each project's sessions behave: pull request titles, auto-merge for docs and how often it is fetched." },
] as const;

export function WelcomeStep() {
  return (
    <div class="setup-step setup-welcome">
      <p class="setup-lead">
        Spec Control shows the OpenSpec changes of the repositories on this machine on one board, and can start your coding agents on any of them. A few things decide whether
        it is useful from the start:
      </p>
      <div class="setup-flow">
        <ol class="setup-flow-steps" aria-label="What setup covers">
          {WELCOME_FLOW.map(({ name, Icon, line }, i) => (
            <li key={name} class="setup-flow-node">
              <span class="setup-flow-mark" aria-hidden="true">
                <span class="setup-flow-number">{i + 1}</span>
                <Icon size={18} />
              </span>
              <span class="setup-flow-text">
                <strong>{name}</strong>
                <span class="setup-flow-sep"> — </span>
                <span class="setup-flow-line">{line}</span>
              </span>
            </li>
          ))}
        </ol>
        <div class="setup-flow-node setup-flow-end" aria-hidden="true">
          <span class="setup-flow-mark">
            <IconCheck size={18} />
          </span>
          <span class="setup-flow-text">
            <strong>Ready</strong>
            <span class="setup-flow-sep"> — </span>
            <span class="setup-flow-line">your projects on one board.</span>
          </span>
        </div>
      </div>
      <p class="hint">Every step can be skipped and changed later, in Settings or in a project's settings. You can run setup again from Help.</p>
    </div>
  );
}

export interface WorkspaceView {
  configuredRoots: readonly string[];
  /** Roots entered in this step, already expanded; not saved yet. */
  entered: readonly string[];
  /** Roots discovery reported as missing, with its message. */
  missing: ReadonlyMap<string, string>;
  suggestions: readonly string[];
  input: string;
  inputError?: string;
  discovery?: DiscoverResult;
  discovering: boolean;
  discoveryError?: string;
  unchecked: ReadonlySet<string>;
  saveError?: string;
  /** Whether the server can open the system's folder dialog. */
  picker: boolean;
  /** The folder dialog is open. */
  picking: boolean;
  pickError?: string;
  /** The folder last chosen in the dialog was already listed, so nothing was added. */
  pickedAgain?: string;
  /** Entered roots that do not exist yet and are created on Continue. */
  toCreate?: ReadonlySet<string>;
  /** Why creating a root was refused, by root. */
  createErrors?: ReadonlyMap<string, string>;
  /** `~/Workspace`, offered for creation while there is no root and nothing to suggest. */
  proposed?: string;
  /** Add from GitHub in this step: the repositories listed to clone on Continue, and how each one went. */
  github?: WorkspaceGithub;
}

export interface WorkspaceGithub {
  listed: readonly ListedRepo[];
  /** The clone started for a listed path, as the clone list reports it. */
  clones: Readonly<Record<string, GithubClone | undefined>>;
  /** Why the server refused to start a listed path's clone. */
  refused: Readonly<Record<string, string>>;
  /** Why Add from GitHub cannot be used here. */
  off?: string;
}

export function WorkspaceStep({
  view,
  onInput,
  onAdd,
  onRemove,
  onToggle,
  onPick,
  onCreate = () => {},
  onPropose = () => {},
  onAddGithub = () => {},
  onRemoveGithub = () => {},
  onRetryGithub = () => {},
  onRenameGithub = () => {},
}: {
  view: WorkspaceView;
  onInput: (text: string) => void;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onToggle: (path: string) => void;
  onPick: () => void;
  /** Marks a missing root to be created on Continue, or unmarks it. */
  onCreate?: (path: string) => void;
  /** Accepts the proposal to create `~/Workspace`. */
  onPropose?: (path: string) => void;
  onAddGithub?: () => void;
  onRemoveGithub?: (path: string) => void;
  onRetryGithub?: (path: string) => void;
  /** A refused repository's folder name, edited before trying again. */
  onRenameGithub?: (path: string, name: string) => void;
}) {
  const candidates = view.discovery?.candidates ?? [];
  const integratable = view.discovery?.integratable.length ?? 0;
  const anyRoot = view.configuredRoots.length + view.entered.length > 0;
  const toCreate = view.toCreate ?? new Set<string>();
  const github = view.github;
  return (
    <div class="setup-step">
      <p class="setup-lead">
        Choose the folder your repositories live in, or create a new one. Spec Control looks for projects with OpenSpec below it, a few levels deep, and clones GitHub
        repositories into it; nothing is saved until you continue.
      </p>
      <section class="setup-group" aria-label="Workspace folders">
        {view.configuredRoots.length > 0 && (
          <ul class="setup-roots" aria-label="Configured workspace roots">
            {view.configuredRoots.map((root) => (
              <li key={root}>
                <code>{root}</code> <span class="hint">configured</span>
              </li>
            ))}
          </ul>
        )}
        {view.entered.length > 0 && (
          <ul class="setup-roots" aria-label="Workspace roots to add">
            {view.entered.map((root) => (
              <li key={root} class={view.missing.has(root) && !toCreate.has(root) ? "missing" : ""}>
                <code>{root}</code>
                {toCreate.has(root) ? (
                  <span class="badge success">created on Continue</span>
                ) : view.missing.has(root) ? (
                  <span class="badge danger">not found — {view.missing.get(root)}</span>
                ) : (
                  <span class="hint">to add</span>
                )}
                {view.missing.has(root) && (
                  <button type="button" class="btn sm" onClick={() => onCreate(root)} aria-pressed={toCreate.has(root)} title={toCreate.has(root) ? "Do not create this folder" : "Create this folder when you continue: one new, empty folder"}>
                    {toCreate.has(root) ? "Don't create" : "Create folder"}
                  </button>
                )}
                <button type="button" class="btn sm ghost" onClick={() => onRemove(root)} aria-label={`Remove ${root}`}>
                  Remove
                </button>
                {view.createErrors?.get(root) && <span class="notice danger setup-create-error">Could not create it: {view.createErrors.get(root)}</span>}
              </li>
            ))}
          </ul>
        )}
        {view.picker && (
          <div class="setup-pick">
            <button type="button" class="btn primary" onClick={onPick} disabled={view.picking} aria-busy={view.picking}>
              {view.picking ? "Waiting for the folder dialog…" : "Choose folder…"}
            </button>
            <span class="hint">{view.picking ? "Pick a folder in the dialog that opened, or cancel it." : "Opens your system's folder dialog."}</span>
          </div>
        )}
        {view.pickedAgain && (
          <p class="hint" aria-live="polite">
            <code>{view.pickedAgain}</code> is already listed.
          </p>
        )}
        {view.pickError && <p class="notice danger">The folder dialog failed: {view.pickError} You can type the path instead.</p>}
        <form
          class="row setup-add-root"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd(view.input);
          }}
        >
          <input type="text" class="input" value={view.input} placeholder="~/Workspace" aria-label="Folder to add" onInput={(e) => onInput(e.currentTarget.value)} />
          <button type="submit" class="btn" disabled={!view.input.trim()}>
            Add folder
          </button>
        </form>
        {view.inputError && <p class="notice danger">{view.inputError}</p>}
        {view.suggestions.length > 0 && (
          <p class="setup-suggestions">
            <span class="hint">Found in your home folder:</span>
            {view.suggestions.map((path) => (
              <button key={path} type="button" class="btn sm" onClick={() => onAdd(path)}>
                + {path}
              </button>
            ))}
          </p>
        )}
        {view.proposed && !view.entered.includes(view.proposed) && (
          <p class="setup-suggestions">
            <span class="hint">No workspace folder yet:</span>
            <button type="button" class="btn sm" onClick={() => onPropose(view.proposed as string)}>
              Create {view.proposed}
            </button>
          </p>
        )}
      </section>
      {github && (
        <section class="setup-group" aria-label="GitHub repositories">
          <div class="row setup-github-head">
            <strong>GitHub repositories</strong>
            <button type="button" class="btn sm" onClick={onAddGithub} disabled={github.off !== undefined} title={github.off ? `Add from GitHub is unavailable: ${github.off}` : "Choose GitHub repositories to clone into a workspace folder"}>
              Add from GitHub
            </button>
          </div>
          {github.off && <p class="hint">Add from GitHub is unavailable: {github.off}.</p>}
          {github.listed.length === 0 ? (
            <p class="hint">Keep your projects on GitHub? Add them here; they are cloned into your workspace folder when you continue.</p>
          ) : (
            <ul class="setup-roots setup-github" aria-label="GitHub repositories to clone">
              {github.listed.map((r) => {
                const clone = github.clones[r.path];
                const refused = github.refused[r.path];
                const outcome = clone ? cloneOutcome(clone) : undefined;
                const failed = refused !== undefined || clone?.state === "failed";
                return (
                  <li key={`${r.repo} ${r.root}`} class={failed ? "missing" : ""}>
                    <code>{r.repo}</code>
                    {refused !== undefined && (
                      <input
                        class="input setup-github-folder"
                        value={r.name}
                        aria-label={`Folder name for ${r.repo}`}
                        title="Rename the folder, then continue or retry"
                        onInput={(e) => onRenameGithub(r.path, (e.target as HTMLInputElement).value)}
                      />
                    )}
                    <span class="hint mono">→ {r.path}</span>
                    {outcome ? (
                      <span class={`badge ${outcome.tone}`} title={outcome.detail}>
                        {outcome.label}
                      </span>
                    ) : refused ? (
                      <span class="badge danger">refused</span>
                    ) : (
                      <span class="hint">cloned on Continue</span>
                    )}
                    {failed && (
                      <button type="button" class="btn sm" onClick={() => onRetryGithub(r.path)}>
                        Retry
                      </button>
                    )}
                    {!clone && (
                      <button type="button" class="btn sm ghost" onClick={() => onRemoveGithub(r.path)} aria-label={`Remove ${r.repo}`}>
                        Remove
                      </button>
                    )}
                    {(refused ?? (clone?.state === "failed" ? clone.reason : undefined)) && <span class="notice danger setup-create-error">{refused ?? clone?.reason}</span>}
                    {clone?.state === "integratable" && <span class="hint">Integrate it from the projects overview.</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {anyRoot && (
        <section class="setup-group setup-found" aria-live="polite" aria-label="Projects found">
          {view.discovering && <p class="hint">Looking for projects…</p>}
          {view.discoveryError && <p class="notice danger">Could not look for projects: {view.discoveryError}</p>}
          {view.discovery && candidates.length === 0 && <p class="hint">No OpenSpec projects that are not tracked yet were found under these folders.</p>}
          {candidates.length > 0 && (
            <>
              <p>
                {candidates.length === 1 ? "One project with OpenSpec was found" : `${candidates.length} projects with OpenSpec were found`}. Checked ones are tracked when you
                continue:
              </p>
              <ul class="setup-candidates">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label class="check">
                      <input type="checkbox" checked={!view.unchecked.has(c.path)} onChange={() => onToggle(c.path)} />
                      <span>{c.name}</span>
                      <code class="hint" title={c.path}>
                        {c.path}
                      </code>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {integratable > 0 && (
            <p class="hint">
              {integratable === 1 ? "One git repository" : `${integratable} git repositories`} without OpenSpec {integratable === 1 ? "was" : "were"} found as well; you can
              integrate {integratable === 1 ? "it" : "them"} from the projects overview.
            </p>
          )}
        </section>
      )}
      {view.saveError && <p class="notice danger">Could not save: {view.saveError}</p>}
    </div>
  );
}

export interface AgentsView {
  savedEnabled: boolean;
  enable: boolean;
  choices: readonly AgentChoice[];
  checked: readonly string[];
  custom: readonly CustomAgent[];
  defaultOptions: readonly { id: string; name: string; available?: boolean }[];
  defaultAgent: string;
  /** How to install each checked agent that is not found. */
  installs: readonly { name: string; steps: readonly InstructionStep[] }[];
  /** **Check again** is looking the executables up. */
  checking?: boolean;
  saveError?: string;
}

export interface AgentsHandlers {
  /** **Check again**: looks each agent's executable up once more. */
  onRecheck: () => void;
  onEnable: (on: boolean) => void;
  onCheck: (id: string, on: boolean) => void;
  onAddCustom: () => void;
  onCustomChange: (key: string, patch: Partial<Pick<CustomAgent, "name" | "command">>) => void;
  onRemoveCustom: (key: string) => void;
  onDefault: (id: string) => void;
}

export function AgentsStep({ view, ...on }: { view: AgentsView } & AgentsHandlers) {
  return (
    <div class="setup-step">
      <AgentSessionsStatement />
      <section class="setup-group">
        <label class="check setup-switch">
          <input type="checkbox" checked={view.enable} disabled={view.savedEnabled} onChange={(e) => on.onEnable(e.currentTarget.checked)} />
          <span>Turn agent sessions on</span>
          {view.savedEnabled && <span class="hint">already on — switch it off in Settings if you need to</span>}
        </label>
      </section>
      <fieldset class="setup-agents">
        <legend>Agents you use</legend>
        <div class="row">
          <p class="hint grow">Check every agent CLI you work with. Agents already configured stay; anything checked here is added when you continue.</p>
          <button type="button" class="btn sm" onClick={on.onRecheck} disabled={view.checking}>
            <IconRefresh size={13} />
            {view.checking ? "Checking…" : "Check again"}
          </button>
        </div>
        <div class="setup-agent-list">
          {view.choices.map((c) => (
            <label key={c.id} class={`check setup-agent ${c.configured || view.checked.includes(c.id) ? "on" : ""}`}>
              <input type="checkbox" checked={c.configured || view.checked.includes(c.id)} disabled={c.configured} onChange={(e) => on.onCheck(c.id, e.currentTarget.checked)} />
              <span class="setup-agent-text">
                <span class="setup-agent-name">
                  <span>{c.name}</span>
                  <span class={`badge ${c.available ? "success" : "warning"}`}>{c.available ? "found" : "not found"}</span>
                </span>
                <span class="hint">{c.configured ? "configured" : view.checked.includes(c.id) ? "added when you continue" : "check to add"}</span>
              </span>
            </label>
          ))}
        </div>
        {view.custom.map((agent) => {
          const problem = customAgentProblem(agent);
          return (
            <div key={agent.key} class="setup-custom-agent">
              <label class="field">
                <span>Name</span>
                <input type="text" class="input" value={agent.name} placeholder="My agent" onInput={(e) => on.onCustomChange(agent.key, { name: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span>
                  Command <span class="hint">— one argument per line; <code>{"{prompt}"}</code> stands for the opening prompt</span>
                </span>
                <textarea class="input mono" rows={2} value={agent.command} placeholder={"my-agent-cli\n{prompt}"} onInput={(e) => on.onCustomChange(agent.key, { command: e.currentTarget.value })} />
              </label>
              <div class="row">
                {problem ? <span class="hint warn">{problem}</span> : <span class="hint">Added when you continue. Its prompts can be edited in Settings → Agent sessions.</span>}
                <button type="button" class="btn sm ghost" onClick={() => on.onRemoveCustom(agent.key)} aria-label={`Remove ${agent.name.trim() || "this agent"}`}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        <div>
          <button type="button" class="btn sm" onClick={on.onAddCustom}>
            + Add another agent
          </button>
        </div>
      </fieldset>
      {view.defaultOptions.length > 0 ? (
        <label class="field setup-default-agent">
          <span>Default agent</span>
          <select class="input" value={view.defaultAgent} aria-label="Default agent" onChange={(e) => on.onDefault(e.currentTarget.value)}>
            {view.defaultOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.available === false ? " (not found)" : ""}
              </option>
            ))}
          </select>
          <span class="hint">Started by a card's session buttons unless a project chooses another one.</span>
        </label>
      ) : (
        <p class="hint">Check at least one agent above, or add your own: the default agent is chosen among them.</p>
      )}
      {view.installs.map(({ name, steps }) => (
        <div key={name} class="setup-install">
          <p>{name} was not found on this machine. To install it:</p>
          <CommandSteps steps={steps} />
        </div>
      ))}
      {view.installs.length > 0 && <p class="hint">You can continue now and install later. After installing, use Check again to look for it.</p>}
      {view.saveError && <p class="notice danger">Could not save: {view.saveError}</p>}
    </div>
  );
}

export interface ConsoleView {
  /** Agent sessions are on in the saved configuration. */
  sessionsOn: boolean;
  agents: readonly { id: string; name: string; available?: boolean }[];
  defaultName: string;
  /** The chosen console agent; `undefined` follows the default agent. */
  choice?: string;
  saveError?: string;
}

export function ConsoleStep({ view, onChoose }: { view: ConsoleView; onChoose: (id: string | undefined) => void }) {
  return (
    <div class="setup-step">
      <p class="setup-lead">
        The <strong>console</strong> is an agent session that belongs to no project and no change. You open it from the top bar, and it is meant for questions and work across
        projects — creating a project, asking about several of them, or anything that is not one change.
      </p>
      <ul class="setup-topics">
        <li>It runs in the console folder, by default under Spec Control's home folder, and never inside one of your repositories.</li>
        <li>It starts without a prompt, so you tell it what to do.</li>
        <li>There is one console at a time; it keeps running when you close its window.</li>
      </ul>
      {!view.sessionsOn && <p class="notice">The console is offered only while agent sessions are on. It becomes available once you switch them on, in the Agents step or in Settings.</p>}
      {view.agents.length >= 2 ? (
        <label class="field">
          <span>Console agent</span>
          <select class="input" aria-label="Console agent" value={view.choice ?? ""} onChange={(e) => onChoose(e.currentTarget.value || undefined)}>
            <option value="">Default agent ({view.defaultName})</option>
            {view.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.available === false ? " (not found)" : ""}
              </option>
            ))}
          </select>
          <span class="hint">With the default agent, the console follows it when you change the default later.</span>
        </label>
      ) : (
        <p>
          The console runs <strong>{view.agents[0]?.name ?? view.defaultName}</strong>, your only agent. Add another one in the Agents step to choose.
        </p>
      )}
      {view.saveError && <p class="notice danger">Could not save: {view.saveError}</p>}
    </div>
  );
}

const SETTING_LABELS: Record<ProjectSetting, string> = { agentSessions: "Agent sessions", agent: "Agent", prTitles: "PR titles", autoMergeDocs: "Docs auto-merge", autoFetch: "Auto fetch" };

/** The dialog's explanations, without "saved at once": in the wizard a setting is saved when the user continues. */
const unsaved = (text: string) => text.replace(/, saved at once/, "").replace(/ ?Saved at once\.$/, "");
const SETTING_HINTS: Record<ProjectSetting, string> = {
  agentSessions: "Whether agent sessions can be started for the project.",
  agent: "The agent the project's sessions start.",
  prTitles: unsaved(PR_TITLES_TITLE),
  autoMergeDocs: AUTO_MERGE_HINT,
  autoFetch: unsaved(AUTO_FETCH_TITLE),
};

/** A value as its control reads it, for "Default: …". */
export function settingValueLabel(setting: ProjectSetting, value: string, agents: readonly Pick<AgentProfile, "id" | "name">[] = []): string {
  switch (setting) {
    case "agentSessions":
      return value === "enabled" ? "Enabled" : "Disabled";
    case "agent":
      return value ? (agents.find((a) => a.id === value)?.name ?? value) : "default agent";
    case "prTitles":
      return value ? "Conventional Commits" : "No convention";
    case "autoMergeDocs":
      return value === "on" ? "On" : "Off";
    case "autoFetch":
      return value === "0" ? "Off" : autoFetchLabel(Number(value) as Parameters<typeof autoFetchLabel>[0]);
  }
}

/** One setting's control, as a select so "Keep each project's setting" can be offered for a switch too. */
export function SettingControl({
  setting,
  value,
  keep,
  label,
  agents,
  disabled,
  onChange,
}: {
  setting: ProjectSetting;
  value: string;
  keep: boolean;
  label: string;
  agents: Config["agentSessions"]["agents"];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const props = { value, label, keep, disabled, onChange, title: SETTING_HINTS[setting] };
  if (setting === "agent") return <AgentSelect agents={agents} {...props} />;
  if (setting === "prTitles") return <PrTitlesSelect {...props} />;
  if (setting === "autoFetch") return <AutoFetchSelect {...props} />;
  const [on, off] = setting === "agentSessions" ? ["enabled", "disabled"] : ["on", "off"];
  return (
    <select class="input" aria-label={label} title={props.title} value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
      {keep && <option value={KEEP_EACH}>{KEEP_EACH_LABEL}</option>}
      <option value={on}>{settingValueLabel(setting, on)}</option>
      <option value={off}>{settingValueLabel(setting, off)}</option>
    </select>
  );
}

/** The help control's id for a setting, so focus can return to it when its overlay closes. */
export const helpButtonId = (setting: ProjectSetting) => `setup-help-${setting}`;

/**
 * One labelled setting line of the step: its name with a help control, the control, and its default. The explanation
 * lives in an overlay the help control opens, so a row reads as name, value and default.
 */
function SettingRow({
  setting,
  note,
  help,
  children,
}: {
  setting: ProjectSetting;
  note?: string;
  help: { open: boolean; onToggle: (setting: ProjectSetting) => void };
  children: preact.ComponentChildren;
}) {
  const overlay = `${helpButtonId(setting)}-text`;
  return (
    <div class="setup-setting">
      <span class="setup-setting-label setup-help">
        {SETTING_LABELS[setting]}
        <button
          type="button"
          id={helpButtonId(setting)}
          class="btn ghost icon-only setup-help-btn"
          aria-label={`About ${SETTING_LABELS[setting]}`}
          title={`About ${SETTING_LABELS[setting]}`}
          aria-expanded={help.open}
          aria-controls={help.open ? overlay : undefined}
          onClick={() => help.onToggle(setting)}
        >
          <IconHelp size={15} />
        </button>
        {help.open && (
          <span id={overlay} class="setup-help-overlay">
            {SETTING_HINTS[setting]}
          </span>
        )}
        {GIT_ONLY_SETTINGS.has(setting) && <span class="setup-setting-requires">Requires a git repository</span>}
      </span>
      <div class="setup-setting-control">
        {children}
        <span class="hint">
          Default: {settingValueLabel(setting, SETTING_DEFAULTS[setting])}.{note ? ` ${note}` : ""}
        </span>
      </div>
    </div>
  );
}

export interface ProjectSettingsView {
  config: Config;
  projects: readonly RepoConfig[];
  /** Whether each project is a git repository, from its latest scan; absent while its first scan runs. */
  isGit: (id: string) => boolean | undefined;
  mode: ProjectSettingsMode;
  all: SettingsDraft;
  each: ReadonlyMap<string, SettingsDraft>;
  /** The project shown in "individual" mode. */
  index: number;
  /** The setting whose help overlay is open. */
  help?: ProjectSetting;
  saveError?: string;
}

export interface ProjectSettingsHandlers {
  onMode: (mode: ProjectSettingsMode) => void;
  /** `repoId` absent: the shared form. */
  onChange: (setting: ProjectSetting, value: string, repoId?: string) => void;
  onIndex: (index: number) => void;
  /** Opens a setting's help overlay, or closes it when it is the open one. */
  onHelp: (setting: ProjectSetting) => void;
}

export function ProjectSettingsStep({ view, onMode, onChange, onIndex, onHelp }: { view: ProjectSettingsView } & ProjectSettingsHandlers) {
  const { config, projects } = view;
  if (projects.length === 0) {
    return (
      <div class="setup-step">
        <p class="setup-lead">No project is tracked yet. Once you track projects on the projects overview, each one's settings are behind the gear on its row or tile.</p>
      </div>
    );
  }
  const reading = projects.filter((r) => view.isGit(r.id) === undefined);
  const isGit = (id: string) => view.isGit(id) === true;
  const agents = config.agentSessions.agents;
  const sessionsOffNote = config.agentSessions.enabled ? undefined : "Agent sessions are off; turn them on in the Agents step for this to take effect.";
  return (
    <div class="setup-step">
      <p class="setup-lead">
        How the {projects.length === 1 ? "project's" : `${projects.length} projects'`} sessions behave. Only what you change here is saved; everything else keeps each project's own
        value. Each project's settings are also behind the gear on its row or tile.
      </p>
      <fieldset class="setup-modes" aria-label="How to set the projects">
        <label class="check">
          <input type="radio" name="setup-mode" checked={view.mode === "all"} onChange={() => onMode("all")} />
          <span>Same settings for all projects</span>
        </label>
        <label class="check">
          <input type="radio" name="setup-mode" checked={view.mode === "individual"} onChange={() => onMode("individual")} />
          <span>Individual settings</span>
        </label>
      </fieldset>
      {reading.length > 0 ? (
        <p class="hint" aria-live="polite">
          Reading {reading.length === 1 ? reading[0].name : `${reading.length} projects`}…
        </p>
      ) : view.mode === "all" ? (
        <section class="setup-group setup-settings" aria-label="Settings for all projects">
          {PROJECT_SETTINGS.map((setting) => {
            const shared = sharedSetting(projects, setting, view.all, config, isGit);
            if (shared.applies === 0) return null;
            const touched = view.all[setting];
            const value = touched ?? shared.value ?? KEEP_EACH;
            const count = skippedNote(shared.skipped);
            const note = [count, setting === "agentSessions" ? sessionsOffNote : undefined].filter(Boolean).join(" ") || undefined;
            return (
              <SettingRow key={setting} setting={setting} note={note} help={{ open: view.help === setting, onToggle: onHelp }}>
                <SettingControl setting={setting} value={value} keep={shared.value === undefined} label={`${SETTING_LABELS[setting]} for all projects`} agents={agents} onChange={(v) => onChange(setting, v)} />
              </SettingRow>
            );
          })}
        </section>
      ) : (
        <IndividualProject view={view} isGit={isGit} sessionsOffNote={sessionsOffNote} onChange={onChange} onIndex={onIndex} onHelp={onHelp} />
      )}
      {view.saveError && <p class="notice danger">Could not save: {view.saveError}</p>}
    </div>
  );
}

function IndividualProject({
  view,
  isGit,
  sessionsOffNote,
  onChange,
  onIndex,
  onHelp,
}: {
  view: ProjectSettingsView;
  isGit: (id: string) => boolean;
  sessionsOffNote?: string;
  onChange: ProjectSettingsHandlers["onChange"];
  onIndex: (index: number) => void;
  onHelp: ProjectSettingsHandlers["onHelp"];
}) {
  const { config, projects } = view;
  const index = Math.min(view.index, projects.length - 1);
  const repo = projects[index];
  const draft = view.each.get(repo.id) ?? {};
  const shown = withDraft(repo, draft, config, isGit(repo.id));
  return (
    <section class="setup-group setup-settings" aria-label={`Settings of ${repo.name}`}>
      <div class="setup-project-head">
        <div class="setup-project-title">
          <p class="setup-position">
            Project {index + 1} of {projects.length}
          </p>
          <h3>{repo.name}</h3>
          <code class="hint" title={repo.path}>
            {repo.path}
          </code>
        </div>
        <div class="row setup-project-nav">
          <button type="button" class="btn" onClick={() => onIndex(index - 1)} disabled={index === 0}>
            Previous project
          </button>
          <button type="button" class="btn" onClick={() => onIndex(index + 1)} disabled={index === projects.length - 1}>
            Next project
          </button>
        </div>
      </div>
      {PROJECT_SETTINGS.filter((setting) => settingApplies(setting, shown, config, isGit(repo.id))).map((setting) => (
        <SettingRow key={setting} setting={setting} note={setting === "agentSessions" ? sessionsOffNote : undefined} help={{ open: view.help === setting, onToggle: onHelp }}>
          <SettingControl
            setting={setting}
            value={draft[setting] ?? settingValue(repo, setting)}
            keep={false}
            label={`${SETTING_LABELS[setting]} for ${repo.name}`}
            agents={config.agentSessions.agents}
            onChange={(v) => onChange(setting, v, repo.id)}
          />
        </SettingRow>
      ))}
    </section>
  );
}

/** Each check's tool, as an icon on its card; a check the wizard does not know gets the System check's own. */
const CHECK_ICON: Record<string, (typeof WELCOME_FLOW)[number]["Icon"]> = {
  "dashboard-home": IconFolder,
  git: IconGitBranch,
  "git-identity": IconPencil,
  "openspec-cli": IconKanban,
  "github-cli": IconGitPullRequest,
};

/** The status as the card's pill says it. */
const CHECK_STATUS_LABEL: Record<EnvironmentReport["status"], string> = { ok: "In place", warning: "Warning", problem: "Problem", "not-needed": "Not needed" };

/**
 * The System check, in the Done step's visual language: a headline with a badge, how many checks are in place and
 * Re-check, then one card per check with its tool's icon, a status pill and, when it is not in place, how to fix it.
 */
export function SystemCheckStep({ report, loading, error, onRecheck }: { report?: EnvironmentReport; loading: boolean; error?: string; onRecheck: () => void }) {
  const counted = report?.checks.filter((c) => c.status !== "not-needed") ?? [];
  const inPlace = counted.filter((c) => c.status === "ok").length;
  const ready = allInPlace(report);
  const tone = report === undefined ? "pending" : ready ? "ok" : "attention";
  return (
    <div class="setup-step setup-system">
      <p class="setup-lead">
        The tools Spec Control and your agents rely on, checked on this machine before the next steps use them. git gives each agent session its own worktree; the GitHub
        CLI is used for pull requests and issues. Nothing is installed or run for you.
      </p>
      <div class={`setup-system-hero ${tone}`}>
        <span class="setup-system-badge" aria-hidden="true">
          {tone === "ok" ? <IconCheck size={26} /> : tone === "attention" ? <span class="setup-system-bang">!</span> : <IconScan size={24} />}
        </span>
        <div class="setup-system-text">
          <p class="setup-system-title">
            {report === undefined ? (error === undefined ? "Checking this machine…" : "The environment could not be checked") : ready ? "Everything needed is in place" : `${inPlace} of ${counted.length} in place`}
          </p>
          <p class="setup-system-sub">
            {report === undefined
              ? "This takes a moment."
              : ready
                ? "Every tool Spec Control relies on was found."
                : "Install what is missing now or later — you can continue either way."}
          </p>
        </div>
        <button type="button" class="btn sm" onClick={onRecheck} disabled={loading}>
          <IconRefresh size={13} />
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>
      {error !== undefined && <p class="notice danger">The environment could not be checked: {error}</p>}
      {report && (
        <ul class="setup-checks" aria-label="What was checked">
          {report.checks.map((check) => {
            const Icon = CHECK_ICON[check.id] ?? IconScan;
            const fix = check.status !== "ok" && check.status !== "not-needed";
            return (
              <li key={check.id} class={`setup-check ${check.status}`}>
                <div class="setup-check-head">
                  <span class="setup-check-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span class="setup-check-text">
                    <strong class="setup-check-name">{check.label}</strong>
                    <span class="setup-check-found">{check.found}</span>
                  </span>
                  <span class={`setup-check-status ${check.status}`}>
                    {check.status === "ok" ? <IconCheck size={12} /> : fix ? <span aria-hidden="true">!</span> : null}
                    {CHECK_STATUS_LABEL[check.status]}
                  </span>
                </div>
                {fix && (check.remedy || (check.instructions && check.instructions.length > 0)) && (
                  <div class="setup-check-fix">
                    {check.remedy && <p class="hint">{check.remedy}</p>}
                    {check.instructions && check.instructions.length > 0 && <CommandSteps steps={check.instructions} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {report?.caveat && <p class="hint">{report.caveat}</p>}
      <p class="hint">You can continue whatever this says. Agents are checked in the Agents step; Settings → Environment checks this machine again later.</p>
    </div>
  );
}

/** The icon of each step, as the Welcome diagram shows it, so the Done step's cards echo the way in. */
const STEP_ICON = Object.fromEntries(WELCOME_FLOW.map(({ name, Icon }) => [name, Icon])) as Record<DoneCard["step"], (typeof WELCOME_FLOW)[number]["Icon"]>;

/**
 * The ending: a headline with a large check mark, one card per step with its icon, outcome and mark, and what comes
 * next. `firstStart` adds that the tour follows.
 */
export function DoneStep({
  summary,
  firstStart = false,
  home,
  clones = [],
  cloneActions,
  now = Date.now(),
}: {
  summary: SetupSummary;
  firstStart?: boolean;
  home?: string;
  /** The clones setup started, with their progress or outcome. */
  clones?: readonly GithubClone[];
  cloneActions?: CloneActions;
  now?: number;
}) {
  const cards = doneCards(summary, home);
  const left = leftToFix(summary);
  return (
    <div class="setup-step setup-done">
      <div class={`setup-done-hero ${left > 0 ? "attention" : ""}`}>
        <span class="setup-done-badge" aria-hidden="true">
          <IconCheck size={34} />
        </span>
        <div>
          <p class="setup-done-title">{left > 0 ? `Setup is complete — ${left === 1 ? "one thing is" : `${left} things are`} left to fix` : "You're all set"}</p>
          <p class="setup-done-sub">
            {summary.tracked > 0
              ? `Spec Control is ready for your ${summary.tracked === 1 ? "project" : `${summary.tracked} projects`}.`
              : "Spec Control is ready; track your projects on the projects overview whenever you like."}
          </p>
        </div>
      </div>
      <ul class="setup-done-cards" aria-label="What setup did">
        {cards.map((card) => {
          const Icon = STEP_ICON[card.step];
          return (
            <li key={card.step} class={`setup-done-card ${card.mark}`}>
              <div class="setup-done-card-head">
                <span class="setup-done-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span class="setup-done-name">{card.step}</span>
                <span class={`setup-done-mark ${card.mark}`}>
                  {card.mark !== "unchanged" && (card.mark === "done" ? <IconCheck size={12} /> : <span aria-hidden="true">!</span>)}
                  {DONE_MARK_LABEL[card.mark]}
                </span>
              </div>
              <strong class="setup-done-outcome">{card.outcome}</strong>
              <span class="setup-done-detail">{card.detail}</span>
            </li>
          );
        })}
      </ul>
      {clones.length > 0 && (
        <section class="setup-done-clones" aria-label="GitHub clones">
          <h3 class="setup-done-clones-title">GitHub clones</h3>
          <ul class="untracked-list clone-list">
            {clones.map((clone) => (
              <CloneRow key={clone.id} clone={clone} now={now} naming="repo" actions={cloneActions} />
            ))}
          </ul>
        </section>
      )}
      <p class="setup-done-next">
        <strong>What's next:</strong> Finish opens the projects overview{firstStart ? ", and the first time a short tour of the board" : ""}.
        {summary.clonesRunning > 0 && ` ${summary.clonesRunning === 1 ? "The clone still running goes" : "The clones still running go"} on; follow ${summary.clonesRunning === 1 ? "it" : "them"} under Unmanaged projects.`} Change
        any of this later in Settings or behind a project's gear, or run setup again from Help.
      </p>
    </div>
  );
}

const STEP = { welcome: 0, system: 1, workspace: 2, agents: 3, console: 4, projects: 5, done: 6 } as const;

/**
 * The wizard. `onSaved` receives every configuration a step saved; `onClose` is told whether setup could be marked done
 * (when not, the wizard opens again on the next load, which is the safe direction). `snapshot` says which projects are
 * git repositories, for the Project settings step.
 */
export function SetupWizard({ config, snapshot, onSaved, onClose }: { config: Config | null; snapshot?: Snapshot | null; onSaved: (config: Config) => void; onClose: (done: boolean) => void }) {
  const [step, setStepOnly] = useState(0);
  // The furthest step reached: the step list opens any step up to it.
  const [furthest, setFurthest] = useState(0);
  const setStep = useCallback((next: number) => {
    setStepOnly(next);
    setFurthest((was) => Math.max(was, next));
  }, []);
  const [busy, setBusy] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [info, setInfo] = useState<SetupState>();
  const [saved, setSaved] = useState<SetupSaved>(NOTHING_SAVED);
  const heading = useRef<HTMLHeadingElement>(null);

  // Workspace.
  const [entered, setEntered] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string>();
  const [discovery, setDiscovery] = useState<{ result?: DiscoverResult; running: boolean; error?: string }>({ running: false });
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string>();
  const [pickedAgain, setPickedAgain] = useState<string>();
  const discoverySeq = useRef(0);
  const [toCreate, setToCreate] = useState<Set<string>>(new Set());
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(new Map());
  // Marked to be created but there by the time the user continued: found after all, saved like any other root.
  const [appeared, setAppeared] = useState<Set<string>>(new Set());
  const [githubOpen, setGithubOpen] = useState(false);
  const [listed, setListed] = useState<ListedRepo[]>([]);
  const [cloneIds, setCloneIds] = useState<Record<string, string>>({});
  const [cloneRefused, setCloneRefused] = useState<Record<string, string>>({});
  const clones = useGithubClones();
  const cloneActions = useCloneActions();
  // A clone setup started that uses OpenSpec was tracked by the server: read the configuration it changed, so the later
  // steps see the project.
  useEffect(
    () =>
      githubClones.onFinished((done) => {
        if (done.some((c) => c.state === "tracked")) void api.config().then(onSaved, () => {});
      }),
    [onSaved],
  );

  // Agents.
  const [availability, setAvailability] = useState<{ agents: AgentAvailability[]; presets: AgentAvailability[] }>();
  // Switched on by default: continuing past the Agents step, which states what sessions may do, turns them on.
  const [enable, setEnable] = useState(true);
  const [checked, setChecked] = useState<string[]>();
  const [custom, setCustom] = useState<CustomAgent[]>([]);
  const [defaultAgent, setDefaultAgent] = useState<string>();
  const [agentsError, setAgentsError] = useState<string>();
  const customSeq = useRef(0);

  // Console.
  const [consoleChoice, setConsoleChoice] = useState<string | undefined | null>(null);
  const [consoleError, setConsoleError] = useState<string>();

  // Project settings.
  const [mode, setMode] = useState<ProjectSettingsMode>("all");
  const [allDraft, setAllDraft] = useState<SettingsDraft>({});
  const [eachDraft, setEachDraft] = useState<Map<string, SettingsDraft>>(new Map());
  const [projectIndex, setProjectIndex] = useState(0);
  const [projectsError, setProjectsError] = useState<string>();
  const [help, setHelp] = useState<ProjectSetting>();
  // An overlay belongs to the rows shown: moving to another step, project or mode closes it.
  useEffect(() => setHelp(undefined), [step, mode, projectIndex]);
  const closeHelp = useCallback((refocus: boolean) => {
    setHelp((open) => {
      if (open && refocus) document.getElementById(helpButtonId(open))?.focus();
      return undefined;
    });
  }, []);
  // The step scrolls inside the dialog: bring an overlay opened near its bottom edge into view.
  useEffect(() => {
    if (help) document.getElementById(`${helpButtonId(help)}-text`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [help]);
  // A click outside the open overlay and its help control closes it.
  useEffect(() => {
    if (!help) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".setup-help")) closeHelp(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [help, closeHelp]);

  // System check.
  const [report, setReport] = useState<EnvironmentReport>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();

  // The Agents step's executable lookup, run once and again on **Check again**; it keeps what the user checked.
  const [lookingUp, setLookingUp] = useState(false);
  const lookUpAgents = useCallback(async () => {
    setLookingUp(true);
    try {
      const s = await api.sessions();
      setAvailability({ agents: s.agents, presets: s.presets });
    } catch {
      setAvailability((was) => was ?? { agents: [], presets: [] });
    } finally {
      setLookingUp(false);
    }
  }, []);

  useEffect(() => {
    api.setup().then(setInfo, () => undefined);
    void lookUpAgents();
  }, [lookUpAgents]);

  // The step's heading takes focus, so a screen reader announces where the user is and Tab starts in the step.
  useEffect(() => heading.current?.focus(), [step]);

  const configuredRoots = config?.scanRoots ?? [];
  const missing = new Map((discovery.result?.errors ?? []).filter((e) => entered.includes(e.root) && !appeared.has(e.root)).map((e) => [e.root, e.message]));
  const rootReady = workspaceRootReady(configuredRoots, entered, missing, toCreate);

  // Discovery over the configured and entered roots, without saving; only the latest run's result is shown.
  const rootsKey = JSON.stringify([configuredRoots, entered]);
  useEffect(() => {
    const roots = [...configuredRoots, ...entered.filter((r) => !configuredRoots.includes(r))];
    const mine = ++discoverySeq.current;
    if (roots.length === 0) {
      setDiscovery({ running: false });
      return;
    }
    setDiscovery((was) => ({ ...was, running: true }));
    api.discover(roots, config?.ignorePaths ?? []).then(
      (result) => mine === discoverySeq.current && setDiscovery({ result, running: false }),
      (err) => mine === discoverySeq.current && setDiscovery({ running: false, error: message(err) }),
    );
  }, [rootsKey]);

  const choices = config && availability ? agentChoices(config, availability.agents, availability.presets) : [];
  // Checked and preselected once the choices are known; the user's choices win from then on.
  useEffect(() => {
    if (checked !== undefined || !config || !availability) return;
    const initial = initiallyChecked(choices);
    setChecked(initial);
    setDefaultAgent(preselectedAgent(config, choices, initial));
  }, [config, availability]);
  const checkedIds = checked ?? choices.filter((c) => c.configured).map((c) => c.id);
  const defaultOptions = defaultAgentOptions(choices, checkedIds, custom);
  const chosenDefault = defaultAgent && defaultOptions.some((o) => o.id === defaultAgent) ? defaultAgent : config ? preselectedAgent(config, choices, checkedIds) : "";
  const agentsChoice = { enable, checked: checkedIds, custom, defaultAgent: chosenDefault };
  const agentsBlocked = availability && !agentsReady(choices, checkedIds, custom) ? "Choose at least one agent to continue." : undefined;
  const savedEnabled = config?.agentSessions.enabled === true;

  const storedConsole = config?.agentSessions.consoleAgent;
  const consoleAgent = consoleChoice === null ? storedConsole : consoleChoice;

  // Which projects are git repositories, from the latest scan; a project without an entry is still being scanned. The
  // app refreshes its snapshot only on its poll interval, and a scan asked for while another runs is dropped, so while
  // the step waits it asks for a scan (read-only; a no-op while one runs) and reads the state itself.
  const [ownSnapshot, setOwnSnapshot] = useState<Snapshot>();
  const latest = ownSnapshot && (!snapshot || ownSnapshot.generatedAt > snapshot.generatedAt) ? ownSnapshot : snapshot;
  const scanned = new Map((latest?.repos ?? []).map((r) => [r.id, r.isGit]));
  const isGit = (id: string) => scanned.get(id);
  const projects = config ? settingsProjects(config) : [];
  const waiting = step === STEP.projects && projects.some((r) => !scanned.has(r.id));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void api
        .scan()
        .catch(() => undefined)
        .then(() => api.state())
        .then(setOwnSnapshot, () => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [waiting]);
  const projectsDirty = mode === "all" ? Object.keys(allDraft).length > 0 : [...eachDraft.values()].some((d) => Object.keys(d).length > 0);

  /** Something entered on the current step that its Continue has not saved. */
  const dirty =
    (step === STEP.workspace && (entered.length > 0 || input.trim() !== "" || listed.some((r) => !cloneIds[r.path]))) ||
    (step === STEP.agents && config !== null && agentsSave(config, agentsChoice) !== null) ||
    (step === STEP.console && config !== null && consoleSave(config, consoleAgent) !== null) ||
    (step === STEP.projects && projectsDirty);

  const loadReport = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await api.environment(true, "setup"));
      setCheckError(undefined);
    } catch (err) {
      setCheckError(message(err));
    } finally {
      setChecking(false);
    }
  }, []);
  // The Done step asks again: the user may have installed something since the System check ran.
  useEffect(() => {
    if (step === STEP.system || step === STEP.done) void loadReport();
  }, [step, loadReport]);

  const finish = useCallback(async () => {
    let done = false;
    try {
      onSaved(await api.markSetupDone());
      done = true;
    } catch {
      // Closed anyway: setup is still pending and the wizard opens again on the next load.
    }
    onClose(done);
  }, [onSaved, onClose]);

  const requestSkip = useCallback(() => {
    if (dirty) setConfirmingSkip(true);
    else void finish();
  }, [dirty, finish]);

  // Escape acts as Skip setup — after a confirmation when something entered would be lost — and, while that
  // confirmation shows, as Keep going. While the system's folder dialog is open it does nothing here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Add from GitHub dialog handles its own Escape.
      if (e.key !== "Escape" || busy || picking || githubOpen) return;
      e.stopPropagation();
      // Escape closes an open help overlay first, and does not end setup.
      if (help) {
        closeHelp(true);
        return;
      }
      if (confirmingSkip) setConfirmingSkip(false);
      else requestSkip();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, picking, githubOpen, help, closeHelp, confirmingSkip, requestSkip]);

  const enterRoot = (root: string) => {
    if (!entered.includes(root) && !configuredRoots.includes(root)) setEntered((was) => (was.includes(root) ? was : [...was, root]));
  };

  const addRoot = (text: string) => {
    if (!text.trim()) return;
    if (!isAbsoluteRoot(text)) {
      setInputError("Enter a full path, such as ~/Workspace or /srv/projects.");
      return;
    }
    setInputError(undefined);
    setInput("");
    enterRoot(expandHome(text, info?.home ?? "~"));
  };

  const pickRoot = async () => {
    setPicking(true);
    setPickError(undefined);
    setPickedAgain(undefined);
    try {
      const result = await api.pickFolder();
      if (result.status === "chosen") {
        if (entered.includes(result.path) || configuredRoots.includes(result.path)) setPickedAgain(result.path);
        else enterRoot(result.path);
      }
      else if (result.status === "failed") setPickError(result.reason);
    } catch (err) {
      setPickError(message(err));
    } finally {
      setPicking(false);
    }
  };

  /** Starts the clone of one listed repository; a refusal is kept on it. Resolves to the clone's id, if it started. */
  const startClone = async (r: ListedRepo): Promise<string | undefined> => {
    try {
      const clone = await api.cloneGithub(r.repo, r.root, r.name);
      setCloneIds((was) => ({ ...was, [r.path]: clone.id }));
      setCloneRefused(({ [r.path]: _old, ...rest }) => rest);
      void githubClones.started(clone);
      return clone.id;
    } catch (err) {
      setCloneRefused((was) => ({ ...was, [r.path]: message(err) }));
      return undefined;
    }
  };

  /** Continue on the Workspace step: `continueWorkspaceStep` decides; this applies its result to the step. */
  const continueWorkspace = async (to: number = STEP.agents) => {
    setBusy(true);
    setWorkspaceError(undefined);
    try {
      const checkedPaths = (discovery.result?.candidates ?? []).filter((c) => !unchecked.has(c.path)).map((c) => c.path);
      const result = await continueWorkspaceStep(
        { entered, toCreate, missing: new Set(missing.keys()), checked: checkedPaths, listed, cloneIds, cloneRefused },
        {
          createWorkspaceFolder: api.createWorkspaceFolder,
          config: api.config,
          saveConfig: api.saveConfig,
          trackRepo: api.trackRepo,
          cloneGithub: api.cloneGithub,
          started: (clone) => {
            setCloneIds((was) => ({ ...was, [clone.path]: clone.id }));
            void githubClones.started(clone);
          },
          onSaved,
        },
      );
      const nowThere = new Set(result.nowThere);
      if (nowThere.size > 0) {
        setToCreate((was) => new Set([...was].filter((r) => !nowThere.has(r))));
        setAppeared((was) => new Set([...was, ...nowThere]));
      }
      setCreateErrors(result.createErrors);
      setCloneIds(result.cloneIds);
      setCloneRefused(result.cloneRefused);
      setSaved((was) => ({
        ...was,
        rootsAdded: [...was.rootsAdded, ...result.rootsAdded],
        rootsCreated: [...was.rootsCreated, ...result.created],
        tracked: was.tracked + result.tracked,
        cloned: [...was.cloned, ...result.cloned],
        clonePaths: [...was.clonePaths, ...result.clonePaths],
      }));
      // Saved: what was entered is configured now, whether or not a refused clone keeps the step open.
      if (result.saved) {
        setEntered([]);
        setUnchecked(new Set());
        setToCreate(new Set());
      }
      if (result.outcome === "next") {
        setListed([]);
        setCloneIds({});
        setCloneRefused({});
        setStep(to);
      }
    } catch (err) {
      setWorkspaceError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const continueAgents = async (to: number = STEP.console) => {
    setBusy(true);
    setAgentsError(undefined);
    try {
      const fresh = await api.config();
      const next = agentsSave(fresh, agentsChoice);
      if (next) {
        onSaved(await api.saveConfig(next));
        const added = next.agentSessions.agents.filter((a) => !fresh.agentSessions.agents.some((f) => f.id === a.id)).map((a) => a.name);
        setSaved((was) => ({ ...was, agentsAdded: [...was.agentsAdded, ...added] }));
        // Saved: from now on they are configured profiles, listed as such.
        setCustom([]);
        setChecked(undefined);
        setDefaultAgent(undefined);
      }
      setStep(to);
    } catch (err) {
      setAgentsError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const continueConsole = async (to: number = STEP.projects) => {
    setBusy(true);
    setConsoleError(undefined);
    try {
      const next = consoleSave(await api.config(), consoleAgent);
      if (next) onSaved(await api.saveConfig(next));
      setConsoleChoice(null);
      setStep(to);
    } catch (err) {
      setConsoleError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const continueProjects = async (to: number = STEP.done) => {
    setBusy(true);
    setProjectsError(undefined);
    try {
      const next = projectSettingsSave(await api.config(), mode, { all: allDraft, each: eachDraft }, (id) => isGit(id) === true);
      if (next) {
        onSaved(await api.saveConfig(next.config));
        setSaved((was) => ({ ...was, projectsChanged: was.projectsChanged + next.changed }));
      }
      setAllDraft({});
      setEachDraft(new Map());
      setStep(to);
    } catch (err) {
      setProjectsError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const changeSetting = (setting: ProjectSetting, value: string, repoId?: string) => {
    if (repoId === undefined) {
      setAllDraft((was) => {
        const { [setting]: _, ...rest } = was;
        return value === KEEP_EACH ? rest : { ...rest, [setting]: value };
      });
      return;
    }
    const repo = projects.find((r) => r.id === repoId);
    setEachDraft((was) => {
      const next = new Map(was);
      const { [setting]: _, ...rest } = next.get(repoId) ?? {};
      // Back to the project's own value: nothing to save for it.
      next.set(repoId, repo && settingValue(repo, setting) === value ? rest : { ...rest, [setting]: value });
      return next;
    });
  };

  /**
   * The step list: an earlier step opens as Back does, keeping what was entered; a later step already reached first saves
   * the current step exactly as its Continue would, and stays put when that fails.
   */
  const openStep = (target: number) => {
    if (busy || picking || target === step || target > furthest) return;
    if (target < step) return setStep(target);
    if (step === STEP.workspace) return void continueWorkspace(target);
    if (step === STEP.agents) return agentsBlocked ? undefined : void continueAgents(target);
    if (step === STEP.console) return void continueConsole(target);
    if (step === STEP.projects && config) return void continueProjects(target);
    setStep(target);
  };

  const frame = {
    step,
    reachable: furthest,
    onStep: openStep,
    busy: busy || picking,
    headingRef: heading,
    onBack: step > 0 ? () => setStep(step - 1) : undefined,
    onSkip: step < SETUP_STEPS.length - 1 ? requestSkip : undefined,
    confirmingSkip,
    onConfirmSkip: () => void finish(),
    onCancelSkip: () => setConfirmingSkip(false),
  };

  if (step === STEP.welcome) {
    return (
      <WizardFrame {...frame} onContinue={() => setStep(STEP.system)}>
        <WelcomeStep />
      </WizardFrame>
    );
  }
  if (step === STEP.system) {
    return (
      <WizardFrame {...frame} onContinue={() => setStep(STEP.workspace)}>
        <SystemCheckStep report={report} loading={checking} error={checkError} onRecheck={() => void loadReport()} />
      </WizardFrame>
    );
  }
  if (step === STEP.workspace) {
    const view: WorkspaceView = {
      configuredRoots,
      entered,
      missing,
      suggestions: (info?.suggestedRoots ?? []).filter((s) => !entered.includes(s) && !configuredRoots.includes(s)),
      input,
      inputError,
      discovery: discovery.result,
      discovering: discovery.running,
      discoveryError: discovery.error,
      unchecked,
      saveError: workspaceError,
      picker: info?.folderPicker === true,
      picking,
      pickError,
      pickedAgain,
      toCreate,
      createErrors,
      proposed: proposedWorkspace(info?.home, configuredRoots, info?.suggestedRoots ?? []),
      github: {
        listed,
        clones: Object.fromEntries(Object.entries(cloneIds).map(([path, id]) => [path, clones.clones.find((c) => c.id === id)])),
        refused: cloneRefused,
        off: clones.gitAvailable === false ? "git was not found on this machine" : rootReady ? undefined : "choose or create a workspace folder first",
      },
    };
    const githubRoots = githubRootChoices(configuredRoots, entered, missing, toCreate);
    return (
      <WizardFrame {...frame} continueBlocked={rootReady ? undefined : "A workspace folder is needed: choose one or create a new one."} onContinue={() => void continueWorkspace()}>
        <WorkspaceStep
          view={view}
          onInput={setInput}
          onAdd={addRoot}
          onPick={() => void pickRoot()}
          onCreate={(root) =>
            setToCreate((was) => {
              const next = new Set(was);
              if (next.has(root)) next.delete(root);
              else next.add(root);
              return next;
            })
          }
          onPropose={(path) => {
            enterRoot(path);
            setToCreate((was) => new Set([...was, path]));
          }}
          onAddGithub={() => setGithubOpen(true)}
          onRemoveGithub={(path) => setListed(listed.filter((r) => r.path !== path))}
          onRenameGithub={(path, name) => {
            const to = joinPath(listed.find((r) => r.path === path)?.root ?? "", name.trim());
            setListed(listed.map((r) => (r.path === path ? { ...r, name: name.trim(), path: to } : r)));
            // The refusal follows the row, so its reason stays in view while the name is edited.
            setCloneRefused(({ [path]: reason, ...rest }) => (reason === undefined ? rest : { ...rest, [to]: reason }));
          }}
          onRetryGithub={(path) => {
            const r = listed.find((l) => l.path === path);
            if (r) void startClone(r);
          }}
          onRemove={(root) => {
            setEntered(entered.filter((r) => r !== root));
            setToCreate((was) => new Set([...was].filter((r) => r !== root)));
            setListed(listed.filter((l) => l.root !== root || cloneIds[l.path] !== undefined));
          }}
          onToggle={(path) => {
            const next = new Set(unchecked);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            setUnchecked(next);
          }}
        />
        {githubOpen && (
          <AddGithubDialog
            roots={githubRoots}
            mode="collect"
            taken={listed.map((r) => r.path)}
            onClose={() => setGithubOpen(false)}
            onCollect={(targets) => setListed((was) => [...was, ...targets.filter((t) => !was.some((r) => r.path === t.path)).map((t) => ({ repo: t.repo, root: t.root, name: t.name, path: t.path }))])}
          />
        )}
      </WizardFrame>
    );
  }
  // Checked agents the last lookup did not find: the Agents step says how to install them, the Done step names them.
  const missingAgents = choices.filter((c) => !c.available && (c.configured || checkedIds.includes(c.id)));
  if (step === STEP.agents) {
    const platform = info?.platform ?? "linux";
    const installs = missingAgents.map((c) => ({
      name: c.name,
      steps: agentInstallSteps(config?.agentSessions.agents.find((a) => a.id === c.id) ?? { id: c.id, name: c.name, command: [c.id] }, platform),
    }));
    const view: AgentsView = {
      savedEnabled,
      enable: savedEnabled || enable,
      choices,
      checked: checkedIds,
      custom,
      defaultOptions,
      defaultAgent: chosenDefault,
      installs,
      checking: lookingUp,
      saveError: agentsError,
    };
    return (
      <WizardFrame {...frame} onContinue={() => void continueAgents()} continueBlocked={agentsBlocked}>
        <AgentsStep
          view={view}
          onRecheck={() => void lookUpAgents()}
          onEnable={setEnable}
          onCheck={(id, on) =>
            // From the latest state, not this render's: two quick clicks must not undo each other.
            setChecked((was) => {
              const list = was ?? checkedIds;
              return on ? (list.includes(id) ? list : [...list, id]) : list.filter((c) => c !== id);
            })
          }
          onAddCustom={() => setCustom((was) => [...was, { key: String(++customSeq.current), name: "", command: "" }])}
          onCustomChange={(key, patch) => setCustom((was) => was.map((a) => (a.key === key ? { ...a, ...patch } : a)))}
          onRemoveCustom={(key) => setCustom((was) => was.filter((a) => a.key !== key))}
          onDefault={setDefaultAgent}
        />
      </WizardFrame>
    );
  }
  if (step === STEP.console) {
    const agents = config?.agentSessions.agents ?? [];
    const found = new Map(choices.map((c) => [c.id, c.available]));
    const view: ConsoleView = {
      sessionsOn: savedEnabled,
      agents: agents.map((a) => ({ id: a.id, name: a.name, available: found.get(a.id) })),
      defaultName: agents.find((a) => a.id === config?.agentSessions.defaultAgent)?.name ?? "the default agent",
      choice: consoleAgent,
      saveError: consoleError,
    };
    return (
      <WizardFrame {...frame} onContinue={() => void continueConsole()}>
        <ConsoleStep view={view} onChoose={setConsoleChoice} />
      </WizardFrame>
    );
  }
  if (step === STEP.projects && config) {
    const view: ProjectSettingsView = { config, projects, isGit, mode, all: allDraft, each: eachDraft, index: projectIndex, help, saveError: projectsError };
    return (
      <WizardFrame {...frame} onContinue={() => void continueProjects()}>
        <ProjectSettingsStep view={view} onMode={setMode} onChange={changeSetting} onIndex={setProjectIndex} onHelp={(setting) => setHelp((open) => (open === setting ? undefined : setting))} />
      </WizardFrame>
    );
  }
  if (step === STEP.projects) {
    return (
      <WizardFrame {...frame} onContinue={() => setStep(STEP.done)}>
        <p class="hint">Loading the configuration…</p>
      </WizardFrame>
    );
  }
  // The clones setup started, as the clone list reports them now; a retry keeps the folder, so they are found by path.
  const setupClones = clones.clones.filter((c) => saved.clonePaths.includes(c.path));
  return (
    <WizardFrame {...frame} onContinue={() => void finish()} continueLabel="Finish">
      <DoneStep
        summary={setupSummary(config, saved, report, missingAgents.map((c) => c.name), setupClones.filter(isCloneActive).length)}
        firstStart={info?.pending === true}
        home={info?.home}
        clones={setupClones}
        cloneActions={cloneActions}
        now={Date.now()}
      />
    </WizardFrame>
  );
}
