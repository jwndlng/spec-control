import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "src", "ui", "styles.css"), "utf8");

function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  return css.slice(start, css.indexOf("\n}", start));
}

function token(source: string, name: string) {
  const value = source.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function luminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [value >> 16 & 255, value >> 8 & 255, value & 255].map((part) => {
    const channel = part / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const [theme, selector] of [["dark", ":root"], ["light", ':root[data-theme="light"]']] as const) {
  test(`dropdown option text meets 4.5:1 contrast in the ${theme} theme`, () => {
    const colors = block(selector);
    const foreground = token(colors, "--fg-body");
    const heading = token(colors, "--fg-heading");
    const surface = token(colors, "--bg-elevated");
    const active = token(colors, "--brand-softer");
    expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(heading, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(foreground, active)).toBeGreaterThanOrEqual(4.5);
  });
}

test("dropdown entrances stop under reduced motion and the popup stays internally scrollable", () => {
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain(".select-popup { animation: none; }");
  expect(css).toContain(".select-options { min-height: 0; overflow: auto; overscroll-behavior: contain;");
});
