import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "src", "ui", "styles.css"), "utf8");

function declared(selector: string, property: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector} in styles.css`);
  return match[1].match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]*)`))?.[1]?.trim();
}

test("Lanes constrain columns and scroll overflowing cards inside each column", () => {
  expect(declared(".board", "min-height")).toBe("0");
  expect(declared(".board:not(.stacked) .column", "min-height")).toBe("0");
  expect(declared(".board:not(.stacked) .cards", "flex")).toBe("1");
  expect(declared(".board:not(.stacked) .cards", "min-height")).toBe("0");
  expect(declared(".cards", "overflow-y")).toBe("auto");
  expect(declared("html:has(.board:not(.stacked)), body:has(.board:not(.stacked))", "overflow")).toBe("hidden");
});

test("Stack remains content-sized and uses page-level vertical scrolling", () => {
  expect(declared(".app:has(.board.stacked)", "height")).toBe("auto");
  expect(declared(".main:has(> .board.stacked)", "flex")).toBe("none");
  expect(declared(".board.stacked", "flex")).toBe("none");
  expect(declared(".board.stacked", "overflow")).toBe("visible");
  expect(declared(".board.stacked .cards", "overflow")).toBe("visible");
});
