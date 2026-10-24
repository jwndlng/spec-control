// Guards for the demo's sample data: it must be obviously fictional, showcase every board feature, and stay fresh.
import { expect, test } from "bun:test";
import { boardColumns } from "../src/shared/columns.ts";
import { summarizeWorkInProgress } from "../src/shared/workInProgress.ts";
import { checkoutMarkers } from "../src/ui/checkoutMarkers.ts";
import { availableActions } from "../src/shared/types.ts";
import { buildActivity, buildPullRequests, buildSample, DEMO_AGENT, DEMO_ROOT } from "../src/ui/demo/sampleData.ts";
import { pageEvents, retained } from "../src/shared/activity.ts";
import { DAY_COLLAPSE_ABOVE, groupByDay } from "../src/ui/activityState.ts";
import { meterText } from "../src/ui/kanban.tsx";
import { pullRequestEntries } from "../src/ui/pullRequestsState.ts";
import { startersFor } from "../src/ui/sessionState.ts";
import { filterRows, overviewRows, wipIndicator } from "../src/ui/overviewState.ts";
import { looksLikeRealHome } from "./helpers.ts";

const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const sample = buildSample(NOW);
const changes = sample.snapshot.repos.flatMap((r) => r.changes);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("every path in the sample is under the fictional root", () => {
  const paths = [
    ...sample.snapshot.repos.flatMap((r) => [r.path, ...r.worktrees.map((w) => w.path)]),
    ...sample.config.repos.map((r) => r.path),
    ...sample.config.scanRoots,
    ...sample.candidates.map((r) => r.path),
  ];
  expect(DEMO_ROOT.startsWith("/home/demo/")).toBe(true);
  expect(paths.length).toBeGreaterThan(10);
  for (const path of paths) expect(path.startsWith("/home/demo/")).toBe(true);
});

test("no string in the sample looks like a real home directory", () => {
  expect(strings(sample).filter(looksLikeRealHome)).toEqual([]);
});

test("the real-home detector catches the usual shapes and lets the demo root through", () => {
  for (const bad of ["/Users/alice/Workspace/secret-repo", "/home/bob/src/x", "C:\\Users\\carol\\code", "see /Users/dave"]) {
    expect(looksLikeRealHome(bad)).toBe(true);
  }
  for (const ok of ["/home/demo/work/atlas-api", "feat/users-page", "openspec/changes/x"]) expect(looksLikeRealHome(ok)).toBe(false);
});

test("the sample showcases every board feature", () => {
  expect(sample.snapshot.repos.length).toBeGreaterThanOrEqual(5);
  const perColumn = new Map<string, number>();
  for (const c of changes) perColumn.set(c.column, (perColumn.get(c.column) ?? 0) + 1);
  for (const column of boardColumns(sample.snapshot)) expect([column, perColumn.get(column) ?? 0]).not.toEqual([column, 0]);
  expect(perColumn.get("Archived") ?? 0).toBeGreaterThan(25);
  // With Hide merged on by default, the Archived column still has archives that wait to be pushed or merged.
  expect(changes.filter((c) => c.archived && c.checkout?.isMain === false).length).toBeGreaterThanOrEqual(2);
  expect(changes.some((c) => c.branchMatch)).toBe(true);
  expect(changes.some((c) => c.warnings?.includes("tasks file has no tasks"))).toBe(true);
  expect(changes.some((c) => c.warnings?.some((w) => w !== "tasks file has no tasks"))).toBe(true);
  expect(sample.snapshot.repos.some((r) => !r.ok && r.error)).toBe(true);
  expect(sample.candidates.length).toBeGreaterThan(0);
});

test("ids and change names are unique where the UI relies on it", () => {
  const ids = [...sample.config.repos, ...sample.candidates].map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const repo of sample.snapshot.repos) {
    const names = repo.changes.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  }
});

test("dates move with now, so ages never grow", () => {
  const later = buildSample(NOW + 180 * 24 * 3_600_000);
  const age = (s: typeof sample, now: number) => now - Date.parse(s.snapshot.repos[0].changes[1].lastActivityAt ?? "");
  expect(age(later, NOW + 180 * 24 * 3_600_000)).toBe(age(sample, NOW));
  expect(later.snapshot.generatedAt).not.toBe(sample.snapshot.generatedAt);
});

test("every roll-up equals what the scanner's roll-up computes from the repository's checkouts", () => {
  for (const repo of sample.snapshot.repos) {
    expect(repo.workInProgress).toEqual(summarizeWorkInProgress(repo.worktrees));
    expect(repo.worktrees.filter((w) => w.isMain).map((w) => [w.path, w.branch])).toEqual([[repo.path, repo.currentBranch]]);
  }
});

test("the sample showcases every checkout state", () => {
  const checkouts = sample.snapshot.repos.flatMap((r) => r.worktrees);
  const linked = checkouts.filter((w) => !w.isMain);
  expect(linked.length).toBeGreaterThanOrEqual(8);
  const kinds = new Set(checkouts.flatMap((w) => checkoutMarkers(w).map((m) => m.kind)));
  expect([...kinds].sort()).toEqual(["behind", "locked", "stale", "uncommitted", "unknown", "unpushed"]);
  expect(linked.some((w) => checkoutMarkers(w).length === 0)).toBe(true); // clean
  expect(checkouts.some((w) => w.detached && !w.branch)).toBe(true);
  // Unpushed both ways: ahead of an upstream, and never pushed.
  const unpushed = checkouts.filter((w) => (w.unpushed ?? 0) > 0 && typeof w.status === "object");
  expect(unpushed.some((w) => typeof w.status === "object" && w.status.upstream)).toBe(true);
  expect(unpushed.some((w) => typeof w.status === "object" && !w.status.upstream && w.branch)).toBe(true);
  // The overview shows a warning, a plain indicator's absence (clean repository) and a dirty main checkout without worktrees.
  const indicators = sample.snapshot.repos.map((r) => wipIndicator(r.workInProgress)?.text);
  expect(indicators).toContain(undefined);
  expect(indicators).toContain("1 uncommitted");
});
test("the sample shows worktree-agnostic changes: one that lives in a worktree and is also, further back, on main", () => {
  const sample = buildSample(Date.parse("2026-06-01T12:00:00.000Z"));
  const changes = sample.snapshot.repos.flatMap((r) => r.changes.map((c) => ({ repo: r, change: c })));
  const inWorktree = changes.filter(({ change }) => change.checkout && !change.checkout.isMain);
  expect(inWorktree.length).toBeGreaterThanOrEqual(3);
  for (const { repo, change } of inWorktree) {
    // it lives in one of its repository's worktrees, on that worktree's branch
    const worktree = repo.worktrees.find((w) => w.path === change.checkout?.path);
    expect([change.name, worktree?.isMain, worktree?.branch]).toEqual([change.name, undefined, change.checkout?.branch]);
    // like the scanner, only an active change carries a branch match
    expect([change.name, change.branchMatch]).toEqual([change.name, change.archived ? undefined : change.checkout?.branch]);
  }
  const both = inWorktree.find(({ change }) => change.otherCheckouts?.length)!;
  expect(both.change.otherCheckouts).toEqual([{ path: both.repo.path, branch: both.repo.currentBranch, isMain: true, column: "Drafts" }]);
  expect(both.change.column).not.toBe("Drafts"); // led by the copy that is further along
  // every repository lists its main checkout first, like `git worktree list` does; names are unique per repository
  for (const repo of sample.snapshot.repos) {
    if (repo.worktrees.length) expect([repo.name, repo.worktrees[0].isMain, repo.worktrees[0].path]).toEqual([repo.name, true, repo.path]);
    const active = repo.changes.filter((c) => !c.archived).map((c) => c.name);
    expect(new Set(active).size).toBe(active.length);
  }
});

test("the demo shows a change in Done awaiting validation, with a Validate prompt on its agent", () => {
  const validating = changes.filter((c) => (c.tasks?.awaiting ?? 0) > 0);
  expect(validating.length).toBeGreaterThan(0);
  for (const c of validating) {
    expect([c.name, c.column, c.subState]).toEqual([c.name, "Done", "validate"]);
    // Awaiting is never folded into done: the card must not claim a verification nobody did.
    expect(c.tasks!.done + c.tasks!.awaiting!).toBe(c.tasks!.total);
    expect(c.tasks!.done).toBeLessThan(c.tasks!.total);
    expect(availableActions(c)).toEqual(["validate", "archive"]);
  }
  // The starters are only offered because the demo's agent has a prompt for each.
  expect(DEMO_AGENT.prompts.validate).toBeDefined();
  expect(startersFor({ ...sample.config, repos: sample.config.repos }, { ...validating[0] })).toEqual(["validate", "archive"]);
  // The card's bar names the awaiting count in words, not by colour alone.
  const { done, awaiting, total } = validating[0].tasks!;
  expect(meterText(done, total, "tasks", awaiting)).toContain(`${awaiting} awaiting validation`);
});

test("the demo shows a change in Ready without a design: the spec-driven schema requires only tasks", () => {
  const noDesign = changes.find((c) => c.name === "trim-bundle-size")!;
  expect(noDesign.artifacts.find((a) => a.id === "design")).toMatchObject({ status: "ready", required: false });
  expect(noDesign.artifacts.find((a) => a.id === "tasks")).toMatchObject({ status: "done", required: true });
  expect(noDesign.column).toBe("Ready");
  // Implement is offered; Draft artifacts too, since the optional design can still be written.
  expect(availableActions(noDesign)).toEqual(["draft", "implement"]);
});

test("the demo shows a change in Ready waiting for one in Implementing, and that one lists it as required by", () => {
  const blocked = changes.filter((c) => c.blocked);
  expect(blocked.map((c) => [c.name, c.column, c.dependsOn])).toEqual([["blue-green-deploys", "Ready", [{ name: "centralize-log-shipping", state: "waiting" }]]]);
  expect(availableActions(blocked[0])).not.toContain("implement");
  const dependency = changes.find((c) => c.name === "centralize-log-shipping");
  expect([dependency?.column, dependency?.requiredBy]).toEqual(["Implementing", ["blue-green-deploys"]]);
});

test("the demo's pull requests show every state the view can render, under made-up acme names", () => {
  const now = Date.parse("2026-06-01T12:00:00.000Z");
  const answer = buildPullRequests(sample.snapshot, now, now - 2 * 60_000);
  expect(answer.viewer).toBe("demo-user");
  // One repository stands for "tracked, but not on GitHub"; the rest are under the invented acme organisation.
  expect(answer.repos.filter((r) => r.status === "unavailable").map((r) => r.reason)).toEqual(["not on GitHub"]);
  for (const repo of answer.repos) expect(repo.github === undefined || repo.github.startsWith("acme/")).toBe(true);

  const prs = answer.repos.flatMap((r) => r.pullRequests);
  expect(prs.filter((pr) => pr.draft)).not.toHaveLength(0);
  expect(prs.filter((pr) => pr.review === "approved" && pr.checks === "passing")).not.toHaveLength(0);
  expect(prs.filter((pr) => pr.checks === "failing")).not.toHaveLength(0);
  expect(prs.filter((pr) => pr.reviewRequestedFromViewer)).not.toHaveLength(0);
  expect(prs.filter((pr) => pr.state === "closed")).not.toHaveLength(0);
  // Merged, and recently enough that the view's 7-day window keeps it.
  const merged = prs.filter((pr) => pr.state === "merged");
  expect(merged).not.toHaveLength(0);
  for (const pr of merged) expect(now - Date.parse(pr.mergedAt as string)).toBeLessThan(7 * 24 * 3600_000);
  // Every link is a github.com URL the visitor follows; the demo itself requests nothing.
  for (const pr of prs) expect(pr.url.startsWith("https://github.com/acme/")).toBe(true);
  // Both groups have something in them, at more than one repository.
  const groups = pullRequestEntries(answer, sample.snapshot.repos.map((r) => ({ id: r.id, name: r.name })));
  expect(groups.open.length).toBeGreaterThan(3);
  expect(groups.closed.length).toBeGreaterThan(1);
  expect(new Set(groups.open.map((e) => e.repoId)).size).toBeGreaterThan(2);
});

test("the demo shows custom, detected and hidden labels", () => {
  const rows = overviewRows(sample.snapshot, sample.config);
  const all = rows.flatMap((r) => r.labels);
  expect(all.some((l) => l.kind === "custom")).toBe(true);
  expect(all.some((l) => l.kind === "detected")).toBe(true);
  // A hidden detected label: detected in the snapshot, hidden in the config, not displayed.
  const hiding = sample.config.repos.find((r) => r.hiddenLabels?.length);
  expect(hiding).toBeDefined();
  const hiddenRepo = sample.snapshot.repos.find((r) => r.id === hiding?.id);
  expect(hiddenRepo?.detectedLabels?.some((d) => d.label === hiding?.hiddenLabels?.[0])).toBe(true);
  expect(rows.find((r) => r.id === hiding?.id)?.labels.some((l) => l.label === hiding?.hiddenLabels?.[0])).toBe(false);
  // A label shared by several repositories, so the filter has something to narrow.
  expect(filterRows(rows, "", false, ["client"]).length).toBeGreaterThanOrEqual(2);
});

test("the sample activity has a busy day to collapse and a non-zero count for every summary figure", () => {
  // The demo is built from the visitor's clock, so check it at several times of day.
  for (const hours of [0, 5, 9, 14, 23]) {
    const now = NOW + hours * 3_600_000;
    const page = pageEvents(retained(buildActivity(buildSample(now).snapshot, now), now));
    for (const [figure, count] of Object.entries(page.summary ?? {})) expect({ hours, figure, count: count > 0 }).toEqual({ hours, figure, count: true });
    expect(Object.keys(page.summary ?? {})).toHaveLength(6);
    const busiest = Math.max(...groupByDay(page.events, new Date(now)).map((d) => d.events.length));
    expect({ hours, busy: busiest > DAY_COLLAPSE_ABOVE }).toEqual({ hours, busy: true });
  }
});

test("the sample has one duplicate after archive, shown as its archived card with the main checkout's copy folded in", () => {
  const duplicates = changes.filter((c) => c.duplicate);
  expect(duplicates).toHaveLength(1);
  const [d] = duplicates;
  expect(d.column).toBe("Archived");
  expect(d.duplicate?.archive).toBe(`${d.archived}-${d.name}`);
  expect(d.otherCheckouts?.some((o) => o.isMain)).toBe(true);
  expect(changes.filter((c) => c.name === d.name && c.repoId === d.repoId)).toHaveLength(1);
});
