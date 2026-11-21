// The console's terminal gets its height from a chain of flex containers, not from any explicit size: the pane fills
// the detail content, the terminal fills what the pane's header leaves, and the terminal's host is absolutely
// positioned inside it. A `flex: 1` only resolves against a parent that is itself a flex container, so if any link in
// that chain stops being one the terminal collapses to nothing — its host contributes no height — and the console
// renders as a few pixels of frame. That is what happened when the dock's `.session-pane` rule was removed along with
// the dock while `ConsolePanel` still relied on it, so the chain is asserted here rather than left to a screenshot.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "src", "ui", "styles.css"), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`, with no media query in between. */
function rule(selector: string): string {
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector} in styles.css`);
  return match[1];
}

const declares = (selector: string, property: string, value: RegExp) => value.test(rule(selector).match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]*)`))?.[1]?.trim() ?? "");

test("the console's terminal sits in an unbroken column of flex parents, so it has a height to fill", () => {
  // Each of these claims `flex: 1` from its parent; the parent must therefore be a column flex container.
  expect(declares(".session-terminal", "flex", /^1\b/)).toBe(true);
  expect(declares(".session-terminal-area", "flex", /^1\b/)).toBe(true);

  // …the terminal's parent, which is the console pane itself. This is the link the dock's removal broke.
  expect(declares(".console-pane", "display", /^flex$/)).toBe(true);
  expect(declares(".console-pane", "flex-direction", /^column$/)).toBe(true);
  expect(declares(".console-pane", "min-height", /^0$/)).toBe(true);

  // …and the area's parent, the terminal box.
  expect(declares(".session-terminal", "display", /^flex$/)).toBe(true);
  expect(declares(".session-terminal", "flex-direction", /^column$/)).toBe(true);

  // The pane's own box is bounded by the detail content column, or `flex: 1` above would have nothing to divide.
  expect(declares(".detail-content:has(.console-pane)", "display", /^flex$/)).toBe(true);
  expect(declares(".detail-content:has(.console-pane)", "flex-direction", /^column$/)).toBe(true);
  expect(declares(".detail-content > .console-pane", "flex", /^1\b/)).toBe(true);
  expect(declares(".detail-content > .console-pane", "min-height", /^0$/)).toBe(true);

  // The host is absolutely positioned, which is exactly why a collapsed chain shows no terminal instead of a short one.
  expect(rule(".session-terminal-host")).toMatch(/position:\s*absolute/);
});

test("the Console header leaves at least 80% of the panel to the terminal and wraps at narrow widths", () => {
  expect(rule(".console-pane > .session-head")).toMatch(/max-height:\s*20%/);
  expect(rule(".console-pane > .session-head")).toMatch(/overflow:\s*auto/);
  expect(rule(".console-pane > .session-head:has(.console-settings[open])")).toMatch(/overflow:\s*visible/);
  expect(rule(".console-head-layout")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  expect(rule(".console-head-context")).toMatch(/flex-wrap:\s*wrap/);
  expect(rule(".console-session-facts")).toMatch(/flex-wrap:\s*wrap/);
  expect(rule(".console-head-actions .console-secondary-actions")).toMatch(/flex-wrap:\s*wrap/);
});

test("the change window uses more of the viewport and gives the settings menu room", () => {
  expect(rule(".detail-overlay")).toMatch(/padding:\s*clamp\(4px,\s*2vh,\s*20px\)\s+clamp\(4px,\s*2vw,\s*24px\)/);
  expect(rule(".detail")).toMatch(/width:\s*min\(1440px,\s*100%\)/);
  expect(rule(".detail")).not.toMatch(/max-height:\s*960px/);
});

test("dismiss and delete change controls have persistent borders at rest", () => {
  expect(rule(".btn.ghost.dismiss-change")).toMatch(/border-color:\s*var\(--border-strong\)/);
  expect(rule(".btn.ghost.delete-change-files")).toMatch(/border-color:\s*var\(--border-strong\)/);
});
