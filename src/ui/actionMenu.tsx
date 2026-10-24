// The split button a change's actions are offered as (kanban-board: "A change's actions are one split button"): a main
// part with the recommended action, and an arrow part that opens a menu of every other one. The arrow follows the
// WAI-ARIA menu button pattern; its keyboard handling is the pure `menuKey` so it can be tested without a renderer.
import { useEffect, useRef, useState } from "preact/hooks";

/** One action: a button, or — for Merge without a session — a link to the pull request. */
export interface ActionItem {
  key: string;
  label: string;
  title?: string;
  /** When the visible label alone says too little to a screen reader. */
  ariaLabel?: string;
  disabled?: boolean;
  href?: string;
  onActivate?: () => void;
}

/** A main part that is not an action: what the change waits for, said where the action would be. */
export interface ActionStatus {
  status: string;
  title?: string;
}

export interface MenuState {
  open: boolean;
  /** The item that holds focus while the menu is open. */
  index: number;
}

export const MENU_CLOSED: MenuState = { open: false, index: 0 };

/**
 * What a key does. `focus` says where focus goes after it, `activate` which item to run, and `handled` whether the key's
 * default is to be prevented — Tab is not: it closes the menu and moves on as Tab always does.
 */
export function menuKey(state: MenuState, key: string, count: number): { state: MenuState; focus?: "item" | "arrow"; activate?: number; handled: boolean } {
  if (count <= 0) return { state: MENU_CLOSED, handled: false };
  if (!state.open) {
    if (key === "Enter" || key === " " || key === "ArrowDown") return { state: { open: true, index: 0 }, focus: "item", handled: true };
    if (key === "ArrowUp") return { state: { open: true, index: count - 1 }, focus: "item", handled: true };
    return { state, handled: false };
  }
  switch (key) {
    case "ArrowDown":
      return { state: { open: true, index: (state.index + 1) % count }, focus: "item", handled: true };
    case "ArrowUp":
      return { state: { open: true, index: (state.index - 1 + count) % count }, focus: "item", handled: true };
    case "Home":
      return { state: { open: true, index: 0 }, focus: "item", handled: true };
    case "End":
      return { state: { open: true, index: count - 1 }, focus: "item", handled: true };
    case "Escape":
      return { state: MENU_CLOSED, focus: "arrow", handled: true };
    case "Tab":
      return { state: MENU_CLOSED, handled: false };
    case "Enter":
    case " ":
      return { state: MENU_CLOSED, focus: "arrow", activate: state.index, handled: true };
    default:
      return { state, handled: false };
  }
}

let ids = 0;

function run(item: ActionItem) {
  if (item.disabled) return;
  if (item.href) window.open(item.href, "_blank", "noopener");
  else item.onActivate?.();
}

/**
 * `name` names the change, for the arrow's accessible name. `disabled` disables both parts — while a starter is
 * starting or a confirmation is open. With no items the arrow part is not rendered at all.
 */
export function ActionMenu({ main, items, name, disabled = false }: { main?: ActionItem | ActionStatus; items: ActionItem[]; name: string; disabled?: boolean }) {
  const [state, setState] = useState<MenuState>(MENU_CLOSED);
  const [id] = useState(() => `action-menu-${++ids}`);
  const root = useRef<HTMLSpanElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  // Fixed against the arrow, so a lane that scrolls cannot clip it; it closes on scroll, so it never drifts.
  const [place, setPlace] = useState<Record<string, string>>({});
  const openAt = (index: number) => {
    const rect = arrow.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      const right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      setPlace(below < 180 && rect.top > below ? { right, bottom: `${window.innerHeight - rect.top + 4}px` } : { right, top: `${rect.bottom + 4}px` });
    }
    setState({ open: true, index });
  };

  // A click outside or a scroll closes it; the popup is positioned against the card and would drift otherwise.
  useEffect(() => {
    if (!state.open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setState(MENU_CLOSED);
    };
    const scrolled = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setState(MENU_CLOSED);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [state.open]);

  useEffect(() => {
    if (disabled && state.open) setState(MENU_CLOSED);
  }, [disabled, state.open]);

  const onKey = (e: KeyboardEvent) => {
    const next = menuKey(state, e.key, items.length);
    if (next.handled) e.preventDefault();
    if (next.state.open && !state.open) openAt(next.state.index);
    else setState(next.state);
    if (next.activate !== undefined) {
      const item = items[next.activate];
      if (item) run(item);
    }
    if (next.focus === "arrow") arrow.current?.focus();
    // After the render that put the item's tabindex in place.
    if (next.focus === "item") requestAnimationFrame(() => itemRefs.current[next.state.index]?.focus());
  };

  if (!main && items.length === 0) return null;
  const mainPart = !main ? null : "status" in main ? (
    // Not a button: it does nothing. Focusable, so a screen reader hears the state where the action would be.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the status stands where the action is, and is read there.
    <span class="split-status" role="status" tabIndex={0} title={main.title}>
      <span aria-hidden="true">⧗ </span>
      {main.status}
    </span>
  ) : main.href ? (
    <a class="btn sm split-main" href={main.href} target="_blank" rel="noopener noreferrer" title={main.title} aria-label={main.ariaLabel}>
      {main.label}
    </a>
  ) : (
    <button type="button" class="btn sm split-main session-start" title={main.title} aria-label={main.ariaLabel} disabled={disabled || main.disabled} onClick={() => run(main)}>
      {main.label}
    </button>
  );
  return (
    <span class={`split${items.length > 0 ? " has-menu" : ""}`} ref={root}>
      {mainPart}
      {items.length > 0 && (
        <>
          <button
            type="button"
            class="btn sm split-arrow"
            ref={arrow}
            aria-haspopup="menu"
            aria-expanded={state.open}
            aria-controls={id}
            aria-label={`More actions for ${name}`}
            title="More actions"
            disabled={disabled}
            onClick={() => {
              if (state.open) setState(MENU_CLOSED);
              else {
                openAt(0);
                requestAnimationFrame(() => itemRefs.current[0]?.focus());
              }
            }}
            onKeyDown={onKey}
          >
            <span aria-hidden="true">▾</span>
          </button>
          {state.open && (
            <div class="split-menu" role="menu" id={id} aria-label={`More actions for ${name}`} style={place}>
              {items.map((item, i) => {
                const props = {
                  role: "menuitem" as const,
                  tabIndex: i === state.index ? 0 : -1,
                  title: item.title,
                  "aria-label": item.ariaLabel,
                  "aria-disabled": item.disabled ? true : undefined,
                  class: `split-item${item.disabled ? " disabled" : ""}`,
                  onKeyDown: onKey,
                  onClick: (e: MouseEvent) => {
                    if (item.disabled) {
                      e.preventDefault();
                      return;
                    }
                    setState(MENU_CLOSED);
                    arrow.current?.focus();
                    // A link follows itself; anything else runs here.
                    if (!item.href) run(item);
                  },
                };
                const keep = (el: HTMLElement | null) => {
                  itemRefs.current[i] = el;
                };
                return item.href ? (
                  <a key={item.key} {...props} href={item.href} target="_blank" rel="noopener noreferrer" ref={keep}>
                    {item.label}
                  </a>
                ) : (
                  <button key={item.key} type="button" {...props} ref={keep}>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </span>
  );
}
