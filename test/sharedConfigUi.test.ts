import { expect, test } from "bun:test";
import type { RepoSharedConfig, SharedConfigPreview, SharedProfile } from "../src/shared/types.ts";
import { foldDiff, lineDiff } from "../src/ui/lineDiff.ts";
import { carriedIds, type GridRow, isPending, pendingAssignments, profileIdFrom, summarize, utf8Bytes, withDigests } from "../src/ui/sharedConfigState.ts";

const profile = (id: string, name = id): SharedProfile => ({ id, name, context: "x", rules: {} });
const PROFILES = [profile("base", "Base"), profile("security", "Security")];
const carrying = (...applied: [string, "in-sync" | "outdated" | "orphaned"][]): RepoSharedConfig => ({ unreadable: false, applied: applied.map(([id, state]) => ({ id, state })) });
const row = (current: RepoSharedConfig | undefined, selected: string[]): GridRow => ({ repoId: "r", name: "alpha-infra", current, selected });

test("lineDiff marks only what changed and keeps order", () => {
  const diff = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne");
  expect(diff).toEqual([
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "same", text: "c" },
    { kind: "same", text: "d" },
    { kind: "add", text: "e" },
  ]);
  expect(lineDiff("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
  expect(lineDiff("", "a")).toEqual([{ kind: "del", text: "" }, { kind: "add", text: "a" }]);
});

test("foldDiff keeps context around changes and folds the rest", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const hunks = foldDiff(lineDiff(before, before.replace("line 10", "line ten")), 2);
  expect(hunks.map((h) => (h.kind === "skipped" ? `skip ${h.count}` : h.lines.map((l) => l.kind[0]).join("")))).toEqual(["skip 8", "ssdass", "skip 7"]);
  expect(foldDiff(lineDiff("a", "a"))).toEqual([{ kind: "skipped", count: 1 }]);
});

test("profile ids are unique lower-case slugs", () => {
  expect(profileIdFrom("Base", [])).toBe("base");
  expect(profileIdFrom("  Front-end / Web!  ", [])).toBe("front-end-web");
  expect(profileIdFrom("Base", ["base", "base-2"])).toBe("base-3");
  expect(profileIdFrom("§§§", [])).toBe("profile");
  expect(profileIdFrom("Sécurité", [])).toBe("se-curite");
  expect(utf8Bytes("é—a")).toBe(6);
});

test("the grid starts from what the file carries and ignores profiles that no longer exist", () => {
  expect(carriedIds(carrying(["base", "in-sync"], ["gone", "orphaned"]), PROFILES)).toEqual(["base"]);
  expect(carriedIds(undefined, PROFILES)).toEqual([]);
});

test("pending: a changed selection, a stale profile that stays, or orphaned sections", () => {
  expect(isPending(row(carrying(["base", "in-sync"]), ["base"]), PROFILES)).toBe(false);
  expect(isPending(row(carrying(), []), PROFILES)).toBe(false);
  expect(isPending(row(carrying(), ["base"]), PROFILES)).toBe(true); // attach
  expect(isPending(row(carrying(["base", "in-sync"], ["security", "in-sync"]), ["security"]), PROFILES)).toBe(true); // detach
  expect(isPending(row(carrying(["base", "outdated"]), ["base"]), PROFILES)).toBe(true); // update
  expect(isPending(row(carrying(["base", "in-sync"], ["gone", "orphaned"]), ["base"]), PROFILES)).toBe(true); // clean up
  expect(isPending(row({ unreadable: true, applied: [] }, ["base"]), PROFILES)).toBe(false); // nothing can be applied
  expect(isPending(row(undefined, ["base"]), PROFILES)).toBe(false); // not scanned yet

  const rows = [row(carrying(), ["security", "base"]), { ...row(carrying(["base", "in-sync"]), ["base"]), repoId: "s" }];
  expect(pendingAssignments(rows, PROFILES)).toEqual([{ repoId: "r", profileIds: ["base", "security"] }]); // dashboard order
});

test("summaries for the overview", () => {
  expect(summarize(undefined, PROFILES)).toBeUndefined();
  expect(summarize(carrying(), PROFILES)).toBeUndefined();
  expect(summarize(carrying(["base", "in-sync"], ["security", "in-sync"]), PROFILES)).toEqual({ text: "Base, Security", level: "ok" });
  expect(summarize(carrying(["base", "outdated"], ["gone", "orphaned"]), PROFILES)).toEqual({ text: "Base (outdated), gone (orphaned)", level: "warning" });
  expect(summarize({ unreadable: true, applied: [] }, PROFILES)).toEqual({ text: "config unreadable", level: "danger" });
});

test("a poll while the preview is open: Apply still sends exactly what was previewed, with its digests", () => {
  const previewFor = (repoId: string, refusal?: string): SharedConfigPreview => ({ repoId, current: { unreadable: false, applied: [] }, before: "a", after: "b", digest: `digest-${repoId}`, refusal });
  // the user ticks base for alpha-infra and opens the preview
  const atPreview: GridRow[] = [
    { repoId: "alpha", name: "alpha-infra", current: carrying(), selected: ["base"] },
    { repoId: "demo", name: "demo-ops", current: carrying(["base", "in-sync"]), selected: ["base"] },
  ];
  const assignments = pendingAssignments(atPreview, PROFILES);
  expect(assignments).toEqual([{ repoId: "alpha", profileIds: ["base"] }]);
  const previews = [previewFor("alpha")];
  // a poll then reports demo-ops's base section outdated, and a new repository is tracked: the live grid now wants more
  const afterPoll: GridRow[] = [atPreview[0], { ...atPreview[1], current: carrying(["base", "outdated"]) }, { repoId: "new", name: "new-repo", current: carrying(), selected: ["base"] }];
  expect(pendingAssignments(afterPoll, PROFILES).map((a) => a.repoId)).toEqual(["alpha", "demo", "new"]);
  // what Apply sends comes from the preview alone
  expect(withDigests(assignments, previews)).toEqual([{ repoId: "alpha", profileIds: ["base"], digest: "digest-alpha" }]);
});

test("withDigests leaves out what the preview refused or never covered", () => {
  const preview = (repoId: string, refusal?: string): SharedConfigPreview => ({ repoId, current: { unreadable: false, applied: [] }, before: "", after: "", digest: `d-${repoId}`, refusal });
  const assignments = [{ repoId: "a", profileIds: ["base"] }, { repoId: "b", profileIds: [] }, { repoId: "c", profileIds: ["security"] }];
  expect(withDigests(assignments, [preview("a"), preview("b", "invalid YAML")])).toEqual([{ repoId: "a", profileIds: ["base"], digest: "d-a" }]);
});
