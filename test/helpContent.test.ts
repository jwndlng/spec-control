import { expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { STAGE_COLUMN } from "../src/shared/types.ts";
import { AppLink, COLUMN_HELP, HELP_SECTION_IDS, HELP_SECTIONS } from "../src/ui/helpContent.tsx";
import { routeFromPath } from "../src/ui/routes.ts";
import { parseSection, SECTION_IDS } from "../src/ui/settingsSections.ts";
import { looksLikeRealHome } from "./helpers.ts";
import { byTag } from "./vnode.ts";

interface Walked {
  text: string;
  links: { path: string; query: string }[];
}

/** The text and in-app links of a section, with function components other than AppLink expanded. */
function walk(node: ComponentChildren, out: Walked = { text: "", links: [] }): Walked {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.text += `${node}`;
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  const vnode = node as VNode<{ children?: ComponentChildren; path?: string; query?: string }>;
  if (vnode.type === AppLink) out.links.push({ path: vnode.props.path ?? "", query: vnode.props.query ?? "" });
  else if (typeof vnode.type === "function") return walk((vnode.type as (p: unknown) => ComponentChildren)(vnode.props), out);
  return walk(vnode.props.children, out);
}

const walked = HELP_SECTIONS.map((s) => ({ id: s.id, ...walk(s.body()) }));

test("Help covers the main topics, each section once", () => {
  expect(new Set(HELP_SECTION_IDS).size).toBe(HELP_SECTION_IDS.length);
  expect(HELP_SECTION_IDS).toEqual(["getting-started", "board", "detail", "agent-sessions", "keeping-current", "pull-requests", "what-it-writes", "troubleshooting"]);
  for (const s of walked) expect([s.id, s.text.length > 100]).toEqual([s.id, true]);
});

test("the board section explains every column by its own name", () => {
  const board = walked.find((s) => s.id === "board");
  for (const [stage, column] of Object.entries(STAGE_COLUMN)) {
    expect(board?.text).toContain(column);
    expect(board?.text).toContain(COLUMN_HELP[stage as keyof typeof COLUMN_HELP]);
  }
});

test("every in-app link goes to a real view, and a Settings link to a real section", () => {
  const links = walked.flatMap((s) => s.links);
  expect(links.length).toBeGreaterThan(5);
  for (const { path, query } of links) {
    const route = routeFromPath(path);
    // Anything unknown falls back to the overview, so only "/" may land there.
    if (path !== "/") expect([path, route.view]).not.toEqual([path, "overview"]);
    if (route.view === "settings") expect([query, parseSection(query, SECTION_IDS)]).not.toEqual([query, undefined]);
  }
  // The troubleshooting section sends the user to the environment report.
  expect(walked.find((s) => s.id === "troubleshooting")?.links).toContainEqual({ path: "/settings", query: "?section=environment" });
});

test("Help names no real home directory, e-mail address or host", () => {
  for (const s of walked) {
    expect([s.id, looksLikeRealHome(s.text)]).toEqual([s.id, false]);
    expect(s.text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/);
    expect(s.text).not.toMatch(/\b(?:https?|ssh|git):\/\/|\bwww\./i);
  }
});

test("/help is the Help view", () => {
  expect(routeFromPath("/help")).toEqual({ view: "help" });
  expect(routeFromPath("/help/")).toEqual({ view: "help" });
  expect(routeFromPath("/helpful")).toEqual({ view: "overview" });
  expect(routeFromPath("/settings")).toEqual({ view: "settings" });
});

test("Help navigates its sections with the section navigation Settings has, not a chip list", async () => {
  const { HELP_PAGE, helpNavSections } = await import("../src/ui/help.tsx");
  const { SectionList, sectionHref } = await import("../src/ui/sectionNav.tsx");
  const sections = helpNavSections();
  expect(sections.map((s) => [s.id, s.label])).toEqual(HELP_SECTIONS.map((s) => [s.id, s.title]));
  // One section element per entry, with the id ?section= and the navigation refer to.
  const rendered = byTag(SectionList({ page: HELP_PAGE, sections, sectionClass: "help-section" }), "section");
  expect(rendered.map((s) => s.props.id)).toEqual(HELP_SECTION_IDS.map((id) => `help-${id}`));
  // Real links to /help with that section, keeping the other parameters; the first section is the default.
  expect(sectionHref(HELP_PAGE, "board", HELP_SECTION_IDS[0], "?q=x&section=detail")).toBe("/help?q=x&section=board");
  expect(sectionHref(HELP_PAGE, HELP_SECTION_IDS[0], HELP_SECTION_IDS[0], "?q=x")).toBe("/help?q=x");
  const source = await Bun.file(new URL("../src/ui/help.tsx", import.meta.url)).text();
  const css = await Bun.file(new URL("../src/ui/styles.css", import.meta.url)).text();
  expect(source).toContain("<SectionNav");
  expect(source + css).not.toContain("help-toc");
});

test("Getting started introduces setup and how to run it again", () => {
  const start = walked.find((s) => s.id === "getting-started");
  expect(start?.text).toContain("Run setup again");
  expect(start?.text).toContain("setup");
});

test("Help explains running session filtering and composition", () => {
  const board = walked.find((s) => s.id === "board")!.text;
  for (const term of ["Show running", "waiting for input or quiet", "archive", "Clear filters", "Activity threshold and Hide merged"])
    expect(board).toContain(term);
});
