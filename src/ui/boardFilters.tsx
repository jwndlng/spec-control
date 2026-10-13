// The board's filter bar (kanban-board: "The board's filters form one filter bar"): search, a Repositories menu, the
// Activity selector, the Hide archived and Hide merged switches, removable tags for what is filtered, and the count of changes shown.
// Same filters and URL format as before; only the controls are new.
import { useEffect, useRef, useState } from "preact/hooks";
import type { RepoSnapshot } from "../shared/types.ts";
import { activeTags, EMPTY_FILTERS, type Filters, hasActiveFilters, activityOptions } from "./filters.ts";
import { IconChevronDown, IconClock, IconColumns, IconFolderGit, IconRotateCcw, IconRows, IconSearch, IconX } from "./icons.tsx";

/** Sets --repo-hue for the `repo-tint` class. */
function repoHue(hue: number | undefined) {
  return hue === undefined ? undefined : { "--repo-hue": hue };
}

/** The Repositories menu: a button that says how many are selected, and a checklist that closes when left. Shared by the board and the activity feed. */
export function RepoMenu({ repos, hues, selected, onChange }: { repos: RepoSnapshot[]; hues: Map<string, number>; selected: string[]; onChange: (repos: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only this menu closes; the page behind it keeps its own Escape handling out of the way.
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]);

  return (
    <div
      class="menu"
      ref={root}
      onFocusOut={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class={`control menu-button ${selected.length ? "on" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="repo-filter-menu"
        onClick={() => setOpen(!open)}
      >
        <IconFolderGit />
        Repositories
        <span class="control-value">{selected.length ? selected.length : "All"}</span>
        <IconChevronDown size={12} />
      </button>
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring legend/border styling the menu does not want
        <div class="menu-list" id="repo-filter-menu" role="group" aria-label="Filter by repository">
          {repos.map((r) => (
            <label key={r.id} class={`menu-item repo-tint ${r.ok ? "" : "error"}`} style={repoHue(hues.get(r.id))} title={r.ok ? r.path : r.error}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              <span class="swatch" />
              <span class="menu-name">{r.name}</span>
              {!r.ok && <span class="badge danger">⚠ scan failed</span>}
            </label>
          ))}
          <div class="menu-foot">
            <button type="button" class="btn sm ghost" disabled={selected.length === 0} onClick={() => onChange([])}>
              Clear selection
            </button>
            <button type="button" class="btn sm" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  filters,
  setFilters,
  repos,
  hues,
  single,
  showing,
  layout,
}: {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  repos: RepoSnapshot[];
  hues: Map<string, number>;
  /** A repository board: no repository filter. */
  single: boolean;
  showing: number;
  /** The layout on screen, which the Lanes/Stack switch marks; `filters.layout` may be `auto`. */
  layout: "lanes" | "stack";
}) {
  const tags = single ? activeTags({ ...filters, repos: [] }, repos) : activeTags(filters, repos);
  return (
    <div class="filterbar">
      <div class="filterbar-row">
        <label class="search">
          <IconSearch />
          <input class="input" type="search" placeholder="Search change or repo…" aria-label="Search change or repo" value={filters.q} onInput={(e) => setFilters({ q: e.currentTarget.value })} />
          {filters.q && (
            <button type="button" class="search-clear" aria-label="Clear search" onClick={() => setFilters({ q: "" })}>
              <IconX size={12} />
            </button>
          )}
        </label>
        {!single && <RepoMenu repos={repos} hues={hues} selected={filters.repos} onChange={(ids) => setFilters({ repos: ids })} />}
        <label class={`control select-control ${filters.activeDays ? "on" : ""}`}>
          <IconClock />
          <span>Activity</span>
          <select value={filters.activeDays} onChange={(e) => setFilters({ activeDays: Number(e.currentTarget.value) || 0 })}>
            {activityOptions(filters.activeDays).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <IconChevronDown size={12} />
        </label>
        <button type="button" role="switch" aria-checked={filters.hideArchived} class={`control switch-control ${filters.hideArchived ? "on" : ""}`} onClick={() => setFilters({ hideArchived: !filters.hideArchived })}>
          <span class="switch" aria-hidden="true" />
          Hide archived
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={filters.hideMerged}
          disabled={filters.hideArchived}
          class={`control switch-control ${filters.hideMerged ? "on" : ""}`}
          title={filters.hideArchived ? "The Archived column is hidden" : "Hide archived changes whose archive has reached the main checkout; keep the ones still to be pushed or merged, and those with a running agent session until it is ended"}
          onClick={() => setFilters({ hideMerged: !filters.hideMerged })}
        >
          <span class="switch" aria-hidden="true" />
          Hide merged
        </button>
        {hasActiveFilters(filters) && (
          <button type="button" class="btn sm ghost clear-filters" onClick={() => setFilters({ ...EMPTY_FILTERS, layout: filters.layout })}>
            <IconRotateCcw size={12} />
            Clear filters
          </button>
        )}
        <span class="spacer" />
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring legend/border styling the control does not want */}
        <div class="segmented" role="group" aria-label="Board layout" title={filters.layout === "auto" ? "Chosen for this window's width" : undefined}>
          <button type="button" class={layout === "lanes" ? "on" : ""} aria-pressed={layout === "lanes"} onClick={() => setFilters({ layout: "lanes" })}>
            <IconColumns size={13} />
            Lanes
          </button>
          <button type="button" class={layout === "stack" ? "on" : ""} aria-pressed={layout === "stack"} onClick={() => setFilters({ layout: "stack" })}>
            <IconRows size={13} />
            Stack
          </button>
        </div>
        <span class="showing">
          Showing <strong>{showing}</strong> {showing === 1 ? "change" : "changes"}
        </span>
      </div>
      <FilterTagList tags={tags} hues={hues} onRemove={(tag) => setFilters(tag.clear)} />
    </div>
  );
}

/** The active filters as removable tags; a repository tag wears that repository's colour. Nothing when none is active. */
export function FilterTagList<T extends { key: string; label: string; repoId?: string }>({ tags, hues, onRemove }: { tags: T[]; hues: Map<string, number>; onRemove: (tag: T) => void }) {
  if (tags.length === 0) return null;
  return (
    <ul class="filter-tags" aria-label="Active filters">
      {tags.map((tag) => (
        <li key={tag.key} class={`filter-tag ${tag.repoId ? "repo-tint" : ""}`} style={repoHue(tag.repoId ? hues.get(tag.repoId) : undefined)}>
          {tag.repoId ? <span class="swatch" /> : <IconClock size={12} />}
          {tag.label}
          <button type="button" aria-label={`Remove filter ${tag.label}`} onClick={() => onRemove(tag)}>
            <IconX size={11} />
          </button>
        </li>
      ))}
    </ul>
  );
}

