import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";
import { DEMO_ROOT } from "../src/ui/demo/sampleData.ts";
import { candidateBranches } from "../src/shared/pullRequestLink.ts";
import type { ChangeSnapshot } from "../src/shared/types.ts";
import { boardCards, ChangeCard } from "../src/ui/kanban.tsx";
import { type DetailPr, DetailPullRequest, detailPullRequest } from "../src/ui/pullRequests.tsx";
import { createPrRefresher } from "../src/ui/pullRequestsState.ts";
import { textOf } from "./vnode.ts";

function demo() {
  let clock = Date.parse("2026-06-01T12:00:00.000Z");
  return { api: createDemoApi({ now: () => clock, latencyMs: 0 }), tick: (ms: number) => (clock += ms) };
}

test("a scan changes generatedAt, so Refresh's wait-for-a-new-snapshot loop ends", async () => {
  const { api, tick } = demo();
  const before = (await api.state()).generatedAt;
  tick(5_000);
  expect(await api.scan()).toEqual({ started: true });
  expect((await api.state()).generatedAt).not.toBe(before);
});

test("saving a config with a repository disabled removes it from the state, for this instance only", async () => {
  const { api } = demo();
  const config = await api.config();
  const [first] = config.repos;
  await api.saveConfig({ ...config, repos: config.repos.map((r) => (r.id === first.id ? { ...r, enabled: false } : r)) });
  expect((await api.state()).repos.map((r) => r.id)).not.toContain(first.id);
  // What a reload does: a fresh instance has the original sample again.
  expect((await demo().api.state()).repos.map((r) => r.id)).toContain(first.id);
});

test("renaming a repository shows on the board", async () => {
  const { api } = demo();
  const config = await api.config();
  await api.saveConfig({ ...config, repos: config.repos.map((r, i) => (i === 0 ? { ...r, name: "renamed" } : r)) });
  expect((await api.state()).repos[0].name).toBe("renamed");
});

test("discovery offers only untracked candidates, and an enabled one appears as an empty repository", async () => {
  const { api } = demo();
  const config = await api.config();
  const found = await api.discover();
  expect(found.candidates.length).toBeGreaterThan(0);
  expect(found.candidates.every((c) => !config.repos.some((r) => r.id === c.id))).toBe(true);

  const [picked] = found.candidates;
  await api.saveConfig({ ...config, repos: [...config.repos, { ...picked, enabled: true }] });
  expect((await api.discover()).candidates.map((c) => c.id)).not.toContain(picked.id);
  expect((await api.state()).repos.find((r) => r.id === picked.id)?.changes).toEqual([]);
});

test("the overview's Enable, Disable and Ignore change the demo's config at once, for this instance only", async () => {
  const { api } = demo();
  const [picked] = (await api.discover()).candidates;
  const tracked = await api.trackRepo(picked.path);
  expect(tracked.repos.find((r) => r.id === picked.id)).toMatchObject({ enabled: true, name: picked.name });
  expect((await api.discover()).candidates.map((c) => c.id)).not.toContain(picked.id);
  expect((await api.state()).repos.map((r) => r.id)).toContain(picked.id);

  const disabled = await api.setRepoEnabled(picked.id, false);
  expect(disabled.repos.find((r) => r.id === picked.id)?.enabled).toBe(false);
  expect((await api.state()).repos.map((r) => r.id)).not.toContain(picked.id);
  await expect(api.setRepoEnabled("000000000000", true)).rejects.toMatchObject({ status: 404 });

  const [plain] = (await api.discover()).integratable;
  await expect(api.trackRepo(plain.path)).rejects.toMatchObject({ status: 404 });
  expect((await api.ignorePath(plain.path)).ignorePaths).toContain(plain.path);
  expect((await api.discover()).integratable.map((r) => r.id)).not.toContain(plain.id);

  // What a reload does: a fresh instance has the original sample again.
  const fresh = demo().api;
  expect((await fresh.discover()).candidates.map((c) => c.id)).toContain(picked.id);
  expect((await fresh.discover()).integratable.map((r) => r.id)).toContain(plain.id);
});

test("discovery outside the sample workspace explains itself instead of pretending", async () => {
  const { api } = demo();
  const result = await api.discover(["/somewhere/else"]);
  expect(result.candidates).toEqual([]);
  expect(result.errors.map((e) => e.root)).toEqual(["/somewhere/else"]);
  expect((await api.discover([DEMO_ROOT])).errors).toEqual([]);
});

test("callers cannot mutate the demo's state through returned objects", async () => {
  const { api } = demo();
  const state = await api.state();
  state.repos.length = 0;
  expect((await api.state()).repos.length).toBeGreaterThan(0);
});

test("shared config in the demo: per-repository profiles, outdated after an edit, orphaned after a delete, nothing persisted", async () => {
  const { api } = demo();
  // the demo starts with profiles already carried (see the seed test below); clear the slate for this walk-through
  await api.saveSharedConfig({ profiles: [] });
  const everyRepo = (await api.state()).repos.map((r) => ({ repoId: r.id, profileIds: [] }));
  await api.applySharedConfig(everyRepo);
  expect(await api.sharedConfig()).toEqual({ profiles: [] });
  expect((await api.state()).repos.every((r) => r.sharedConfig === undefined)).toBe(true);

  const base = { id: "base", name: "Base", context: "We use conventional commits.", rules: { proposal: ["Always include Non-goals"] } };
  const security = { id: "security", name: "Security", context: "Threat-model every new endpoint.", rules: {} };
  await api.saveSharedConfig({ profiles: [base, security] });
  const [first, second] = (await api.state()).repos;
  expect(first.sharedConfig).toEqual({ unreadable: false, applied: [] });

  const assignments = [{ repoId: first.id, profileIds: ["base", "security"] }, { repoId: second.id, profileIds: ["base"] }, { repoId: "nope", profileIds: ["base"] }, { repoId: second.id.concat("x"), profileIds: [] }];
  const { previews } = await api.previewSharedConfig(assignments.slice(0, 3));
  expect(previews[0].after).toContain("spec-control:shared:begin security");
  expect(previews[0].after).toContain("- Always include Non-goals # spec-control:shared:base");
  expect(previews[0].before).not.toContain("spec-control:shared");
  expect(previews[2].refusal).toContain("not an enabled repository");
  expect((await api.state()).repos[0].sharedConfig?.applied).toEqual([]); // a preview changes nothing

  const { results } = await api.applySharedConfig(assignments.slice(0, 3));
  expect(results.map((r) => r.result)).toEqual(["written", "written", "refused"]);
  expect((await api.applySharedConfig([assignments[1]])).results[0].result).toBe("unchanged");
  expect((await api.applySharedConfig([{ repoId: first.id, profileIds: ["missing"] }])).results[0].reason).toBe("unknown profile: missing");
  let repos = (await api.state()).repos;
  expect(repos[0].sharedConfig?.applied).toEqual([{ id: "base", state: "in-sync" }, { id: "security", state: "in-sync" }]);
  expect(repos[1].sharedConfig?.applied).toEqual([{ id: "base", state: "in-sync" }]);

  await api.saveSharedConfig({ profiles: [{ ...base, context: "We use conventional commits. Squash on merge." }] });
  repos = (await api.state()).repos;
  expect(repos[0].sharedConfig?.applied).toEqual([{ id: "base", state: "outdated" }, { id: "security", state: "orphaned" }]);

  expect((await demo().api.sharedConfig()).profiles.map((p) => p.id)).toEqual(["base", "security"]); // a reload starts over, from the seed
});

test("pull in the demo: canned outcomes, the notice's repositories are only fetched, nothing persists", async () => {
  const { api } = demo();
  const repos = (await api.state()).repos;
  const offDefault = repos.filter((r) => r.onDefaultBranch === false).map((r) => r.name);
  expect(offDefault.sort()).toEqual(["ember-mobile", "harbor-web"]); // the sample shows the notice at first sight
  expect(repos.every((r) => r.defaultBranch === "main")).toBe(true);

  const onMain = repos.find((r) => r.name === "atlas-api")!;
  const first = await api.pullRepo(onMain.id);
  expect(first).toMatchObject({ fetched: true, update: "fast-forwarded", branch: "main", upstream: "origin/main" });
  expect(first.commits).toBeGreaterThan(0);
  expect((await api.pullRepo(onMain.id)).update).toBe("up-to-date");

  const harbor = repos.find((r) => r.name === "harbor-web")!;
  expect(await api.pullRepo(harbor.id)).toMatchObject({ fetched: true, update: "skipped", reason: "on feat/redesign-settings-page, not main; only fetched" });

  const failedScan = repos.find((r) => !r.ok)!;
  await expect(api.pullRepo(failedScan.id)).rejects.toThrow("not a tracked");
  await expect(api.pullRepo("nope")).rejects.toThrow("not a tracked");

  const { results } = await api.pullAll();
  expect(results.map((r) => r.repoId).sort()).toEqual(repos.filter((r) => r.ok).map((r) => r.id).sort());
  expect((await demo().api.pullRepo(onMain.id)).update).toBe("fast-forwarded"); // a reload starts over
});

test("a blocked pull in the demo: the leftovers are listed, then Resolve and pull answers with a fast-forward", async () => {
  const { api } = demo();
  const repos = (await api.state()).repos;
  const blocked = repos.find((r) => r.name === "quill-docs")!;

  const refused = await api.pullRepo(blocked.id);
  expect(refused).toMatchObject({ fetched: true, update: "refused" });
  expect(refused.blocking?.map((b) => [b.path, b.kind, b.differs])).toEqual([
    ["openspec/changes/add-import-redirects/.openspec.yaml", "leftover", false],
    ["openspec/changes/add-import-redirects/prompt.md", "leftover", true],
  ]);
  expect(refused.resolvable?.files).toHaveLength(2);
  expect(refused.hint).toContain("Resolve and pull replaces them");

  // a claim that is not the one that was offered changes nothing
  expect(await api.resolvePull(blocked.id, { upstream: "0".repeat(40), files: refused.resolvable!.files })).toMatchObject({ update: "refused" });

  const resolved = await api.resolvePull(blocked.id, refused.resolvable!);
  expect(resolved).toMatchObject({ fetched: false, update: "fast-forwarded" });
  expect(resolved.resolved).toEqual([
    { path: "openspec/changes/add-import-redirects/.openspec.yaml" },
    { path: "openspec/changes/add-import-redirects/prompt.md", copy: expect.stringContaining("/home/demo/.spec-control/pull-backups/") },
  ]);
  expect((await api.pullRepo(blocked.id)).update).toBe("up-to-date"); // it stays resolved until a reload
  await expect(api.resolvePull("nope", refused.resolvable!)).rejects.toThrow("not a tracked");
  expect((await demo().api.pullRepo(blocked.id)).update).toBe("refused"); // a reload starts over
});

test("change artifacts in the demo: files follow the sample's state, tasks.md agrees with the card, errors match the server's", async () => {
  const { api } = demo();
  const [repo] = (await api.state()).repos;
  const inProgress = repo.changes.find((c) => c.name === "add-rate-limiting")!;
  const listing = await api.changeArtifacts(repo.id, inProgress.name);
  expect(listing.change).toEqual({ repoId: repo.id, name: "add-rate-limiting", schema: "spec-driven", dir: `${repo.path}/openspec/changes/add-rate-limiting`, archived: false });
  expect(listing.artifacts.map((a) => a.id)).toEqual(inProgress.artifacts.map((a) => a.id));
  expect(listing.artifacts.every((a) => a.files.length > 0 && a.files.every((f) => f.bytes > 0))).toBe(true);

  const tasks = await api.artifactFile(repo.id, inProgress.name, "tasks.md");
  expect(tasks.text.match(/^- \[x\]/gm)?.length).toBe(inProgress.tasks!.done);
  expect(tasks.text.match(/^- \[[ x]\]/gm)?.length).toBe(inProgress.tasks!.total);
  expect(tasks.bytes).toBe(new TextEncoder().encode(tasks.text).length);

  const early = await api.changeArtifacts(repo.id, "idempotency-keys");
  expect(early.artifacts.map((a) => [a.id, a.status, a.files.length])).toEqual([["proposal", "done", 1], ["specs", "ready", 0], ["design", "ready", 0], ["tasks", "blocked", 0]]);

  const archived = repo.changes.find((c) => c.archived)!;
  const old = await api.changeArtifacts(repo.id, archived.name);
  expect(old.change.archived).toBe(true);
  expect(old.change.dir).toBe(`${repo.path}/openspec/changes/archive/${archived.archived}-${archived.name}`);

  const status = (p: Promise<unknown>) => p.then(() => 200, (err) => (err as { status?: number }).status);
  expect(await status(api.changeArtifacts(repo.id, "never-existed"))).toBe(404);
  expect(await status(api.changeArtifacts("nope", inProgress.name))).toBe(404);
  expect(await status(api.artifactFile(repo.id, "never-existed", "proposal.md"))).toBe(404);
  expect(await status(api.artifactFile(repo.id, inProgress.name, "missing.md"))).toBe(404);
  expect(await status(api.artifactFile(repo.id, inProgress.name, "../secrets.md"))).toBe(400);
  expect(await status(api.artifactFile(repo.id, "a/b", "proposal.md"))).toBe(400);
});

test("cleanup is simulated: a merged worktree and its branch go, kept items say why, and a reload brings them back", async () => {
  const { api } = demo();
  const repo = (await api.state()).repos.find((r) => r.name === "lantern-infra")!;
  const preview = await api.cleanupPreview(repo.id);
  const worktree = preview.worktrees.find((w) => w.branch === "chore/upgrade-terraform")!;
  expect(worktree).toMatchObject({ removable: true, work: { state: "merged" } });
  expect(preview.worktrees.some((w) => !w.removable && w.reason)).toBe(true);
  expect(preview.branches.find((b) => b.name === "experiment/plan-cache")).toMatchObject({ removable: false, reason: "4 commit(s) not in origin/main" });
  expect(preview.prunable.length).toBe(1);
  const branch = preview.branches.find((b) => b.name === "chore/upgrade-terraform")!;
  expect(branch).toMatchObject({ removable: true, worktreePath: worktree.path });

  const result = await api.cleanup(repo.id, { worktrees: [worktree.path], prune: true, branches: [{ name: branch.name, commit: branch.commit }] });
  expect(result.items.map((i) => [i.kind, i.outcome])).toEqual([
    ["worktree", "removed"],
    ["prune", "pruned"],
    ["branch", "deleted"],
  ]);
  expect(result.items[2].commit).toBe(branch.commit);
  const after = (await api.state()).repos.find((r) => r.id === repo.id)!;
  expect(after.worktrees.some((w) => w.path === worktree.path || w.prunable)).toBe(false);
  expect((await api.cleanupPreview(repo.id)).branches.map((b) => b.name)).not.toContain("chore/upgrade-terraform");

  const fresh = demo().api;
  expect((await fresh.state()).repos.find((r) => r.id === repo.id)!.worktrees.some((w) => w.path === worktree.path)).toBe(true);
});

test("the main checkout's branch is never offered in the demo either", async () => {
  const { api } = demo();
  const repo = (await api.state()).repos.find((r) => r.name === "harbor-web")!;
  const preview = await api.cleanupPreview(repo.id);
  expect(preview.branches.find((b) => b.name === repo.currentBranch)).toMatchObject({ removable: false, reason: "it is checked out in the main checkout" });
  expect(preview.branches.find((b) => b.name === "fix/focus-ring-contrast")).toMatchObject({ removable: true });
});

test("dismissing is simulated: a draft shows a file lost for good, leaves the board, and a reload brings it back", async () => {
  const { api } = demo();
  const repos = (await api.state()).repos;
  const repo = repos.find((r) => r.changes.some((c) => c.stage === "drafts" && !c.archived && (!c.checkout || c.checkout.isMain)))!;
  const draft = repo.changes.find((c) => c.stage === "drafts" && !c.archived && (!c.checkout || c.checkout.isMain))!;
  const preview = await api.dismissPreview(repo.id, draft.name);
  expect(preview.files.some((f) => f.state === "lost")).toBe(true);
  expect(preview.files.some((f) => f.path === ".openspec.yaml" && f.state === "restorable")).toBe(true);
  await expect(api.dismissChange(repo.id, draft.name, "stale")).rejects.toMatchObject({ status: 409 });
  expect(await api.dismissChange(repo.id, draft.name, preview.fingerprint)).toEqual({ name: draft.name, staged: true });
  expect((await api.state()).repos.find((r) => r.id === repo.id)!.changes.some((c) => c.name === draft.name && !c.archived)).toBe(false);
  await expect(api.dismissPreview(repo.id, draft.name)).rejects.toMatchObject({ status: 404 });

  const fresh = demo().api;
  expect((await fresh.state()).repos.find((r) => r.id === repo.id)!.changes.some((c) => c.name === draft.name)).toBe(true);
});

test("the demo's environment report passes and needs no process, file or connection", async () => {
  const { api } = demo();
  const report = await api.environment();
  expect(report.status).toBe("ok");
  for (const check of report.checks) expect([check.id, check.status]).toEqual([check.id, "ok"]);
  expect(report.checks.map((c) => c.id)).toEqual(["dashboard-home", "git", "git-identity", "openspec-cli", "agent:demo-agent", "github-cli"]);
  // Every path is made up and under the fictional home; nothing was looked up on the machine running this.
  for (const check of report.checks) expect([check.id, /\/(Users|home)\/(?!demo\b)/.test(check.found)]).toEqual([check.id, false]);
  // Pure: the same instance and clock give exactly the same report, so nothing was observed to produce it.
  expect(await api.environment()).toEqual(report);
  // And the module that builds it reaches for neither the filesystem nor a process.
  const source = readFileSync(new URL("../src/ui/demo/sampleData.ts", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "Bun.spawn", "Bun.which", "fetch("]) expect([forbidden, source.includes(forbidden)]).toEqual([forbidden, false]);
});

test("switching agent sessions off in the demo turns the checks it makes unnecessary into not-needed", async () => {
  const { api } = demo();
  const config = await api.config();
  await api.saveConfig({ ...config, agentSessions: { ...config.agentSessions, enabled: false } });
  const report = await api.environment();
  for (const id of ["git-identity", "agent:demo-agent", "github-cli"]) {
    const check = report.checks.find((c) => c.id === id);
    expect([id, check?.status]).toEqual([id, "not-needed"]);
    expect([id, check?.found]).toEqual([id, "not needed while agent sessions are off"]);
  }
  // The machine-level checks are unaffected, and nothing claims a GitHub credential either way.
  expect(report.checks.find((c) => c.id === "git")?.status).toBe("ok");
  expect(report.caveat).toBeUndefined();
  expect(report.status).toBe("ok");
});

test("the demo links pull requests to changes on cards and in the header, shows the absence too, and a board fetches nothing", async () => {
  const { api, tick } = demo();
  const snapshot = await api.state();
  const prs = await api.pullRequests();
  const hues = new Map(snapshot.repos.map((r, i) => [r.id, i * 40]));
  const cards = boardCards(snapshot.repos, hues, prs);
  const linked = cards.filter((c) => c.pullRequest);
  // A card link for an open, a draft and a merged pull request.
  expect(linked.length).toBeGreaterThan(2);
  expect(linked.some((c) => c.pullRequest?.draft)).toBe(true);
  expect(linked.some((c) => c.pullRequest?.state === "merged" || c.pullRequest?.state === "closed")).toBe(true);
  expect(linked.some((c) => c.pullRequest?.state === "open" && !c.pullRequest.draft)).toBe(true);
  for (const c of linked) expect(candidateBranches(c)).toContain(c.pullRequest?.head as string);
  const first = linked[0];
  expect(textOf(ChangeCard({ card: first, now: Date.now(), from: "/board" }))).toContain(`PR #${first.pullRequest?.number}`);
  // A card with a branch and no pull request.
  expect(cards.some((c) => c.branchMatch && !c.pullRequest && !c.archived)).toBe(true);
  // The detail header line for a linked change: number, title, state, review and checks.
  const reviewed = linked.find((c) => c.pullRequest?.review !== "none" && c.pullRequest?.checks !== "none");
  expect(reviewed).toBeDefined();
  const info = detailPullRequest(reviewed as ChangeSnapshot, prs);
  const line = textOf(DetailPullRequest({ info: info as DetailPr }));
  expect(line).toContain(`#${reviewed?.pullRequest?.number}`);
  expect(line).toContain(reviewed?.pullRequest?.title as string);

  // Opening a board in the demo never asks for a refresh, however old the made-up lists are.
  expect(api.syntheticPullRequests).toBe(true);
  tick(60 * 60_000);
  let asked = 0;
  const refresher = createPrRefresher({
    current: () => prs,
    fetch: () => {
      asked++;
      return api.refreshPullRequests();
    },
    onStart: () => {},
    onAnswer: () => {},
    onError: () => {},
    onSettled: () => {},
    synthetic: api.syntheticPullRequests,
  });
  expect(refresher.openBoard(undefined, Date.parse("2026-06-01T14:00:00.000Z"))).toBeUndefined();
  expect(refresher.openBoard(snapshot.repos[0].id, Date.parse("2026-06-01T14:00:00.000Z"))).toBeUndefined();
  expect(asked).toBe(0);
});

test("the overview's per-project settings change the in-memory config at once, with the dashboard's refusals", async () => {
  const { api } = demo();
  const [first, second] = (await api.config()).repos;
  expect((await api.renameRepo(first.id, "  Renamed ")).repos[0].name).toBe("Renamed");
  expect((await api.state()).repos.find((r) => r.id === first.id)?.name).toBe("Renamed");
  await expect(api.renameRepo(first.id, " ")).rejects.toMatchObject({ status: 400 });

  expect((await api.setRepoAgent(first.id, { enabled: false })).repos[0].agent).toEqual({ enabled: false });
  await expect(api.setRepoAgent(first.id, { agentId: "nope" })).rejects.toMatchObject({ status: 400 });
  await expect(api.setRepoAgent(first.id, {})).rejects.toMatchObject({ status: 400 });

  const labelled = await api.setRepoLabels(second.id, { labels: ["client"] });
  expect(labelled.repos.find((r) => r.id === second.id)?.labels).toEqual(["client"]);
  const cleared = await api.setRepoLabels(second.id, { labels: undefined });
  expect("labels" in (cleared.repos.find((r) => r.id === second.id) ?? {})).toBe(false);
  await expect(api.setRepoLabels(second.id, { labels: ["Infra", "infra"] })).rejects.toMatchObject({ status: 400 });

  expect((await api.setRepoPrTitleConvention(second.id, "conventional-commits")).repos.find((r) => r.id === second.id)?.prTitleConvention).toBe("conventional-commits");
  expect("prTitleConvention" in ((await api.setRepoPrTitleConvention(second.id, null)).repos.find((r) => r.id === second.id) ?? {})).toBe(false);
  await expect(api.setRepoPrTitleConvention(second.id, "angular" as never)).rejects.toMatchObject({ status: 400 });

  // auto fetch is stored like the real setting, and the demo fetches nothing
  expect((await api.setRepoAutoFetch(second.id, 15)).repos.find((r) => r.id === second.id)?.autoFetchSeconds).toBe(15);
  expect((await api.setRepoAutoFetch(second.id, 0)).repos.find((r) => r.id === second.id)?.autoFetchSeconds).toBe(0);
  expect("autoFetchSeconds" in ((await api.setRepoAutoFetch(second.id, 60)).repos.find((r) => r.id === second.id) ?? {})).toBe(false);
  await expect(api.setRepoAutoFetch(second.id, 1 as never)).rejects.toMatchObject({ status: 400 });
  await expect(api.setRepoAutoFetch(second.id, null as never)).rejects.toMatchObject({ status: 400 });

  expect((await api.setLabelColor(" Client ", 290)).labelColors).toEqual({ client: 290 });
  expect((await api.config()).labelColors).toEqual({ client: 290 });
  expect("labelColors" in (await api.setLabelColor("client", null))).toBe(false);
  for (const [label, hue] of [["client", 360], ["client", 12.5], ["a,b", 290], ["  ", 290]] as const) {
    await expect(api.setLabelColor(label, hue)).rejects.toMatchObject({ status: 400 });
  }
  expect("labelColors" in (await api.config())).toBe(false);

  await expect(api.forgetRepo(first.id)).rejects.toMatchObject({ status: 409 });
  await api.setRepoEnabled(first.id, false);
  expect((await api.forgetRepo(first.id)).repos.map((r) => r.id)).not.toContain(first.id);
  await expect(api.forgetRepo(first.id)).rejects.toMatchObject({ status: 404 });

  // What a reload does: a fresh instance has the original sample again.
  expect((await demo().api.config()).repos[0]).toEqual(first);
});

test("the demo's activity carries metrics in the visitor's time zone: several projects and busy days", async () => {
  const at = Date.now();
  const api = createDemoApi({ now: () => at, latencyMs: 0 });
  const page = await api.activity({ limit: 100, tz: "Europe/Zurich" });
  expect(page.metrics?.repos.length).toBeGreaterThan(1);
  expect(page.metrics?.days.some((d) => d.events > 0)).toBe(true);
  expect(page.metrics?.days.at(-1)?.day).toBe(new Date(at).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" }));
  // A zone this runtime cannot name counts in UTC instead of failing the feed.
  expect((await api.activity({ limit: 1, tz: "Mars/Olympus" })).metrics?.events).toBe(page.metrics?.events);
});

test("setup is done in the demo, and Run setup again works on the page's own config", async () => {
  const { api } = demo();
  const setup = await api.setup();
  expect(setup.pending).toBe(false);
  // The sample workspace is configured, so nothing is suggested until the visitor removes it.
  expect(setup.suggestedRoots).toEqual([]);
  const config = await api.config();
  await api.saveConfig({ ...config, scanRoots: [] });
  expect((await api.setup()).suggestedRoots).toEqual(config.scanRoots);
  expect((await api.markSetupDone()).setup).toBeUndefined();
});

test("the demo's setup view leaves the agents out and judges nothing not needed", async () => {
  const { api } = demo();
  const report = await api.environment(false, "setup");
  expect(report.checks.some((c) => c.id.startsWith("agent:"))).toBe(false);
  expect(report.checks.some((c) => c.status === "not-needed")).toBe(false);
});

// ---- Add from GitHub and the workspace folder, simulated ----

test("the demo lists a fictional owner's repositories, one already added", async () => {
  const { api } = demo();
  const list = await api.listGithubRepos();
  expect(list.status).toBe("ok");
  expect(list.repos.filter((r) => r.added)).toHaveLength(1);
  expect(list.repos.map((r) => r.repo)).toContain("acme/ledger-sync");
  expect((await api.githubClones()).gitAvailable).toBe(true);
});

test("cloning a repository with OpenSpec tracks it with sample changes; one without is offered for integration", async () => {
  const { api } = demo();
  const started = await api.cloneGithub("acme/ledger-sync", DEMO_ROOT, "ledger-sync");
  expect(started.state).toBe("cloning");
  await Bun.sleep(40);
  expect((await api.githubClones()).clones[0].state).toBe("tracked");
  const repo = (await api.state()).repos.find((r) => r.path === `${DEMO_ROOT}/ledger-sync`);
  expect(repo?.changes.length).toBeGreaterThan(0);
  expect(repo?.changes.every((c) => c.repoId === repo.id)).toBe(true);

  await api.cloneGithub("acme/brand-assets", DEMO_ROOT, "brand-assets");
  await Bun.sleep(40);
  expect((await api.discover()).integratable.map((r) => r.path)).toContain(`${DEMO_ROOT}/brand-assets`);
  expect((await api.config()).repos.some((r) => r.path === `${DEMO_ROOT}/brand-assets`)).toBe(false);
});

test("one fictional repository fails; it can be retried and dismissed, and refusals are the server's", async () => {
  const { api } = demo();
  const failing = await api.cloneGithub("acme/legacy-billing", DEMO_ROOT, "legacy-billing");
  await Bun.sleep(40);
  const [failed] = (await api.githubClones()).clones;
  expect(failed.state).toBe("failed");
  expect(failed.reason).toContain("gh auth setup-git");
  // Retry replaces the failed entry.
  await api.cloneGithub("acme/legacy-billing", DEMO_ROOT, "legacy-billing");
  expect((await api.githubClones()).clones).toHaveLength(1);
  await Bun.sleep(40);
  const [again] = (await api.githubClones()).clones;
  expect((await api.dismissGithubClone(again.id)).clones).toEqual([]);
  await expect(api.dismissGithubClone(failing.id)).rejects.toMatchObject({ status: 404 });
  await expect(api.cloneGithub("https://gitlab.com/acme/x", DEMO_ROOT, "x")).rejects.toMatchObject({ status: 400 });
  await expect(api.cloneGithub("acme/x", "/somewhere/else", "x")).rejects.toMatchObject({ status: 404 });
  const tracked = (await api.config()).repos[0];
  await expect(api.cloneGithub("acme/x", DEMO_ROOT, tracked.path.split("/").at(-1) ?? "")).rejects.toMatchObject({ status: 409 });
});

test("a workspace folder is created in memory once, and discovery then finds it", async () => {
  const { api } = demo();
  expect(await api.createWorkspaceFolder("~/Workspace")).toEqual({ path: "/home/demo/Workspace" });
  await expect(api.createWorkspaceFolder("~/Workspace")).rejects.toMatchObject({ status: 409 });
  await expect(api.createWorkspaceFolder("relative")).rejects.toMatchObject({ status: 400 });
  expect((await api.discover(["/home/demo/Workspace"])).errors).toEqual([]);
});

test("everything Add from GitHub did is gone after a reload", async () => {
  const { api } = demo();
  await api.cloneGithub("acme/ledger-sync", DEMO_ROOT, "ledger-sync");
  await api.createWorkspaceFolder("~/Workspace");
  await Bun.sleep(40);
  const fresh = demo().api;
  expect((await fresh.githubClones()).clones).toEqual([]);
  expect((await fresh.state()).repos.some((r) => r.path.endsWith("/ledger-sync"))).toBe(false);
  expect((await fresh.discover(["/home/demo/Workspace"])).errors).toHaveLength(1);
});

test("a demo clone reports progress through the phases and can be cancelled, retried and dismissed", async () => {
  const api = createDemoApi({ latencyMs: 10 });
  const started = await api.cloneGithub("acme/ledger-sync", DEMO_ROOT, "ledger-sync");
  expect(started.progress?.phase).toBe("connecting");
  await Bun.sleep(120);
  const [running] = (await api.githubClones()).clones;
  expect(running.state).toBe("cloning");
  expect(running.progress?.phase).toBe("receiving");
  expect(running.progress?.percent).toBeGreaterThan(0);
  const cancelled = await api.cancelGithubClone(running.id);
  expect(cancelled.state).toBe("cancelled");
  await Bun.sleep(350);
  // Nothing was tracked, and the cancelled entry stays cancelled.
  expect((await api.githubClones()).clones.map((c) => c.state)).toEqual(["cancelled"]);
  expect((await api.config()).repos.some((r) => r.path === `${DEMO_ROOT}/ledger-sync`)).toBe(false);
  await expect(api.cancelGithubClone(running.id)).rejects.toMatchObject({ status: 409 });
  await expect(api.cancelGithubClone("clone-404")).rejects.toMatchObject({ status: 404 });
  // Retry replaces it and runs to the end.
  const retried = await api.cloneGithub("acme/ledger-sync", DEMO_ROOT, "ledger-sync");
  await expect(api.dismissGithubClone(retried.id)).rejects.toMatchObject({ status: 409 });
  await Bun.sleep(400);
  const [done] = (await api.githubClones()).clones;
  expect(done).toMatchObject({ id: retried.id, state: "tracked" });
  expect(done.progress).toBeUndefined();
  expect((await api.dismissGithubClone(done.id)).clones).toEqual([]);
});
