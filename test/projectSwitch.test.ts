// The repository board header's project switcher (project-overview: "The repository board header switches between projects").
import { expect, test } from "bun:test";
import { h } from "preact";
import type { RepoSnapshot } from "../src/shared/types.ts";
import { moveFocus, SwitchList } from "../src/ui/projectSwitch.tsx";
import { filterEntries, switchEntries } from "../src/ui/projectSwitchState.ts";
import { href } from "../src/ui/url.ts";
import { byTag, textOf } from "./vnode.ts";

const repo = (id: string, name: string, path = `/w/acme/${name}`, ok = true) => ({ id, name, path, ok }) as RepoSnapshot;
const repos = [repo("g", "gamma-web"), repo("a", "alpha-infra"), repo("b", "beta-soc", "/w/acme/beta-soc", false)];

test("entries are sorted by name ignoring case, with the current project and a failed scan marked", () => {
  const entries = switchEntries([...repos, repo("d", "Delta-api")], "b");
  expect(entries.map((e) => e.name)).toEqual(["alpha-infra", "beta-soc", "Delta-api", "gamma-web"]);
  expect(entries.filter((e) => e.current).map((e) => e.id)).toEqual(["b"]);
  expect(entries.filter((e) => e.failed).map((e) => e.id)).toEqual(["b"]);
  expect(entries.every((e) => e.hint === undefined)).toBe(true);
});

test("same-named projects get the overview's path hints, and the search matches them", () => {
  const entries = switchEntries([repo("x", "chat-groups", "/w/acme/chat-groups"), repo("y", "chat-groups", "/w/ops/repos/chat-groups")], "x");
  expect(entries.map((e) => e.hint)).toEqual(["acme", "ops/repos"]);
  expect(filterEntries(entries, "ops").map((e) => e.id)).toEqual(["y"]);
});

test("the search narrows by name, ignoring case and surrounding spaces", () => {
  const entries = switchEntries(repos, "a");
  expect(filterEntries(entries, " GA ").map((e) => e.id)).toEqual(["g"]);
  expect(filterEntries(entries, "").length).toBe(3);
  expect(filterEntries(entries, "zzz")).toEqual([]);
});

const list = (q: string, onChoose = () => {}) =>
  h(SwitchList, { entries: switchEntries(repos, "b"), q, onQuery: () => {}, onChoose, onKeyDown: () => {} });

test("the list links every project to its board and marks the current one", () => {
  const links = byTag(list(""), "a");
  expect(links.map((a) => a.props.href)).toEqual(["a", "b", "g"].map((id) => href(`/repo/${id}`)));
  expect(links.map((a) => a.props["aria-current"])).toEqual([undefined, "page", undefined]);
  expect(links.map((a) => a.props.title)).toEqual(["/w/acme/alpha-infra", "/w/acme/beta-soc", "/w/acme/gamma-web"]);
  expect(textOf(links[1])).toContain("scan failed");
});

test("a search that matches nothing says so", () => {
  expect(byTag(list("zzz"), "a")).toEqual([]);
  expect(textOf(list("zzz"))).toContain("No project matches “zzz”.");
});

test("a modifier or middle click is left to the browser and keeps the list", () => {
  let chosen = 0;
  const [alpha] = byTag(list("", () => chosen++), "a");
  for (const patch of [{ metaKey: true }, { ctrlKey: true }, { button: 1 }]) {
    let prevented = false;
    const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...patch, preventDefault: () => (prevented = true) };
    (alpha.props.onClick as (e: unknown) => void)(event);
    expect(prevented).toBe(false);
  }
  expect(chosen).toBe(0);
});

test("choosing the current project only closes the list", () => {
  let chosen = 0;
  const current = byTag(list("", () => chosen++), "a")[1];
  let prevented = false;
  (current.props.onClick as (e: unknown) => void)({ defaultPrevented: false, button: 0, preventDefault: () => (prevented = true) });
  expect(prevented).toBe(true);
  expect(chosen).toBe(1);
});

test("the arrow keys move between the search field (-1) and the entries", () => {
  expect(moveFocus(-1, 3, "ArrowDown")).toBe(0);
  expect(moveFocus(2, 3, "ArrowDown")).toBe(2);
  expect(moveFocus(0, 3, "ArrowUp")).toBe(-1);
  expect(moveFocus(-1, 0, "ArrowDown")).toBe(-1);
});
