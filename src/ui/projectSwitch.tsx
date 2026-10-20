// The repository board header's project switcher (project-overview: "The repository board header switches between
// projects"): the breadcrumb's project name opens a searchable list of every tracked project, each entry a link to its
// board. Opens and closes like the board's Repositories menu.
import { useEffect, useRef, useState } from "preact/hooks";
import type { RepoSnapshot } from "../shared/types.ts";
import { IconChevronDown, IconSearch } from "./icons.tsx";
import { filterEntries, type SwitchEntry, switchEntries } from "./projectSwitchState.ts";
import { repoPath } from "./routes.ts";
import { followInApp, href } from "./url.ts";

const LIST_ID = "project-switch-list";

/** The list itself, hook-free: the search field, one link per matching entry, or a note that nothing matches. */
export function SwitchList({
  entries,
  q,
  onQuery,
  onChoose,
  onKeyDown,
}: {
  entries: SwitchEntry[];
  q: string;
  onQuery: (q: string) => void;
  /** After an entry was followed in place, or the current one was chosen. */
  onChoose: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  const shown = filterEntries(entries, q);
  return (
    <div class="menu-list switch-list" id={LIST_ID}>
      <label class="search switch-search">
        <IconSearch size={13} />
        <input class="input" type="search" placeholder="Find a project" aria-label="Find a project" value={q} onInput={(e) => onQuery(e.currentTarget.value)} onKeyDown={onKeyDown} />
      </label>
      <nav aria-label="Projects">
        {shown.map((entry) => (
          <a
            key={entry.id}
            class={`menu-item switch-item ${entry.failed ? "error" : ""} ${entry.current ? "current" : ""}`}
            href={href(repoPath(entry.id))}
            title={entry.path}
            aria-current={entry.current ? "page" : undefined}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              if (entry.current) {
                e.preventDefault();
                onChoose();
                return;
              }
              followInApp(e, repoPath(entry.id));
              if (e.defaultPrevented) onChoose();
            }}
          >
            <span class="menu-name">{entry.name}</span>
            {entry.hint && <span class="path-hint mono">{entry.hint}/</span>}
            {entry.failed && <span class="badge danger">⚠ scan failed</span>}
            {entry.current && <span class="switch-current">current</span>}
          </a>
        ))}
      </nav>
      {shown.length === 0 && <p class="switch-empty">No project matches “{q.trim()}”.</p>}
    </div>
  );
}

/** Where the arrow keys move from `index` (-1: the search field) among `count` entries; -1 is the search field again. */
export function moveFocus(index: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return Math.min(index + 1, count - 1);
  return index - 1;
}

export function ProjectSwitch({ repos, current }: { repos: RepoSnapshot[]; current: RepoSnapshot }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQ("");
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // The search field takes the focus as the list opens, so typing narrows it at once.
    root.current?.querySelector<HTMLInputElement>(".switch-search input")?.focus();
    const onOutside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only this list closes; the page behind it keeps its own Escape handling out of the way.
      e.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  const entries = switchEntries(repos, current.id);

  const onKeyDown = (e: KeyboardEvent) => {
    const links = [...(root.current?.querySelectorAll<HTMLAnchorElement>(".switch-item") ?? [])];
    const search = root.current?.querySelector<HTMLInputElement>(".switch-search input");
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = moveFocus(index, links.length, e.key);
      (next < 0 ? search : links[next])?.focus();
    } else if (e.key === "Enter" && e.target === search) {
      e.preventDefault();
      links[0]?.click();
    }
  };

  return (
    <div
      class="menu project-switch"
      ref={root}
      onFocusOut={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class="switch-button"
        title={current.path}
        aria-label={`${current.name} — switch project`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? LIST_ID : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span class="switch-name">{current.name}</span>
        <IconChevronDown size={14} />
      </button>
      {open && <SwitchList entries={entries} q={q} onQuery={setQ} onChoose={() => close(false)} onKeyDown={onKeyDown} />}
    </div>
  );
}
