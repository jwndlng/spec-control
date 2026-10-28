import { expect, test } from "bun:test";
import { resolveDependencies } from "../src/shared/dependencies.ts";
import { type ChangeSnapshot, STAGE_COLUMN, type Stage } from "../src/shared/types.ts";

const MAIN = { path: "/w/acme/billing", branch: "main", isMain: true };
const BRANCH = (name: string) => ({ path: `/w/wt/${name}`, branch: `feat/${name}`, isMain: false });

function change(name: string, stage: Stage, extra: Partial<ChangeSnapshot> = {}): ChangeSnapshot {
  return { repoId: "r", name, schema: "spec-driven", artifacts: [], tasks: null, stage, column: STAGE_COLUMN[stage], checkout: MAIN, ...extra };
}
const deps = (...names: string[]) => ({ dependsOn: names.map((name) => ({ name, state: "waiting" as const })) });
const find = (changes: ChangeSnapshot[], name: string, archived = false) => changes.find((c) => c.name === name && !!c.archived === archived) as ChangeSnapshot;
const states = (c: ChangeSnapshot) => c.dependsOn?.map((d) => `${d.name}:${d.state}`);

test("archived in the main checkout and Done in the main checkout are met", () => {
  const out = resolveDependencies([
    change("add-billing-schema", "archived", { archived: "2026-09-30" }),
    change("add-billing-api", "done"),
    change("add-billing-ui", "ready", deps("add-billing-schema", "add-billing-api")),
  ]);
  const ui = find(out, "add-billing-ui");
  expect(states(ui)).toEqual(["add-billing-schema:met", "add-billing-api:met"]);
  expect(ui.blocked).toBeUndefined();
  expect(find(out, "add-billing-schema", true).requiredBy).toEqual(["add-billing-ui"]);
});

test("Done in main while a worktree leads still counts; Done or archived only on a branch waits", () => {
  const out = resolveDependencies([
    change("a", "done", { checkout: BRANCH("a"), otherCheckouts: [{ ...MAIN, column: STAGE_COLUMN.done }] }),
    change("b", "done", { checkout: BRANCH("b"), otherCheckouts: [{ ...MAIN, column: STAGE_COLUMN.implementing }] }),
    change("c", "archived", { archived: "2026-10-01", checkout: BRANCH("c"), otherCheckouts: [{ ...MAIN, column: STAGE_COLUMN.implementing }] }),
    change("d", "archived", { archived: "2026-10-01", checkout: BRANCH("d"), otherCheckouts: [{ ...MAIN, column: STAGE_COLUMN.done }] }),
    change("x", "ready", deps("a", "b", "c", "d")),
  ]);
  expect(states(find(out, "x"))).toEqual(["a:met", "b:waiting", "c:waiting", "d:met"]);
  expect(find(out, "x").blocked).toBe(true);
});

test("a reused name is not met by its old archive, and is met once the new change is done or archived", () => {
  const old = change("add-billing-schema", "archived", { archived: "2026-09-01" });
  const ui = change("add-billing-ui", "ready", deps("add-billing-schema"));
  const waiting = resolveDependencies([change("add-billing-schema", "drafts", { created: "2026-10-01" }), old, ui]);
  expect(states(find(waiting, "add-billing-ui"))).toEqual(["add-billing-schema:waiting"]);
  expect(find(waiting, "add-billing-ui").blocked).toBe(true);

  const done = resolveDependencies([change("add-billing-schema", "done", { created: "2026-10-01" }), old, ui]);
  expect(states(find(done, "add-billing-ui"))).toEqual(["add-billing-schema:met"]);
  expect(find(done, "add-billing-ui").blocked).toBeUndefined();

  // done only on its branch still waits; an archive in main dated on or after its creation is the new change's
  const onBranch = change("add-billing-schema", "done", { created: "2026-10-01", checkout: BRANCH("add-billing-schema"), otherCheckouts: [{ ...MAIN, column: STAGE_COLUMN.drafts }] });
  expect(states(find(resolveDependencies([onBranch, old, ui]), "add-billing-ui"))).toEqual(["add-billing-schema:waiting"]);
  const archivedAgain = change("add-billing-schema", "archived", { archived: "2026-10-05" });
  expect(states(find(resolveDependencies([onBranch, archivedAgain, old, ui]), "add-billing-ui"))).toEqual(["add-billing-schema:met"]);
});

test("a folder without git has no checkout and is its own main checkout", () => {
  const out = resolveDependencies([change("a", "done", { checkout: undefined }), change("x", "ready", { checkout: undefined, ...deps("a") })]);
  expect(states(find(out, "x"))).toEqual(["a:met"]);
});

test("a missing name blocks and warns", () => {
  const out = resolveDependencies([change("x", "ready", deps("add-billing-scheme"))]);
  const x = find(out, "x");
  expect(states(x)).toEqual(["add-billing-scheme:missing"]);
  expect(x.blocked).toBe(true);
  expect(x.warnings).toEqual(['depends on "add-billing-scheme", but no change of that name exists']);
});

test("a three-change cycle is reported on each change", () => {
  const out = resolveDependencies([change("alpha", "ready", deps("beta")), change("beta", "ready", deps("gamma")), change("gamma", "ready", deps("alpha"))]);
  for (const name of ["alpha", "beta", "gamma"]) {
    expect(find(out, name).dependsOn?.[0].state).toBe("cycle");
    expect(find(out, name).blocked).toBe(true);
  }
  expect(find(out, "alpha").warnings).toEqual(["dependency cycle: alpha → beta → gamma → alpha"]);
});

test("a self-reference is a cycle", () => {
  const out = resolveDependencies([change("alpha", "ready", deps("alpha"))]);
  expect(states(find(out, "alpha"))).toEqual(["alpha:cycle"]);
  expect(find(out, "alpha").warnings).toEqual(["dependency cycle: alpha → alpha"]);
});

test("a met change breaks the cycle", () => {
  const out = resolveDependencies([change("alpha", "ready", deps("beta")), change("beta", "archived", { archived: "2026-09-01", ...deps("alpha") })]);
  expect(states(find(out, "alpha", false))).toEqual(["beta:met"]);
  expect(find(out, "alpha").warnings).toBeUndefined();
});

test("a chain blocks every link that waits, without moving anything", () => {
  const out = resolveDependencies([
    change("add-billing-schema", "implementing"),
    change("add-billing-api", "ready", deps("add-billing-schema")),
    change("add-billing-ui", "ready", deps("add-billing-api")),
  ]);
  expect(find(out, "add-billing-api").blocked).toBe(true);
  expect(find(out, "add-billing-ui").blocked).toBe(true);
  expect(find(out, "add-billing-ui").column).toBe(STAGE_COLUMN.ready);
  expect(find(out, "add-billing-schema").requiredBy).toEqual(["add-billing-api"]);
});

test("required-by lists are sorted", () => {
  const out = resolveDependencies([change("api", "ready"), change("ui", "drafts", deps("api")), change("docs", "drafts", deps("api"))]);
  expect(find(out, "api").requiredBy).toEqual(["docs", "ui"]);
});

test("an unreadable file blocks without a list, and resolving again keeps it so", () => {
  const once = resolveDependencies([change("x", "ready", { blocked: true })]);
  expect(find(once, "x").blocked).toBe(true);
  expect(find(resolveDependencies(once), "x").blocked).toBe(true);
});

test("archived changes are never blocked", () => {
  const out = resolveDependencies([change("a", "implementing"), change("old", "archived", { archived: "2026-01-01", ...deps("a") })]);
  expect(find(out, "old", true).blocked).toBeUndefined();
  expect(find(out, "old", true).dependsOn).toBeUndefined();
  expect(find(out, "a").requiredBy).toBeUndefined();
});

test("a repository without the convention is returned unchanged", () => {
  const input = [change("a", "ready"), change("b", "archived", { archived: "2026-01-01" })];
  const out = resolveDependencies(input);
  expect(out).toBe(input);
  expect(out[0]).toBe(input[0]);
});

test("changes outside the graph keep their identity", () => {
  const lonely = change("lonely", "drafts");
  const out = resolveDependencies([lonely, change("a", "ready"), change("b", "ready", deps("a"))]);
  expect(out[0]).toBe(lonely);
  expect(Object.keys(out[0])).not.toContain("requiredBy");
});
