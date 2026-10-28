import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown, safeHref } from "../src/ui/markdown.tsx";
import { FIXTURES } from "./helpers.ts";
import { byTag, elements, textOf } from "./vnode.ts";

const CHANGE = join(FIXTURES, "demo-ops", "openspec", "changes", "cloud-deployment");
const fixture = (path: string) => readFileSync(join(CHANGE, path), "utf8");
const tags = (md: string) => elements(renderMarkdown(md)).map((el) => el.type as string);

/** No element may carry an event handler, inline markup, or be one that loads or runs something. */
function expectInert(md: string) {
  const tree = renderMarkdown(md);
  for (const el of elements(tree)) {
    expect(["script", "img", "iframe", "style", "link", "object", "embed", "video", "audio", "svg", "form"]).not.toContain(el.type as string);
    for (const prop of Object.keys(el.props)) {
      expect(prop.toLowerCase().startsWith("on")).toBe(false);
      expect(prop).not.toBe("dangerouslySetInnerHTML");
      expect(prop).not.toBe("src");
    }
  }
  return tree;
}

test("one fixture file of each artifact type renders as structure, not as Markdown source", () => {
  const proposal = renderMarkdown(fixture("proposal.md"));
  expect(byTag(proposal, "h2").length).toBeGreaterThan(0);
  expect(textOf(proposal)).not.toContain("## ");

  const spec = renderMarkdown(fixture("specs/cloud-deployment/spec.md"));
  expect(byTag(spec, "h3").map(textOf).some((t) => t.startsWith("Requirement:"))).toBe(true);
  expect(byTag(spec, "li").length).toBeGreaterThan(0);

  const design = renderMarkdown(fixture("design.md"));
  expect(elements(design).length).toBeGreaterThan(1);

  const tasks = renderMarkdown(fixture("tasks.md"));
  const boxes = byTag(tasks, "input");
  expect(boxes.length).toBe(10);
  expect(boxes.filter((b) => b.props.checked).length).toBe(4);
  expect(boxes.every((b) => b.props.type === "checkbox" && b.props.disabled === true)).toBe(true);
  for (const path of ["proposal.md", "design.md", "tasks.md", "specs/cloud-deployment/spec.md"]) expectInert(fixture(path));
});

test("headings, nested and ordered lists, tables, code, quotes, rules and inline styles", () => {
  const md = [
    "# Title",
    "",
    "Some *emphasis*, **strong**, ~~gone~~ and `inline <code>`.",
    "",
    "1. first",
    "2. second",
    "   - nested **bold**",
    "   - [ ] nested task",
    "",
    "| Area | Effect |",
    "| :--- | ---: |",
    "| Code | `one` module |",
    "",
    "```ts",
    "function f() {",
    "    return 1;",
    "}",
    "```",
    "",
    "> quoted",
    "",
    "---",
  ].join("\n");
  const tree = renderMarkdown(md);
  expect(tags(md)).toEqual(expect.arrayContaining(["h1", "p", "em", "strong", "del", "code", "ol", "ul", "li", "table", "thead", "tbody", "th", "td", "pre", "blockquote", "hr"]));
  expect(byTag(tree, "ol")[0].props.start).toBe(1);
  expect(byTag(byTag(tree, "ol")[0], "ul").length).toBe(1); // nested inside the ordered item
  expect(byTag(tree, "th").map(textOf)).toEqual(["Area", "Effect"]);
  expect(byTag(tree, "td")[1].props.style).toEqual({ textAlign: "right" });
  expect(textOf(byTag(tree, "pre")[0])).toBe("function f() {\n    return 1;\n}"); // line breaks and indentation kept
  expect(byTag(tree, "pre")[0].props["data-lang"]).toBe("ts");
  expect(byTag(tree, "code").map(textOf)).toContain("inline <code>");
});

test("raw HTML never becomes an element", () => {
  for (const md of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "text <b onclick=alert(1)>bold</b> text", "<style>body{display:none}</style>", '<iframe src="https://example.com"></iframe>', "<div>\n\n**x**\n\n</div>"]) {
    const tree = expectInert(md);
    // shown as written instead of being interpreted or lost
    expect(textOf(tree)).toContain(md.split("\n")[0].slice(0, 12));
  }
  expect(tags("<script>alert(1)</script>")).toEqual(["div", "p"]);
});

test("images are neither embedded nor fetched", () => {
  const tree = expectInert("before ![diagram](https://example.com/a.png) after");
  expect(byTag(tree, "img")).toEqual([]);
  expect(JSON.stringify(elements(tree).map((el) => Object.entries(el.props).filter(([k]) => k !== "children")))).not.toContain("example.com");
  expect(textOf(tree)).toBe("before diagram after");
});

test("only absolute http, https and mailto targets become links without a resolver", () => {
  const dangerous = renderMarkdown("[click](javascript:alert(1)) [d](data:text/html,x) [v](vbscript:x) [f](file:///etc/passwd)");
  expect(byTag(dangerous, "a")).toEqual([]);
  expect(textOf(dangerous)).toBe("click d v f");

  const docs = byTag(renderMarkdown("[docs](https://example.com/docs)"), "a")[0];
  expect(docs.props).toMatchObject({ href: "https://example.com/docs", target: "_blank", rel: "noopener noreferrer" });
  expect(textOf(docs)).toBe("docs");

  const others = byTag(renderMarkdown("[m](mailto:team@example.com) [r](design.md) <https://example.com/auto>"), "a");
  expect(others.map((a) => a.props.href)).toEqual(["mailto:team@example.com", "https://example.com/auto"]);
  expect(others.every((a) => a.props.target === "_blank" && a.props.rel === "noopener noreferrer")).toBe(true);

  expect(safeHref("JaVaScRiPt:alert(1)")).toBeUndefined();
  expect(safeHref(" java\tscript:alert(1)")).toBeUndefined();
  expect(safeHref("\u0001javascript:alert(1)")).toBeUndefined();
  expect(safeHref("")).toBeUndefined();
  expect(safeHref("HTTPS://example.com")).toBe("HTTPS://example.com");
  expect(safeHref("../specs/x.md#anchor")).toBeUndefined();
});

test("What's new never renders a relative link: without a resolver, relative targets are text", () => {
  const tree = renderMarkdown("See [design](./design.md), [up](../../specs/x.md), [top](#top) and [root](/board).");
  expect(byTag(tree, "a")).toEqual([]);
  expect(textOf(tree)).toBe("See design, up, top and root.");
});

test("a resolver turns relative targets into in-place links, and only those it accepts", () => {
  const seen: string[] = [];
  const resolver = { resolve: (t: string) => (seen.push(t), t === "./design.md" ? "/repo/r/change/c?file=design.md" : undefined) };
  const tree = expectInert("[d](./design.md) [x](./missing.md) [js](javascript:alert(1)) [w](https://example.com)");
  const links = byTag(renderMarkdown("[d](./design.md) [x](./missing.md) [js](javascript:alert(1)) [w](https://example.com)", resolver), "a");
  expect(seen).toEqual(["./design.md", "./missing.md"]); // never asked about absolute targets
  expect(links.map((a) => a.props.href)).toEqual(["/repo/r/change/c?file=design.md", "https://example.com"]);
  expect(links[0].props.target).toBeUndefined();
  expect(links[0].props.class).toBe("md-file-link");
  expect(textOf(tree)).toBe("d x js w");
  // The resolver belongs to one call: the next render without one has no relative links again.
  expect(byTag(renderMarkdown("[d](./design.md)"), "a")).toEqual([]);
});

test("the renderer has no way to inject markup", () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "ui", "markdown.tsx"), "utf8").replace(/\/\/.*$/gm, "");
  expect(source).not.toContain("dangerouslySetInnerHTML");
  expect(source).not.toMatch(/\bparse\(|<img\b|innerHTML/);
});

test("character references in text are decoded, odd input does not throw", () => {
  expect(textOf(renderMarkdown("a &amp; b &lt;c&gt;"))).toBe("a & b <c>");
  expect(textOf(renderMarkdown(""))).toBe("");
  expect(() => renderMarkdown("[unclosed](\n\n```\nnever closed")).not.toThrow();
});
