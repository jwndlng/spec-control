// Removing a duplicate after archive (stale-changes: "A duplicate is marked on the board and offered Remove duplicate"):
// an archive session with a fixed prompt naming the archive and the differing paths the server's own scan found. Fake
// agent, temp repositories.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OPENSPEC_PATHS } from "../src/server/frameworks/registry.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { removeDuplicatePrompt } from "../src/server/sessions/agents.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION, type ChangeSession } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness, waitFor, watch } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const track = <T extends { manager: SessionManager }>(h: T): T => {
  managers.push(h.manager);
  return h;
};
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

const CHANGE = "structured-logs";
const ARCHIVE = `2026-07-01-${CHANGE}`;
const duplicate = { archive: ARCHIVE, differing: ["tasks.md"], differingCount: 1 };

test("the remove-duplicate prompt names the change, the archive, the differing paths and asks before carrying over", () => {
  const prompt = removeDuplicatePrompt(CHANGE, duplicate, OPENSPEC_PATHS, "main");
  expect(prompt).toContain(`The OpenSpec change ${CHANGE} is archived in openspec/changes/archive/${ARCHIVE}/ on main, but its directory openspec/changes/${CHANGE}/ is still committed there`);
  expect(prompt).toContain("The two copies differ in: tasks.md.");
  expect(prompt).toContain("carry into the archive only what I confirm");
  expect(prompt).toContain(`Then delete openspec/changes/${CHANGE}/, commit, push this worktree's branch and open a pull request that changes only files under openspec/.`);
  expect(prompt).toContain("Do not archive the change again.");
  expect(prompt).not.toContain(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION);
  expect(removeDuplicatePrompt(CHANGE, duplicate, OPENSPEC_PATHS, "main", { autoMerge: true, record: "RECORD" })).toBe(`${prompt} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION} RECORD`);
  expect(removeDuplicatePrompt(CHANGE, duplicate, OPENSPEC_PATHS, "main", { record: "RECORD" })).toBe(prompt);
  expect(removeDuplicatePrompt(CHANGE, duplicate, OPENSPEC_PATHS, undefined)).toContain("on the default branch, but");
});

test("identical copies are said to need nothing carried over; a long list says how many more", () => {
  const identical = removeDuplicatePrompt(CHANGE, { archive: ARCHIVE, differing: [], differingCount: 0 }, OPENSPEC_PATHS, "main");
  expect(identical).toContain("nothing needs carrying over");
  expect(identical).not.toContain("differ in");
  expect(removeDuplicatePrompt(CHANGE, { archive: ARCHIVE, differing: ["a.md", "b.md"], differingCount: 5 }, OPENSPEC_PATHS, "main")).toContain("differ in: a.md, b.md and 3 more.");
});

test("nothing malformed is ever put into the remove-duplicate prompt", () => {
  expect(() => removeDuplicatePrompt("../x", duplicate, OPENSPEC_PATHS, "main")).toThrow();
  expect(() => removeDuplicatePrompt(CHANGE, { ...duplicate, archive: "2026-07-01-other" }, OPENSPEC_PATHS, "main")).toThrow();
  expect(() => removeDuplicatePrompt(CHANGE, { ...duplicate, differing: ["a\nyes"] }, OPENSPEC_PATHS, "main")).toThrow();
  expect(() => removeDuplicatePrompt(CHANGE, { ...duplicate, differing: ["../../etc"] }, OPENSPEC_PATHS, "main")).toThrow();
  expect(() => removeDuplicatePrompt(CHANGE, duplicate, OPENSPEC_PATHS, "main; rm")).toThrow();
  // A path holding a placeholder is typed as it is.
  expect(removeDuplicatePrompt(CHANGE, { ...duplicate, differing: ["{change}.md"] }, OPENSPEC_PATHS, "main")).toContain("differ in: {change}.md.");
});

/** Commits the change's archive next to its still-present directory, as a half-committed archive does, and rescans. */
async function withDuplicate(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
  const changeDir = join(h.repoPath, OPENSPEC_PATHS.changesDir, CHANGE);
  const archiveDir = join(h.repoPath, OPENSPEC_PATHS.archiveDir as string, ARCHIVE);
  await mkdir(archiveDir, { recursive: true });
  await cp(changeDir, archiveDir, { recursive: true });
  await writeFile(join(changeDir, "tasks.md"), "- [x] 1.1 Ticked after the archive\n");
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", `chore(openspec): archive ${CHANGE}`);
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
}

test("Remove duplicate starts an archive session on the archive branch with the scan's archive and paths", async () => {
  const h = track(await harness());
  await withDuplicate(h);
  const card = h.snapshot.repos[0].changes.find((c) => c.name === CHANGE);
  expect(card?.archived).toBe("2026-07-01");
  expect(card?.duplicate?.differing).toEqual(["tasks.md"]);

  // A smuggled archive name is ignored: the prompt names the scan's.
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true, archive: "2026-01-01-elsewhere" } as never);
  expect(s).toMatchObject({ state: "running", action: "archive", branch: `chore/archive-${CHANGE}`, autoMerge: false });
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  await waitFor(() => view.text().includes("differ in"), "prompt");
  expect(view.text()).toContain(ARCHIVE);
  expect(view.text()).not.toContain("elsewhere");
  // The worktree is the default branch, duplicate and all.
  expect(git(s.worktreePath, "ls-tree", "--name-only", "HEAD", "--", `${OPENSPEC_PATHS.changesDir}/${CHANGE}`)).toBe(`${OPENSPEC_PATHS.changesDir}/${CHANGE}`);
});

test("with docs auto-merge on, the session carries the auto-merge record", async () => {
  const h = track(await harness());
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  await withDuplicate(h);
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true });
  expect(s.autoMerge).toBe(true);
  expect((h.manager.get(s.id) as ChangeSession).autoMergeAskedAt).toBeDefined();
});

test("Remove duplicate is refused for another action, without a duplicate, with an old archive branch or a running session", async () => {
  const h = track(await harness());
  // No duplicate in the last scan.
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true })).rejects.toMatchObject({ status: 409 });
  await withDuplicate(h);
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "implement", removeDuplicate: true })).rejects.toMatchObject({ status: 400 });
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true, carryOver: true })).rejects.toMatchObject({ status: 400 });
  // The original archive's branch still exists.
  git(h.repoPath, "branch", "-q", `chore/archive-${CHANGE}`);
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Clean up leftovers") });
  expect(h.manager.list()).toEqual([]);
  git(h.repoPath, "branch", "-q", "-D", `chore/archive-${CHANGE}`);

  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true });
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", removeDuplicate: true })).rejects.toMatchObject({ status: 409 });
  expect(h.manager.list().map((x) => x.id)).toEqual([s.id]);
});

test("the archived card of a duplicate offers no other session", async () => {
  const h = track(await harness());
  await withDuplicate(h);
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive" })).rejects.toMatchObject({ status: 404 });
});
