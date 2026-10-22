// Carrying a stranded archive over (stale-changes: "The change detail offers the fitting action for a stale change"):
// an archive session with a fixed prompt naming the commit the server's own scan found. Fake agent, temp repositories.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { OPENSPEC_PATHS } from "../src/server/frameworks/registry.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { carryOverPrompt } from "../src/server/sessions/agents.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION } from "../src/shared/types.ts";
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
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const stranded = { branch: `feat/${CHANGE}`, archive: `2026-07-01-${CHANGE}`, commit: COMMIT };

test("the carry-over prompt names the change, the commit, its branch and the default branch", () => {
  const prompt = carryOverPrompt(CHANGE, stranded, "main");
  expect(prompt).toContain(`The OpenSpec change ${CHANGE} was already archived in commit ${COMMIT} on the branch feat/${CHANGE}, but that commit never reached main.`);
  expect(prompt).toContain(`git cherry-pick ${COMMIT}`);
  expect(prompt).toContain("Do not archive the change again.");
  expect(prompt).not.toContain(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION);
  expect(carryOverPrompt(CHANGE, stranded, "main", { autoMerge: true }).endsWith(` ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}`)).toBe(true);
  expect(carryOverPrompt(CHANGE, stranded, undefined)).toContain("never reached the default branch.");
});

test("nothing malformed is ever put into the prompt", () => {
  expect(() => carryOverPrompt("../x", stranded, "main")).toThrow();
  expect(() => carryOverPrompt(CHANGE, { ...stranded, commit: "abc" }, "main")).toThrow();
  expect(() => carryOverPrompt(CHANGE, { ...stranded, branch: "--upload-pack=x" }, "main")).toThrow();
  expect(() => carryOverPrompt(CHANGE, { ...stranded, branch: "a..b" }, "main")).toThrow();
  expect(() => carryOverPrompt(CHANGE, stranded, "main; rm")).toThrow();
});

test("Carry over archive starts an archive session with the commit from the scan, whatever the change's stage", async () => {
  const h = track(await harness());
  git(h.repoPath, "checkout", "-q", "-b", `feat/${CHANGE}`);
  await rename(join(h.repoPath, OPENSPEC_PATHS.changesDir, CHANGE), join(h.repoPath, OPENSPEC_PATHS.archiveDir as string, `2026-07-01-${CHANGE}`));
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", `chore(openspec): archive ${CHANGE}`);
  const commit = git(h.repoPath, "rev-parse", "HEAD");
  git(h.repoPath, "checkout", "-q", "main");
  h.snapshot.repos[0] = await scanRepo(newRepoConfig(h.repoPath, true));
  const change = h.snapshot.repos[0].changes.find((c) => c.name === CHANGE);
  expect(change?.strandedArchive?.commit).toBe(commit);
  expect(change?.stage).not.toBe("done"); // Archive itself would not be offered

  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", carryOver: true });
  expect(s).toMatchObject({ state: "running", action: "archive", branch: `chore/archive-${CHANGE}` });
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  expect(view.text()).toContain(`git cherry-pick ${commit}`);
  expect(view.text()).toContain(`on the branch feat/${CHANGE}`);
});

test("Carry over archive is refused without a stranded archive or for another action", async () => {
  const h = track(await harness());
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "archive", carryOver: true })).rejects.toMatchObject({ status: 409 });
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, action: "implement", carryOver: true })).rejects.toMatchObject({ status: 400 });
  expect(h.manager.list()).toEqual([]);
});
