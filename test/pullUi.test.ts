import { expect, test } from "bun:test";
import type { PullBlockingFile, PullResult } from "../src/shared/types.ts";
import { BlockedPullModal, FetchNoteBadge, PullBlockedList } from "../src/ui/pull.tsx";
import { Modal } from "../src/ui/modal.tsx";
import { blockingNote, branchNotice, fetchNote, pullNeedsReport, pullOutcome, resolveSummary, shownPullResult } from "../src/ui/pullState.ts";
import { byComponent, byTag, textOf } from "./vnode.ts";

const result = (patch: Partial<PullResult>): PullResult => ({ repoId: "r", fetched: true, update: "up-to-date", branch: "main", upstream: "origin/main", defaultBranch: "main", ...patch });

test("every outcome reads as text, with the reason available", () => {
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 3 }))).toMatchObject({ label: "+3 commits", tone: "success" });
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 1 })).label).toBe("+1 commit");
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 2, hooksSkipped: true })).detail).toContain("post-merge hook was not run");
  expect(pullOutcome(result({}))).toMatchObject({ label: "up to date", tone: "" });
  expect(pullOutcome(result({ update: "skipped", reason: "on feat/redesign, not main; only fetched" }))).toEqual({ label: "fetched only", tone: "warning", detail: "Fetched, but the checkout was not updated: on feat/redesign, not main; only fetched." });
  expect(pullOutcome(result({ fetched: false, update: "skipped", reason: "no remote configured; there is nothing to pull" }))).toMatchObject({ label: "nothing to pull", tone: "" });
  expect(pullOutcome(result({ update: "refused", reason: "local and remote have diverged (1 ahead, 2 behind)" }))).toMatchObject({ label: "refused", tone: "warning" });
  expect(pullOutcome(result({ fetched: false, update: "failed", reason: "Could not read from remote repository." })).detail).toBe("Could not fetch: Could not read from remote repository.");
  expect(pullOutcome(result({ fetched: false, update: "failed", reason: "timed out" }))).toEqual({ label: "failed", tone: "danger", detail: "Could not fetch: timed out." });
});

test("an outcome that left the checkout behind is reported, the rest only badged", () => {
  // stated: the pull was asked for to bring the checkout up to date and it did not
  expect(pullNeedsReport(result({ update: "skipped", reason: "on feat/redesign, not main; only fetched" }))).toBe(true);
  expect(pullNeedsReport(result({ update: "refused", reason: "local and remote have diverged (1 ahead, 2 behind)" }))).toBe(true);
  expect(pullNeedsReport(result({ fetched: false, update: "failed", reason: "timed out" }))).toBe(true);
  // nothing to say: the checkout is as current as the remote can make it
  expect(pullNeedsReport(result({ update: "fast-forwarded", commits: 3 }))).toBe(false);
  expect(pullNeedsReport(result({}))).toBe(false);
  expect(pullNeedsReport(result({ fetched: false, update: "skipped", reason: "no remote configured; there is nothing to pull" }))).toBe(false);
});

test("the notice appears only off a known default branch, and says what it means", () => {
  expect(branchNotice({ currentBranch: "main", defaultBranch: "main", onDefaultBranch: true })).toBeUndefined();
  expect(branchNotice({ currentBranch: "develop" })).toBeUndefined(); // nobody knows the default branch: claim nothing
  expect(branchNotice({ currentBranch: "develop", onDefaultBranch: false })).toBeUndefined();
  const off = branchNotice({ currentBranch: "feat/redesign-settings-page", defaultBranch: "main", onDefaultBranch: false });
  expect(off?.short).toBe("on feat/redesign-settings-page, not main");
  expect(off?.long).toContain("Archived changes, specs and progress shown for this repository come from that branch and may be outdated");
  expect(off?.long).toContain("Changes that live in worktrees are read from their own checkouts and are not affected");
  expect(branchNotice({ defaultBranch: "trunk", onDefaultBranch: false })?.short).toBe("on a detached HEAD, not trunk");
});

const leftover = (path: string, differs = false): PullBlockingFile => ({ path, kind: "leftover", differs, incoming: "a".repeat(40), worktree: differs ? "b".repeat(40) : "a".repeat(40) });
const work = (path: string): PullBlockingFile => ({ path, kind: "local-work" });
const yaml = "openspec/changes/add-login/.openspec.yaml";
const prompt = "openspec/changes/add-login/prompt.md";

test("a blocked pull is told apart from any other refusal, and the file count is in the detail", () => {
  const leftovers = pullOutcome(result({ update: "refused", reason: "Entry not uptodate", blocking: [leftover(yaml), leftover(prompt, true)], resolvable: { upstream: "c".repeat(40), files: [leftover(yaml)] } }));
  expect(leftovers).toMatchObject({ label: "blocked by leftovers", tone: "warning" });
  expect(leftovers.detail).toContain("2 uncommitted files the incoming commits also change");
  expect(leftovers.detail).toContain("Resolve and pull can replace them");

  const mixed = pullOutcome(result({ update: "refused", reason: "Your local changes would be overwritten", blocking: [work("src/app.ts"), leftover(yaml)] }));
  expect(mixed).toMatchObject({ label: "blocked", tone: "warning" });
  expect(mixed.detail).toContain("2 uncommitted files");
  expect(mixed.detail).toContain("Your local changes would be overwritten");

  expect(pullOutcome(result({ update: "refused", reason: "Entry not uptodate", blocking: [leftover(yaml)] })).detail).toContain("1 uncommitted file the");
  // a resolve never fetches, so its refusal must not say it did
  expect(pullOutcome(result({ fetched: false, update: "refused", reason: "the upstream moved on", blocking: [leftover(yaml)] })).detail).toStartWith("The checkout was left as it is:");
  // an outcome with no blocking files reads exactly as it did before
  expect(pullOutcome(result({ update: "refused", reason: "local and remote have diverged (1 ahead, 2 behind)" }))).toMatchObject({ label: "refused", detail: "Fetched, but the checkout was left as it is: local and remote have diverged (1 ahead, 2 behind)." });
  // every blocked refusal still has to be put in front of the user
  expect([true, true]).toEqual([pullNeedsReport(result({ update: "refused", blocking: [leftover(yaml)] })), pullNeedsReport(result({ fetched: false, update: "refused", blocking: [work("x")] }))]);
});

test("a fast-forward that replaced leftovers says so", () => {
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 1, resolved: [{ path: yaml }] })).detail).toContain("1 leftover file was replaced with the incoming version");
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 2, resolved: [{ path: yaml }, { path: prompt, copy: "/h/pull-backups/x/t/prompt.md" }] })).detail).toContain("2 leftover files were replaced");
  expect(pullOutcome(result({ update: "fast-forwarded", commits: 2 })).detail).not.toContain("replaced");
});

test("each blocking file says what it is, and the confirmation says what it will do", () => {
  expect(blockingNote(leftover(yaml))).toBe("leftover, the same as the incoming version");
  expect(blockingNote(leftover(prompt, true))).toBe("leftover, differs from the incoming version — a copy will be kept");
  expect(blockingNote(work("src/app.ts"))).toBe("your own uncommitted work — it is never touched");

  expect(resolveSummary([leftover(yaml)])).toBe("Replaces 1 file with the version the incoming commits bring, then fast-forwards. Nothing differs, so no copy is needed.");
  const two = resolveSummary([leftover(yaml), leftover(prompt, true)]);
  expect(two).toContain("Replaces 2 files with the version the incoming commits bring");
  expect(two).toContain("1 file differs; a copy of each is saved under ~/.spec-control/ first.");
  expect(resolveSummary([leftover(yaml, true), leftover(prompt, true)])).toContain("2 files differ;");
});

test("the blocked list shows every file and offers the resolution exactly once", () => {
  const claim = { upstream: "c".repeat(40), files: [leftover(yaml), leftover(prompt, true)] };
  const view = PullBlockedList({ result: result({ update: "refused", reason: "Entry not uptodate", blocking: claim.files, resolvable: claim, hint: "Resolve and pull replaces them." }), running: false, onResolve: () => {} });
  const text = textOf(view);
  expect(text).toContain(yaml);
  expect(text).toContain(prompt);
  expect(text).toContain("leftover, the same as the incoming version");
  expect(text).toContain("leftover, differs from the incoming version — a copy will be kept");
  expect(text).toContain("Resolve and pull replaces them.");
  expect(text).toContain("Replaces 2 files with the version the incoming commits bring");
  const buttons = byTag(view, "button");
  expect(buttons).toHaveLength(1);
  expect(textOf(buttons[0])).toBe("Resolve and pull");
  expect(buttons[0].props.disabled).toBe(false);

  // the confirmation is what the offer said: the button hands back that claim unchanged
  let handed: unknown;
  const armed = PullBlockedList({ result: result({ update: "refused", blocking: claim.files, resolvable: claim }), running: false, onResolve: (c) => { handed = c; } });
  (byTag(armed, "button")[0].props.onClick as () => void)();
  expect(handed).toBe(claim);
});

test("local work among the blocking files is shown but never offered, and a running resolve disables the button", () => {
  const mixed = PullBlockedList({ result: result({ update: "refused", reason: "would be overwritten", blocking: [work("src/app.ts"), leftover(yaml)], hint: "Commit or set aside the listed files, then pull again." }), running: false, onResolve: () => {} });
  expect(textOf(mixed)).toContain("your own uncommitted work — it is never touched");
  expect(textOf(mixed)).toContain("Commit or set aside the listed files");
  expect(byTag(mixed, "button")).toHaveLength(0); // nothing to confirm

  const claim = { upstream: "c".repeat(40), files: [leftover(yaml)] };
  const busy = PullBlockedList({ result: result({ update: "refused", blocking: claim.files, resolvable: claim }), running: true, onResolve: () => {} });
  expect(byTag(busy, "button")[0].props.disabled).toBe(true);
  expect(textOf(byTag(busy, "button")[0])).toBe("Resolving…");
});

test("once resolved the same list becomes the outcome: what was replaced, and where the copies are", () => {
  const copy = "/home/demo/.spec-control/pull-backups/r/2026-02-14T09-41-08-317Z/openspec/changes/add-login/prompt.md";
  const done = PullBlockedList({ result: result({ fetched: false, update: "fast-forwarded", commits: 2, resolved: [{ path: yaml }, { path: prompt, copy }] }), running: false, onResolve: () => {} });
  const text = textOf(done);
  expect(text).toContain("2 leftover files were replaced with the incoming version");
  expect(text).toContain(yaml);
  expect(text).toContain(prompt);
  expect(text).toContain(copy);
  expect(text).toContain("A copy of the version that was here is kept at");
  expect(byTag(done, "button")).toHaveLength(0); // nothing left to confirm

  const noCopies = PullBlockedList({ result: result({ fetched: false, update: "fast-forwarded", commits: 1, resolved: [{ path: yaml }] }), running: false, onResolve: () => {} });
  expect(textOf(noCopies)).not.toContain("kept at");
});

test("the fetch note says when the repository was last fetched, how often it is fetched, and when an automatic fetch failed", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  // nothing without a remote, or for a folder without git (which has no `hasRemote`)
  expect(fetchNote({ hasRemote: false, lastFetchedAt: ago(4) }, now)).toBeUndefined();
  expect(fetchNote({}, now)).toBeUndefined();

  expect(fetchNote({ hasRemote: true }, now)).toMatchObject({ label: "never fetched", tone: "" });
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(0.2) }, now)?.label).toBe("fetched just now");
  const recent = fetchNote({ hasRemote: true, lastFetchedAt: ago(4), autoFetchSeconds: 900 }, now);
  expect(recent).toMatchObject({ label: "fetched 4m ago", tone: "" });
  expect(recent?.detail).toContain(new Date(ago(4)).toLocaleString());
  expect(recent?.detail).toContain("every 15 minutes");
  expect(recent?.detail).toContain("only updated by Pull");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(4), autoFetchSeconds: 3600 }, now)?.detail).toContain("every hour");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(4), autoFetchSeconds: 60 }, now)?.detail).toContain("every minute");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(4), autoFetchSeconds: 15 }, now)?.detail).toContain("every 15 seconds");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(4) }, now)?.detail).not.toContain("automatically");

  // a failure shows, as text and not only as a colour, with its reason — until something fetched after it
  const failed = fetchNote({ hasRemote: true, lastFetchedAt: ago(20), autoFetch: { at: ago(5), ok: false, reason: "Could not resolve host: git.example.invalid." }, autoFetchSeconds: 300 }, now);
  expect(failed).toMatchObject({ label: "⚠ auto fetch failed", tone: "warning" });
  expect(failed?.detail).toContain("failed: Could not resolve host: git.example.invalid.");
  expect(failed?.detail).toContain("can be switched off in the project's settings");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(1), autoFetch: { at: ago(5), ok: false, reason: "timed out" } }, now)?.label).toBe("fetched 1m ago");
  expect(fetchNote({ hasRemote: true, lastFetchedAt: ago(5), autoFetch: { at: ago(5), ok: true } }, now)?.label).toBe("fetched 5m ago");

  // the badge carries the label and puts the detail in its tooltip
  const badge = FetchNoteBadge({ input: { hasRemote: true, lastFetchedAt: ago(4) }, now });
  expect(textOf(badge as never)).toBe("fetched 4m ago");
  expect(FetchNoteBadge({ input: { hasRemote: false }, now })).toBeNull();
});

/** The Blocked pull modal as the Pull control renders it for a repository state, and the list inside it. */
function blockedModal(state: "running" | PullResult | undefined, last: PullResult | undefined) {
  const tree = BlockedPullModal({ repoId: "demo-ops", result: shownPullResult(state, last), running: state === "running", onClose: () => {}, onResolve: () => {} });
  const [modal] = byComponent(tree, Modal); // Modal uses hooks: a leaf whose children are the list
  return { modal, list: modal && (modal.props.children as { props: Parameters<typeof PullBlockedList>[0] }).props };
}

test("the Blocked pull modal stays open while Resolve and pull runs, then shows the new outcome", () => {
  const claim = { upstream: "c".repeat(40), files: [leftover(yaml), leftover(prompt, true)] };
  const refused = result({ update: "refused", reason: "Entry not uptodate", blocking: claim.files, resolvable: claim });

  const before = blockedModal(refused, refused);
  expect(before.modal?.props.title).toBe("Blocked pull");
  expect(textOf(byTag(PullBlockedList(before.list), "button")[0])).toBe("Resolve and pull");

  // Resolve and pull confirmed: the repository's pull is running and there is no new outcome yet.
  const during = blockedModal("running", refused);
  expect(during.modal).toBeDefined();
  expect(during.list.result).toBe(refused);
  const [button] = byTag(PullBlockedList(during.list), "button");
  expect(button.props.disabled).toBe(true);
  expect(textOf(button)).toBe("Resolving…");
  expect(textOf(PullBlockedList(during.list))).toContain(yaml);

  // Finished: the fast-forward and the files it replaced.
  const resolved = result({ fetched: false, update: "fast-forwarded", commits: 2, resolved: [{ path: yaml }, { path: prompt, copy: "/h/pull-backups/demo-ops/t/prompt.md" }] });
  const after = blockedModal(resolved, resolved);
  expect(after.list.running).toBe(false);
  expect(textOf(PullBlockedList(after.list))).toContain("2 leftover files were replaced");

  // Nothing to show before any outcome, running or not.
  expect(shownPullResult(undefined, undefined)).toBeUndefined();
  expect(BlockedPullModal({ repoId: "demo-ops", result: shownPullResult("running", undefined), running: true, onClose: () => {}, onResolve: () => {} })).toBeNull();
});
