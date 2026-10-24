// agent-sessions: "An agent asked to open a pull request is asked to record its branch" — what the server hands the
// agent, decided from the session, and that asking writes nothing.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shipPrompt } from "../src/server/sessions/agents.ts";
import { treeFingerprint, useTempHome } from "./helpers.ts";
import { git, harness, recordFor, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: Harness["manager"][] = [];
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

/** A running session of `change` doing `action`, with something to ship in its worktree. */
async function running(action: "implement" | "archive", change: string, patch: (h: Harness) => void = () => {}) {
  const h = await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}", archive: "archive {change}" } } });
  patch(h);
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change, action });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  await mkdir(join(s.worktreePath, "openspec", "changes", change), { recursive: true });
  await writeFile(join(s.worktreePath, "openspec", "changes", change, "notes.md"), "x");
  return { h, s, seen, agent: h.config.agentSessions.agents[0] };
}

test("Ship on an implement session asks for the implementation branch, and the dashboard writes nothing for it", async () => {
  const { h, s, seen, agent } = await running("implement", "upgrade-runtime");
  const state = (cwd: string) => [git(cwd, "for-each-ref"), git(cwd, "status", "--porcelain"), git(cwd, "ls-files", "--stage")].join("\n");
  const before = { repo: state(h.repoPath), worktree: state(s.worktreePath), files: await treeFingerprint(s.worktreePath), main: await treeFingerprint(join(h.repoPath, "openspec")) };
  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  const expected = shipPrompt(agent, "upgrade-runtime", { record: recordFor("upgrade-runtime") });
  expect(expected).toContain("set branch: ");
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the ship prompt with the record instruction");
  // No file written, nothing staged, no ref moved — in the worktree or the main checkout.
  expect({ repo: state(h.repoPath), worktree: state(s.worktreePath), files: await treeFingerprint(s.worktreePath), main: await treeFingerprint(join(h.repoPath, "openspec")) }).toEqual(before);
});

test("Ship on an archive session asks for the archive branch", async () => {
  const { h, s, seen, agent } = await running("archive", "confirm-retention");
  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  const expected = shipPrompt(agent, "confirm-retention", { record: recordFor("confirm-retention", true) });
  expect(expected).toContain("set archive-branch: ");
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the ship prompt with the archive record instruction");
});

test("a repository whose framework supplies no record instruction gets Ship's text unchanged", async () => {
  const { h, s, seen, agent } = await running("implement", "upgrade-runtime", (h) => {
    // A module registered without a record instruction: none is found for this id, so none is asked for.
    h.snapshot.repos[0].framework = "no-record";
  });
  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  const plain = shipPrompt(agent, "upgrade-runtime");
  await waitFor(() => seen.text().includes(`you said: ${plain}`), "the plain ship prompt");
  expect(seen.text()).not.toContain("spec-control:");
});
