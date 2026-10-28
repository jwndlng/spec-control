import { expect, test } from "bun:test";
import { countTasksFromContent } from "../src/server/frameworks/openspec/adapter.ts";
import { parseStatusV2, parseWorktrees } from "../src/server/git.ts";
import { parseTaskProgress } from "../src/server/tasksParser.ts";
import { boardColumns, deriveStage, isComplete, isPlanned, requiredArtifacts } from "../src/shared/columns.ts";
import type { ArtifactStatus, Snapshot, TaskProgress } from "../src/shared/types.ts";

test("task progress counts mixed list markers", () => {
  const md = ["## 1. Setup", "- [x] 1.1 a", "* [ ] 1.2 b", "1. [X] 1.3 c", "+ [ ] d", "2) [x] e", "- not a task", "[x] no marker"].join("\n");
  expect(parseTaskProgress(md)).toEqual({ done: 3, awaiting: 0, total: 5 });
  expect(parseTaskProgress("")).toEqual({ done: 0, awaiting: 0, total: 0 });
});

test("task progress counts tasks awaiting validation apart from done ones", () => {
  const md = ["## 1. Build", "- [x] 1.1 a", "- [~] 1.2 b", "- [ ] 1.3 c", "* [~] d", "2) [X] e"].join("\n");
  expect(parseTaskProgress(md)).toEqual({ done: 2, awaiting: 2, awaitingTasks: ["1.2 b", "d"], total: 5 });
  // `[~]` is never folded into `done`: nobody has confirmed it yet.
  expect(parseTaskProgress("- [x] a\n- [~] b")).toEqual({ done: 1, awaiting: 1, awaitingTasks: ["b"], total: 2 });
  const thirteenAndTwo = [...Array(13).fill("- [x] done"), ...Array(2).fill("- [~] check it")].join("\n");
  expect(parseTaskProgress(thirteenAndTwo)).toEqual({ done: 13, awaiting: 2, awaitingTasks: ["check it", "check it"], total: 15 });
});

test("task progress reports what the user has to do: the `[~]` tasks' text, in file order, as plain text", () => {
  const md = [
    "- [x] 1.1 Add the client",
    "- [~] 1.2 Add the API token to the deployment secrets — you: set API_TOKEN in the alpha-infra project   ",
    "- [ ] 1.3 Wire it up",
    "  * [~]   1.4 Check the retry on a <b>slow</b> network",
  ].join("\n");
  expect(parseTaskProgress(md)).toEqual({
    done: 1,
    awaiting: 2,
    awaitingTasks: ["1.2 Add the API token to the deployment secrets — you: set API_TOKEN in the alpha-infra project", "1.4 Check the retry on a <b>slow</b> network"],
    total: 4,
  });
});

test("task progress: the awaiting list is bounded, `awaiting` stays the full count", () => {
  const long = "x".repeat(500);
  const md = [`- [~] ${long}`, ...Array.from({ length: 11 }, (_, i) => `- [~] task ${i + 2}`)].join("\n");
  const progress = parseTaskProgress(md);
  expect([progress.done, progress.awaiting, progress.total]).toEqual([0, 12, 12]);
  expect(progress.awaitingTasks).toHaveLength(10);
  expect(Array.from(progress.awaitingTasks![0])).toHaveLength(200);
  expect(progress.awaitingTasks![0].endsWith("…")).toBe(true);
  expect(progress.awaitingTasks!.slice(1)).toEqual(Array.from({ length: 9 }, (_, i) => `task ${i + 2}`));
  // Exactly 200 characters is not shortened.
  expect(parseTaskProgress(`- [~] ${"y".repeat(200)}`).awaitingTasks).toEqual(["y".repeat(200)]);
});

test("task progress: spacing inside the brackets does not matter, an unknown marker is open", () => {
  expect(parseTaskProgress("- [ x] a\n- [x ] b\n- [ ~] c\n- [~ ] d")).toEqual({ done: 2, awaiting: 2, awaitingTasks: ["c", "d"], total: 4 });
  // Markers OpenSpec assigns no meaning to count as tasks, never as done.
  expect(parseTaskProgress("- [-] a\n- [?] b")).toEqual({ done: 0, awaiting: 0, total: 2 });
  expect(parseTaskProgress("- [] a")).toEqual({ done: 0, awaiting: 0, total: 1 });
});

test("task progress: a file without the awaiting marker counts exactly as before, with no awaiting list", () => {
  const md = ["## 1. Setup", "- [x] 1.1 a", "- [ ] 1.2 b", "* [X] c", "1. [ ] d", "+ [x] e", "prose"].join("\n");
  const { done, total } = parseTaskProgress(md);
  expect({ done, total }).toEqual({ done: 3, total: 5 });
  expect(parseTaskProgress(md).awaiting).toBe(0);
  expect("awaitingTasks" in parseTaskProgress(md)).toBe(false);
});

test("task progress: link bullets are not tasks, as the CLI counts them", () => {
  const md = ["- [x] a", "- [ ] b", "- [a](./a.md)", "- [x](x.md)", "- [1](#ref) footnote"].join("\n");
  expect(parseTaskProgress(md)).toEqual({ done: 1, awaiting: 0, total: 2 });
  expect(countTasksFromContent(md)).toEqual({ completed: 1, total: 2 });
  // A reference-link bullet and an awaiting-looking link are links too.
  expect(parseTaskProgress("- [A][ref]\n- [~](./notes.md)")).toEqual({ done: 0, awaiting: 0, total: 0 });
});

test("task progress: no space is needed after the list marker", () => {
  expect(parseTaskProgress("-[x] a\n-[ ] b")).toEqual({ done: 1, awaiting: 0, total: 2 });
  expect(parseTaskProgress("*[~] c")).toEqual({ done: 0, awaiting: 1, awaitingTasks: ["c"], total: 1 });
});

test("task progress: a whitespace-only box counts wherever it is followed", () => {
  expect(parseTaskProgress("- [ ](./notes.md) read the notes")).toEqual({ done: 0, awaiting: 0, total: 1 });
  expect(parseTaskProgress("- [  ][ref] b")).toEqual({ done: 0, awaiting: 0, total: 1 });
});

test("task progress: ordered markers have at most nine digits", () => {
  expect(parseTaskProgress("123456789. [x] a\n1234567890. [x] b")).toEqual({ done: 1, awaiting: 0, total: 1 });
});

// Every file the dashboard and the `openspec` CLI must count alike (change-scanner: "Counts agree with the CLI").
const CLI_CORPUS: Record<string, string> = {
  plain: "## 1. Setup\n- [x] 1.1 a\n- [ ] 1.2 b\n* [X] c\n+ [ ] d\n1. [x] e\n2) [ ] f\nprose",
  links: "- [x] a\n- [ ] b\n- [a](./a.md)\n- [x](x.md)\n- [1](#ref) footnote\n- [Design](./design.md)",
  references: "- [A][a]\n- [x][b] done?\n- [ ][c] open\n\n[a]: https://example.com",
  noSpace: "-[x] a\n-[ ] b\n1.[x] c\n2)[ ] d",
  whitespaceBox: "- [ ](x)\n- [ ][y]\n- [   ] z\n- [] empty\n- []( ) link-ish",
  spacing: "- [ x] a\n- [x ] b\n- [ X ] c\n- [-] d\n- [?] e\n- [WIP] f\n- [x]done",
  ordered: "1) [x] a\n123456789. [ ] b\n1234567890. [x] c\n0. [x] d",
  crlf: "- [x] a\r\n- [ ] b\r\n- [x](x.md)\r\n",
  nested: "- [x] 1.1\n  - [ ] 1.1.1\n    * [x] 1.1.1.1\n\t+ [ ] tabbed",
  fenced: "```md\n- [x] example\n- [ ] example\n```\n- [ ] real",
  notTasks: "[x] no marker\n- not a task\n-- [x] double\n- x] half\n- [x",
};

test("task progress: counts agree with the CLI for every file without `[~]`", () => {
  for (const [name, md] of Object.entries(CLI_CORPUS)) {
    const { done, total } = parseTaskProgress(md);
    const cli = countTasksFromContent(md);
    expect({ name, done, total }).toEqual({ name, done: cli.completed, total: cli.total });
  }
});

test("worktree porcelain parsing: main first, detached kept, flags read", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/feat",
    "HEAD def",
    "branch refs/heads/feat/structured-report-format",
    "",
    "worktree /repo/.worktrees/detached",
    "HEAD 1234567890abcdef",
    "detached",
    "",
    "worktree /repo/.worktrees/held",
    "HEAD 456",
    "branch refs/heads/fix/held",
    "locked",
    "",
    "worktree /repo/.worktrees/held with reason",
    "HEAD 789",
    "branch refs/heads/fix/held-2",
    "locked agent session still running",
    "",
    "worktree /repo/.worktrees/gone",
    "HEAD 0ab",
    "branch refs/heads/feat/gone",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");
  expect(parseWorktrees(porcelain)).toEqual([
    { path: "/repo", head: "abc", branch: "main", isMain: true },
    { path: "/repo/.worktrees/feat", head: "def", branch: "feat/structured-report-format" },
    { path: "/repo/.worktrees/detached", head: "1234567", detached: true },
    { path: "/repo/.worktrees/held", head: "456", branch: "fix/held", locked: true },
    { path: "/repo/.worktrees/held with reason", head: "789", branch: "fix/held-2", locked: true, lockReason: "agent session still running" },
    { path: "/repo/.worktrees/gone", head: "0ab", branch: "feat/gone", prunable: true },
  ]);
  expect(parseWorktrees("")).toEqual([]);
});

test("a bare main record is flagged and is still the main entry", () => {
  const porcelain = ["worktree /srv/repo.git", "bare", "", "worktree /w/feat", "HEAD abc", "branch refs/heads/feat/x", ""].join("\n");
  expect(parseWorktrees(porcelain)).toEqual([
    { path: "/srv/repo.git", bare: true, isMain: true },
    { path: "/w/feat", head: "abc", branch: "feat/x" },
  ]);
});

const OID = "1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e";
const statusV2 = (...lines: string[]) => parseStatusV2([...lines, ""].join("\n"));
const CLEAN = { detached: false, unborn: false, modified: 0, untracked: 0, conflicts: 0 };

test("status v2: clean with upstream, ahead and behind", () => {
  const branch = [`# branch.oid ${OID}`, "# branch.head feat/report", "# branch.upstream origin/feat/report"];
  expect(statusV2(...branch, "# branch.ab +0 -0")).toEqual({ ...CLEAN, head: "feat/report", upstream: "origin/feat/report", ahead: 0, behind: 0 });
  expect(statusV2(...branch, "# branch.ab +2 -5")).toMatchObject({ ahead: 2, behind: 5 });
});

test("status v2: modified, staged, renamed, unmerged and untracked entries are counted, never named", () => {
  const parsed = statusV2(
    `# branch.oid ${OID}`,
    "# branch.head main",
    `1 .M N... 100644 100644 100644 ${OID} ${OID} src/edited.ts`,
    `1 A. N... 000000 100644 100644 ${OID} ${OID} src/staged new.ts`,
    `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 src/new-name.ts\tsrc/old-name.ts`,
    `u UU N... 100644 100644 100644 100644 ${OID} ${OID} ${OID} src/conflict.ts`,
    "? scratch/",
    "? notes.md",
    "! ignored.log",
  );
  expect(parsed).toEqual({ ...CLEAN, head: "main", modified: 4, conflicts: 1, untracked: 2 });
  expect(JSON.stringify(parsed)).not.toContain("src/");
});

test("status v2: no upstream, detached and unborn", () => {
  const noUpstream = statusV2(`# branch.oid ${OID}`, "# branch.head feat/never-pushed");
  expect(noUpstream).toEqual({ ...CLEAN, head: "feat/never-pushed" });
  expect(noUpstream.upstream).toBeUndefined();
  expect(noUpstream.ahead).toBeUndefined();
  // An upstream that is configured but gone has no ahead/behind line.
  expect(statusV2(`# branch.oid ${OID}`, "# branch.head x", "# branch.upstream origin/x")).toEqual({ ...CLEAN, head: "x", upstream: "origin/x" });
  expect(statusV2(`# branch.oid ${OID}`, "# branch.head (detached)")).toEqual({ ...CLEAN, detached: true });
  expect(statusV2("# branch.oid (initial)", "# branch.head main", "? a.md", "? b.md")).toEqual({ ...CLEAN, head: "main", unborn: true, untracked: 2 });
  expect(parseStatusV2("")).toEqual(CLEAN);
});

const A = (...pairs: [string, ArtifactStatus["status"]][]): ArtifactStatus[] => pairs.map(([id, status]) => ({ id, status }));
// Artifacts in the order the spec-driven schema declares them (specs before design), with the named ones done.
const specDriven = (...done: string[]) => A(...["proposal", "specs", "design", "tasks"].map((id): [string, ArtifactStatus["status"]] => [id, done.includes(id) ? "done" : "ready"]));
const ALL = ["proposal", "specs", "design", "tasks"];
const stage = (artifacts: ArtifactStatus[], tasks: TaskProgress | null, extra: { archived?: boolean } = {}) =>
  deriveStage({ archived: false, artifacts, tasks, ...extra });
const LIFECYCLE = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived"];

test("column derivation: backlog until something is written, drafts until everything is", () => {
  expect(stage(specDriven(), null)).toEqual({ stage: "backlog", column: "Backlog" });
  expect(stage(specDriven("proposal"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(specDriven("proposal", "design"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(specDriven("proposal", "specs"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  // which artifact is written does not matter, only that one is
  expect(stage(specDriven("specs"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(specDriven("proposal", "design", "specs"), { done: 0, total: 0 })).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(specDriven(...ALL), null)).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(specDriven(...ALL), { done: 0, total: 12 })).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(specDriven(...ALL), { done: 0, total: 0 })).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(specDriven(...ALL), { done: 1, total: 12 })).toEqual({ stage: "implementing", column: "Implementing" });
  // ticked tasks win even while an artifact is still open
  expect(stage(specDriven("proposal", "specs"), { done: 2, total: 12 })).toEqual({ stage: "implementing", column: "Implementing" });
  expect(stage([], null)).toEqual({ stage: "unknown", column: "Unknown" });
  // any schema is placed the same way
  expect(stage(A(["brief", "done"], ["plan", "ready"], ["checklist", "blocked"]), null)).toEqual({ stage: "drafts", column: "Drafts" });
});

// As the scanner reports them: `required` from the spec-driven schema's `apply.requires`, which names only `tasks`.
const scanned = (...done: string[]) => specDriven(...done).map((a) => ({ ...a, required: a.id === "tasks" }));

test("column derivation: Ready needs the artifacts apply.requires names, not a design", () => {
  expect(stage(scanned("proposal", "specs", "tasks"), { done: 0, total: 6 })).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(scanned("tasks"), { done: 0, total: 4 })).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(scanned("proposal", "specs", "design"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(scanned("proposal"), null)).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(scanned(), null)).toEqual({ stage: "backlog", column: "Backlog" });
  expect(stage(scanned(...ALL), { done: 0, total: 6 })).toEqual({ stage: "ready", column: "Ready" });
  expect(stage(scanned("proposal", "specs", "tasks"), { done: 2, total: 6 })).toEqual({ stage: "implementing", column: "Implementing" });
  // A schema without apply.requires reports every artifact as required: all of them must be written.
  const all = A(["brief", "done"], ["plan", "ready"], ["checklist", "done"]).map((a) => ({ ...a, required: true }));
  expect(stage(all, null)).toEqual({ stage: "drafts", column: "Drafts" });
  // Nothing required (an apply.requires naming no artifact of the schema): every artifact is, rather than none.
  const none = A(["brief", "done"], ["plan", "ready"]).map((a) => ({ ...a, required: false }));
  expect(stage(none, null)).toEqual({ stage: "drafts", column: "Drafts" });
});

test("column derivation: artifacts cached without the required flag keep today's columns", () => {
  expect(stage(specDriven("proposal", "specs", "tasks"), { done: 0, total: 6 })).toEqual({ stage: "drafts", column: "Drafts" });
  expect(stage(specDriven("tasks"), { done: 0, total: 4 })).toEqual({ stage: "drafts", column: "Drafts" });
  expect(requiredArtifacts(specDriven()).map((a) => a.id)).toEqual(ALL);
  expect(requiredArtifacts(scanned()).map((a) => a.id)).toEqual(["tasks"]);
  expect([isPlanned([]), isPlanned(scanned("tasks")), isPlanned(specDriven("tasks"))]).toEqual([false, true, false]);
});

test("column derivation: every complete change is Done until archived", () => {
  expect(stage(specDriven(...ALL), { done: 12, total: 12 })).toEqual({ stage: "done", column: "Done", subState: "complete" });
  expect(stage(specDriven(...ALL), { done: 12, awaiting: 0, total: 12 })).toEqual({ stage: "done", column: "Done", subState: "complete" });
  expect(stage(specDriven(...ALL), { done: 3, total: 3 }, { archived: true })).toEqual({ stage: "archived", column: "Archived" });
  expect([isComplete("done"), isComplete("implementing"), isComplete("archived")]).toEqual([true, false, false]);
});

test("column derivation: a task awaiting validation settles the change into Done with the validate sub-state", () => {
  expect(stage(specDriven(...ALL), { done: 13, awaiting: 2, total: 15 })).toEqual({ stage: "done", column: "Done", subState: "validate" });
  // Nothing ticked, everything awaiting: still the done column — the agent is finished with all of it.
  expect(stage(specDriven(...ALL), { done: 0, awaiting: 9, total: 9 })).toEqual({ stage: "done", column: "Done", subState: "validate" });
  // One task still open: not settled.
  expect(stage(specDriven(...ALL), { done: 13, awaiting: 1, total: 15 })).toEqual({ stage: "implementing", column: "Implementing" });
  // The first task left for validation takes the change out of Ready, exactly as a ticked one would.
  expect(stage(specDriven(...ALL), { done: 0, awaiting: 1, total: 12 })).toEqual({ stage: "implementing", column: "Implementing" });
  // Only `done` carries a sub-state.
  expect(stage(specDriven(...ALL), { done: 3, awaiting: 3, total: 3 }, { archived: true }).subState).toBeUndefined();
  expect(stage(specDriven(...ALL), { done: 0, awaiting: 0, total: 12 }).subState).toBeUndefined();
});

test("column derivation: settled tasks decide Done and Implementing (kanban-board scenarios)", () => {
  expect(stage(scanned(...ALL), { done: 13, awaiting: 2, total: 15 })).toEqual({ stage: "done", column: "Done", subState: "validate" });
  expect(stage(scanned(...ALL), { done: 0, awaiting: 1, total: 4 })).toEqual({ stage: "implementing", column: "Implementing" });
  expect(stage(scanned(...ALL), { done: 0, awaiting: 3, total: 3 })).toEqual({ stage: "done", column: "Done", subState: "validate" });
});

test("column derivation: a snapshot cached without `awaiting` derives exactly what it derived before", () => {
  const cached: [TaskProgress | null, string][] = [
    [null, "Ready"],
    [{ done: 0, total: 0 }, "Ready"],
    [{ done: 0, total: 12 }, "Ready"],
    [{ done: 1, total: 12 }, "Implementing"],
    [{ done: 12, total: 12 }, "Done"],
  ];
  for (const [tasks, column] of cached) expect(stage(specDriven(...ALL), tasks).column).toBe(column);
});

test("board columns: the lifecycle columns for every schema, Unknown only when needed", () => {
  const change = (schema: string, artifacts: ArtifactStatus[], column = "Drafts") => ({
    repoId: "r", name: "c", schema, artifacts, tasks: null, stage: "drafts" as const, column,
  });
  const snap = (changes: ReturnType<typeof change>[]): Snapshot => ({
    generatedAt: "",
    repos: [{ id: "r", name: "r", path: "/r", ok: true, scannedAt: "", isGit: false, worktrees: [], changes }],
  });
  expect(boardColumns(snap([change("spec-driven", specDriven())]))).toEqual(LIFECYCLE);
  expect(boardColumns(snap([change("plain", A(["brief", "done"], ["plan", "ready"], ["checklist", "blocked"]))]))).toEqual(LIFECYCLE);
  expect(boardColumns(snap([change("spec-driven", specDriven()), change("tdd", A(["spec", "done"], ["tests", "ready"]))]))).toEqual(LIFECYCLE);
  expect(boardColumns(snap([]))).toEqual(LIFECYCLE);
  expect(boardColumns(snap([change("spec-driven", [], "Unknown")]))).toEqual(["Backlog", "Drafts", "Unknown", "Ready", "Implementing", "Done", "Archived"]);
});
