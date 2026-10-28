import { afterEach, expect, test } from "bun:test";
import { ApiError, type Api, httpApi, setApi } from "../src/ui/api.ts";
import { createInRepos, DependsOnField, submitState, toggleDependency } from "../src/ui/newChangeForm.tsx";
import { dependencyChoices, newChangeTargets } from "../src/ui/repoGroups.ts";
import { byTag, textOf } from "./vnode.ts";

afterEach(() => setApi(httpApi));

const repos = [
  { id: "a", name: "alpha-infra" },
  { id: "d", name: "demo-ops" },
  { id: "x", name: "zeta-net" },
];

/** A fake backend recording every create and scan; `refuse` maps a repository id to the refusal it answers with. */
function fakeApi(refuse: Record<string, ApiError> = {}, scansBusy = 0) {
  const calls: string[] = [];
  let inFlight = 0;
  let busy = scansBusy;
  const fake: Api = {
    ...httpApi,
    createChange: async (repoId, name, prompt) => {
      inFlight++;
      expect(inFlight).toBe(1);
      calls.push(`create ${repoId} ${name} ${prompt ?? "-"}`);
      await Promise.resolve();
      inFlight--;
      if (refuse[repoId]) throw refuse[repoId];
      return { name, staged: repoId !== "x" };
    },
    scan: async () => {
      calls.push("scan");
      return { started: busy-- <= 0 };
    },
  };
  setApi(fake);
  return calls;
}

test("createInRepos sends one create per repository, one at a time and in order, then one scan", async () => {
  const calls = fakeApi();
  const progress: string[] = [];
  const results = await createInRepos(repos, "bump-terraform-1-9", "Bump to 1.9", (id) => progress.push(id));
  expect(calls).toEqual(["create a bump-terraform-1-9 Bump to 1.9", "create d bump-terraform-1-9 Bump to 1.9", "create x bump-terraform-1-9 Bump to 1.9", "scan"]);
  expect(progress).toEqual(["a", "d", "x"]);
  expect(results).toEqual([
    { repoId: "a", repoName: "alpha-infra", ok: true, staged: true },
    { repoId: "d", repoName: "demo-ops", ok: true, staged: true },
    { repoId: "x", repoName: "zeta-net", ok: true, staged: false },
  ]);
});

test("a refusal is that repository's result and does not stop the others", async () => {
  const calls = fakeApi({ d: new ApiError(409, 'a change named "bump-terraform-1-9" already exists') });
  const results = await createInRepos(repos, "bump-terraform-1-9", undefined);
  expect(calls.filter((c) => c.startsWith("create")).map((c) => c.split(" ")[1])).toEqual(["a", "d", "x"]);
  expect(results[1]).toEqual({ repoId: "d", repoName: "demo-ops", ok: false, message: 'a change named "bump-terraform-1-9" already exists' });
  expect(results[0].ok && results[2].ok).toBe(true);
});

test("one scan is asked for after the last create, also when it answers not started: the server queues the follow-up", async () => {
  const calls = fakeApi({}, 2);
  await createInRepos(repos.slice(0, 2), "bump", undefined);
  expect(calls).toEqual(["create a bump -", "create d bump -", "scan"]);
});

test("no scan is asked for when every repository refused", async () => {
  const refusal = new ApiError(409, "repository has not been successfully scanned");
  const calls = fakeApi({ a: refusal, d: refusal, x: refusal });
  const results = await createInRepos(repos, "bump", undefined);
  expect(results.every((r) => !r.ok)).toBe(true);
  expect(calls).not.toContain("scan");
});

test("Depends on offers the active changes by name and keeps the picking order", () => {
  const changes = [
    { name: "add-billing-schema", column: "Implementing" },
    { name: "add-audit-log", column: "Archived", archived: "2026-09-01" },
    { name: "add-billing-api", column: "Ready" },
  ];
  expect(dependencyChoices(changes)).toEqual([
    { name: "add-billing-api", column: "Ready" },
    { name: "add-billing-schema", column: "Implementing" },
  ]);
  expect(newChangeTargets([{ id: "a", name: "alpha-infra", ok: true, changes }], []).projects[0].changes?.map((c) => c.name)).toEqual(["add-billing-api", "add-billing-schema"]);

  let picked: string[] = [];
  picked = toggleDependency(picked, "add-billing-schema");
  picked = toggleDependency(picked, "add-billing-api");
  expect(picked).toEqual(["add-billing-schema", "add-billing-api"]);
  expect(toggleDependency(picked, "add-billing-schema")).toEqual(["add-billing-api"]);

  const field = (DependsOnField({ choices: dependencyChoices(changes), selected: ["add-billing-api"], disabled: false, onToggle: () => {} }));
  const boxes = byTag(field, "input");
  expect(boxes.map((b) => b.props.checked)).toEqual([true, false]);
  expect(textOf(field)).toContain("Ready");
  const empty = (DependsOnField({ choices: [], selected: [], disabled: false, onToggle: () => {} }));
  expect(textOf(empty)).toContain("No active change in this project to depend on.");
});

test("the request carries dependsOn only when some were picked", async () => {
  const sent: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ name: "x", staged: true }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await httpApi.createChange("a", "add-billing-ui", undefined, ["add-billing-schema", "add-billing-api"]);
    await httpApi.createChange("a", "add-billing-ui", "why", []);
  } finally {
    globalThis.fetch = realFetch;
  }
  expect(sent).toEqual([{ name: "add-billing-ui", dependsOn: ["add-billing-schema", "add-billing-api"] }, { name: "add-billing-ui", prompt: "why" }]);
});

test("the form, in every mode, refuses a reserved or unusable name with its reason as text", () => {
  expect(submitState("archive", null, false)).toEqual({ trimmed: "archive", nameError: "archive is reserved for archived changes", canSubmit: false });
  expect(submitState(" Archive ", null, false).canSubmit).toBe(false);
  expect(submitState("-wip", null, false)).toEqual({ trimmed: "-wip", nameError: "must not start with . or -", canSubmit: false });
  expect(submitState(".git", null, false).nameError).toBe("must not start with . or -");
  expect(submitState("foo/bar", null, false).nameError).toContain("only letters");
  expect(submitState("", null, false).nameError).toBe("required");
  expect(submitState("add-audit-trail", null, false)).toEqual({ trimmed: "add-audit-trail", nameError: null, canSubmit: true });
  expect(submitState("add-audit-trail", "choose a label", false).canSubmit).toBe(false);
  expect(submitState("add-audit-trail", null, true).canSubmit).toBe(false);
});
