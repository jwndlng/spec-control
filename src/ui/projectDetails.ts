// What the repository board header shows (project-overview: "Repository board header", kanban-board: "Actions have
// their own area"): its action groups with their descriptions, the facts of its quick view and the sections of its
// project details overlay. Pure, so the visibility rules are tested without a renderer; `RepoHeader` and
// `ProjectDetailsDialog` only render what these return.
import { displayedLabels, type DisplayedLabel } from "../shared/labels.ts";
import { autoFetchInterval, type Config, type RepoSnapshot } from "../shared/types.ts";
import { hasCheckoutInfo } from "./checkoutMarkers.ts";
import { fetchNote, type FetchNote } from "./pullState.ts";

export type ActionId = "console" | "pull" | "cleanup" | "import" | "newChange";

/** One sentence per action: what it does and, where it touches the repository, what it leaves alone. */
export const ACTION_DESCRIPTIONS: Record<ActionId, string> = {
  console: "Opens your agent in this project's own folder, for anything that is not a change.",
  pull: "Brings the main checkout up to date with its remote by fast-forward only; never merges, rebases or discards work.",
  cleanup: "Lists the worktrees and local branches that are safe to remove and removes only those you confirm; never touches a remote.",
  import: "Turns open GitHub issues you pick into new changes.",
  newChange: "Creates a new change directory, with an optional prompt for your agent.",
};

/** An action's description as the board renders it: the tooltip's text, and the id of the element that carries it. */
export interface ActionDescription {
  id: string;
  text: string;
}

/** The id of the element holding an action's description on the repository board; there is one header per page. */
export const actionDescriptionId = (id: ActionId) => `board-action-${id}`;

export interface BoardAction {
  id: ActionId;
  /** The tooltip and accessible description: the action's sentence, led by the reason when it is inactive. */
  description: string;
  /** Why the action is offered but cannot be used now. */
  inactive?: string;
}

export interface ActionGroup {
  id: "agent" | "repository" | "changes";
  caption: string;
  actions: BoardAction[];
}

export interface ActionGroupsInput {
  /** `projectConsoleUnavailable`: null when no console is offered, a reason when it is offered but inactive. */
  console: string | null | undefined;
  isGit: boolean;
  /** Whether the last scan succeeded. */
  ok: boolean;
}

/** The action's description; an inactive action says why first, in the same sentence it is described with. */
export function describeAction(id: ActionId, inactive?: string): string {
  return inactive ? `Unavailable: ${inactive}. ${ACTION_DESCRIPTIONS[id]}` : ACTION_DESCRIPTIONS[id];
}

const action = (id: ActionId, inactive?: string): BoardAction => (inactive ? { id, description: describeAction(id, inactive), inactive } : { id, description: describeAction(id) });

/** Agent, Repository, Changes — in that order, each only with an action to offer; New change last. */
export function actionGroups({ console, isGit, ok }: ActionGroupsInput): ActionGroup[] {
  const canGit = isGit && ok;
  const groups: ActionGroup[] = [
    { id: "agent", caption: "Agent", actions: console === null ? [] : [action("console", console)] },
    { id: "repository", caption: "Repository", actions: canGit ? [action("pull"), action("cleanup")] : [] },
    { id: "changes", caption: "Changes", actions: [...(canGit ? [action("import")] : []), ...(ok ? [action("newChange")] : [])] },
  ];
  return groups.filter((g) => g.actions.length > 0);
}

export interface Attention {
  label: string;
  detail: string;
  tone: "danger" | "warning";
}

export interface QuickViewFacts {
  /** The main checkout's chip and the branches control, the current branch alone, or nothing. */
  checkouts: "summary" | "branch" | "none";
  pullRequests: boolean;
  fetchNote?: FetchNote;
  /** Shared config that is not in sync, or an unreadable `openspec/config.yaml`. */
  sharedConfig?: Attention;
}

export const CONFIG_UNREADABLE = "openspec/config.yaml is missing, not valid YAML, or has malformed shared-config markers";

/** What needs a look in the repository's shared config; nothing when every profile it carries is in sync. */
export function sharedConfigAttention(repo: Pick<RepoSnapshot, "sharedConfig">): Attention | undefined {
  const shared = repo.sharedConfig;
  if (!shared) return undefined;
  if (shared.unreadable) return { label: "⚙ config unreadable", detail: `${CONFIG_UNREADABLE}. See Details.`, tone: "danger" };
  const off = shared.applied.filter((p) => p.state !== "in-sync");
  if (off.length === 0) return undefined;
  return { label: "⚙ shared config needs attention", detail: `${off.map((p) => `${p.id} is ${p.state}`).join(", ")}. See Details.`, tone: "warning" };
}

/** The project's effective auto-fetch interval, from the configuration; absent when it is off or unknown. */
export function autoFetchSecondsOf(config: Config | null, repoId: string): number | undefined {
  return autoFetchInterval(config?.repos.find((r) => r.id === repoId));
}

/** The quick view's facts, in their order after the counts; Details is always there. */
export function quickViewFacts(repo: RepoSnapshot, config: Config | null, now = Date.now()): QuickViewFacts {
  const facts: QuickViewFacts = {
    // Snapshots cached by older versions know no checkouts: fall back to the current branch.
    checkouts: hasCheckoutInfo(repo.worktrees) ? "summary" : repo.currentBranch ? "branch" : "none",
    // A repository without git has no remote and no pull requests, so it gets no control.
    pullRequests: repo.isGit,
  };
  const note = repo.isGit && repo.ok ? fetchNote({ ...repo, autoFetchSeconds: autoFetchSecondsOf(config, repo.id) }, now) : undefined;
  if (note) facts.fetchNote = note;
  const attention = sharedConfigAttention(repo);
  if (attention) facts.sharedConfig = attention;
  return facts;
}

export type DetailSection = "repository" | "checkouts" | "sync" | "pullRequests" | "sharedConfig" | "labels";

export const DETAIL_SECTION_TITLES: Record<DetailSection, string> = {
  repository: "Repository",
  checkouts: "Checkouts",
  sync: "Sync",
  pullRequests: "Pull requests",
  sharedConfig: "Shared config",
  labels: "Labels",
};

/** The repository's labels as the overview shows them. */
export function repoLabels(repo: Pick<RepoSnapshot, "id" | "detectedLabels">, config: Config | null): DisplayedLabel[] {
  return displayedLabels(config?.repos.find((r) => r.id === repo.id), repo.detectedLabels, config?.labelColors);
}

/** The overlay's sections, in order, each only when it has something to show. */
export function detailSections(repo: RepoSnapshot, config: Config | null): DetailSection[] {
  const sections: DetailSection[] = ["repository"];
  if (hasCheckoutInfo(repo.worktrees)) sections.push("checkouts");
  if (repo.isGit) sections.push("sync", "pullRequests");
  if (repo.sharedConfig && (repo.sharedConfig.unreadable || repo.sharedConfig.applied.length > 0)) sections.push("sharedConfig");
  if (repoLabels(repo, config).length > 0) sections.push("labels");
  return sections;
}

/** The board offers the project's settings only for a repository enabled in the configuration. */
export function boardSettingsOffered(config: Config | null, repoId: string): boolean {
  return config?.repos.find((r) => r.id === repoId)?.enabled === true;
}

/** Where the board goes once a project was disabled from its settings dialog: the overview, for the board's own project. */
export function afterBoardDisable(disabledId: string, boardRepoId: string): string | undefined {
  return disabledId === boardRepoId ? "/" : undefined;
}
