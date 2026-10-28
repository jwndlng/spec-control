// The Merge action and what the panel and the card say about it (agent-merges-docs-prs 5.2): pure helpers, the card as
// rendered, and the panel's source, which uses hooks and so is read rather than rendered.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSession, ChangeSnapshot, PullRequest, RepoPullRequests, RepoSnapshot } from "../src/shared/types.ts";
import { boardCards, type Card, ChangeCard } from "../src/ui/kanban.tsx";
import { cardMergePending, mergeControl, mergeNotice, RESUME_TO_MERGE, sessionPullRequest } from "../src/ui/sessionState.ts";
import { byTag, textOf } from "./vnode.ts";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const HEAD = "c0ffee1234567000000000000000000000000088";
const BRANCH = "archive-rotate-keys";

const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 88, title: "archive rotate-keys", url: "https://github.com/acme/demo-ops/pull/88", author: "octo", head: BRANCH, base: "main", draft: false, state: "open",
  createdAt: new Date(NOW - 3600_000).toISOString(), review: "none", reviewRequestedFromViewer: false, checks: "passing", mergeable: "mergeable", headOid: HEAD, docsOnly: true, ...patch,
});
const lists = (...prs: PullRequest[]): RepoPullRequests[] => [{ repoId: "demo", github: "acme/demo-ops", status: "ok", fetchedAt: new Date(NOW).toISOString(), pullRequests: prs }];
const session = (patch: Partial<ChangeSession> = {}): ChangeSession => ({
  id: "s1", repoId: "demo", change: "rotate-keys", action: "archive", agentId: "fake", agentName: "Fake Agent", state: "running", worktreePath: "/w/acme/x", branch: BRANCH,
  createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), resumable: true, ...patch,
});

test("the session's pull request is the open one of its branch in its repository's list", () => {
  expect(sessionPullRequest(session(), lists(pr()))?.number).toBe(88);
  expect(sessionPullRequest(session(), lists(pr({ state: "merged" })))).toBeUndefined();
  expect(sessionPullRequest(session(), lists(pr({ head: "feat/other" })))).toBeUndefined();
  expect(sessionPullRequest(session({ repoId: "other" }), lists(pr()))).toBeUndefined();
  expect(sessionPullRequest(session({ inPlace: true, branch: undefined }), lists(pr()))).toBeUndefined();
});

test("Merge is enabled for a running session with a ready pull request and a head commit, and says why otherwise", () => {
  expect(mergeControl(session(), lists(pr()))).toMatchObject({ enabled: true, title: expect.stringContaining("#88, only if its head is still c0ffee1") });
  // With or without docs auto-merge, and with no checks at all: the manual action follows readiness.
  expect(mergeControl(session(), lists(pr({ docsOnly: undefined, checks: "none" })))?.enabled).toBe(true);
  expect(mergeControl(session(), lists(pr({ checks: "pending" })))).toMatchObject({ enabled: false, title: expect.stringContaining("checks are still running") });
  expect(mergeControl(session(), lists(pr({ mergeable: "conflicting" })))).toMatchObject({ enabled: false, title: expect.stringContaining("conflicts") });
  expect(mergeControl(session(), lists(pr({ headOid: undefined })))).toMatchObject({ enabled: false, title: expect.stringContaining("no head commit") });
  expect(mergeControl(session({ state: "exited" }), lists(pr()))).toMatchObject({ enabled: false, title: RESUME_TO_MERGE });
  // No open pull request: no Merge at all.
  expect(mergeControl(session(), lists())).toBeUndefined();
  expect(mergeControl(undefined, lists(pr()))).toBeUndefined();
});

test("while a Merge prompt for the current head is pending the panel says so; typed but not sent is said too", () => {
  const asked = { pr: 88, head: HEAD, at: new Date(NOW).toISOString(), submitted: true, by: "dashboard" as const };
  expect(mergeNotice(session({ mergeAsked: asked }), pr())).toEqual({ text: "Asked the agent to merge #88 at c0ffee1.", title: HEAD, tone: "info" });
  expect(mergeNotice(session({ mergeAsked: { ...asked, submitted: false } }), pr())).toEqual({
    text: "The Merge prompt for #88 was typed but not sent. Press Enter in the terminal to send it.",
    tone: "warn",
  });
  // Merged, closed or moved on: no longer pending.
  expect(mergeNotice(session({ mergeAsked: asked }), pr({ headOid: "c0ffee1234567000000000000000000000000089" }))).toBeUndefined();
  expect(mergeNotice(session({ mergeAsked: asked }), pr({ state: "merged" }))).toBeUndefined();
  expect(mergeNotice(session({ mergeAsked: asked }), undefined)).toBeUndefined();
  expect(mergeNotice(session(), pr())).toBeUndefined();
});

test("the card says the agent was asked to merge #88 while it is pending, and nothing otherwise", () => {
  const asked = { pr: 88, head: HEAD, at: new Date(NOW).toISOString(), submitted: true, by: "dashboard" as const };
  const sessions = [session({ mergeAsked: asked })];
  const change: ChangeSnapshot = { repoId: "demo", name: "rotate-keys", schema: "spec-driven", artifacts: [], tasks: { done: 3, total: 3 }, lastActivityAt: new Date(NOW).toISOString(), branchMatch: BRANCH, stage: "done", column: "Done" };
  const repo: RepoSnapshot = { id: "demo", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: new Date(NOW).toISOString(), isGit: true, worktrees: [], changes: [change] };
  const card: Card = boardCards([repo], new Map([["demo", 120]]), { repos: lists(pr()) })[0];
  const merging = cardMergePending(sessions, card, card.pullRequest);
  expect(merging).toBe("asked the agent to merge #88");
  const link = byTag(ChangeCard({ card, now: NOW, from: "/board", merging }), "a").find((a) => String(a.props.class ?? "").includes("card-pr"));
  expect(textOf(link).replace(/\s+/g, " ")).toContain("asked the agent to merge #88");
  expect(cardMergePending(sessions, card, pr({ state: "merged" }))).toBeUndefined();
  expect(cardMergePending(sessions, { repoId: "demo", name: "other" }, card.pullRequest)).toBeUndefined();
  const plain = byTag(ChangeCard({ card, now: NOW, from: "/board" }), "a").find((a) => String(a.props.class ?? "").includes("card-pr"));
  expect(textOf(plain)).not.toContain("merge");
});

test("the panel offers Merge from the helpers, posts to the session's merge route, and shows the pending wording", () => {
  const panel = readFileSync(join(import.meta.dir, "..", "src", "ui", "sessionPanel.tsx"), "utf8");
  expect(panel).toContain("mergeControl(session, prs.data?.repos, handedOverProposal(session, ui.sessions, ui.worktrees))");
  expect(panel).toContain("disabled={!merge.enabled || acting}");
  expect(panel).toContain("api.mergeSession(session.id)");
  expect(panel).toContain("mergeNotice(merge?.recordedOn ?? session, merge?.pr)");
  expect(panel).toContain("RESUME_TO_MERGE");
  const client = readFileSync(join(import.meta.dir, "..", "src", "ui", "api.ts"), "utf8");
  // No body: the number and the head commit come from the server's own list.
  const route = ["mergeSession: (id) => call<PromptResult>(`/api/sessions/", "$", "{id}/merge`, { method: \"POST\" })"].join("");
  expect(client).toContain(route);
});
