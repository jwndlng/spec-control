// Shared data model between server and UI (design.md D3).

/** Character set of a change directory name: letters, digits, dots, dashes, underscores — same rule the scanner enforces. */
export const CHANGE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export type ArtifactState = "done" | "ready" | "blocked";

/** The lifecycle phase a change is in; each stage has exactly one board column (`STAGE_COLUMN`). */
export type Stage = "backlog" | "drafts" | "unknown" | "ready" | "implementing" | "done" | "archived";

export interface ArtifactStatus {
  id: string;
  status: ArtifactState;
  /** Named by the schema's `apply.requires` (every artifact when it names none): needed before implementing. Absent in
   *  snapshots recorded before it was reported, which then count every artifact as required. */
  required?: boolean;
}

export interface TaskProgress {
  /** `[x]` boxes only: verified work. A task awaiting validation is never counted here. */
  done: number;
  /** `[~]` boxes: finished by the agent, not yet confirmed by a person. Absent in snapshots cached by older versions. */
  awaiting?: number;
  /** Every checkbox: done, awaiting and open together. */
  total: number;
}

/** A change in `Done` is either awaiting a person's confirmation (`validate`) or fully verified (`complete`). */
export type DoneSubState = "complete" | "validate";

/**
 * One dependency a change declares in its `depends-on.yaml`, resolved against the repository's other changes:
 * `met` — the main checkout holds it archived or in `Done`; `cycle` — following unmet dependencies from it leads back;
 * `missing` — no change of that name exists; `waiting` — it exists but is not implemented and merged yet.
 */
export type DependencyState = "met" | "waiting" | "missing" | "cycle";

export interface ChangeDependency {
  name: string;
  state: DependencyState;
}

export interface ChangeSnapshot {
  repoId: string;
  name: string;
  schema: string;
  /** Artifacts in schema order. Empty when the change could not be loaded. */
  artifacts: ArtifactStatus[];
  /** null when the tasks artifact does not exist. */
  tasks: TaskProgress | null;
  /** From .openspec.yaml, ISO date. */
  created?: string;
  /** ISO date parsed from the archive directory name; present ⇒ archived. */
  archived?: string;
  /** Committer date of the last commit touching the change dir, or newest mtime. */
  lastActivityAt?: string;
  /**
   * The branch of the linked worktree the change's data comes from; for a change that lives in the main checkout, the
   * first branch or worktree branch whose name contains the change name.
   */
  branchMatch?: string;
  /**
   * The checkout this change's data comes from: the leading copy among all checkouts holding the change. Absent in
   * snapshots cached by older versions and for non-git repositories.
   */
  checkout?: ChangeCheckout;
  /** Other checkouts that hold a copy of this change, with the column that copy alone would be in. */
  otherCheckouts?: (ChangeCheckout & { column: string })[];
  /**
   * Whether the delta specs are already reflected in `openspec/specs/`. Only set for non-archived changes whose tasks
   * are all complete; it does not affect the column (such a change is `Done` until archived).
   */
  specsSynced?: boolean;
  stage: Stage;
  /** Display column, e.g. "Drafts", "Implementing". */
  column: string;
  /** Only for `done`: `validate` while a person still has to confirm a task. Derived with the column, never stored. */
  subState?: DoneSubState;
  /**
   * Contents of the change's `prompt.md`, when present. A free-text hint the user jotted down when starting the change;
   * not a schema artifact and does not affect artifact status. Bounded, so pathological files do not bloat the snapshot.
   */
  prompt?: string;
  /**
   * The changes this one declares in `depends-on.yaml`, in file order, each with its state. Only for active changes
   * that declare any; derived on every scan, never stored.
   */
  dependsOn?: ChangeDependency[];
  /** Names of the active changes of the same repository that depend on this one, sorted. Absent when there are none. */
  requiredBy?: string[];
  /**
   * `true` while a dependency is not `met` or `depends-on.yaml` could not be read: **Implement** is withheld. Absent
   * otherwise — and in snapshots cached by older versions, which therefore read as not blocked.
   */
  blocked?: boolean;
  /**
   * The GitHub issue this change was imported from, as its `issue.yaml` records it (openspec/specs/issue-import). Read
   * for active and archived changes; display only, never an input to columns, counts or actions. The link is always
   * derived with `issueUrl`, never read from the file.
   */
  sourceIssue?: SourceIssue;
  /** Non-fatal problems while reading this change. */
  warnings?: string[];
}

/** Working-tree state of one checkout. Counts only — never the names of changed files. */
export interface CheckoutStatus {
  /** Tracked files that differ from `HEAD`, staged or not, including renamed and unmerged ones. */
  modified: number;
  /** Untracked items; an untracked directory counts once. */
  untracked: number;
  /** Unmerged files; they are also part of `modified`. */
  conflicts: number;
  upstream?: string;
  /** Relative to the last fetch, and only present with an upstream. */
  ahead?: number;
  behind?: number;
}

/**
 * One checkout of a repository as `git worktree list` reports it: the main checkout (`isMain`) or a linked worktree.
 * Everything but `path` is optional so snapshots cached by older versions still load.
 */
export interface Worktree {
  path: string;
  /** Absent when HEAD is detached. */
  branch?: string;
  /** Abbreviated commit, for naming a detached checkout. */
  head?: string;
  detached?: boolean;
  /** The repository's main working tree (git lists it first); everything else is a linked worktree. The main checkout is not a worktree: every worktree count excludes it. */
  isMain?: boolean;
  /** git considers it removable, typically because its directory is gone ("stale"); such a worktree is never inspected. */
  prunable?: boolean;
  /** A bare repository entry: there is no working tree to read. */
  bare?: boolean;
  locked?: boolean;
  lockReason?: string;
  /** `false` when the per-repository cap left this worktree without a status. */
  inspected?: boolean;
  /**
   * Commits not pushed as of the last fetch: `ahead` with an upstream, otherwise the commits on no remote-tracking ref
   * (capped at 100). Absent when the repository has no remote-tracking refs.
   */
  unpushed?: number;
  status?: CheckoutStatus | "unknown";
}

/** Roll-up of a repository's checkouts, derived solely from `worktrees` (`summarizeWorkInProgress`). */
export interface WorkInProgress {
  /** Linked worktrees; the main checkout is not one. */
  worktrees: number;
  /** Checkouts, main included, with modified or untracked items. */
  uncommitted: number;
  unpushed: number;
  stale: number;
  unknown: number;
}

/** Where a change's data was read from. */
export interface ChangeCheckout {
  path: string;
  branch?: string;
  isMain: boolean;
}

/**
 * A spec-driven framework module that reads repositories (spec-frameworks spec). A lowercase kebab-case identifier;
 * `openspec` is the only module today.
 */
export type FrameworkId = string;

/** The framework a repository is read by when nothing says otherwise: snapshots cached before `framework` existed. */
export const DEFAULT_FRAMEWORK: FrameworkId = "openspec";

/**
 * What both sides know about each registered framework module: its display name and where its changes live, relative
 * to the project folder. The server modules take their label and layout from here, so the UI needs no server code.
 */
export const FRAMEWORK_INFO: Readonly<Record<FrameworkId, { label: string; changesDir: string }>> = {
  openspec: { label: "OpenSpec", changesDir: "openspec/changes" },
};

/** The display facts of a repository's framework; an unknown or absent id reads as the default framework. */
export function frameworkInfo(id: FrameworkId | undefined): { label: string; changesDir: string } {
  return FRAMEWORK_INFO[id ?? DEFAULT_FRAMEWORK] ?? FRAMEWORK_INFO[DEFAULT_FRAMEWORK];
}

export interface RepoSnapshot {
  id: string;
  name: string;
  path: string;
  /** The framework module that read this repository. Absent in snapshots cached by older versions: read as `openspec`. */
  framework?: FrameworkId;
  ok: boolean;
  error?: string;
  warnings?: string[];
  scannedAt: string;
  isGit: boolean;
  currentBranch?: string;
  /**
   * The repository's default branch: what `origin/HEAD` points to, else `main`, else `master`. Omitted when it cannot be
   * determined (and in snapshots cached by older versions).
   */
  defaultBranch?: string;
  /**
   * Whether the main checkout is on `defaultBranch` (false when HEAD is detached). Archives, specs and progress are read
   * from the main checkout, so off the default branch they may be outdated. Omitted with `defaultBranch`.
   */
  onDefaultBranch?: boolean;
  /**
   * A git repository with nothing to branch a session from: `HEAD` names no commit and there is no `origin/HEAD` (as
   * **New project** leaves it). Its change sessions run in place. Omitted otherwise, when unknown and for non-git folders.
   */
  noCommit?: true;
  /**
   * Whether the repository has a remote it can be fetched from: a remote-tracking ref or an `origin`. Omitted for
   * non-git folders and in snapshots cached by older versions.
   */
  hasRemote?: boolean;
  /** When the repository was last fetched, by anyone: the time of its `FETCH_HEAD`. Omitted when never fetched. */
  lastFetchedAt?: string;
  /** The most recent automatic fetch, or a pull since, as this run of the dashboard saw it. Display only. */
  autoFetch?: AutoFetchOutcome;
  /** Every checkout, the main one included. */
  worktrees: Worktree[];
  /** Absent for non-git repositories and in snapshots cached by older versions. */
  workInProgress?: WorkInProgress;
  /**
   * Latest change to anything under `openspec/`: the last commit touching it, or the mtime of a file
   * git reports as modified/untracked there, whichever is newer. Absent in snapshots cached by older versions.
   */
  lastUpdatedAt?: string;
  /** Shared profiles found in this repository's `openspec/config.yaml`. Absent until the dashboard has at least one profile. */
  sharedConfig?: RepoSharedConfig;
  /** Technology labels derived from marker files in the project folder (`shared/labels.ts`). Absent when the scan
   *  failed and in snapshots cached by older versions. */
  detectedLabels?: DetectedLabel[];
  changes: ChangeSnapshot[];
}

export interface Snapshot {
  generatedAt: string;
  repos: RepoSnapshot[];
}

export interface RepoConfig {
  /** Stable hash of the absolute path. */
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  /** Per-repository agent-session settings. Absent means "included": once sessions are enabled globally they apply to
   *  every tracked repository unless it is switched off here. */
  agent?: RepoAgentConfig;
  /** The user's own labels, in the order given. Absent when there are none. */
  labels?: string[];
  /** Detected labels the user hid for this repository (compared ignoring case). Absent when there are none. */
  hiddenLabels?: string[];
  /** How this project's pull requests are titled, which Ship asks the agent for. Absent means no convention. */
  prTitleConvention?: PrTitleConvention;
  /**
   * Fetch the project's remote at this interval, in seconds; `0` is Off. Absent means the default, every minute
   * (`autoFetchInterval`), so the key only records a departure from it.
   */
  autoFetchSeconds?: AutoFetchSeconds | 0;
}

/** The intervals a project can be fetched at automatically (repository-pull: "fetched automatically unless switched off"). */
export const AUTO_FETCH_SECONDS = [15, 30, 60, 300, 600, 900, 1800, 3600] as const;
export type AutoFetchSeconds = (typeof AUTO_FETCH_SECONDS)[number];
/** The interval of a project without a saved auto-fetch setting. */
export const DEFAULT_AUTO_FETCH_SECONDS: AutoFetchSeconds = 60;

/** How often a project is fetched automatically, in seconds, or undefined when its auto fetch is switched off. */
export function autoFetchInterval(repo: Pick<RepoConfig, "autoFetchSeconds"> | undefined): AutoFetchSeconds | undefined {
  const seconds = repo?.autoFetchSeconds ?? DEFAULT_AUTO_FETCH_SECONDS;
  return seconds === 0 ? undefined : seconds;
}

/** What the last automatic fetch of a repository, or a pull after it, came to. Kept in memory only. */
export interface AutoFetchOutcome {
  at: string;
  ok: boolean;
  /** git's reason, credentials masked; only when `ok` is false. */
  reason?: string;
}

/** A pull request title convention a project can declare. One value today; an enum so another needs no migration. */
export type PrTitleConvention = "conventional-commits";

/** A label the scan derived from the repository's files; `marker` says what produced it, e.g. "`.tf` files". */
export interface DetectedLabel {
  label: string;
  marker: string;
}

export interface RepoAgentConfig {
  enabled: boolean;
  /** Agent profile used for this repository; absent means the default agent. */
  agentId?: string;
  /** Ship asks the agent to enable auto-merge when the session ships only files under `openspec/`. Absent means off. */
  autoMergeDocs?: boolean;
}

/**
 * One agent CLI the dashboard can start in a terminal. Nothing here is specific to a vendor: a profile is a command
 * line plus the opening prompts, so any CLI that runs interactively in a terminal can be described.
 */
export interface AgentProfile {
  id: string;
  name: string;
  /** Argument list, never a shell string. `{prompt}` is replaced by the opening prompt as one argument; without it
   *  the prompt is typed into the terminal once the agent has started. */
  command: string[];
  /** Opening prompt per session starter; `{change}` is the only placeholder. A starter without a prompt is not offered. */
  prompts: Partial<Record<PromptKey, string>>;
  /** Additional instructions appended to the prompt of the same key, composed as one line. Never a prompt of its own:
   *  a key without a prompt stays unavailable and its text is sent nowhere — except `ship`, which has a default. */
  promptSuffixes?: Partial<Record<PromptKey, string>>;
  /** Continues this agent's latest conversation in the same directory, e.g. ["claude", "--continue"]. */
  resumeCommand?: string[];
  /** Environment variables removed for the agent, e.g. API keys so a CLI's own login is used. */
  unsetEnv?: string[];
}

/**
 * One shortcut of the agent console: a control that types a prepared prompt into the running agent. The title is what
 * the control reads and is never sent; the prompt is what the agent receives, exactly as written — one line, with no
 * placeholder, because a shortcut is offered in every session, including those that belong to no change.
 */
export interface Shortcut {
  id: string;
  /** What the control reads. Never sent to the agent. */
  title: string;
  /** Typed into the agent's terminal exactly as written; one line, no placeholder. */
  prompt: string;
}

export interface AgentSessionsConfig {
  enabled: boolean;
  agents: AgentProfile[];
  defaultAgent: string;
  /** Where the main console's agent runs; absent means `~/.spec-control/console/`. Never inside a tracked repository. */
  consoleDir?: string;
  /** The profile the main console runs; absent means the default agent, which it then follows when the default changes. */
  consoleAgent?: string;
  /** The console's shortcuts, in the order they are offered. Empty means no shortcuts are offered at all. */
  shortcuts: Shortcut[];
  /** Whether Fast-forward asks for confirmation first; absent means it does. */
  confirmFastForward?: boolean;
}

export interface Config {
  version: 1;
  scanRoots: string[];
  /** Absolute path prefixes discovery never descends into or reports. Tracked repositories below them stay tracked. */
  ignorePaths: string[];
  repos: RepoConfig[];
  pollIntervalSeconds: number;
  port: number;
  agentSessions: AgentSessionsConfig;
  /** The colour the user chose per label, by lower-case label name, as a hue in degrees; absent when none was chosen. */
  labelColors?: Record<string, number>;
  /** `false` when the user turned Check for new versions off; absent means on (openspec/specs/update-notice). */
  updateCheck?: false;
  /** Only on a configuration created on first start or after a reset: the setup wizard has not been finished or skipped. */
  setup?: "pending";
}

/** What `GET /api/setup` answers (setup-wizard): whether setup is pending, and folders worth offering as roots. */
export interface SetupState {
  pending: boolean;
  home: string;
  suggestedRoots: string[];
  /** The platform the server runs on, which decides the install instructions shown (`darwin`, `linux` or `win32`). */
  platform: "darwin" | "linux" | "win32";
  /** Whether `POST /api/setup/folder` can open the system's folder dialog on this machine. */
  folderPicker: boolean;
}

/** What `POST /api/setup/folder` answers: the folder the user chose in the system's dialog, or why there is none. */
export type FolderPickResult = { status: "chosen"; path: string } | { status: "cancelled" } | { status: "failed"; reason: string };

/**
 * What the server last learned about newer releases (`GET /api/update`). `enabled` is false when the user turned the
 * check off or the build is `dev`; `available` is true only when it is enabled and `latest` is newer than `current`.
 */
export interface UpdateStatus {
  enabled: boolean;
  /** The running version, exactly as `GET /api/version` reports it. */
  current: string;
  /** The last release tag learned, kept across failed checks. */
  latest?: string;
  checkedAt?: string;
  outcome: "never" | "ok" | "failed";
  available: boolean;
}

/**
 * The session starters. `fastForward` drafts, implements and ships in one session; it has no prompt of its own — it is
 * composed from the Draft, Implement and Ship prompts (`fastForwardPrompt` in `src/server/sessions/agents.ts`).
 */
export type SessionAction = "draft" | "fastForward" | "implement" | "validate" | "archive";
export const SESSION_ACTIONS: readonly SessionAction[] = ["draft", "fastForward", "implement", "validate", "archive"];
/** The starters a profile carries a prompt for: every one but Fast-forward. */
export type StarterPromptKey = Exclude<SessionAction, "fastForward">;
export const STARTER_PROMPT_KEYS: readonly StarterPromptKey[] = ["draft", "implement", "validate", "archive"];
/**
 * `ship` is a prompt, not a starter: it asks the agent of an existing session to commit, push and open a pull request.
 * `integrate` is not a starter for a change either: it opens an integration session in a repository that does not use
 * OpenSpec yet. Unlike every other prompt it carries no placeholder — the folder is the agent's working directory, so
 * no text from the browser reaches the command line. `resolveConflicts` is a prompt of the same kind as `ship`: it
 * asks the agent of an existing session to make its branch merge into the base again.
 */
export type PromptKey = StarterPromptKey | "ship" | "integrate" | "resolveConflicts";
/** Agent-neutral on purpose, so every profile can ship without being configured for it. */
/** What a prompt sent on the user's behalf answers (a next step, Resolve conflicts): the session, and whether the prompt
 *  was submitted. `false` means the agent of a running session did not show the typed prompt (it may be showing a
 *  menu), so Enter was not pressed and nothing was confirmed. */
export type PromptResult = Session & { submitted: boolean };
/** What Ship and a starter's prompt sent into a running session answer: the same, plus whether the prompt carried an
 *  auto-merge instruction — `AUTO_MERGE_DOCS_INSTRUCTION` for Ship, `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION` for Archive. */
export type AutoMergePromptResult = PromptResult & { autoMerge: boolean };
export type ShipResult = AutoMergePromptResult;
/** What starting a session answers: the session, and whether its opening prompt carried
 *  `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`. Always `false` for a session that was already open and was returned. */
export type StartResult = Session & { autoMerge: boolean };

export const DEFAULT_SHIP_PROMPT =
  "Ship the work in this worktree: commit everything that belongs to it with a commit message that follows this repository's conventions, push the branch, and open a pull request against the default branch if there is none yet. Do not merge it. Tell me the pull request URL.";

/** What Ship adds for a project whose pull request titles follow Conventional Commits: one line, no placeholder. */
export const CONVENTIONAL_COMMITS_SHIP_SENTENCE =
  "Title the pull request as a Conventional Commit — <type>(<optional scope>): <summary>, for example feat(api): add pagination — and write the commit messages the same way.";

/** Appended to Ship's prompt, after the profile's additional instructions, only when the project allows docs-only pull
 *  requests to merge and the dashboard found nothing outside `openspec/` (auto-merge-docs design D4). One line, because
 *  it may be typed into a terminal; agent-neutral, so it names the GitHub feature and no tool; and worded to override an
 *  earlier "do not merge", since it has to work with the default prompt and with a profile's own alike. Not editable:
 *  it is the one instruction that loosens review. */
export const AUTO_MERGE_DOCS_INSTRUCTION =
  "This project lets a pull request that changes only files under openspec/ merge without review. So, in place of any instruction above not to merge it: once the pull request is open, check that every file it changes is under openspec/, and if so enable auto-merge on it so that it merges when its required checks pass; if any file is outside openspec/, leave it unmerged and tell me why. Tell me whether auto-merge was enabled.";

/** Appended to the Archive prompt, after the profile's additional instructions, only when the project allows docs-only
 *  pull requests to merge and the session's worktree holds nothing outside `openspec/` (archive-auto-merge-docs design
 *  D2). Unlike Ship's it presumes no pull request: the default Archive prompts open none, so it applies only if the
 *  agent opens one anyway, and says not to open one for its sake. One line, agent-neutral, not editable. */
export const AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION =
  "This project lets a pull request that changes only files under openspec/ merge without review. Do not open a pull request just because of this. But if you open one for this work, then, in place of any instruction above not to merge it: once it is open, check that every file it changes is under openspec/, and if so enable auto-merge on it so that it merges when its required checks pass; if any file is outside openspec/, leave it unmerged and tell me why. If you opened a pull request, tell me whether auto-merge was enabled.";

/** Agent-neutral like Ship's, and deliberately silent about method: rebase or merge is the repository's convention,
 *  which the agent knows and the dashboard does not. */
export const DEFAULT_RESOLVE_CONFLICTS_PROMPT =
  "The branch for {change} in this worktree no longer merges into the default branch. Bring it up to date with the default branch and resolve every conflict, keeping what this branch set out to do. Then run the project's checks and push the branch. Do not merge the pull request.";

/** Between the Draft and the Implement prompt of a Fast-forward prompt: one line, agent-neutral, not editable. */
export const FAST_FORWARD_CONTINUE_SENTENCE =
  "This change is fast-forwarded: once every artifact is written, do not stop for my review — the pull request will be its only review — and go straight on to implementing it:";

/** Between the Implement and the Ship prompt of a Fast-forward prompt: one line, agent-neutral, not editable. */
export const FAST_FORWARD_SHIP_SENTENCE = "When every task is settled, ship the work without asking me:";

/** Fast-forward needs both phases it chains; Ship always has a default. */
export function fastForwardAvailable(agent: Pick<AgentProfile, "prompts">): boolean {
  return Boolean(agent.prompts.draft) && Boolean(agent.prompts.implement);
}

/** Like Ship's, so every agent can integrate without being configured for it. It names no change and carries no
 *  placeholder: the repository folder is the agent's working directory. Which tools OpenSpec is installed for is the
 *  agent's question to the user, not ours. */
export const DEFAULT_INTEGRATE_PROMPT =
  "Set this project up for OpenSpec: run `openspec init` in this folder, ask me which tools to install it for, and tell me what it created when you are done.";

/**
 * What became of the work in a session's worktree, from local git only (nothing is fetched, so `merged` is as of the
 * user's last fetch). `clean`: no commit the base lacks; `missing`: the directory is not a worktree (any more).
 */
export type WorkState = "missing" | "clean" | "uncommitted" | "unpushed" | "pushed" | "merged";
export const SHIPPABLE_WORK: readonly WorkState[] = ["uncommitted", "unpushed", "pushed"];
/** States holding work the base does not have yet — the only ones where merging into the base is worth checking. */
export const CONFLICTABLE_WORK: readonly WorkState[] = ["uncommitted", "unpushed", "pushed"];

/** That merging the branch into the base would conflict. Absent means it merges cleanly *or* could not be checked. */
export interface WorkConflicts {
  /** What it would be merged into, e.g. `origin/main`. */
  base: string;
  /** Conflicting paths, capped; never empty. */
  files: string[];
  /** Set when the cap cut the list short. */
  truncated?: boolean;
}

export interface WorkStatus {
  state: WorkState;
  /** Files for `uncommitted`, commits for `unpushed`. */
  count?: number;
  /** What the branch was compared with, e.g. `origin/main`. */
  base?: string;
  /** Only for `CONFLICTABLE_WORK`, and only when the check could be made. As of the user's last fetch, like `merged`. */
  conflicts?: WorkConflicts;
}

/** A directory under the dashboard's worktrees folder; it outlives session records, so it is listed on its own. */
export interface SessionWorktree {
  repoId: string;
  name: string;
  path: string;
  change: string;
  action: SessionAction;
  branch?: string;
  work: WorkStatus;
  /** Latest of the branch's last commit and its session's last update. */
  lastActivityAt?: string;
  /** Most recent session in this worktree, if its record still exists. */
  sessionId?: string;
}

/** A session is a process in a terminal: it runs, or it has ended. `failed` means it could not be started. */
export type SessionState = "running" | "exited" | "failed";

export const OPEN_SESSION_STATES: readonly SessionState[] = ["running"];

/** What every session has, whether it belongs to a change or is the main console. */
interface SessionBase {
  id: string;
  agentId: string;
  agentName: string;
  state: SessionState;
  exitCode?: number | null;
  error?: string;
  /**
   * The directory the agent runs in: the session's own worktree under the dashboard home, an adopted one — or, for an
   * in-place session, the repository folder itself.
   */
  worktreePath: string;
  /**
   * The worktree already existed with the session's branch checked out (git allows a branch in one worktree only), so
   * the session runs there. The dashboard did not create it and never removes it.
   */
  adopted?: boolean;
  /**
   * The repository is not a git repository, so there is no worktree to isolate the work in: the agent runs in the
   * repository folder itself and edits it directly. No branch, no work status, no Ship, no worktree removal, no pull.
   */
  inPlace?: boolean;
  /** Absent for an in-place session, which has no branch. */
  branch?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When the terminal last printed something that counts as activity: output within the echo window after the
   * dashboard resized the terminal or passed input to it does not. Decides whether a running session may need the user.
   */
  lastOutputAt?: string;
  /**
   * When the running agent reported, through its state file, that it is waiting for the user — set only while that
   * report is current (written after the process started and after the user's latest input). Never stored.
   */
  waitingReportedAt?: string;
  /** True once the agent has a conversation that `resumeCommand` can continue. */
  resumable: boolean;
}

/** A session started for one change of one repository, from a card's starter. */
export interface ChangeSession extends SessionBase {
  console?: undefined;
  integration?: undefined;
  projectConsole?: undefined;
  folder?: undefined;
  repoId: string;
  change: string;
  action: SessionAction;
  /**
   * When the dashboard last appended an auto-merge instruction to a prompt for this session (Ship, Archive started or
   * sent). Only a session that carries it is ever ended because its pull request merged (auto-merge-cleanup D1).
   */
  autoMergeAskedAt?: string;
  /** Set once the dashboard ended this session because its auto-merge pull request merged; it is never ended twice. */
  autoEnded?: AutoEnded;
}

/** What ending a session because its auto-merge pull request merged came to (auto-merge-cleanup D4). */
export interface AutoEnded {
  /** The merged pull request's number. */
  pr: number;
  at: string;
  /** Whether the worktree was removed (or was already gone). */
  removed: boolean;
  /** Why the worktree was kept, when it was. */
  reason?: string;
}

/**
 * The main console: the default agent in the console folder, belonging to no repository and no change. It has no
 * branch, no worktree of its own, no work status, no Ship and no pull, and is never part of Open work or the activity log.
 */
export interface ConsoleSession extends SessionBase {
  console: true;
  integration?: undefined;
  projectConsole?: undefined;
  folder?: undefined;
  repoId?: undefined;
  change?: undefined;
  action?: undefined;
  branch?: undefined;
  adopted?: undefined;
  inPlace?: undefined;
}

/**
 * Setting a repository up for OpenSpec: the default agent in a git repository that is not tracked yet, run **in place**
 * in its main checkout, because the point is to leave `openspec/config.yaml` where discovery looks for it. It belongs
 * to no repository in the config, no change and no action; it has no branch, no worktree of its own, no work status,
 * no Ship and no pull, and is never part of Open work or the activity log.
 */
export interface IntegrationSession extends SessionBase {
  integration: true;
  console?: undefined;
  projectConsole?: undefined;
  /** Canonical path of the repository being set up; the agent's working directory. */
  folder: string;
  repoId?: undefined;
  change?: undefined;
  action?: undefined;
  branch?: undefined;
  adopted?: undefined;
  inPlace: true;
}

/**
 * A project's console: the project's agent, without a prompt, run **in place** in the tracked folder — for a git
 * repository its main checkout — for general project work that is not a change (project-console spec). It carries the
 * repository it belongs to but no change, action or branch; it has no work status, no Ship and no pull, and is never
 * part of Open work or the activity log.
 */
export interface ProjectConsoleSession extends SessionBase {
  projectConsole: true;
  console?: undefined;
  integration?: undefined;
  repoId: string;
  /** The tracked folder; the agent's working directory. */
  folder: string;
  change?: undefined;
  action?: undefined;
  branch?: undefined;
  adopted?: undefined;
  inPlace: true;
}

export type Session = ChangeSession | ConsoleSession | IntegrationSession | ProjectConsoleSession;

export function isConsole(session: Session): session is ConsoleSession {
  return session.console === true;
}

export function isIntegration(session: Session): session is IntegrationSession {
  return session.integration === true;
}

export function isProjectConsole(session: Session): session is ProjectConsoleSession {
  return session.projectConsole === true;
}

/** A session that belongs to no change: the main console, integrations and project consoles. */
export function isChangeless(session: Session): session is ConsoleSession | IntegrationSession | ProjectConsoleSession {
  return isConsole(session) || isIntegration(session) || isProjectConsole(session);
}

/** A session that may be shown as a project's console: one of its project consoles, or the setup session in its folder. */
export type ProjectConsoleLike = ProjectConsoleSession | IntegrationSession;

/**
 * Every session that counts as the console of the project `repo`: its own project consoles, and the integration
 * sessions that ran in its folder — the agent that set the project up stays reachable once the project is tracked.
 */
export function projectConsoleSessions(sessions: readonly Session[], repo: { id: string; path: string }): ProjectConsoleLike[] {
  return sessions.filter((s): s is ProjectConsoleLike => (isProjectConsole(s) && s.repoId === repo.id) || (isIntegration(s) && s.folder === repo.path));
}

/** Which of a project's console sessions to show: a running one first, otherwise the newest. */
export function projectConsoleToShow(sessions: readonly ProjectConsoleLike[], preferred?: string): ProjectConsoleLike | undefined {
  return sessions.find((s) => OPEN_SESSION_STATES.includes(s.state)) ?? sessions.find((s) => s.id === preferred) ?? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Only the change sessions of a list: every view about repositories and changes starts here. */
export function changeSessions(sessions: readonly Session[]): ChangeSession[] {
  return sessions.filter((s): s is ChangeSession => !isChangeless(s));
}

export interface AgentAvailability {
  id: string;
  name: string;
  available: boolean;
  /** Resolved executable, when found. */
  path?: string;
}

/**
 * Why **Integrate** cannot be offered at all — as opposed to for one folder. Shared so the disabled row, the refusal
 * and the test all say the same thing. `undefined` means the action is available.
 */
export function integrateUnavailable(config: Config, agents: readonly AgentAvailability[]): string | undefined {
  if (!config.agentSessions.enabled) return "agent sessions are disabled";
  const agent = config.agentSessions.agents.find((a) => a.id === config.agentSessions.defaultAgent);
  if (!agent) return "no agent is configured";
  if (agents.find((a) => a.id === agent.id)?.available === false) return `${agent.name} was not found (${agent.command[0]})`;
  return undefined;
}

/**
 * Why **New project** cannot be offered (project-creation spec): it needs a workspace root to create the folder in, and
 * everything Integrate needs, because the new folder is handed to an integration session. `undefined` means available.
 */
export function newProjectUnavailable(config: Config, agents: readonly AgentAvailability[]): string | undefined {
  if (config.scanRoots.length === 0) return "add a workspace root in Settings first";
  return integrateUnavailable(config, agents);
}

/** A new project's folder name: one path segment, starting with a letter or digit, at most 100 characters. */
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Whether `name` may become a new project folder. `.git` names are refused: they read as a bare repository. */
export function isProjectName(name: string): boolean {
  return PROJECT_NAME.test(name) && !name.toLowerCase().endsWith(".git");
}

export interface CreateProjectRequest {
  /** One of the configured workspace roots (scan roots). */
  root: string;
  /** The new folder's name, created directly inside `root`. */
  name: string;
}

export interface CreateProjectResponse {
  /** Canonical path of the new folder. */
  path: string;
  /** The integration session started in it. */
  session: IntegrationSession;
}

/** Included unless explicitly switched off for this repository (the global switch is checked separately). */
export function repoAgentEnabled(repo: Pick<RepoConfig, "enabled" | "agent">): boolean {
  return repo.enabled && repo.agent?.enabled !== false;
}

/** Stages before every required artifact is written: the only ones Fast-forward is offered in. */
const UNPLANNED_STAGES: readonly Stage[] = ["unknown", "backlog", "drafts"];

/** The session starters a change currently qualifies for (before feature/opt-in checks). */
export function availableActions(change: Pick<ChangeSnapshot, "archived" | "artifacts" | "stage" | "subState" | "blocked">): SessionAction[] {
  if (change.archived) return [];
  const actions: SessionAction[] = [];
  if (change.artifacts.length === 0 || change.artifacts.some((a) => a.status !== "done")) {
    actions.push("draft");
    // Fast-forward is for a change not planned yet — once Ready it is Implement and Ship. It goes on to implement, so a
    // change waiting for its dependencies may only be drafted.
    if (!change.blocked && UNPLANNED_STAGES.includes(change.stage)) actions.push("fastForward");
  }
  // A change waiting for its dependencies may still be drafted; only implementing it would break the order.
  if ((change.stage === "ready" || change.stage === "implementing") && !change.blocked) actions.push("implement");
  // In `Done` there is nothing left to implement; offering it is what sends an agent back into finished code.
  if (change.stage === "done" && change.subState === "validate") actions.push("validate");
  if (change.stage === "done") actions.push("archive"); // every task settled, not archived yet
  return actions;
}

/** Another known repository with the same `origin` remote: probably a second clone, but never merged or hidden. */
export interface SameRemoteRepo {
  name: string;
  path: string;
  /** In the saved config (enabled or not), as opposed to another candidate. */
  tracked: boolean;
}

/**
 * A discovery candidate. `sameRemoteAs` and `framework` (the module whose project marker it has) are information for the
 * user and are dropped when the candidate is enabled.
 */
export type DiscoveredRepo = RepoConfig & { sameRemoteAs?: SameRemoteRepo[]; framework?: FrameworkId };

/**
 * A git repository under the roots that does not use OpenSpec yet: no `openspec/config.yaml`, not a linked worktree,
 * not in the config, and not a container of a reported OpenSpec project. Offered for integration, never tracked.
 */
export interface IntegratableRepo {
  id: string;
  path: string;
  name: string;
}

export interface DiscoverResult {
  /** Repositories found under the roots that are not in the config yet. Never persisted by discovery. */
  candidates: DiscoveredRepo[];
  /** Git repositories under the roots that have no OpenSpec yet. Empty when there are none. */
  integratable: IntegratableRepo[];
  errors: { root: string; message: string }[];
}

export interface ScanTriggerResult {
  started: boolean;
}

/** The board column of each stage, in board order. `Unknown` is shown only while a change is in it. */
export const STAGE_COLUMN: Record<Stage, string> = {
  backlog: "Backlog",
  drafts: "Drafts",
  unknown: "Unknown",
  ready: "Ready",
  implementing: "Implementing",
  done: "Done",
  archived: "Archived",
};

/**
 * A named set of guidance for agents that the dashboard keeps once and applies to many repositories'
 * `openspec/config.yaml`. A repository can carry several profiles at once (e.g. `base` plus `security`).
 */
export interface SharedProfile {
  /** Stable slug; written into the markers in repositories, so it identifies the profile there. */
  id: string;
  name: string;
  /** Injected by OpenSpec into every artifact instruction. */
  context: string;
  /** Artifact id → ordered rule texts. */
  rules: Record<string, string[]>;
}

/** The dashboard's shared OpenSpec config: profiles in the order they are written into a repository. */
export interface SharedConfig {
  profiles: SharedProfile[];
}

/**
 * `orphaned`: the repository carries managed content for a profile id the dashboard no longer has.
 */
export type AppliedProfileState = "in-sync" | "outdated" | "orphaned";

export interface AppliedProfile {
  id: string;
  state: AppliedProfileState;
}

/** Which shared profiles a repository's `openspec/config.yaml` carries, read from its markers. */
export interface RepoSharedConfig {
  /** The file is missing, not valid YAML, or its markers are malformed; nothing can be said or applied. */
  unreadable: boolean;
  applied: AppliedProfile[];
}

/** Desired profiles for one repository: exactly these, in dashboard order; an empty list removes all managed content. */
export interface SharedConfigAssignment {
  repoId: string;
  profileIds: string[];
}

export interface SharedConfigPreview {
  repoId: string;
  current: RepoSharedConfig;
  /** Current file text; empty when the file cannot be read. */
  before: string;
  /** What apply would write; equals `before` when nothing would change or apply would refuse. */
  after: string;
  /** Why apply would not write to this repository. */
  refusal?: string;
}

export interface SharedConfigApplyResult {
  repoId: string;
  result: "written" | "unchanged" | "refused";
  reason?: string;
}

/** One existing file of an artifact, relative to the change directory. */
export interface ChangeArtifactFile {
  path: string;
  bytes: number;
}

export interface ChangeArtifactEntry extends ArtifactStatus {
  /** Sorted; empty when the artifact has no file yet. */
  files: ChangeArtifactFile[];
}

/** Answer of `GET /api/repos/<repoId>/changes/<changeName>/artifacts`. */
export interface ChangeArtifacts {
  change: {
    repoId: string;
    name: string;
    schema: string;
    /** Absolute change directory; for archived changes the dated directory under `archive/`. */
    dir: string;
    archived: boolean;
  };
  /** In schema order. */
  artifacts: ChangeArtifactEntry[];
}

/** Answer of `GET /api/repos/<repoId>/changes/<changeName>/file?path=…`. */
export interface ArtifactFileContent {
  path: string;
  bytes: number;
  text: string;
}

// ---- Activity feed (openspec/specs/activity-feed) ----

interface ActivityBase {
  /** Format version of a log entry. */
  v: 1;
  /** Unique and sortable: later events have greater ids. */
  id: string;
  /** When it happened as far as the dashboard can tell (see `diffSnapshots`), ISO. */
  at: string;
  /** When the dashboard noticed, ISO. */
  detectedAt: string;
  repoId: string;
  /** The repository's name at that time, so entries of repositories that are no longer tracked stay readable. */
  repoName: string;
  /** Noticed on the first scan after the dashboard had not been running for a while. */
  catchUp?: boolean;
}

export type ActivityEvent = ActivityBase &
  (
    | { kind: "change-created"; change: string; to: string; tasks?: TaskProgress }
    | { kind: "change-moved"; change: string; from: string; to: string; tasks?: TaskProgress }
    | { kind: "tasks-progress"; change: string; column: string; from: TaskProgress; to: TaskProgress }
    | { kind: "change-archived"; change: string; from?: string }
    | { kind: "change-removed"; change: string; from: string }
    | { kind: "repo-tracked"; openChanges: number }
    | { kind: "repo-untracked" }
    | { kind: "repo-failing"; error: string }
    | { kind: "repo-recovered" }
    | { kind: "session-started"; change: string; action: string; agentName: string; resumed?: boolean }
    | { kind: "session-ended"; change: string; exitCode?: number; error?: string }
    | { kind: "session-shipped"; change: string; submitted?: boolean }
    /** The resolve prompt was handed over — not that the conflict was resolved: that is re-derived from git. */
    | { kind: "session-conflicts-resolve"; change: string; submitted?: boolean }
    /** Ended by the dashboard because the session's auto-merge pull request merged; `reason` says why the worktree was kept. */
    | { kind: "session-auto-ended"; change: string; pr: number; removed: boolean; reason?: string }
  );

export type ActivityKind = ActivityEvent["kind"];

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "change-created",
  "change-moved",
  "tasks-progress",
  "change-archived",
  "change-removed",
  "repo-tracked",
  "repo-untracked",
  "repo-failing",
  "repo-recovered",
  "session-started",
  "session-ended",
  "session-shipped",
  "session-conflicts-resolve",
  "session-auto-ended",
];

export type ActivityGroupName = "changes" | "tasks" | "sessions" | "repositories";

/** The filter groups of the Activity view, which its charts also stack by. */
export const ACTIVITY_GROUPS: Readonly<Record<ActivityGroupName, readonly ActivityKind[]>> = {
  changes: ["change-created", "change-moved", "change-archived", "change-removed"],
  tasks: ["tasks-progress"],
  sessions: ["session-started", "session-ended", "session-shipped", "session-conflicts-resolve", "session-auto-ended"],
  repositories: ["repo-tracked", "repo-untracked", "repo-failing", "repo-recovered"],
};

export interface ActivityPage {
  /** Newest first; consecutive task progress of one change is already collapsed. */
  events: ActivityEvent[];
  /** Pass as `before` to get older events; absent when there are none. */
  nextBefore?: string;
  /** The newest recorded event, whatever the filters; absent when nothing is recorded. */
  newestId?: string;
  /** Only when the request named `since`: how many recorded events are newer than that one, whatever the filters. */
  newerThanSince?: number;
  /** Only on the first page (no `before`): figures over every retained event matching the filters. */
  summary?: ActivitySummary;
  /** Only on the first page (no `before`): per day and per repository, over every retained event matching the filters. */
  metrics?: ActivityMetrics;
}

/** The Activity view's summary strip: counts of recorded events (not feed entries) within the retention window. */
export interface ActivitySummary {
  created: number;
  moved: number;
  archived: number;
  /** The sum of each task progress event's rise in finished tasks; a fall subtracts nothing. */
  tasksCompleted: number;
  /** Sessions started, resumed ones included. */
  sessions: number;
  /** Events the feed shows in its danger tone (`needsAttention`). */
  attention: number;
}

/**
 * The Activity view's per-day and per-project metrics: counts of recorded events (not feed entries) within the
 * retention window. A change is told apart by repository id and change name.
 */
export interface ActivityMetrics {
  events: number;
  /** Distinct changes touched by the events. */
  changes: number;
  /** Every calendar day of the window in the requested time zone, oldest first, quiet days included. */
  days: ActivityDayCount[];
  /** Every repository with a counted event, busiest first, then by name. */
  repos: ActivityRepoCount[];
}

export interface ActivityDayCount {
  /** `YYYY-MM-DD` in the requested time zone. */
  day: string;
  events: number;
  changes: number;
  /** Events per kind group. */
  groups: ActivityGroupCounts;
  /** The summary figures of that day alone. */
  figures: ActivitySummary;
  /** 24 counts: the events whose time falls in each hour 00–23 of the day, in the requested time zone. */
  hours: number[];
}

export type ActivityGroupCounts = Record<ActivityGroupName, number>;

export interface ActivityRepoCount {
  repoId: string;
  /** The name of its newest counted event. */
  repoName: string;
  events: number;
  changes: number;
  /** Events per kind group. */
  groups: ActivityGroupCounts;
}

/**
 * One uncommitted path that stops a fast-forward: the incoming commits change it and the main checkout has it modified,
 * staged or untracked. A **change leftover** is a file the dashboard's own create-change wrote and staged that the
 * incoming commits now bring along; anything else is the user's **local work** and is never touched
 * (openspec/specs/repository-pull: "Change leftovers blocking a pull are resolved on confirmation").
 */
export interface PullBlockingFile {
  /** Repository-relative, forward slashes — git's own spelling. */
  path: string;
  kind: "leftover" | "local-work";
  /** Leftovers only: the local content is not the incoming content, so a copy is kept before it is replaced. */
  differs?: boolean;
  /** Leftovers only. Blob ids, the claim a confirmation is checked against: upstream, index (when staged), working tree. */
  incoming?: string;
  staged?: string;
  worktree?: string;
}

/**
 * What a confirmed **Resolve and pull** claims: the upstream commit the user was shown and the blocking files exactly as
 * they were offered. The server re-determines all of it and proceeds only when its own answer matches this one.
 */
export interface PullResolve {
  /** Full commit id the upstream pointed at when the offer was made. */
  upstream: string;
  files: PullBlockingFile[];
}

/**
 * What the pull action did for one repository. The fetch and the update of the main checkout are reported separately:
 * the fetch is always safe, the update only happens when it is an unambiguous fast-forward on the default branch.
 */
export interface PullResult {
  repoId: string;
  /** The remote was fetched (remote-tracking refs are current). A confirmed resolve never fetches. */
  fetched: boolean;
  update: "fast-forwarded" | "up-to-date" | "skipped" | "refused" | "failed";
  /** Commits the main checkout moved forward. */
  commits?: number;
  /** Why the update was skipped, refused or failed — git's words where git decided. */
  reason?: string;
  branch?: string;
  upstream?: string;
  defaultBranch?: string;
  /** The repository has a post-merge hook; the dashboard does not run hooks. */
  hooksSkipped?: boolean;
  /** Refusals over uncommitted files: every blocking path, classified. Absent when git refused for another reason. */
  blocking?: PullBlockingFile[];
  /** Present only when every blocking file is a change leftover: post this back to run Resolve and pull. */
  resolvable?: PullResolve;
  /** What a confirmed resolve replaced, and where a copy of the local version was saved when it differed. */
  resolved?: { path: string; copy?: string }[];
  /** The next step in plain words, for a refusal the user has to act on. Never suggests forcing or discarding. */
  hint?: string;
}

/** What `POST /api/repos/<id>/changes` answers on success: the change exists on disk; `staged` says whether git tracks it already. */
export interface CreateChangeResponse {
  name: string;
  /** False when the repository is not a git repository or the `git add` failed — the change is there, merely untracked. */
  staged: boolean;
}

/**
 * Repository cleanup (openspec/specs/repository-cleanup). Every item is either `removable` or kept with a `reason`;
 * the preview is read-only and the server re-checks every item when a selection is applied.
 */
export interface CleanupWorktree {
  path: string;
  /** Absent when HEAD is detached. */
  branch?: string;
  work: WorkStatus;
  lastCommitAt?: string;
  /** The dashboard created it (it lives under `~/.spec-control/worktrees/`). */
  managed: boolean;
  locked?: boolean;
  removable: boolean;
  reason?: string;
}

export interface CleanupBranch {
  name: string;
  /** Full commit the branch points to; a branch is deleted only if it still points here. */
  commit: string;
  lastCommitAt?: string;
  upstream?: string;
  /** How the branch's work was found in the base: its commits are in it, or its changed files' content is. */
  mergedBy?: "ancestry" | "content";
  /** The linked worktree the branch is checked out in; the branch can only go together with that worktree. */
  worktreePath?: string;
  removable: boolean;
  reason?: string;
}

export interface CleanupPreview {
  repoId: string;
  /** What "merged" was judged against, e.g. `origin/main`; absent when the default branch is unknown. */
  base?: string;
  worktrees: CleanupWorktree[];
  /** Worktree records whose directory is gone; removed together by `git worktree prune`. */
  prunable: { path: string }[];
  branches: CleanupBranch[];
}

export interface CleanupSelection {
  worktrees: string[];
  prune: boolean;
  branches: { name: string; commit: string }[];
}

export interface CleanupItemResult {
  kind: "worktree" | "prune" | "branch";
  /** The worktree path, the pruned record's path, or the branch name. */
  id: string;
  outcome: "removed" | "pruned" | "deleted" | "kept";
  reason?: string;
  /** For a deleted branch: the commit it pointed to, to restore it with `git branch <name> <commit>`. */
  commit?: string;
}

export interface CleanupResult {
  repoId: string;
  items: CleanupItemResult[];
}

/** One file of a change directory as the dismiss confirmation shows it. */
export interface DismissFile {
  /** Relative to the change directory, with `/` separators. */
  path: string;
  /** `restorable`: tracked and identical to `HEAD`, so git can bring it back. `lost`: untracked, modified, or no git. */
  state: "restorable" | "lost";
}

/** What dismissing a change would delete (openspec/specs/change-dismissal). */
export interface DismissPreview {
  repoId: string;
  name: string;
  isGit: boolean;
  files: DismissFile[];
  /** Linked worktrees holding their own copy of the change; they are kept, and the card stays while one does. */
  copies: { path: string; branch?: string }[];
  /** "Same as shown" token over every file's path, size, mtime and state; the dismissal is refused when it changed. */
  fingerprint: string;
}

export interface DismissResult {
  name: string;
  /** Whether the removal was staged; false for a repository without git, an untracked change, or a failed `git add`. */
  staged: boolean;
}

/**
 * Status of one environment check (openspec/specs/environment-check). `not-needed` is not a weaker `ok`: it means the
 * configuration switched off the feature that would need it, so nothing was looked at.
 */
export type EnvironmentStatus = "ok" | "warning" | "problem" | "not-needed";

/** Worst first; `not-needed` last, so a report of only disabled features is not reported as `ok`. */
export const ENVIRONMENT_STATUS_ORDER: readonly EnvironmentStatus[] = ["problem", "warning", "ok", "not-needed"];

/** One prerequisite of the machine the dashboard runs on, as the environment report states it. */
export interface EnvironmentCheck {
  /** Stable: `git`, `git-identity`, `openspec-cli`, `github-cli`, `dashboard-home`, or `agent:<agent id>`. */
  id: string;
  label: string;
  status: EnvironmentStatus;
  /** What was found, in one line. Never a credential, and never a claim that something will work. */
  found: string;
  /** How to fix it, in one line; absent when the status is `ok` or `not-needed`. */
  remedy?: string;
  /** Steps for the platform the server runs on, each with a command the user may copy; never run by the dashboard. */
  instructions?: InstructionStep[];
}

/** One step of a check's instructions: what to do, and optionally the one command to run for it. */
export interface InstructionStep {
  text: string;
  command?: string;
}

/**
 * Which report: `settings` judges what matters from the saved configuration; `setup` is the wizard's System check, run
 * before agents or a workspace are chosen, so it leaves the per-agent checks to the Agents step and judges every tool
 * by what setup is about to switch on — nothing is `not-needed` (environment-check: the setup view leaves agents out).
 */
export type EnvironmentView = "settings" | "setup";

export interface EnvironmentReport {
  checkedAt: string;
  /** The worst status of any check, in `ENVIRONMENT_STATUS_ORDER`. */
  status: EnvironmentStatus;
  checks: EnvironmentCheck[];
  /**
   * What the report cannot know, because it contacts no network: present whenever the GitHub CLI check looked at
   * anything at all.
   */
  caveat?: string;
}

/** Checks the user is meant to act on: a `not-needed` check is not a problem, and an `ok` one needs nothing. */
export function environmentProblems(report: EnvironmentReport): number {
  return report.checks.filter((c) => c.status === "warning" || c.status === "problem").length;
}

/**
 * One pull request of a GitHub repository, as the dashboard reads it from `gh pr list` (openspec/specs/pull-requests).
 * Display only: nothing here is an input to scanning, columns or actions.
 */
export interface PullRequest {
  number: number;
  title: string;
  /** The pull request on github.com; the UI links to it and never fetches it. */
  url: string;
  /** Login of the author; empty when GitHub reports none (a deleted account). */
  author: string;
  head: string;
  base: string;
  draft: boolean;
  state: "open" | "merged" | "closed";
  createdAt: string;
  mergedAt?: string;
  closedAt?: string;
  /** GitHub's review decision; `none` when it has none (drafts, repositories without review rules). */
  review: "approved" | "changes_requested" | "review_required" | "none";
  /** The signed-in user is among the requested reviewers. Team requests are not resolved and do not count. */
  reviewRequestedFromViewer: boolean;
  checks: "passing" | "failing" | "pending" | "none";
  /**
   * Whether it merges cleanly into its base, as GitHub reports it; `unknown` while GitHub has not computed it. Absent
   * in caches written before it was read, which every reader treats as `unknown`.
   */
  mergeable?: "mergeable" | "conflicting" | "unknown";
}

/** What one tracked repository's pull-request list looks like right now. `pullRequests` is the last good list, also when `failed`. */
export interface RepoPullRequests {
  repoId: string;
  /** `owner/name` when the repository's `origin` is on github.com. */
  github?: string;
  /** `never`: not fetched yet. `unavailable`: cannot be queried at all (not on GitHub, no `gh`, not signed in). */
  status: "ok" | "unavailable" | "failed" | "never";
  /** Why it is `unavailable` or `failed`; credentials in any text from `gh` are masked. */
  reason?: string;
  /**
   * Set when the reason is the machine's `gh` rather than this repository, so the view can explain it once instead of
   * listing every repository as failing.
   */
  setup?: "gh-missing" | "gh-signed-out";
  /** When the list was last fetched successfully. */
  fetchedAt?: string;
  /** A limit was reached, so the list is not complete. */
  truncated?: { open: boolean; closed: boolean };
  pullRequests: PullRequest[];
}

/** A change's source issue: the GitHub repository as `owner/name`, the issue number and its title at import time. */
export interface SourceIssue {
  github: string;
  number: number;
  title?: string;
}

/** One open issue of a GitHub repository, as the dashboard reads it from `gh issue list` (openspec/specs/issue-import). */
export interface GithubIssue {
  number: number;
  title: string;
  /** The issue text as written; Markdown, never rendered as HTML by the dialog. */
  body: string;
  /** The issue on github.com; the UI links to it and never fetches it. */
  url: string;
  /** Login of the author; empty when GitHub reports none. */
  author: string;
  labels: string[];
  createdAt: string;
  updatedAt?: string;
}

/**
 * The open issues of one tracked repository, fetched on the user's request and kept in memory only. `issues` is empty
 * unless `status` is `ok`.
 */
export interface RepoIssues {
  repoId: string;
  /** `owner/name` when the repository's `origin` is on github.com. */
  github?: string;
  /** `unavailable`: cannot be queried at all (not on GitHub, no `gh`, not signed in). `failed`: this attempt did not work. */
  status: "ok" | "unavailable" | "failed";
  /** Why it is `unavailable` or `failed`; credentials in any text from `gh` are masked. */
  reason?: string;
  setup?: RepoPullRequests["setup"];
  fetchedAt?: string;
  /** The limit of 100 was reached, so the list is not complete. */
  truncated?: boolean;
  issues: GithubIssue[];
}

/** One repository of `gh repo list`, as the Add from GitHub dialog shows it (openspec/specs/github-repositories). */
export interface GithubRepoEntry {
  /** `owner/name`. */
  repo: string;
  description: string;
  private: boolean;
  archived: boolean;
  /** When it was last pushed to; empty when GitHub reports none. */
  pushedAt: string;
  /** A tracked repository has it as its `origin`: shown, but not offered again. */
  added: boolean;
}

/** What `POST /api/github/repos` answers: one owner's repositories, newest push first. `repos` is empty unless `ok`. */
export interface GithubRepoList {
  status: "ok" | "unavailable" | "failed";
  /** The owner listed: the one asked for, or the account `gh` is signed in as. */
  owner?: string;
  /** Why it is `unavailable` or `failed`; credentials masked. */
  reason?: string;
  setup?: RepoPullRequests["setup"];
  /** The limit of 200 was reached. */
  truncated?: boolean;
  repos: GithubRepoEntry[];
}

/** The phase of a running clone, from git's own `--progress` reports. */
export type GithubClonePhase = "connecting" | "receiving" | "resolving" | "checkout";

/** What a running clone last reported: parsed values only, never git's text. */
export interface GithubCloneProgress {
  phase: GithubClonePhase;
  /** git's percentage for this phase; absent while it has given none (`connecting`). */
  percent?: number;
  /** Bytes received so far, when git reports them (`receiving`). */
  receivedBytes?: number;
  /** When the progress last changed. */
  updatedAt: string;
}

/**
 * A clone started since the dashboard started (`GET /api/github/clones`). Kept in memory only; never an input to
 * scanning, columns or actions. `queued`: waiting for one of the two slots, git not started; `tracked`: it holds
 * `openspec/config.yaml` and was added to the configuration; `integratable`: cloned without it; `failed`: git refused
 * or timed out; `cancelled`: the user stopped it.
 */
export interface GithubClone {
  id: string;
  /** `owner/name`. */
  repo: string;
  root: string;
  name: string;
  path: string;
  state: "queued" | "cloning" | "tracked" | "integratable" | "failed" | "cancelled";
  /** Present while `cloning`. */
  progress?: GithubCloneProgress;
  /** Why it failed, credentials masked; for a cancelled clone only when its folder was left in place. */
  reason?: string;
  startedAt: string;
  finishedAt?: string;
}

/** What `GET /api/github/clones` answers: the clones, and whether `git` is on this machine at all. */
export interface GithubClonesResponse {
  clones: GithubClone[];
  gitAvailable: boolean;
}

export interface GithubCloneRequest {
  /** `owner/name`, or a URL `parseGithubRepo` accepts. */
  repo: string;
  /** One of the configured workspace roots. */
  root: string;
  /** The folder created directly inside `root`. */
  name: string;
}

/** What the import sends along with a create request: which issue the change comes from. */
export interface ChangeIssueRef {
  number: number;
  title?: string;
}

export interface PullRequestsResponse {
  /** The signed-in GitHub login, when `gh api user` answered. */
  viewer?: string;
  repos: RepoPullRequests[];
}
