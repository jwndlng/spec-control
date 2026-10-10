// Add from GitHub's decisions (openspec/specs/github-repositories), pure so they are tested without a DOM: when the
// action is unavailable, what the repository list shows, which chosen repositories can be cloned where, how an outcome
// reads, and the one store of running and finished clones that the dialog, the wizard and the overview all read — polled
// every second while a clone runs, and not at all otherwise.
import { defaultCloneFolder, isGithubOwner, parseGithubRepo } from "../shared/github.ts";
import { type Config, type GithubClone, type GithubClonesResponse, type GithubRepoEntry, type GithubRepoList, isProjectName } from "../shared/types.ts";
import { relTime } from "./format.ts";

/** Why **Add from GitHub** cannot be used, or `undefined`. Agent sessions play no part: a clone starts no agent. */
export function addGithubUnavailable(config: Pick<Config, "scanRoots"> | null, gitAvailable: boolean | undefined): string | undefined {
  if (!config || config.scanRoots.length === 0) return "add a workspace root in Settings first";
  if (gitAvailable === false) return "git was not found on this machine";
  return undefined;
}

/** The list filtered by a search over `owner/name` and description, case-insensitive; the order is kept. */
export function filterGithubRepos(repos: readonly GithubRepoEntry[], query: string): GithubRepoEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...repos];
  return repos.filter((r) => r.repo.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
}

/** "pushed 3 days ago", or nothing when GitHub reported no push. */
export function pushedAge(pushedAt: string, now = Date.now()): string {
  if (!pushedAt || Number.isNaN(Date.parse(pushedAt))) return "";
  const ago = relTime(pushedAt, now);
  return ago === "just now" ? "pushed just now" : `pushed ${ago} ago`;
}

/** What the dialog says above the list when `gh` cannot list anything; the typed entry stays available either way. */
export function listingNotice(list: GithubRepoList | undefined): { tone: "warn" | "danger"; text: string } | undefined {
  if (!list || list.status === "ok") return undefined;
  if (list.status === "unavailable") return { tone: "warn", text: `${list.reason ?? "The GitHub CLI is not available"}. You can still type a repository as owner/name.` };
  return { tone: "danger", text: `Could not list repositories: ${list.reason ?? "gh gave no reason"}.` };
}

/** Joins a root and a folder name for display, without doubling a trailing separator. */
export const joinPath = (root: string, name: string) => `${root.replace(/[\\/]+$/, "")}/${name}`;

/** One repository the user chose, with the folder it goes into. */
export interface ChosenRepo {
  repo: string;
  name: string;
}

export function chooseRepo(chosen: readonly ChosenRepo[], repo: string): ChosenRepo[] {
  if (chosen.some((c) => c.repo.toLowerCase() === repo.toLowerCase())) return [...chosen];
  return [...chosen, { repo, name: defaultCloneFolder(repo) }];
}

export interface CloneTarget extends ChosenRepo {
  /** The workspace root it is cloned into; empty while none is chosen. */
  root: string;
  /** `<root>/<name>`, or empty while no root is chosen. */
  path: string;
  /** Why it cannot be cloned like this; `undefined` when it can. */
  problem?: string;
}

/**
 * Each chosen repository with its target and what is wrong with it, before anything is sent: a folder name a folder may
 * not have, and two targets — in this choice or among `taken` (already listed or cloning) — that are the same path.
 * Whether the folder exists is the server's to say, at Clone.
 */
export function cloneTargets(chosen: readonly ChosenRepo[], root: string, taken: readonly string[] = []): CloneTarget[] {
  const paths = chosen.map((c) => (root ? joinPath(root, c.name.trim()) : ""));
  return chosen.map((c, i) => {
    const name = c.name.trim();
    const path = paths[i];
    let problem: string | undefined;
    if (!isProjectName(name)) problem = "the folder name must start with a letter or digit and use only letters, digits, '.', '_' and '-'";
    else if (path && paths.some((p, j) => j !== i && p === path)) problem = "two repositories would go into the same folder";
    else if (path && taken.includes(path)) problem = "that folder is already taken by another repository being added";
    return { repo: c.repo, name, root, path, ...(problem ? { problem } : {}) };
  });
}

export function canClone(targets: readonly CloneTarget[], root: string): boolean {
  return root !== "" && targets.length > 0 && targets.every((t) => t.problem === undefined);
}

/** How a clone's state reads in the dialog, the wizard and the overview. */
export function cloneOutcome(clone: Pick<GithubClone, "state" | "reason">): { label: string; tone: "" | "success" | "warning" | "danger"; detail: string } {
  switch (clone.state) {
    case "cloning":
      return { label: "Cloning…", tone: "", detail: "git clone is running; this goes on when the dialog is closed." };
    case "tracked":
      return { label: "tracked", tone: "success", detail: "Cloned; it uses OpenSpec, so it is tracked and on the overview." };
    case "integratable":
      return { label: "cloned without OpenSpec", tone: "warning", detail: "Cloned; it does not use OpenSpec yet — Integrate it under Unmanaged projects on the overview." };
    case "failed":
      return { label: "clone failed", tone: "danger", detail: clone.reason ?? "git gave no reason" };
  }
}

// ---- the clones store ----

export interface GithubClonesState {
  clones: GithubClone[];
  /** Unknown until the first answer. */
  gitAvailable?: boolean;
  error?: string;
}

/** Polled only while something runs: a finished list is never asked for again by itself. */
export function shouldPoll(clones: readonly Pick<GithubClone, "state">[]): boolean {
  return clones.some((c) => c.state === "cloning");
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface GithubClonesStore {
  get(): GithubClonesState;
  /** Asks once, and keeps asking every second while a clone runs. */
  refresh(): Promise<void>;
  /** A clone the server just accepted: listed as running at once, so its outcome is reported even if it is quick. */
  started(clone: GithubClone): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** Told about clones that were running at the last answer and have an outcome now — to rediscover and re-read the config. */
  onFinished(listener: (finished: GithubClone[]) => void): () => void;
  /** Stops polling; tests only. */
  stop(): void;
}

export const CLONE_POLL_MS = 1000;

/**
 * The page's own timers, called as plain functions: a browser refuses `setTimeout` called as a method of another object
 * ("Illegal invocation"), which would stop the polling after its first answer.
 */
const BROWSER_TIMERS: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export function createGithubClonesStore(load: () => Promise<GithubClonesResponse>, timers: Timers = BROWSER_TIMERS, intervalMs = CLONE_POLL_MS): GithubClonesStore {
  let state: GithubClonesState = { clones: [] };
  let timer: unknown;
  let inFlight: Promise<void> | undefined;
  /** A clone was started while a request was on its way, whose answer cannot know it yet: ask once more after it. */
  let askAgain = false;
  const listeners = new Set<() => void>();
  const finishedListeners = new Set<(finished: GithubClone[]) => void>();
  const set = (next: GithubClonesState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    if (timer !== undefined || !shouldPoll(state.clones)) return;
    timer = timers.setTimeout(() => {
      timer = undefined;
      void refresh();
    }, intervalMs);
  };
  const refresh = (): Promise<void> => {
    inFlight ??= (async () => {
      try {
        const answer = await load();
        // Read after the answer, so a clone `started` while it was on its way counts as running.
        const running = new Set(state.clones.filter((c) => c.state === "cloning").map((c) => c.id));
        set({ clones: answer.clones, gitAvailable: answer.gitAvailable });
        const finished = answer.clones.filter((c) => running.has(c.id) && c.state !== "cloning");
        if (finished.length > 0) for (const listener of finishedListeners) listener(finished);
      } catch (err) {
        set({ ...state, error: err instanceof Error ? err.message : String(err) });
      } finally {
        inFlight = undefined;
      }
      if (askAgain) {
        askAgain = false;
        await refresh();
        return;
      }
      schedule();
    })();
    return inFlight;
  };
  return {
    get: () => state,
    refresh,
    started(clone) {
      set({ ...state, clones: [...state.clones.filter((c) => c.id !== clone.id && c.path !== clone.path), clone] });
      if (inFlight) askAgain = true;
      return refresh();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFinished(listener) {
      finishedListeners.add(listener);
      return () => finishedListeners.delete(listener);
    },
    stop() {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}

// ---- the dialog ----

export type AddGithubMode = "clone" | "collect";

export interface AddGithubState {
  /** The owner field as typed; empty means the signed-in account. */
  owner: string;
  ownerError?: string;
  /** The latest listing's answer; a failed one keeps the repositories of the one before. */
  list?: GithubRepoList;
  repos: GithubRepoEntry[];
  loading: boolean;
  query: string;
  typed: string;
  typedError?: string;
  chosen: ChosenRepo[];
  root: string;
  submitting: boolean;
  /** Per chosen repository: why the server refused it. */
  refused: Record<string, string>;
  /** Per chosen repository: the clone the server accepted (clone mode). */
  started: Record<string, string>;
}

export interface AddGithubDeps {
  listGithubRepos(owner?: string): Promise<GithubRepoList>;
  cloneGithub(repo: string, root: string, name: string): Promise<GithubClone>;
  /** The clone store's `started`. */
  started(clone: GithubClone): void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * What the Add from GitHub dialog does, without a DOM. The list is asked for only by `open`, a confirmed owner and
 * `refresh`; nothing is cloned before `submit`, and in `collect` mode not even then — the chosen targets are handed back.
 */
export class AddGithubController {
  private state: AddGithubState;
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: AddGithubDeps,
    roots: readonly string[],
    private readonly taken: () => readonly string[] = () => [],
  ) {
    this.state = { owner: "", repos: [], loading: false, query: "", typed: "", chosen: [], root: roots.length === 1 ? roots[0] : "", submitting: false, refused: {}, started: {} };
  }

  get(): AddGithubState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AddGithubState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  targets(): CloneTarget[] {
    return cloneTargets(this.state.chosen, this.state.root, this.taken());
  }

  /** The dialog opened: the signed-in account's repositories. */
  open(): Promise<void> {
    return this.load(undefined);
  }

  setOwner(owner: string): void {
    this.set({ owner, ownerError: undefined });
  }

  /** The owner field confirmed: another owner's repositories, or the signed-in account's for an empty field. */
  confirmOwner(): Promise<void> {
    const owner = this.state.owner.trim();
    if (owner && !isGithubOwner(owner)) {
      this.set({ ownerError: "an owner uses only letters, digits and single hyphens" });
      return Promise.resolve();
    }
    return this.load(owner || undefined);
  }

  refresh(): Promise<void> {
    return this.load(this.state.list?.owner ?? (this.state.owner.trim() || undefined));
  }

  private async load(owner: string | undefined): Promise<void> {
    const mine = ++this.seq;
    this.set({ loading: true });
    let list: GithubRepoList;
    try {
      list = await this.deps.listGithubRepos(owner);
    } catch (err) {
      list = { status: "failed", owner, reason: errorText(err), repos: [] };
    }
    if (mine !== this.seq) return;
    // Another owner replaces the list; a failure keeps what was listed before.
    this.set({ loading: false, list, repos: list.status === "ok" ? list.repos : list.status === "failed" ? this.state.repos : [] });
  }

  setQuery(query: string): void {
    this.set({ query });
  }

  /** Chooses or unchooses a listed repository; one already added cannot be chosen. */
  toggle(repo: string): void {
    const entry = this.state.repos.find((r) => r.repo === repo);
    if (entry?.added) return;
    const isChosen = this.state.chosen.some((c) => c.repo === repo);
    this.set({ chosen: isChosen ? this.state.chosen.filter((c) => c.repo !== repo) : chooseRepo(this.state.chosen, repo) });
  }

  setTyped(typed: string): void {
    const parsed = typed.trim() ? parseGithubRepo(typed) : undefined;
    this.set({ typed, typedError: parsed && !parsed.ok ? parsed.reason : undefined });
  }

  /** Adds the typed repository to the choice, reduced to `owner/name`; refused with the reason otherwise. */
  addTyped(): void {
    const parsed = parseGithubRepo(this.state.typed);
    if (!parsed.ok) {
      this.set({ typedError: parsed.reason });
      return;
    }
    const added = this.state.repos.find((r) => r.repo.toLowerCase() === parsed.repo.toLowerCase())?.added;
    if (added) {
      this.set({ typedError: `${parsed.repo} is already tracked` });
      return;
    }
    this.set({ chosen: chooseRepo(this.state.chosen, parsed.repo), typed: "", typedError: undefined });
  }

  remove(repo: string): void {
    const { [repo]: _r, ...refused } = this.state.refused;
    this.set({ chosen: this.state.chosen.filter((c) => c.repo !== repo), refused });
  }

  rename(repo: string, name: string): void {
    const { [repo]: _r, ...refused } = this.state.refused;
    this.set({ chosen: this.state.chosen.map((c) => (c.repo === repo ? { ...c, name } : c)), refused });
  }

  setRoot(root: string): void {
    this.set({ root, refused: {} });
  }

  /**
   * Clone mode: starts each chosen repository not started yet, one request after another; a refusal is shown on its
   * repository and the others still start. Collect mode: starts nothing and returns the targets. Undefined when
   * something is still wrong.
   */
  async submit(mode: AddGithubMode): Promise<CloneTarget[] | undefined> {
    const targets = this.targets();
    if (this.state.submitting || !canClone(targets, this.state.root)) return undefined;
    if (mode === "collect") return targets;
    this.set({ submitting: true });
    const refused: Record<string, string> = {};
    const started = { ...this.state.started };
    for (const target of targets) {
      if (started[target.repo]) continue;
      try {
        const clone = await this.deps.cloneGithub(target.repo, this.state.root, target.name);
        started[target.repo] = clone.id;
        this.deps.started(clone);
      } catch (err) {
        refused[target.repo] = errorText(err);
      }
    }
    this.set({ submitting: false, refused, started });
    return targets;
  }
}

