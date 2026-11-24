import { expect, test } from "bun:test";
import { DetailHeader, WorktreePath } from "../src/ui/changeDetail.tsx";
import { splitPathLabel } from "../src/ui/format.ts";
import { byComponent } from "./vnode.ts";

const main = { path: "/w/acme/demo-ops", branch: "main", isMain: true };
const linked = { path: "/w/acme/demo-ops-audit-trail", branch: "feat/audit-trail", isMain: false };
const change = (checkout?: typeof main) => ({ repoId: "d1", name: "audit-trail", checkout });
test("the path label keeps the worktree's own name as its tail", () => {
  expect(splitPathLabel("/h/worktrees/d1/audit-trail")).toEqual({ head: "/h/worktrees/d1/", tail: "audit-trail" });
  expect(splitPathLabel("/h/worktrees/d1/audit-trail/")).toEqual({ head: "/h/worktrees/d1/", tail: "audit-trail" });
  expect(splitPathLabel("relative")).toEqual({ head: "relative", tail: "" });
});

test("the detail header offers the worktree path for the change it shows, not for one gone from the snapshot", () => {
  const repo = { id: "d1", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: "2026-10-09T10:00:00Z", isGit: true, worktrees: [], changes: [] };
  const snapshot = { ...change(linked), schema: "spec-driven", artifacts: [], tasks: null, stage: "implementing" as const, column: "Implementing" };
  const offered = byComponent(DetailHeader({ repo, change: snapshot, onClose: () => {} }), WorktreePath);
  expect(offered.map((el) => el.props.path)).toEqual(["/w/acme/demo-ops-audit-trail"]);
  for (const checkout of [main, undefined]) {
    expect(byComponent(DetailHeader({ repo, change: { ...snapshot, checkout }, onClose: () => {} }), WorktreePath)).toEqual([]);
  }
  expect(byComponent(DetailHeader({ repo, change: { name: "gone" }, onClose: () => {} }), WorktreePath)).toEqual([]);
});
