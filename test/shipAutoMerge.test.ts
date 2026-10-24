// Auto-merge of docs-only pull requests (agent-sessions, Ship): the read-only check, and what Ship hands the agent.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreesDir } from "../src/server/paths.ts";
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION, type ChangeSession } from "../src/shared/types.ts";
import { openingPrompt, shipPrompt } from "../src/server/sessions/agents.ts";
import { sessionBranch } from "../src/server/sessions/manager.ts";
import { shipsOnlyOpenSpec } from "../src/server/sessions/workStatus.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import { afterStart, autoMergeNotice, reportShip, type AutoMergeReport } from "../src/ui/sessionState.ts";
import { useTempHome } from "./helpers.ts";
import { installFakeGh } from "./ghHelpers.ts";
import { git, harness, recordFor, tempGitRepo, waitFor, watch, type Harness } from "./sessionHelpers.ts";

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

async function worktree(repoPath: string, name: string): Promise<string> {
  const path = join(worktreesDir(), `t-${Math.random().toString(36).slice(2, 8)}`, name);
  await ensureWorktree(repoPath, path, `feat/${name}`);
  return path;
}

async function put(wt: string, file: string, content = "x"): Promise<void> {
  await mkdir(join(wt, file, ".."), { recursive: true });
  await writeFile(join(wt, file), content);
}

const commitAll = (wt: string) => {
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "work");
};

test("only files under openspec/, committed or not, count as docs-only", async () => {
  const repo = await tempGitRepo();
  const wt = await worktree(repo, "docs");
  await put(wt, "openspec/changes/rotate-keys/proposal.md");
  commitAll(wt);
  expect(await shipsOnlyOpenSpec(wt, "main")).toBe(true);

  // uncommitted on top: a modified tracked file (status starts with a space) and an untracked one, both inside
  await put(wt, "openspec/changes/rotate-keys/proposal.md", "changed");
  await put(wt, "openspec/specs/secrets/spec.md");
  expect(await shipsOnlyOpenSpec(wt, "main")).toBe(true);
});

test("anything outside openspec/ — committed, untracked, look-alike or renamed in — is not docs-only", async () => {
  const repo = await tempGitRepo();
  const cases: [string, (wt: string) => Promise<void>][] = [
    ["committed code", async (wt) => {
      await put(wt, "openspec/changes/rotate-keys/tasks.md");
      await put(wt, "src/keys.ts");
      commitAll(wt);
    }],
    ["an untracked file at the root", async (wt) => {
      await put(wt, "openspec/changes/rotate-keys/tasks.md");
      commitAll(wt);
      await put(wt, "notes.txt");
    }],
    ["look-alike paths", async (wt) => {
      await put(wt, "docs/openspec/notes.md");
      await put(wt, "openspec-notes.md");
      commitAll(wt);
    }],
    ["a staged rename from src/ into openspec/", async (wt) => {
      await put(wt, "src/moved.md", "a file that is renamed");
      commitAll(wt);
      git(wt, "push", "-q", ".", "HEAD:refs/heads/base-with-src");
      await mkdir(join(wt, "openspec"), { recursive: true });
      await rename(join(wt, "src/moved.md"), join(wt, "openspec/moved.md"));
      git(wt, "add", "-A");
    }],
  ];
  for (const [what, make] of cases) {
    const wt = await worktree(repo, what.replace(/[^a-z]+/g, "-").replace(/-$/, ""));
    await make(wt);
    const base = what.startsWith("a staged rename") ? "base-with-src" : "main";
    expect({ what, docsOnly: await shipsOnlyOpenSpec(wt, base) }).toEqual({ what, docsOnly: false });
  }
});

test("an unknown base, an unreadable base and an empty diff fail closed", async () => {
  const repo = await tempGitRepo();
  const wt = await worktree(repo, "closed");
  expect(await shipsOnlyOpenSpec(wt, "main")).toBe(false); // nothing to ship at all
  await put(wt, "openspec/changes/rotate-keys/proposal.md");
  commitAll(wt);
  expect(await shipsOnlyOpenSpec(wt, undefined)).toBe(false);
  expect(await shipsOnlyOpenSpec(wt, "no-such-ref")).toBe(false);
  expect(await shipsOnlyOpenSpec(join(wt, "gone"), "main")).toBe(false);
});

test("Archive's variant also accepts a worktree with nothing in it yet, and still nothing outside openspec/", async () => {
  const repo = await tempGitRepo();
  const empty = await worktree(repo, "archive-empty");
  expect(await shipsOnlyOpenSpec(empty, "main", { allowEmpty: true })).toBe(true);
  expect(await shipsOnlyOpenSpec(empty, undefined, { allowEmpty: true })).toBe(false);
  // the change copied in uncommitted from the main checkout
  await put(empty, "openspec/changes/rotate-keys/tasks.md");
  expect(await shipsOnlyOpenSpec(empty, "main", { allowEmpty: true })).toBe(true);

  const code = await worktree(repo, "archive-code");
  await put(code, "src/keys.ts");
  commitAll(code);
  expect(await shipsOnlyOpenSpec(code, "main", { allowEmpty: true })).toBe(false);
  expect(await shipsOnlyOpenSpec(code, "main")).toBe(false);
});

/** When the session was last asked to enable auto-merge (auto-merge-cleanup D1). */
const askedAt = (h: Harness, id: string) => (h.manager.get(id) as ChangeSession).autoMergeAskedAt;

/** A running session of `upgrade-runtime` whose project has the setting as given, with `files` written into it. */
async function shipping(autoMergeDocs: boolean | undefined, files: string[], opts: { resume?: boolean } = {}) {
  const h = await harness();
  h.config.repos[0].agent = { enabled: true, ...(autoMergeDocs === undefined ? {} : { autoMergeDocs }) };
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  for (const file of files) await put(s.worktreePath, file);
  if (opts.resume) {
    h.manager.write(s.id, "exit\r");
    await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  }
  const agent = h.config.agentSessions.agents[0];
  const record = recordFor("upgrade-runtime");
  return { h, s, seen, plain: shipPrompt(agent, "upgrade-runtime", { record }), withAutoMerge: shipPrompt(agent, "upgrade-runtime", { autoMerge: true, record }) };
}

test("Ship asks for auto-merge in an opted-in project when only OpenSpec documents are shipped", async () => {
  const gh = await installFakeGh();
  try {
    const { h, s, seen, withAutoMerge } = await shipping(true, ["openspec/changes/upgrade-runtime/notes.md", "openspec/specs/runtime/spec.md"]);
    const refs = git(h.repoPath, "for-each-ref");
    const result = await h.manager.ship(s.id);
    expect(result).toMatchObject({ submitted: true, autoMerge: true });
    expect(askedAt(h, s.id)).toBeDefined();
    await waitFor(() => seen.text().includes(`you said: ${withAutoMerge}`), "the ship prompt with the auto-merge instruction");
    // The dashboard itself merged nothing: no gh, no ref moved.
    expect(await gh.calls()).toEqual([]);
    expect(git(h.repoPath, "for-each-ref")).toBe(refs);
  } finally {
    gh.restore();
  }
});

test("Ship asks for auto-merge when it starts an ended agent again, too", async () => {
  const { h, s, seen, withAutoMerge } = await shipping(true, ["openspec/changes/upgrade-runtime/notes.md"], { resume: true });
  expect(await h.manager.ship(s.id)).toMatchObject({ submitted: true, autoMerge: true });
  expect(askedAt(h, s.id)).toBeDefined();
  await waitFor(() => seen.text().includes('args=["--resumed"]') && seen.text().includes(`you said: ${withAutoMerge}`), "resume command plus the prompt");
});

test("Ship's prompt is today's when the project did not opt in, or code is shipped", async () => {
  for (const [autoMergeDocs, files] of [
    [true, ["openspec/changes/upgrade-runtime/notes.md", "src/runtime.ts"]],
    [false, ["openspec/changes/upgrade-runtime/notes.md"]],
    [undefined, ["openspec/changes/upgrade-runtime/notes.md"]],
  ] as const) {
    const { h, s, seen, plain } = await shipping(autoMergeDocs, [...files]);
    expect(await h.manager.ship(s.id)).toMatchObject({ submitted: true, autoMerge: false });
    expect(askedAt(h, s.id)).toBeUndefined();
    await waitFor(() => seen.text().includes(`you said: ${plain}`), "the plain ship prompt");
    expect(seen.text()).not.toContain("enable auto-merge");
  }
});

test("both Ship controls report the auto-merge notice only when Ship asked for auto-merge", () => {
  const seen: string[] = [];
  const ui = { reportUnsent: (id?: string) => seen.push(`unsent ${id}`), reportAutoMerge: (r?: AutoMergeReport) => seen.push(`autoMerge ${r ? `${r.id} ${r.action}` : r}`) };
  reportShip(ui, "s1", { submitted: true, autoMerge: true });
  reportShip(ui, "s1", { submitted: true, autoMerge: false });
  reportShip(ui, "s1", { submitted: false, autoMerge: true });
  expect(seen).toEqual(["unsent undefined", "autoMerge s1 ship", "unsent undefined", "autoMerge undefined", "unsent s1", "autoMerge s1 ship"]);
  for (const action of ["ship", "archive"] as const) {
    // The pull request is handed back to the agent to merge; GitHub's auto-merge is no longer asked for.
    expect(autoMergeNotice(action)).toContain("will be handed back to the agent to merge once its checks pass");
    expect(autoMergeNotice(action)).not.toContain("auto-merge");
    expect(autoMergeNotice(action)).toContain("merges nothing");
  }
  expect(autoMergeNotice("ship")).toContain("Only OpenSpec documents changed");
  // Archive's is conditional, like its instruction: the Archive prompt may open no pull request at all.
  expect(autoMergeNotice("archive")).toContain("if the agent opens a pull request");
});

test("a start reports Archive's notice when its prompt carried the instruction, and clears only its own session's", () => {
  const other: AutoMergeReport = { id: "s2", action: "ship" };
  expect(afterStart(undefined, "s1", true)).toEqual({ id: "s1", action: "archive" });
  expect(afterStart(other, "s1", true)).toEqual({ id: "s1", action: "archive" });
  expect(afterStart({ id: "s1", action: "archive" }, "s1", false)).toBeUndefined();
  expect(afterStart(other, "s1", false)).toBe(other);
});

// Archive (archive-auto-merge-docs): the same check, decided once the archive worktree exists or where the session runs.

/** A harness whose project has auto-merge set as given; `confirm-retention` is `Done`, so Archive is available for it. */
async function archiving(autoMergeDocs: boolean | undefined, opts: { git?: boolean } = {}) {
  const h = await harness({ ...opts, agent: { prompts: { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } });
  h.config.repos[0].agent = { enabled: true, ...(autoMergeDocs === undefined ? {} : { autoMergeDocs }) };
  managers.push(h.manager);
  const agent = h.config.agentSessions.agents[0];
  const archive = (change: string, autoMerge: boolean) => openingPrompt(agent, "archive", change, { autoMerge, record: recordFor(change, true) }) as string;
  return { h, archive };
}

/** The opening prompt as the fake agent received it: its one argument. */
async function openedWith(h: Harness, id: string, prompt: string): Promise<void> {
  const seen = await watch(h.manager, id);
  await waitFor(() => seen.text().includes(`args=${JSON.stringify([prompt])}`), "the opening prompt");
}

test("Archive in a fresh worktree of an opted-in project ends with the archive auto-merge instruction", async () => {
  const { h, archive } = await archiving(true);
  const refs = git(h.repoPath, "for-each-ref");
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  expect(s.autoMerge).toBe(true);
  expect(askedAt(h, s.id)).toBeDefined();
  expect(archive("confirm-retention", true)).toEndWith(`${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION} ${recordFor("confirm-retention", true)}`);
  await openedWith(h, s.id, archive("confirm-retention", true));
  // Read-only: the only new ref is the archive branch the worktree was created on.
  const added = git(h.repoPath, "for-each-ref").split("\n").filter((line) => !refs.includes(line));
  expect(added.map((line) => line.split("\t")[1])).toEqual([`refs/heads/${sessionBranch("archive", "confirm-retention")}`]);
});

test("Archive's prompt is today's with the setting off, and for every other starter", async () => {
  for (const setting of [false, undefined]) {
    const { h, archive } = await archiving(setting);
    const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
    expect(s.autoMerge).toBe(false);
    expect(askedAt(h, s.id)).toBeUndefined();
    await openedWith(h, s.id, archive("confirm-retention", false));
  }
  const { h } = await archiving(true);
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
  expect(s.autoMerge).toBe(false);
  expect(askedAt(h, s.id)).toBeUndefined();
  await openedWith(h, s.id, "validate confirm-retention");
});

test("a leftover archive branch with code in it gets no instruction", async () => {
  const { h, archive } = await archiving(true);
  const branch = sessionBranch("archive", "confirm-retention");
  git(h.repoPath, "checkout", "-q", "-b", branch);
  await put(h.repoPath, "src/keys.ts");
  commitAll(h.repoPath);
  git(h.repoPath, "checkout", "-q", "main");
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  expect(s.autoMerge).toBe(false);
  await openedWith(h, s.id, archive("confirm-retention", false));
});

test("Archive in a folder without git runs in place, with no instruction", async () => {
  const { h, archive } = await archiving(true, { git: false });
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  expect([s.inPlace, s.autoMerge]).toEqual([true, false]);
  await openedWith(h, s.id, archive("confirm-retention", false));
});

test("an Archive request that returns the session already open reports no instruction", async () => {
  const { h } = await archiving(true);
  const a = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
  const again = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  expect([again.id, again.autoMerge]).toEqual([a.id, false]);
});

test("Archive sent into a running session: the instruction only where that worktree holds nothing but OpenSpec documents", async () => {
  for (const [file, expected] of [["src/keys.ts", false], ["openspec/changes/confirm-retention/notes.md", true]] as const) {
    const { h, archive } = await archiving(true);
    const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
    const seen = await watch(h.manager, s.id);
    await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
    await put(s.worktreePath, file);
    commitAll(s.worktreePath);
    const result = await h.manager.prompt(s.id, { action: "archive" });
    expect({ file, submitted: result.submitted, autoMerge: result.autoMerge }).toEqual({ file, submitted: true, autoMerge: expected });
    expect({ file, asked: askedAt(h, s.id) !== undefined }).toEqual({ file, asked: expected });
    await waitFor(() => seen.text().includes(`you said: ${archive("confirm-retention", expected)}`), "the archive prompt");
    // Any other action sent carries nothing, in the same docs-only worktree too.
    expect((await h.manager.prompt(s.id, { action: "validate" })).autoMerge).toBe(false);
  }
});
