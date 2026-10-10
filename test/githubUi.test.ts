import { expect, test } from "bun:test";
import type { GithubClone, GithubClonesResponse, GithubRepoEntry, GithubRepoList } from "../src/shared/types.ts";
import { type AddGithubActions, AddGithubBody, AddGithubTrigger, type AddGithubView } from "../src/ui/addGithub.tsx";
import { NoRepos } from "../src/ui/empty.tsx";
import { AddGithubButton } from "../src/ui/addGithub.tsx";
import {
  AddGithubController,
  addGithubUnavailable,
  cloneOutcome,
  cloneTargets,
  createGithubClonesStore,
  filterGithubRepos,
  listingNotice,
  pushedAge,
  shouldPoll,
  type Timers,
} from "../src/ui/githubState.ts";
import { defaultConfig } from "../src/server/config.ts";
import { byComponent, byTag, textOf } from "./vnode.ts";

/** Activates a button the test expects to be there. */
const press = (el: { props: Record<string, unknown> } | undefined) => {
  if (!el) throw new Error("no such button");
  (el.props.onClick as () => void)();
};
const entry = (repo: string, patch: Partial<GithubRepoEntry> = {}): GithubRepoEntry => ({ repo, description: "", private: false, archived: false, pushedAt: "2026-10-01T10:00:00Z", added: false, ...patch });
const clone = (patch: Partial<GithubClone> & Pick<GithubClone, "id" | "state">): GithubClone => ({ repo: "acme/beta-soc", root: "/w/acme", name: "beta-soc", path: "/w/acme/beta-soc", startedAt: "2026-10-10T10:00:00Z", ...patch });

// ---- 6.1: the clones store ----

/** Timers a test advances by hand. */
function manualTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const handle = { fn, ms };
      pending.push(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      const at = pending.indexOf(handle as (typeof pending)[number]);
      if (at >= 0) pending.splice(at, 1);
    },
  };
  return { timers, pending, fire: () => pending.shift()?.fn() };
}

test("polling runs only while a clone is cloning", () => {
  expect(shouldPoll([])).toBe(false);
  expect(shouldPoll([{ state: "tracked" }, { state: "failed" }])).toBe(false);
  expect(shouldPoll([{ state: "tracked" }, { state: "cloning" }])).toBe(true);
});

test("the store asks every second while a clone runs, stops once none does, and reports what finished", async () => {
  const answers: GithubClonesResponse[] = [
    { clones: [clone({ id: "c1", state: "cloning" })], gitAvailable: true },
    { clones: [clone({ id: "c1", state: "cloning" })], gitAvailable: true },
    { clones: [clone({ id: "c1", state: "tracked" })], gitAvailable: true },
  ];
  let asked = 0;
  const { timers, pending, fire } = manualTimers();
  const store = createGithubClonesStore(async () => answers[Math.min(asked++, answers.length - 1)], timers, 1000);
  const finished: string[] = [];
  store.onFinished((done) => finished.push(...done.map((c) => `${c.id}:${c.state}`)));
  await store.refresh();
  expect(store.get().gitAvailable).toBe(true);
  expect(pending.map((p) => p.ms)).toEqual([1000]);
  fire();
  await Bun.sleep(0);
  expect(asked).toBe(2);
  expect(pending).toHaveLength(1);
  fire();
  await Bun.sleep(0);
  expect(asked).toBe(3);
  expect(finished).toEqual(["c1:tracked"]);
  // Nothing runs any more: no further request is planned.
  expect(pending).toHaveLength(0);
});

test("nothing running means no polling at all", async () => {
  const { timers, pending } = manualTimers();
  let asked = 0;
  const store = createGithubClonesStore(async () => {
    asked++;
    return { clones: [clone({ id: "c1", state: "failed", reason: "x" })], gitAvailable: true };
  }, timers);
  await store.refresh();
  expect(asked).toBe(1);
  expect(pending).toEqual([]);
});

test("a clone that finishes before the first poll is still reported", async () => {
  const { timers } = manualTimers();
  const store = createGithubClonesStore(async () => ({ clones: [clone({ id: "c9", state: "integratable" })], gitAvailable: true }), timers);
  const finished: string[] = [];
  store.onFinished((done) => finished.push(...done.map((c) => c.id)));
  await store.started(clone({ id: "c9", state: "cloning" }));
  expect(finished).toEqual(["c9"]);
});

// ---- pure helpers ----

test("Add from GitHub needs a workspace root and git, not agent sessions", () => {
  expect(addGithubUnavailable({ scanRoots: [] }, true)).toBe("add a workspace root in Settings first");
  expect(addGithubUnavailable({ scanRoots: ["/w/acme"] }, false)).toBe("git was not found on this machine");
  expect(addGithubUnavailable({ scanRoots: ["/w/acme"] }, true)).toBeUndefined();
  expect(addGithubUnavailable({ scanRoots: ["/w/acme"] }, undefined)).toBeUndefined();
});

test("the trigger is inactive with the reason in its tooltip and accessible name", () => {
  const off = byTag(AddGithubTrigger({ off: "git was not found on this machine", small: true, onOpen: () => {} }), "button")[0];
  expect(off.props.disabled).toBe(true);
  expect(off.props.title).toBe("Add from GitHub is unavailable: git was not found on this machine");
  expect(off.props["aria-label"]).toBe("Add from GitHub, unavailable: git was not found on this machine");
  const on = byTag(AddGithubTrigger({ off: undefined, small: true, onOpen: () => {} }), "button")[0];
  expect(on.props.disabled).toBe(false);
  expect(on.props["aria-label"]).toBe("Add from GitHub");
});

test("the boards' empty state offers Add from GitHub", () => {
  expect(byComponent(NoRepos({ config: { ...defaultConfig(), scanRoots: ["/w/acme"] } }), AddGithubButton)).toHaveLength(1);
});

test("search covers owner/name and description; ages and notices read as text", () => {
  const repos = [entry("jdoe/alpha-infra", { description: "Terraform modules" }), entry("jdoe/demo-ops")];
  expect(filterGithubRepos(repos, "TERRA").map((r) => r.repo)).toEqual(["jdoe/alpha-infra"]);
  expect(filterGithubRepos(repos, "demo").map((r) => r.repo)).toEqual(["jdoe/demo-ops"]);
  expect(filterGithubRepos(repos, " ").length).toBe(2);
  expect(pushedAge("2026-10-08T10:00:00Z", Date.parse("2026-10-10T10:00:00Z"))).toBe("pushed 2d ago");
  expect(pushedAge("")).toBe("");
  expect(listingNotice({ status: "unavailable", reason: "gh is not signed in to github.com — run `gh auth login`", repos: [] })?.text).toContain("You can still type a repository");
  expect(listingNotice({ status: "failed", reason: "boom", repos: [] })).toEqual({ tone: "danger", text: "Could not list repositories: boom." });
  expect(listingNotice({ status: "ok", repos: [] })).toBeUndefined();
});

test("targets show the full path and refuse bad names and duplicate folders", () => {
  const targets = cloneTargets(
    [
      { repo: "acme/beta-soc", name: "beta-soc" },
      { repo: "jdoe/beta-soc", name: "beta-soc" },
      { repo: "acme/chat-groups", name: "../x" },
      { repo: "acme/alpha", name: "alpha" },
    ],
    "/w/acme",
    ["/w/acme/alpha"],
  );
  expect(targets.map((t) => t.path)).toEqual(["/w/acme/beta-soc", "/w/acme/beta-soc", "/w/acme/../x", "/w/acme/alpha"]);
  expect(targets[0].problem).toContain("same folder");
  expect(targets[1].problem).toContain("same folder");
  expect(targets[2].problem).toContain("folder name");
  expect(targets[3].problem).toContain("already taken");
  expect(cloneTargets([{ repo: "acme/beta-soc", name: "beta-soc" }], "")[0].path).toBe("");
});

test("each outcome reads in words", () => {
  expect(cloneOutcome({ state: "cloning" }).label).toBe("Cloning…");
  expect(cloneOutcome({ state: "tracked" }).label).toBe("tracked");
  expect(cloneOutcome({ state: "integratable" }).detail).toContain("Integrate");
  expect(cloneOutcome({ state: "failed", reason: "Repository not found." })).toMatchObject({ label: "clone failed", tone: "danger", detail: "Repository not found." });
});

// ---- 6.2: the dialog ----

function fakeDeps(lists: Record<string, GithubRepoList>) {
  const calls: string[] = [];
  const started: GithubClone[] = [];
  let next = 1;
  return {
    calls,
    started,
    deps: {
      listGithubRepos: async (owner?: string) => {
        calls.push(`list ${owner ?? "(signed in)"}`);
        return lists[owner ?? ""] ?? { status: "ok", owner, repos: [] };
      },
      cloneGithub: async (repo: string, root: string, name: string) => {
        calls.push(`clone ${repo} ${root}/${name}`);
        if (repo === "acme/taken") throw new Error(`${root}/${name} already exists`);
        return clone({ id: `c${next++}`, repo, root, name, path: `${root}/${name}`, state: "cloning" });
      },
      started: (c: GithubClone) => void started.push(c),
    },
  };
}

const SIGNED_IN: GithubRepoList = { status: "ok", owner: "jdoe", repos: [entry("jdoe/demo-ops", { added: true }), entry("jdoe/alpha-infra")] };

test("opening lists the signed-in account once; choosing two and closing starts nothing", async () => {
  const { deps, calls } = fakeDeps({ "": SIGNED_IN });
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  await dialog.open();
  expect(dialog.get().root).toBe("/w/acme");
  dialog.toggle("jdoe/alpha-infra");
  dialog.setTyped("acme/beta-soc");
  dialog.addTyped();
  expect(dialog.targets().map((t) => t.path)).toEqual(["/w/acme/alpha-infra", "/w/acme/beta-soc"]);
  // Closing is the host's onClose; nothing in the controller ran but the one listing.
  expect(calls).toEqual(["list (signed in)"]);
});

test("an already added repository cannot be chosen, by the list or by typing", async () => {
  const { deps } = fakeDeps({ "": SIGNED_IN });
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  await dialog.open();
  dialog.toggle("jdoe/demo-ops");
  expect(dialog.get().chosen).toEqual([]);
  dialog.setTyped("https://github.com/jdoe/demo-ops.git");
  dialog.addTyped();
  expect(dialog.get().typedError).toContain("already tracked");
});

test("typed entries are validated as they are typed, and another host or credentials are refused", async () => {
  const { deps } = fakeDeps({});
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  dialog.setTyped("https://gitlab.com/acme/beta-soc");
  expect(dialog.get().typedError).toContain("not a GitHub repository");
  dialog.setTyped("https://user:secret@github.com/acme/beta-soc");
  expect(dialog.get().typedError).not.toContain("secret");
  dialog.addTyped();
  expect(dialog.get().chosen).toEqual([]);
  dialog.setTyped("git@github.com:acme/beta-soc.git");
  expect(dialog.get().typedError).toBeUndefined();
  dialog.addTyped();
  expect(dialog.get().chosen).toEqual([{ repo: "acme/beta-soc", name: "beta-soc" }]);
});

test("another owner replaces the list; an invalid owner starts nothing; a failure keeps the earlier list", async () => {
  const { deps, calls } = fakeDeps({ "": SIGNED_IN, acme: { status: "ok", owner: "acme", repos: [entry("acme/beta-soc")] }, broken: { status: "failed", owner: "broken", reason: "boom", repos: [] } });
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  await dialog.open();
  dialog.setOwner("acme");
  await dialog.confirmOwner();
  expect(dialog.get().repos.map((r) => r.repo)).toEqual(["acme/beta-soc"]);
  dialog.setOwner("ac/me");
  await dialog.confirmOwner();
  expect(dialog.get().ownerError).toBeDefined();
  dialog.setOwner("broken");
  await dialog.confirmOwner();
  expect(dialog.get().list?.status).toBe("failed");
  expect(dialog.get().repos.map((r) => r.repo)).toEqual(["acme/beta-soc"]);
  expect(calls).toEqual(["list (signed in)", "list acme", "list broken"]);
});

test("gh not signed in: the dialog says so and a typed repository can still be cloned", async () => {
  const { deps, calls, started } = fakeDeps({ "": { status: "unavailable", reason: "gh is not signed in to github.com — run `gh auth login`", setup: "gh-signed-out", repos: [] } });
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  await dialog.open();
  dialog.setTyped("acme/beta-soc");
  dialog.addTyped();
  await dialog.submit("clone");
  expect(calls).toEqual(["list (signed in)", "clone acme/beta-soc /w/acme/beta-soc"]);
  expect(started.map((c) => c.repo)).toEqual(["acme/beta-soc"]);
});

test("Clone starts each target once; a refusal stays on its repository; another name goes to another folder", async () => {
  const { deps, calls } = fakeDeps({});
  const dialog = new AddGithubController(deps, ["/w/acme", "/w/other"]);
  expect(dialog.get().root).toBe("");
  dialog.setTyped("acme/beta-soc");
  dialog.addTyped();
  dialog.setTyped("acme/taken");
  dialog.addTyped();
  expect(await dialog.submit("clone")).toBeUndefined(); // no root chosen yet
  dialog.setRoot("/w/acme");
  dialog.rename("acme/beta-soc", "beta-soc-gh");
  await dialog.submit("clone");
  expect(dialog.get().refused["acme/taken"]).toContain("already exists");
  expect(Object.keys(dialog.get().started)).toEqual(["acme/beta-soc"]);
  await dialog.submit("clone");
  expect(calls.filter((c) => c.startsWith("clone"))).toEqual(["clone acme/beta-soc /w/acme/beta-soc-gh", "clone acme/taken /w/acme/taken", "clone acme/taken /w/acme/taken"]);
});

test("collect mode starts nothing and hands the targets back", async () => {
  const { deps, calls } = fakeDeps({});
  const dialog = new AddGithubController(deps, ["/w/acme"]);
  dialog.setTyped("acme/beta-soc");
  dialog.addTyped();
  const targets = await dialog.submit("collect");
  expect(targets?.map((t) => t.path)).toEqual(["/w/acme/beta-soc"]);
  expect(calls).toEqual([]);
});

function body(patch: Partial<AddGithubView> = {}) {
  const calls: string[] = [];
  const actions = new Proxy({} as AddGithubActions, { get: (_t, name) => (...args: unknown[]) => calls.push(`${String(name)} ${args.join(" ")}`.trim()) });
  const view: AddGithubView = {
    owner: "",
    repos: SIGNED_IN.repos,
    list: SIGNED_IN,
    loading: false,
    query: "",
    typed: "",
    chosen: [{ repo: "jdoe/alpha-infra", name: "alpha-infra" }],
    root: "/w/acme",
    submitting: false,
    refused: {},
    started: {},
    mode: "clone",
    roots: ["/w/acme"],
    targets: cloneTargets([{ repo: "jdoe/alpha-infra", name: "alpha-infra" }], "/w/acme"),
    clones: {},
    now: Date.parse("2026-10-10T10:00:00Z"),
    ...patch,
  };
  return { node: AddGithubBody({ view, actions }), calls };
}

test("the dialog lists repositories with their marks, the target path and Clone", () => {
  const { node, calls } = body();
  const text = textOf(node);
  expect(text).toContain("jdoe/demo-ops");
  expect(text).toContain("already added");
  expect(text).toContain("/w/acme/alpha-infra");
  const boxes = byTag(node, "input").filter((i) => i.props.type === "checkbox");
  expect(boxes.map((b) => [b.props["aria-label"], b.props.disabled])).toEqual([
    ["jdoe/demo-ops, already added", true],
    ["Clone jdoe/alpha-infra", false],
  ]);
  const submit = byTag(node, "button").find((b) => b.props.type === "submit");
  expect(textOf(submit)).toBe("Clone 1");
  expect(submit?.props.disabled).toBe(false);
  const cancel = byTag(node, "button").find((b) => textOf(b) === "Cancel");
  press(cancel);
  expect(calls).toEqual(["close"]);
});

test("a bad folder name blocks Clone; collect mode says Add; outcomes show per repository", () => {
  const bad = body({ chosen: [{ repo: "jdoe/alpha-infra", name: "../x" }], targets: cloneTargets([{ repo: "jdoe/alpha-infra", name: "../x" }], "/w/acme") });
  expect(byTag(bad.node, "button").find((b) => b.props.type === "submit")?.props.disabled).toBe(true);
  expect(textOf(byTag(body({ mode: "collect" }).node, "button").find((b) => b.props.type === "submit"))).toBe("Add 1");
  const done = body({ started: { "jdoe/alpha-infra": "c1" }, clones: { "jdoe/alpha-infra": clone({ id: "c1", repo: "jdoe/alpha-infra", state: "integratable" }) } });
  expect(textOf(done.node)).toContain("cloned without OpenSpec");
  expect(textOf(done.node)).toContain("Integrate it under Unmanaged projects");
  expect(byTag(done.node, "button").find((b) => b.props.type === "submit")).toBeUndefined();
});

test("the default timers work where setTimeout must not be called as another object's method, as in a browser", async () => {
  const real = globalThis.setTimeout;
  // Like a browser's: refuses any `this` but the global object.
  const strict = function (this: unknown, fn: () => void, ms?: number) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return real(fn, ms);
  };
  globalThis.setTimeout = strict as unknown as typeof setTimeout;
  try {
    let asked = 0;
    const store = createGithubClonesStore(async () => {
      asked++;
      return { clones: [clone({ id: "c1", state: asked < 2 ? "cloning" : "tracked" })], gitAvailable: true };
    }, undefined, 5);
    await store.refresh();
    await Bun.sleep(40);
    expect(asked).toBe(2);
    expect(store.get().clones[0].state).toBe("tracked");
  } finally {
    globalThis.setTimeout = real;
  }
});

test("a clone started while a poll is on its way is asked about again, so it keeps being polled", async () => {
  const { timers, pending } = manualTimers();
  let release: (value: GithubClonesResponse) => void = () => {};
  let asked = 0;
  const store = createGithubClonesStore(() => {
    asked++;
    if (asked === 1) return new Promise((resolve) => (release = resolve));
    return Promise.resolve({ clones: [clone({ id: "c2", state: "cloning" })], gitAvailable: true });
  }, timers);
  const first = store.refresh();
  const started = store.started(clone({ id: "c2", state: "cloning" }));
  // The older answer does not know c2 yet.
  release({ clones: [], gitAvailable: true });
  await first;
  await started;
  expect(asked).toBe(2);
  expect(store.get().clones.map((c) => c.id)).toEqual(["c2"]);
  expect(pending).toHaveLength(1);
});
