import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readShipTasks, SHIP_TASK_BYTES, tasksSettled } from "../src/server/sessions/taskSummary.ts";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { mergedImplementation } from "../src/shared/pullRequestLink.ts";
import { CONVENTIONAL_COMMITS_SHIP_SENTENCE, type ChangeSession, type RepoPullRequests } from "../src/shared/types.ts";
import { treeFingerprint, useTempHome } from "./helpers.ts";
import { harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);
let cleanup: () => Promise<void>;
const managers: Harness["manager"][] = [];
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown();
});
afterAll(() => cleanup());

async function setup() {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const tasks = join(s.worktreePath, "openspec/changes/upgrade-runtime/tasks.md");
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent");
  return { h, s, tasks, seen };
}

for (const [name, content, verified] of [
  ["open", "- [ ] Run checks\n", true],
  ["awaiting", "- [~] Sign in on the real device\n", true],
  ["unknown", "no task checkboxes\n", false],
  ["complete", "- [x] Verified check\n", true],
] as const) {
  test(`explicit Ship reports ${name} tasks without confirmation or agent interaction`, async () => {
    const { h, s, tasks, seen } = await setup();
    h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
    await writeFile(tasks, content);
    const result = await h.manager.ship(s.id);
    expect(result).toMatchObject({ submitted: true, taskSummary: { verified } });
    expect(result.preflight).toBeUndefined();
    expect(await readFile(tasks, "utf8")).toBe(content);
    expect(seen.text()).not.toContain("you said: Ship the work");
    if (name !== "complete") expect(result.autoMerge).toBe(false);
    if (name === "open") expect(result.taskSummary?.open).toEqual(["Run checks"]);
    if (name === "awaiting") expect(result.taskSummary?.awaiting).toEqual(["Sign in on the real device"]);
  });
}

test("Finish tasks remains an explicit request and does not ship", async () => {
  const { h, s, tasks, seen } = await setup();
  await writeFile(tasks, "- [ ] Check A\n");
  expect(await h.manager.ship(s.id, { finishTasks: true })).toMatchObject({ submitted: true, shipped: false });
  await waitFor(() => seen.text().includes("Do not ship as part of this request"), "finish prompt");
  expect(await readFile(tasks, "utf8")).toBe("- [ ] Check A\n");
});

test("complete tasks proceed without confirmation even when the board snapshot is unresolved", async () => {
  const { h, s, tasks } = await setup();
  await writeFile(tasks, "- [x] Check A\n- [X] Check B\n");
  const result = await h.manager.ship(s.id);
  expect(result.submitted).toBe(true);
  expect(result.preflight).toBeUndefined();
});

test("the Ship-menu bulk confirmation checks every remaining marker from its preflight version, then ships", async () => {
  const { h, s, tasks } = await setup();
  await writeFile(tasks, "# Tasks\n\n- [x] Done\n- [ ] Open\n- [~] Needs review\n");
  const preview = await h.manager.ship(s.id);
  expect(preview.preflight?.summary).toMatchObject({ done: 1, total: 3, open: ["Open"], awaiting: ["Needs review"] });
  await writeFile(tasks, "# Tasks\n\n- [x] Done\n- [ ] Changed after preview\n- [~] Needs review\n");
  const refreshed = await h.manager.ship(s.id, { confirmAllTasks: true, confirmation: preview.preflight!.token });
  expect(refreshed.preflight?.summary.open).toEqual(["Changed after preview"]);
  expect(await Bun.file(tasks).text()).toContain("- [ ] Changed after preview");
  const shipped = await h.manager.ship(s.id, { confirmAllTasks: true, confirmation: refreshed.preflight!.token });
  expect(shipped.shipped).toBe(true);
  expect(await Bun.file(tasks).text()).toBe("# Tasks\n\n- [x] Done\n- [x] Changed after preview\n- [x] Needs review\n");
});

test("bounded task reads fail closed for missing, malformed, symlinked, oversized and empty files", async () => {
  const { s, tasks } = await setup();
  const read = () => readShipTasks(s.worktreePath, "upgrade-runtime");
  for (const text of ["", "no boxes", "- [x] Done\n- [xx] Malformed", "- [x] Done\n" + "z".repeat(SHIP_TASK_BYTES)]) {
    await writeFile(tasks, text);
    expect(tasksSettled((await read()).summary)).toBe(false);
  }
  await rm(tasks);
  expect((await read()).summary.verified).toBe(false);
  await symlink(join(s.worktreePath, "README.md"), tasks);
  expect((await read()).summary.verified).toBe(false);
  await rm(tasks);
  await writeFile(tasks, Array.from({ length: 20 }, (_, i) => `- [ ] Check ${i}`).join("\n"));
  const result = await read();
  expect(result.summary.open).toHaveLength(10);
  expect(result.summary.truncated).toBe(true);
  expect((await readShipTasks(s.worktreePath, "upgrade-runtime", "unknown")).summary.verified).toBe(false);
});

test("a direct Ship API request reports unresolved tasks without confirmation", async () => {
  const { h, s, tasks } = await setup();
  await writeFile(tasks, "- [ ] Run check\n");
  const fetch = createFetchHandler({ state: { sessions: h.manager } as AppState, indexHtml: "" });
  const response = await fetch(
    new Request(`http://localhost/api/sessions/${s.id}/ship`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ confirmation: "fake" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ submitted: true, taskSummary: { open: ["Run check"] } });
});

function merged(h: Harness): RepoPullRequests {
  return {
    repoId: h.repoId,
    status: "ok",
    fetchedAt: "2026-11-01T10:00:00Z",
    pullRequests: [
      {
        number: 42,
        title: "Upgrade",
        head: "feat/upgrade-runtime",
        base: "main",
        state: "merged",
        isCrossRepository: false,
        mergedAt: "2026-11-01T09:00:00Z",
      } as RepoPullRequests["pullRequests"][number],
    ],
  };
}

test("only a linked implementation merge offers recovery; stale cache is a lead, never task evidence", async () => {
  const h = await harness();
  managers.push(h.manager);
  const change = h.snapshot.repos[0].changes.find((c) => c.name === "upgrade-runtime")!;
  const list = merged(h);
  expect(mergedImplementation(change, [list])?.number).toBe(42);
  expect(mergedImplementation(change, [{ ...list, status: "failed" }])?.number).toBe(42);
  for (const patch of [
    { state: "closed" },
    { head: "docs/upgrade-runtime" },
    { head: "feat/unrelated" },
    { mergedAt: "2000-01-01" },
    { isCrossRepository: true },
  ]) {
    expect(
      mergedImplementation(change, [{ ...list, pullRequests: [{ ...list.pullRequests[0], ...patch } as (typeof list.pullRequests)[number]] }]),
    ).toBeUndefined();
  }
  expect(mergedImplementation(change, [])).toBeUndefined();
  expect(mergedImplementation({ ...change, archived: "2026-11-01" }, [list])).toBeUndefined();
});

test("Finish checks sends into a running session and resumes an ended one without checking off tasks", async () => {
  const { h, s, tasks, seen } = await setup();
  await writeFile(tasks, "- [ ] Verify CI\n");
  const before = await treeFingerprint(s.worktreePath);
  h.config.repos[0].prTitleConvention = "conventional-commits";
  const result = await h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h));
  expect(result).toMatchObject({ id: s.id, submitted: true });
  await waitFor(() => seen.text().includes("never push to the merged branch"), "follow-up prompt");
  expect(seen.text()).toContain("last fetched 2026-11-01");
  expect(seen.text()).toContain("Verify the current PR and evidence yourself.");
  expect(seen.text()).toContain(CONVENTIONAL_COMMITS_SHIP_SENTENCE);
  expect(seen.text()).toContain("set branch:");
  expect(await treeFingerprint(s.worktreePath)).toEqual(before);
  expect(h.manager.list().filter((s) => s.state === "running")).toHaveLength(1);
  await h.manager.close(s.id);
  expect((await h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h))).id).toBe(s.id);
  await expect(h.manager.finishChecks(h.repoId, "upgrade-runtime")).rejects.toMatchObject({ status: 409 });
});

test("Finish checks creates a safe implementation session without a record; concurrent starts share its worktree", async () => {
  const h = await harness();
  managers.push(h.manager);
  const results = await Promise.all([
    h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h)),
    h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h)),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].worktreePath).not.toBe(h.repoPath);
  expect(h.manager.list().filter((s) => s.state === "running")).toHaveLength(1);
  h.config.agentSessions.enabled = false;
  await expect(h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h))).rejects.toMatchObject({ status: 403 });
});

test("Finish checks refuses disabled projects and a no-session worktree held by a different branch", async () => {
  const h = await harness();
  managers.push(h.manager);
  h.config.repos[0].agent = { enabled: false };
  await expect(h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h))).rejects.toMatchObject({ status: 403 });
  h.config.repos[0].agent = { enabled: true };
  // An existing folder is not enough: it must be the repository's worktree on the intended branch.
  const { worktreesDir } = await import("../src/server/paths.ts");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(worktreesDir(), h.repoId, "upgrade-runtime"), { recursive: true });
  await expect(h.manager.finishChecks(h.repoId, "upgrade-runtime", merged(h))).rejects.toMatchObject({ status: 409 });
  expect(h.manager.list()).toHaveLength(0);
});

test("an archive branch reads tasks from the moved change, while an active symlink remains unverified", async () => {
  const { s, tasks } = await setup();
  const { mkdir, rename } = await import("node:fs/promises");
  await writeFile(tasks, "- [x] Verified before archive\n");
  const active = join(s.worktreePath, "openspec/changes/upgrade-runtime");
  const archived = join(s.worktreePath, "openspec/changes/archive/2026-11-04-upgrade-runtime");
  await mkdir(join(s.worktreePath, "openspec/changes/archive"), { recursive: true });
  await rename(active, archived);
  expect(tasksSettled((await readShipTasks(s.worktreePath, "upgrade-runtime")).summary)).toBe(true);
  await symlink(archived, active);
  expect(tasksSettled((await readShipTasks(s.worktreePath, "upgrade-runtime")).summary)).toBe(false);
});

test("Finish checks keeps a running follow-up agent when merged-PR cleanup observes its old PR", async () => {
  const { h, s } = await setup();
  const { git } = await import("./sessionHelpers.ts");
  const list = merged(h);
  list.pullRequests[0].mergedAt = new Date(Date.now() + 1000).toISOString();
  list.pullRequests[0].headOid = git(s.worktreePath, "rev-parse", "HEAD");
  const result = await h.manager.finishChecks(h.repoId, "upgrade-runtime", list);
  expect(result.submitted).toBe(true);
  await h.manager.endMergedSessions(h.repoId, list.pullRequests);
  expect(h.manager.get(s.id).state).toBe("running");
  expect((h.manager.get(s.id) as ChangeSession).autoShipSuppressed).toBe(true);
});
