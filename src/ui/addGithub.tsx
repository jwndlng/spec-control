// Add from GitHub (openspec/specs/github-repositories): pick repositories from a list `gh repo list` gives — asked for
// when the dialog opens, when the owner changes and on Refresh, never otherwise — or type them, choose the workspace root
// and each folder name in the **To clone** panel, and confirm. In `clone` mode (the overview) Clone starts the clones,
// which go on in the background, and closes the dialog once all were accepted; in `collect` mode (the setup wizard) it
// hands the choice back, to be cloned on the step's Continue.
// `AddGithubController` holds what the dialog does; the body is hook-free, so tests walk it without a DOM.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Config, GithubRepoEntry } from "../shared/types.ts";
import { api } from "./api.ts";
import { githubClones, useGithubClones } from "./githubClonesState.ts";
import {
  type AddGithubMode,
  type AddGithubState,
  type AddGithubSubmitted,
  AddGithubController,
  addGithubUnavailable,
  canClone,
  CLONE_STATUS_MS,
  cloneStartedStatus,
  type CloneTarget,
  filterGithubRepos,
  listingNotice,
  pushedAge,
} from "./githubState.ts";
import { IconGitBranch, IconRefresh, IconX } from "./icons.tsx";
import { Modal } from "./modal.tsx";

/** The button itself. Inactive, with the reason as its tooltip and in its accessible name, when `off` gives one. */
export function AddGithubTrigger({ off, small, onOpen }: { off: string | undefined; small: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      class={small ? "btn sm" : "btn"}
      disabled={off !== undefined}
      title={off ? `Add from GitHub is unavailable: ${off}` : "Clone GitHub repositories into a workspace root"}
      aria-label={off ? `Add from GitHub, unavailable: ${off}` : "Add from GitHub"}
      onClick={onOpen}
    >
      <IconGitBranch size={12} /> Add from GitHub
    </button>
  );
}

/**
 * The overview's **Add from GitHub**: the button and its dialog, which clones on confirmation and closes once every
 * clone was accepted. The overview then says so for a few seconds, politely; the clones are under Unmanaged projects.
 */
export function AddGithubButton({ config, small = true }: { config: Config | null; small?: boolean }) {
  const clones = useGithubClones();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const hide = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(hide.current), []);
  if (!config) return null;
  const announce = (count: number) => {
    clearTimeout(hide.current);
    setStatus(cloneStartedStatus(count));
    hide.current = setTimeout(() => setStatus(""), CLONE_STATUS_MS);
  };
  return (
    <span class="add-github-anchor">
      <AddGithubTrigger off={addGithubUnavailable(config, clones.gitAvailable)} small={small} onOpen={() => setOpen(true)} />
      {/* Always on the page, so assistive technology hears what is put into it. */}
      <span class={`add-github-status${status ? " shown" : ""}`} role="status" aria-live="polite">
        {status}
      </span>
      {open && <AddGithubDialog roots={config.scanRoots} mode="clone" onClose={() => setOpen(false)} onStarted={announce} />}
    </span>
  );
}

export interface AddGithubActions {
  setOwner(owner: string): void;
  confirmOwner(): void;
  refresh(): void;
  setQuery(query: string): void;
  toggle(repo: string): void;
  setTyped(typed: string): void;
  addTyped(): void;
  remove(repo: string): void;
  rename(repo: string, name: string): void;
  setRoot(root: string): void;
  submit(): void;
  close(): void;
}

export interface AddGithubView extends AddGithubState {
  mode: AddGithubMode;
  roots: readonly string[];
  targets: CloneTarget[];
  now?: number;
}

/** One repository of the list: the whole row is the checkbox's label. */
function RepoRow({ repo, chosen, disabled, now, onToggle }: { repo: GithubRepoEntry; chosen: boolean; disabled: boolean; now?: number; onToggle: () => void }) {
  const pushed = pushedAge(repo.pushedAt, now);
  return (
    <li class={`add-github-repo${repo.added ? " added" : ""}${chosen ? " chosen" : ""}`}>
      <label class="add-github-repo-row">
        <input type="checkbox" checked={chosen || repo.added} disabled={repo.added || disabled} onChange={onToggle} aria-label={repo.added ? `${repo.repo}, already added` : `Clone ${repo.repo}`} />
        <span class="add-github-repo-body">
          <span class="add-github-repo-line">
            <span class="add-github-repo-name mono">{repo.repo}</span>
            {repo.private && <span class="badge">private</span>}
            {repo.archived && <span class="badge warning">archived</span>}
            {repo.added && <span class="badge success">already added</span>}
            {pushed && <span class="add-github-pushed">{pushed}</span>}
          </span>
          {repo.description && <span class="add-github-description">{repo.description}</span>}
        </span>
      </label>
    </li>
  );
}

/** The dialog's content: the list on one side, the **To clone** panel with each target and Clone on the other. Hook-free. */
export function AddGithubBody({ view, actions }: { view: AddGithubView; actions: AddGithubActions }) {
  const shown = filterGithubRepos(view.repos, view.query);
  const notice = listingNotice(view.list);
  const chosen = new Set(view.chosen.map((c) => c.repo));
  const ready = canClone(view.targets, view.root) && !view.submitting;
  const count = view.targets.length;
  return (
    <form
      class="add-github"
      aria-label="Add from GitHub"
      onSubmit={(e) => {
        e.preventDefault();
        actions.submit();
      }}
    >
      <section class="add-github-list-panel" aria-label="Your GitHub repositories">
        <div class="add-github-bar">
          <label class="add-github-owner">
            <span>Owner</span>
            <input
              class="input"
              type="text"
              value={view.owner}
              placeholder={view.list?.owner ?? "your account"}
              aria-label="Owner whose repositories to list"
              aria-invalid={view.ownerError ? true : undefined}
              onInput={(e) => actions.setOwner((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  actions.confirmOwner();
                }
              }}
            />
          </label>
          <button type="button" class="btn ghost" onClick={actions.confirmOwner} disabled={view.loading}>
            List
          </button>
          <button type="button" class="btn ghost" onClick={actions.refresh} disabled={view.loading} aria-busy={view.loading} title="Ask GitHub again for the repositories">
            <IconRefresh size={14} />
            {view.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {view.ownerError && <p class="hint danger">{view.ownerError}</p>}
        <input class="input add-github-search" type="search" placeholder="Search repositories" aria-label="Search repositories" value={view.query} onInput={(e) => actions.setQuery((e.target as HTMLInputElement).value)} />
        <p class="hint add-github-status-line" aria-live="polite">
          {view.loading && !view.list ? "Asking GitHub for your repositories…" : null}
          {view.list?.status === "ok" && (
            <>
              {view.list.repos.length} {view.list.repos.length === 1 ? "repository" : "repositories"} of <span class="mono">{view.list.owner}</span>
              {view.list.truncated ? " — only the 200 most recently pushed are listed" : ""}
            </>
          )}
        </p>
        {notice && (
          <div class={`notice ${notice.tone}`}>
            {notice.text}
            {view.list?.setup === "gh-signed-out" && <> Sign in once in a terminal with <code>gh auth login</code>, then Refresh.</>}
            {view.list?.setup === "gh-missing" && <> Install the GitHub CLI (<code>gh</code>) and sign in with <code>gh auth login</code> to list your repositories.</>}
          </div>
        )}
        {view.repos.length > 0 && (
          <ul class="add-github-repos" aria-label="GitHub repositories">
            {shown.length === 0 && <li class="add-github-empty">No repository matches the search.</li>}
            {shown.map((r) => (
              <RepoRow key={r.repo} repo={r} chosen={chosen.has(r.repo)} disabled={view.submitting} now={view.now} onToggle={() => actions.toggle(r.repo)} />
            ))}
          </ul>
        )}
        <div class="add-github-typed">
          <input
            class="input"
            type="text"
            value={view.typed}
            placeholder="owner/name or https://github.com/owner/name"
            aria-label="Repository to add"
            aria-invalid={view.typedError ? true : undefined}
            onInput={(e) => actions.setTyped((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                actions.addTyped();
              }
            }}
          />
          <button type="button" class="btn" onClick={actions.addTyped} disabled={!view.typed.trim() || view.typedError !== undefined}>
            Add
          </button>
        </div>
        {view.typedError && <p class="hint danger">{view.typedError}</p>}
      </section>
      <section class="add-github-panel" aria-label="To clone">
        <h3 class="add-github-panel-title">
          To clone {count > 0 && <span class="add-github-count">· {count}</span>}
        </h3>
        {view.roots.length > 1 ? (
          <label class="add-github-root">
            <span>Workspace root</span>
            <select class="input" value={view.root} onChange={(e) => actions.setRoot((e.currentTarget as HTMLSelectElement).value)} disabled={view.submitting}>
              <option value="">Choose a workspace root</option>
              {view.roots.map((root) => (
                <option key={root} value={root}>
                  {root}
                </option>
              ))}
            </select>
          </label>
        ) : (
          view.root && (
            <p class="hint add-github-root">
              Into <span class="mono">{view.root}</span>
            </p>
          )
        )}
        {count === 0 ? (
          <p class="add-github-empty">Nothing chosen yet. Check repositories in the list, or type one as owner/name.</p>
        ) : (
          <ul class="add-github-targets" aria-label="Repositories to clone">
            {view.targets.map((t) => {
              const refused = view.refused[t.repo];
              return (
                <li key={t.repo} class={`add-github-target${refused || t.problem ? " refused" : ""}`}>
                  <div class="add-github-target-head">
                    <span class="add-github-repo-name mono">{t.repo}</span>
                    <button type="button" class="btn sm ghost" onClick={() => actions.remove(t.repo)} disabled={view.submitting} aria-label={`Remove ${t.repo}`} title="Remove it from the choice">
                      <IconX size={12} />
                    </button>
                  </div>
                  <label class="add-github-folder">
                    <span>Folder</span>
                    <input
                      class="input"
                      value={t.name}
                      disabled={view.submitting}
                      aria-label={`Folder name for ${t.repo}`}
                      aria-invalid={t.problem || refused ? true : undefined}
                      onInput={(e) => actions.rename(t.repo, (e.target as HTMLInputElement).value)}
                    />
                  </label>
                  <span class="add-github-path mono" title={t.path}>
                    {t.path || "choose a workspace root"}
                  </span>
                  {t.problem && <span class="add-github-problem">{t.problem}</span>}
                  {refused && <span class="add-github-problem">refused: {refused}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {view.root === "" && view.roots.length > 1 && <p class="hint">Choose the workspace root to clone into.</p>}
        <p class="hint">
          {view.mode === "clone"
            ? "Each repository is cloned with git over HTTPS into a new folder — no prompt, no hooks. The clones run in the background; follow them under Unmanaged projects. One that uses OpenSpec is tracked once it has finished."
            : "The repositories are listed in the step and cloned when you continue — with git over HTTPS, no prompt, no hooks."}
        </p>
        <div class="row actions">
          <button type="submit" class="btn primary" disabled={!ready}>
            {view.submitting ? "Starting…" : `${view.mode === "collect" ? "Add" : "Clone"}${count > 0 ? ` ${count}` : ""}`}
          </button>
          <button type="button" class="btn ghost" onClick={actions.close} disabled={view.submitting}>
            Cancel
          </button>
        </div>
      </section>
    </form>
  );
}

/**
 * The dialog over the page. `taken` are target paths already used elsewhere (the wizard's listed repositories);
 * `onCollect` receives the choice in `collect` mode; `onStarted` hears how many clones a Clone started in `clone` mode,
 * and the dialog closes by itself when none was refused.
 */
export function AddGithubDialog({
  roots,
  mode,
  taken = [],
  onClose,
  onCollect,
  onStarted,
}: {
  roots: readonly string[];
  mode: AddGithubMode;
  taken?: readonly string[];
  onClose: () => void;
  onCollect?: (targets: CloneTarget[]) => void;
  onStarted?: (count: number) => void;
}) {
  const controller = useMemo(() => new AddGithubController({ listGithubRepos: api.listGithubRepos, cloneGithub: api.cloneGithub, started: (clone) => void githubClones.started(clone) }, roots, () => taken), []);
  const [state, setState] = useState(controller.get());
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => setState(controller.get()));
    // The one listing the dialog makes by itself: when it opens.
    void controller.open();
    return unsubscribe;
  }, [controller]);
  const view: AddGithubView = { ...state, mode, roots, targets: controller.targets() };
  const close = () => {
    if (!controller.get().submitting) onClose();
  };
  const actions: AddGithubActions = {
    setOwner: (owner) => controller.setOwner(owner),
    confirmOwner: () => void controller.confirmOwner(),
    refresh: () => void controller.refresh(),
    setQuery: (query) => controller.setQuery(query),
    toggle: (repo) => controller.toggle(repo),
    setTyped: (typed) => controller.setTyped(typed),
    addTyped: () => controller.addTyped(),
    remove: (repo) => controller.remove(repo),
    rename: (repo, name) => controller.rename(repo, name),
    setRoot: (root) => controller.setRoot(root),
    submit: () => void controller.submit(mode).then((done) => closeAfterSubmit(mode, done, controller.get(), { onCollect, onStarted, onClose })),
    close,
  };
  return (
    <Modal label="Add from GitHub" title="Add from GitHub" subtitle="Clone your GitHub repositories into a workspace root" icon={<IconGitBranch size={18} />} onClose={onClose} canClose={() => !controller.get().submitting} wide>
      <AddGithubBody view={view} actions={actions} />
    </Modal>
  );
}

/**
 * What the host does once Clone or Add returned: collect hands the choice back and closes; clone reports how many
 * started and closes only when nothing was refused, so a refusal stays visible on its row.
 */
export function closeAfterSubmit(
  mode: AddGithubMode,
  done: AddGithubSubmitted | undefined,
  state: Pick<AddGithubState, "refused">,
  host: { onCollect?: (targets: CloneTarget[]) => void; onStarted?: (count: number) => void; onClose: () => void },
): void {
  if (!done) return;
  if (mode === "collect") {
    host.onCollect?.(done.targets);
    host.onClose();
    return;
  }
  if (done.started.length > 0) host.onStarted?.(done.started.length);
  if (Object.keys(state.refused).length === 0) host.onClose();
}
