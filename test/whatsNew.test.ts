import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadChangelog, sortEntries, validateEntries, type ChangelogEntry } from "../scripts/changelog.ts";
import { groupByMonth, loadSeenIds, saveSeenIds, unseenIds, WHATS_NEW_SEEN_KEY } from "../src/ui/whatsNewState.ts";

const CHANGELOG = await loadChangelog(join(import.meta.dir, "../src/ui/changelog/entries"));

const entry = (date: string, slug: string): ChangelogEntry => ({ id: `${date}-${slug}`, date, title: slug, summary: `About ${slug}.` });
const memory = (data: Record<string, string> = {}) => ({
  data,
  getItem: (key: string) => data[key] ?? null,
  setItem: (key: string, value: string) => {
    data[key] = value;
  },
});
const throwing = {
  getItem: (): string | null => {
    throw new Error("refused");
  },
  setItem: () => {
    throw new Error("refused");
  },
};

const older = [entry("2026-09-24", "repository-cleanup"), entry("2026-09-20", "activity")];
const newer = [entry("2026-10-02", "project-labels"), entry("2026-10-01", "new-project"), entry("2026-09-30", "pull-requests"), ...older];

test("first visit: nothing remembered counts every entry as seen", () => {
  const store = memory();
  const seen = loadSeenIds(store);
  expect(seen).toBeUndefined();
  expect(unseenIds(newer, seen)).toEqual([]);
});

test("entries added after the user saw the list are counted, in changelog order", () => {
  const store = memory();
  saveSeenIds(older.map((e) => e.id), older, store);
  expect(unseenIds(newer, loadSeenIds(store))).toEqual(["2026-10-02-project-labels", "2026-10-01-new-project", "2026-09-30-pull-requests"]);
  saveSeenIds(newer.map((e) => e.id), newer, store);
  expect(unseenIds(newer, loadSeenIds(store))).toEqual([]);
});

test("removing a seen entry changes nothing and makes no other entry unseen", () => {
  const store = memory();
  saveSeenIds(newer.map((e) => e.id), newer, store);
  const without = newer.filter((e) => e.id !== "2026-10-01-new-project");
  expect(unseenIds(without, loadSeenIds(store))).toEqual([]);
});

test("a malformed or refused storage is 'nothing remembered' without an error", () => {
  for (const raw of ["not json", "{}", '["a", 1]', "null"]) expect(loadSeenIds(memory({ [WHATS_NEW_SEEN_KEY]: raw }))).toBeUndefined();
  expect(loadSeenIds(memory({ [WHATS_NEW_SEEN_KEY]: "[]" }))).toEqual(new Set());
  expect(loadSeenIds(throwing)).toBeUndefined();
  expect(unseenIds(newer, loadSeenIds(throwing))).toEqual([]);
  expect(() => saveSeenIds(["x"], newer, throwing)).not.toThrow();
});

test("saving prunes ids that are no longer in the changelog", () => {
  const store = memory();
  saveSeenIds(["2025-01-01-gone", ...older.map((e) => e.id)], older, store);
  expect(JSON.parse(store.data[WHATS_NEW_SEEN_KEY] ?? "")).toEqual(older.map((e) => e.id));
});

test("months group by the entry's calendar date, across a year boundary", () => {
  const entries = [entry("2027-01-01", "new-year"), entry("2026-12-31", "last-day"), entry("2026-12-01", "first-of-december"), entry("2026-11-30", "november")];
  const months = groupByMonth(entries, "en-US");
  expect(months.map((m) => m.label)).toEqual(["January 2027", "December 2026", "November 2026"]);
  expect(months.map((m) => m.entries.map((e) => e.id.slice(11)))).toEqual([["new-year"], ["last-day", "first-of-december"], ["november"]]);
  expect(groupByMonth([entry("2026-10-02", "project-labels"), entry("2026-09-24", "repository-cleanup")], "en-US").map((m) => m.label)).toEqual(["October 2026", "September 2026"]);
});

test("the changelog is well-formed: unique ids of its own date, valid dates, newest first, title and summary", () => {
  expect(CHANGELOG.length).toBeGreaterThan(0);
  expect(() => validateEntries(CHANGELOG)).not.toThrow();
  expect(CHANGELOG.some((item) => item.id === "2026-11-11-confirm-awaiting-tasks")).toBe(true);
});

test("the loader sorts deterministically and reports invalid entries", () => {
  expect(sortEntries([entry("2026-10-01", "z"), entry("2026-10-01", "a")]).map(({ id }) => id))
    .toEqual(["2026-10-01-a", "2026-10-01-z"]);
  expect(sortEntries([{ ...entry("2026-10-01", "z"), order: 0 }, { ...entry("2026-10-01", "a"), order: 1 }]).map(({ id }) => id))
    .toEqual(["2026-10-01-z", "2026-10-01-a"]);
  const ok = entry("2026-10-01", "a");
  expect(() => validateEntries([ok, ok])).toThrow("2026-10-01-a: duplicate id");
  expect(() => validateEntries([{ ...ok, id: "2026-10-01-Bad_Slug" }])).toThrow("id is not <YYYY-MM-DD>-<kebab-case-slug>");
  expect(() => validateEntries([{ ...ok, date: "2026-02-30" }])).toThrow("invalid date");
  expect(() => validateEntries([{ ...ok, date: "2026-10-02" }])).toThrow("id does not start with the entry's date");
  expect(() => validateEntries([{ ...ok, title: " ", summary: "" }])).toThrow("empty title");
  expect(() => validateEntries([ok], new Map([[ok.id, "2026-10-01-wrong.json"]]))).toThrow("filename does not match id");
});
