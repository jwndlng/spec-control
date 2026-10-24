import { expect, test } from "bun:test";
import { type ChangeCopy, foldLeftovers, leadingCopy, mergeChanges } from "../src/server/mergeChanges.ts";
import type { ChangeSnapshot, Stage } from "../src/shared/types.ts";

const MAIN = { path: "/w/acme/alpha-infra", branch: "main", isMain: true };
const wt = (name: string, branch: string | undefined = `feat/${name}`) => ({ path: `/w/acme/alpha-infra/.claude/worktrees/${name}`, branch, isMain: false });

function copy(checkout: ChangeCopy["checkout"], stage: Stage, column: string, extra: Partial<ChangeSnapshot> = {}): ChangeCopy {
  const artifacts = ["proposal", "design", "specs", "tasks"].map((id) => ({ id, status: "ready" as const }));
  return { checkout, change: { repoId: "r", name: "audit-trail", schema: "spec-driven", artifacts, tasks: null, stage, column, ...extra } };
}
const doneArtifacts = (n: number) => ["proposal", "design", "specs", "tasks"].map((id, i) => ({ id, status: i < n ? ("done" as const) : ("ready" as const) }));

test("leadingCopy: stage first, then artifacts, tasks, recency, main, path — whatever the input order", () => {
  const cases: [string, ChangeCopy, ChangeCopy][] = [
    ["stage", copy(wt("a"), "implementing", "Implementing"), copy(MAIN, "drafts", "Drafts", { lastActivityAt: "2030-01-01T00:00:00Z" })],
    ["done artifacts", copy(wt("a"), "drafts", "Drafts", { artifacts: doneArtifacts(2) }), copy(MAIN, "drafts", "Drafts", { artifacts: doneArtifacts(1) })],
    ["done tasks", copy(wt("a"), "implementing", "Implementing", { tasks: { done: 5, total: 9 } }), copy(MAIN, "implementing", "Implementing", { tasks: { done: 2, total: 9 } })],
    ["recency", copy(wt("a"), "ready", "Ready", { lastActivityAt: "2026-09-21T10:00:00+02:00" }), copy(MAIN, "ready", "Ready", { lastActivityAt: "2026-09-21T07:59:00Z" })],
    ["main before worktrees", copy(MAIN, "ready", "Ready"), copy(wt("a"), "ready", "Ready")],
    ["path", copy(wt("a"), "ready", "Ready"), copy(wt("b"), "ready", "Ready")],
  ];
  for (const [label, winner, loser] of cases) {
    expect([label, leadingCopy([winner, loser]).checkout.path]).toEqual([label, winner.checkout.path]);
    expect([label, leadingCopy([loser, winner]).checkout.path]).toEqual([label, winner.checkout.path]);
  }
  // identical everywhere → main, every time
  const same = [copy(wt("b"), "ready", "Ready"), copy(MAIN, "ready", "Ready"), copy(wt("a"), "ready", "Ready")];
  expect(leadingCopy(same).checkout).toEqual(MAIN);
  expect(leadingCopy([...same].reverse()).checkout).toEqual(MAIN);
});

test("mergeChanges: one change per name, data from the leading copy, other checkouts listed", () => {
  const merged = mergeChanges(
    [
      copy(MAIN, "drafts", "Drafts", { branchMatch: "guessed/from-names" }),
      copy(wt("audit-trail", "wip/compliance"), "implementing", "Implementing", { tasks: { done: 4, total: 12 }, branchMatch: "wip/compliance" }),
      copy(wt("old", undefined), "backlog", "Backlog"),
      { ...copy(wt("other"), "ready", "Ready"), change: { ...copy(MAIN, "ready", "Ready").change, name: "upgrade-runtime" } },
    ],
    new Map(),
  );
  expect(merged.map((c) => c.name)).toEqual(["audit-trail", "upgrade-runtime"]);
  const [audit, upgrade] = merged;
  expect([audit.column, audit.tasks, audit.branchMatch]).toEqual(["Implementing", { done: 4, total: 12 }, "wip/compliance"]);
  expect(audit.checkout).toEqual(wt("audit-trail", "wip/compliance"));
  expect(audit.otherCheckouts).toEqual([{ ...MAIN, column: "Drafts" }, { ...wt("old", undefined), column: "Backlog" }]);
  expect([upgrade.checkout?.isMain, upgrade.otherCheckouts, upgrade.branchMatch]).toEqual([false, undefined, "feat/other"]);
});

test("mergeChanges: a change that leads from main keeps its name-based branch guess", () => {
  const [change] = mergeChanges([copy(MAIN, "done", "Done", { branchMatch: "feat/audit-trail" }), copy(wt("stale"), "drafts", "Drafts")], new Map());
  expect([change.checkout, change.branchMatch, change.column]).toEqual([MAIN, "feat/audit-trail", "Done"]);
  expect(change.otherCheckouts).toEqual([{ ...wt("stale"), column: "Drafts" }]);
});

test("mergeChanges: archived on main wins, unless the copy was created after the archive", () => {
  const archived = new Map([["audit-trail", "2026-09-20"]]);
  const stale = copy(wt("stale"), "implementing", "Implementing", { created: "2026-09-10" });
  const undated = copy(wt("undated"), "implementing", "Implementing");
  const sameDay = copy(wt("same-day"), "implementing", "Implementing", { created: "2026-09-20" });
  const reused = copy(wt("reused"), "drafts", "Drafts", { created: "2026-10-02" });
  expect(mergeChanges([stale, undated, sameDay], archived)).toEqual([]);
  expect(mergeChanges([stale, reused], archived).map((c) => [c.name, c.checkout?.path, c.otherCheckouts])).toEqual([["audit-trail", reused.checkout.path, undefined]]);
  // main's own copy is not decided here: foldLeftovers has already taken it into the archive
  const leftover = copy(MAIN, "done", "Done", { created: "2026-09-01" });
  const folded = foldLeftovers([leftover], [archivedSnapshot("2026-09-20")]);
  expect(mergeChanges(folded.copies, archived)).toEqual([]);
  expect(folded.archived.map((c) => c.otherCheckouts)).toEqual([[{ ...MAIN, column: "Done" }]]);
});

const archivedSnapshot = (date: string, extra: Partial<ChangeSnapshot> = {}): ChangeSnapshot => ({ ...copy(MAIN, "archived", "Archived").change, archived: date, ...extra });

test("foldLeftovers: main's active copy of a change it archived is a leftover of that archive", () => {
  const archived = [archivedSnapshot("2026-09-20")];
  for (const [label, extra] of [
    ["created before", { created: "2026-09-10" }],
    ["no created date", {}],
    ["same day", { created: "2026-09-20" }],
  ] as const) {
    const { copies, archived: out } = foldLeftovers([copy(MAIN, "done", "Done", extra)], archived);
    expect([label, copies]).toEqual([label, []]);
    expect([label, out.map((c) => [c.archived, c.otherCheckouts])]).toEqual([label, [["2026-09-20", [{ ...MAIN, column: "Done" }]]]]);
  }
  // other names pass through untouched, and the input is not mutated
  const other = { ...copy(MAIN, "ready", "Ready"), change: { ...copy(MAIN, "ready", "Ready").change, name: "upgrade-runtime" } };
  const result = foldLeftovers([other, copy(MAIN, "done", "Done", { created: "2026-09-01" })], archived);
  expect(result.copies).toEqual([other]);
  expect(archived[0].otherCheckouts).toBeUndefined();
});

test("foldLeftovers: a name reused after the archive stays a change of its own", () => {
  const reused = copy(MAIN, "drafts", "Drafts", { created: "2026-10-02" });
  const { copies, archived } = foldLeftovers([reused], [archivedSnapshot("2026-09-20")]);
  expect(copies).toEqual([reused]);
  expect(archived.map((c) => c.otherCheckouts)).toEqual([undefined]);
});

test("foldLeftovers: of two archives of one name only the newest gets the leftover", () => {
  const { copies, archived } = foldLeftovers([copy(MAIN, "done", "Done", { created: "2026-09-10" })], [archivedSnapshot("2026-09-20"), archivedSnapshot("2026-08-01")]);
  expect(copies).toEqual([]);
  expect(archived.map((c) => [c.archived, c.otherCheckouts])).toEqual([
    ["2026-09-20", [{ ...MAIN, column: "Done" }]],
    ["2026-08-01", undefined],
  ]);
});

test("mergeChanges: worktrees that merely carry main's copy along are not listed", () => {
  const carried = ["b", "c", "d"].map((n) => copy(wt(n), "drafts", "Drafts"));
  const [change] = mergeChanges([copy(MAIN, "drafts", "Drafts"), copy(wt("a"), "implementing", "Implementing", { tasks: { done: 1, total: 3 } }), ...carried], new Map());
  expect(change.checkout?.path).toBe(wt("a").path);
  expect(change.otherCheckouts).toEqual([{ ...MAIN, column: "Drafts" }]);
  // led from main: identical worktree copies are noise too, a differing one is not
  const [fromMain] = mergeChanges([copy(MAIN, "ready", "Ready"), copy(wt("same"), "ready", "Ready"), copy(wt("behind"), "drafts", "Drafts")], new Map());
  expect(fromMain.otherCheckouts).toEqual([{ ...wt("behind"), column: "Drafts" }]);
  // no main copy at all: every copy is somebody's work
  const [wtOnly] = mergeChanges([copy(wt("x"), "ready", "Ready"), copy(wt("y"), "ready", "Ready")], new Map());
  expect(wtOnly.otherCheckouts).toEqual([{ ...wt("y"), column: "Ready" }]);
});

test("a pending archive leads: one archived change from the worktree, active copies as its other checkouts", () => {
  const archivedCopy = (name: string, date: string) => copy(wt(name, `chore/${name}`), "archived", "Archived", { archived: date });
  const main = copy(MAIN, "implementing", "Implementing", { created: "2026-09-10" });
  const stale = copy(wt("stale"), "drafts", "Drafts", { created: "2026-09-10" });

  const [one, ...rest] = mergeChanges([stale, main], new Map(), [archivedCopy("archive-a", "2026-09-18"), archivedCopy("archive-b", "2026-09-20")]);
  expect(rest).toEqual([]);
  expect(one).toMatchObject({ archived: "2026-09-20", column: "Archived", checkout: { branch: "chore/archive-b", isMain: false } }); // the latest of several
  expect(one.otherCheckouts?.map((o) => [o.isMain, o.column])).toEqual([[true, "Implementing"], [false, "Drafts"]]);

  // nothing active left anywhere: still reported, without other checkouts
  expect(mergeChanges([], new Map(), [archivedCopy("archive-a", "2026-09-18")])).toMatchObject([{ archived: "2026-09-18", otherCheckouts: undefined }]);

  // a change created after that archive reuses the name and stays active on its own
  const reused = copy(MAIN, "drafts", "Drafts", { created: "2026-10-02" });
  const both = mergeChanges([reused, stale], new Map(), [archivedCopy("archive-a", "2026-09-18")]);
  expect(both.map((c) => [c.column, c.checkout?.isMain, c.otherCheckouts?.length]).sort()).toEqual([["Archived", false, 1], ["Drafts", true, undefined]].sort());
});

test("mergeChanges: the card carries the leading copy's Done sub-state", () => {
  // The worktree is further along: everything settled, two tasks still awaiting a person.
  const validating = copy(wt("audit-trail"), "done", "Done", { tasks: { done: 13, awaiting: 2, total: 15 }, subState: "validate" as const });
  const behind = copy(MAIN, "implementing", "Implementing", { tasks: { done: 4, awaiting: 0, total: 15 } });
  const [change] = mergeChanges([behind, validating], new Map());
  expect([change.column, change.subState, change.tasks]).toEqual(["Done", "validate", { done: 13, awaiting: 2, total: 15 }]);
  expect(change.otherCheckouts).toEqual([{ ...MAIN, column: "Implementing" }]);

  // The other way round: main has everything confirmed, so it leads and the card says `complete`.
  const confirmed = copy(MAIN, "done", "Done", { tasks: { done: 15, awaiting: 0, total: 15 }, subState: "complete" as const });
  const [led] = mergeChanges([validating, confirmed], new Map());
  expect([led.checkout, led.subState]).toEqual([MAIN, "complete"]);
});

test("mergeChanges: the record is the leading copy's, else the main checkout's copy's, and changes no column", () => {
  const lead = copy(wt("audit-trail"), "implementing", "Implementing", { tasks: { done: 2, total: 5 }, recorded: { branch: "fix/audit-trail" } });
  const [fromLead] = mergeChanges([copy(MAIN, "ready", "Ready"), lead], new Map());
  expect(fromLead.recorded).toEqual({ branch: "fix/audit-trail" });

  const [fromMain] = mergeChanges([copy(MAIN, "ready", "Ready", { recorded: { branch: "fix/audit-trail" } }), { ...lead, change: { ...lead.change, recorded: undefined } }], new Map());
  expect(fromMain.recorded).toEqual({ branch: "fix/audit-trail" });
  expect(fromMain.checkout?.path).toBe(lead.checkout.path);

  // The leading copy's own record wins over the main checkout's.
  const [both] = mergeChanges([copy(MAIN, "ready", "Ready", { recorded: { branch: "feat/audit-trail" } }), lead], new Map());
  expect(both.recorded).toEqual({ branch: "fix/audit-trail" });

  // Gaining a record changes nothing else about the card.
  const [without] = mergeChanges([copy(MAIN, "ready", "Ready"), { ...lead, change: { ...lead.change, recorded: undefined } }], new Map());
  const { recorded: _, ...rest } = fromLead;
  expect(rest).toEqual(without);
  expect(mergeChanges([copy(MAIN, "ready", "Ready")], new Map())[0].recorded).toBeUndefined();
});
