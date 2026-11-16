import { createPortal } from "preact/compat";
import type { Ref } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

let dismissOpen: { id: string; run: () => void } | undefined;

/** Lets a surrounding capture-phase Escape handler give an open picker first refusal. */
export function dismissActiveSelect(): boolean {
  if (!dismissOpen) return false;
  dismissOpen.run();
  return true;
}

function moveTab(from: HTMLElement, backwards: boolean) {
  const candidates = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.isConnected && !el.closest("[inert]") && !el.closest(".select-popup") && el.getAttribute("aria-hidden") !== "true");
  const index = candidates.indexOf(from);
  const next = candidates[index + (backwards ? -1 : 1)];
  if (next) {
    next.focus();
  }
}

/** A controlled, single-value picker. The caller owns values and persistence; browsing never calls onChange. */
export function Select({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  id,
  title,
  disabled = false,
  compact = false,
  class: className = "",
  placeholder,
  triggerRef,
  onTriggerClick,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
  compact?: boolean;
  class?: string;
  placeholder?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  onTriggerClick?: (event: MouseEvent) => void;
}) {
  const uid = useId();
  const instanceId = `select-${uid}`;
  const popupId = id ? `${id}-listbox` : `select-listbox-${uid}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string>();
  const [position, setPosition] = useState<Record<string, string>>({});
  const searchable = options.length >= 8;
  const matches = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [options, query]);
  const enabled = matches.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  const selectedIndex = matches.findIndex((option) => option.value === value && !option.disabled);
  const enabledActive = matches.findIndex((option) => option.value === activeValue && !option.disabled);
  const active = enabledActive >= 0 ? enabledActive : (enabled[0] ?? 0);
  const display = options.find((option) => option.value === value)?.label ?? placeholder ?? "Select…";

  const setTriggerRef = (el: HTMLButtonElement | null) => {
    trigger.current = el;
    if (typeof triggerRef === "function") triggerRef(el);
    else if (triggerRef) triggerRef.current = el;
  };

  const setActive = (index: number) => {
    const option = matches[index];
    if (option && !option.disabled) setActiveValue(option.value);
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    typeahead.current = "";
    if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
    if (dismissOpen?.id === instanceId) dismissOpen = undefined;
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus());
  };
  const closeActive = () => close(true);

  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return false;
    const margin = 8;
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      close(false);
      return false;
    }
    const width = Math.min(Math.max(rect.width, 220), Math.max(1, window.innerWidth - margin * 2));
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const maxHeight = Math.max(1, Math.min(320, Math.max(below, above) - 4));
    setPosition({ left: `${left}px`, width: `${width}px`, maxHeight: `${maxHeight}px`, ...(below >= above ? { top: `${rect.bottom + 4}px` } : { bottom: `${window.innerHeight - rect.top + 4}px` }) });
    return true;
  };

  const openPicker = (initial?: number) => {
    if (disabled) return;
    dismissOpen?.run();
    if (!place()) return;
    const chosen = selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? 0);
    setActiveValue(matches[initial ?? chosen]?.value);
    setQuery("");
    setOpen(true);
    dismissOpen = { id: instanceId, run: closeActive };
  };

  const commit = (index: number) => {
    const option = matches[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  const nextEnabled = (start: number, direction: number) => {
    if (!enabled.length) return start;
    let index = start;
    for (let count = 0; count < matches.length; count++) {
      index = (index + direction + matches.length) % matches.length;
      if (!matches[index]?.disabled) return index;
    }
    return start;
  };

  const onKeyDown = (event: KeyboardEvent, inSearch: boolean) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openPicker(event.key === "ArrowUp" ? (enabled.at(-1) ?? 0) : undefined);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      event.stopPropagation();
      close(false);
      if (trigger.current) moveTab(trigger.current, event.shiftKey);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActive(nextEnabled(active, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      setActive(event.key === "Home" ? (enabled[0] ?? 0) : (enabled.at(-1) ?? 0));
    } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      commit(active);
    } else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead.current = `${typeahead.current}${event.key}`.toLocaleLowerCase();
      const prefix = typeahead.current;
      const index = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(prefix));
      if (index >= 0) setActiveValue(options[index]?.value);
      if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = window.setTimeout(() => { typeahead.current = ""; }, 700);
    } else if (inSearch && event.key === " ") {
      return;
    }
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(false);
    };
    const reposition = () => place();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const frame = requestAnimationFrame(() => {
      (searchable ? search.current : listbox.current)?.focus();
      if (!searchable) optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
    });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      cancelAnimationFrame(frame);
      if (dismissOpen?.id === instanceId) dismissOpen = undefined;
    };
  }, [open, searchable]);

  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    if (enabledActive < 0 && enabled.length) setActiveValue(matches[selectedIndex >= 0 ? selectedIndex : enabled[0]]?.value);
    optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [matches, active, enabled, enabledActive, activeValue, selectedIndex, open]);

  const panel = open ? <div ref={popup} class="select-popup" style={position} onPointerDown={(event) => event.stopPropagation()}>
    {searchable && <input
      ref={search}
      class="select-search"
      type="search"
      role="combobox"
      aria-label={ariaLabel ? `Search ${ariaLabel}` : "Search options"}
      aria-describedby={ariaDescribedBy}
      aria-autocomplete="list"
      aria-expanded="true"
      aria-controls={popupId}
      aria-activedescendant={enabled.length ? `${popupId}-option-${active}` : undefined}
      value={query}
      placeholder="Search options…"
      onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
      onKeyDown={(event) => onKeyDown(event, true)}
    />}
    <div
      ref={listbox}
      class="select-options"
      id={popupId}
      role="listbox"
      aria-label={ariaLabel ? `${ariaLabel} options` : undefined}
      aria-labelledby={ariaLabelledBy}
      tabIndex={searchable ? -1 : 0}
      aria-activedescendant={enabled.length ? `${popupId}-option-${active}` : undefined}
      onKeyDown={(event) => onKeyDown(event, false)}
    >
      {matches.map((option, index) => <div
        key={`${option.value}-${index}`}
        id={`${popupId}-option-${index}`}
        ref={(el) => { optionRefs.current[index] = el; }}
        class={`select-option${index === active ? " active" : ""}${option.value === value ? " selected" : ""}${option.disabled ? " disabled" : ""}`}
        role="option"
        aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        tabIndex={-1}
        onPointerMove={() => !option.disabled && setActive(index)}
        onClick={() => commit(index)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            commit(index);
          }
        }}
      >
        <span>{option.label}</span>
        {option.value === value && <span class="select-check" aria-hidden="true">✓</span>}
      </div>)}
    </div>
    {!matches.length && <div class="select-empty" role="status">No options found</div>}
    {searchable && matches.length > 0 && <span class="sr-only" role="status">{matches.length} {matches.length === 1 ? "option" : "options"}</span>}
  </div> : null;

  return <>
    <button
      ref={setTriggerRef}
      id={id}
      type="button"
      class={`shared-select${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={popupId}
      title={title}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onTriggerClick?.(event); open ? close(true) : openPicker(); }}
      onKeyDown={(event) => onKeyDown(event, false)}
    >
      <span class="shared-select-label">{display}</span><span class="shared-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(panel, trigger.current?.closest<HTMLElement>('[role="dialog"], [aria-modal="true"]') ?? document.body)}
  </>;
}
