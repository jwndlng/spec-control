import { expect, test } from "bun:test";
import { menuActions, type NextStep, type PullRequestStep, recommendedAction, waitingLabel } from "../src/shared/nextStep.ts";
import { availableActions, type ChangeSnapshot, type PullRequest, type SessionAction } from "../src/shared/types.ts";

const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 58,
  title: "Rotate keys",
  url: "https://github.com/acme/demo-ops/pull/58",
  author: "someone",
  head: "feat/rotate-keys",
  base: "main",
  draft: false,
  state: "open",
  createdAt: "2026-10-01T10:00:00Z",
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "passing",
  mergeable: "mergeable",
  ...patch,
});
type Change = Pick<ChangeSnapshot, "stage" | "subState" | "archived" | "artifacts" | "blocked">;
const optional = (design: "done" | "ready") => [{ id: "proposal", status: "done" as const, required: true }, { id: "tasks", status: "done" as const, required: true }, { id: "design", status: design, required: false }];
const change = (patch: Partial<Change>): Change => ({ stage: "ready", artifacts: optional("done"), ...patch });
/** The split button as a card would show it, with every starter's prompt configured. */
const split = (c: Change, link?: PullRequest, actions: readonly SessionAction[] = availableActions(c)) => {
  const main = recommendedAction(c, actions, link);
  return { main, menu: menuActions(c, actions, link, main) };
};
const start = (action: SessionAction): NextStep => ({ kind: "start", action });
const step = (s: PullRequestStep): NextStep => ({ kind: "pullRequest", step: s });

test("without a pull request, each stage recommends its primary step and the menu holds the rest in order", () => {
  expect(split(change({ stage: "unknown", artifacts: [] }))).toEqual({ main: start("draft"), menu: [start("fastForward")] });
  expect(split(change({ stage: "backlog", artifacts: optional("ready") }))).toEqual({ main: start("draft"), menu: [start("fastForward")] });
  expect(split(change({ stage: "drafts", artifacts: optional("ready") }))).toEqual({ main: start("draft"), menu: [start("fastForward")] });
  // Ready with an optional design missing: Implement, Draft in the menu.
  expect(split(change({ stage: "ready", artifacts: optional("ready") }))).toEqual({ main: start("implement"), menu: [start("draft")] });
  expect(split(change({ stage: "ready" }))).toEqual({ main: start("implement"), menu: [] });
  expect(split(change({ stage: "implementing", artifacts: optional("ready") }))).toEqual({ main: start("implement"), menu: [] });
  expect(split(change({ stage: "done", subState: "validate" }))).toEqual({ main: start("validate"), menu: [start("archive")] });
  expect(split(change({ stage: "done", artifacts: optional("ready") }))).toEqual({ main: start("archive"), menu: [] });
  expect(split(change({ stage: "done", subState: "complete" }))).toEqual({ main: start("archive"), menu: [] });
});

test("a step that is not available falls back to the next in menu order, or to nothing", () => {
  // Blocked: Implement is withheld, Draft for the design is what is left.
  expect(split(change({ stage: "ready", artifacts: optional("ready"), blocked: true }))).toEqual({ main: start("draft"), menu: [] });
  expect(split(change({ stage: "implementing", blocked: true }))).toEqual({ main: undefined, menu: [] });
  // The agent has no Validate prompt: Archive is recommended.
  expect(split(change({ stage: "done", subState: "validate" }), undefined, ["archive"])).toEqual({ main: start("archive"), menu: [] });
  // No Draft prompt: Fast-forward is all there is.
  expect(split(change({ stage: "backlog", artifacts: optional("ready") }), undefined, ["fastForward"])).toEqual({ main: start("fastForward"), menu: [] });
  expect(split(change({ stage: "backlog" }), undefined, [])).toEqual({ main: undefined, menu: [] });
});

test("an open pull request decides by its readiness, and the menu keeps every starter", () => {
  const implementing = change({ stage: "implementing" });
  const done = change({ stage: "done" });
  expect(split(implementing, pr({ mergeable: "conflicting" }))).toEqual({ main: step("resolveConflicts"), menu: [start("implement")] });
  expect(split(done, pr())).toEqual({ main: step("merge"), menu: [start("archive")] });
  expect(split(implementing, pr({ checks: "failing" }))).toEqual({ main: start("implement"), menu: [] });
  // In Done Implement is not available: Fix checks opens the session's console.
  expect(split(done, pr({ checks: "failing" }))).toEqual({ main: step("fixChecks"), menu: [start("archive")] });
  expect(split(done, pr({ checks: "pending" }))).toEqual({ main: { kind: "waiting", reason: "checks running" }, menu: [start("archive")] });
  expect(split(implementing, pr({ draft: true }))).toEqual({ main: { kind: "waiting", reason: "draft" }, menu: [start("implement")] });
  expect(split(implementing, pr({ mergeable: "unknown" }))).toEqual({ main: { kind: "waiting", reason: "mergeability unknown" }, menu: [start("implement")] });
  // Ready to merge while a Ready change's design could still be drafted: both starters stay in the menu.
  expect(split(change({ stage: "ready", artifacts: optional("ready") }), pr())).toEqual({ main: step("merge"), menu: [start("draft"), start("implement")] });
  expect(waitingLabel("checks running")).toBe("Waiting: checks running");
  expect(waitingLabel("draft")).toBe("Waiting: draft pull request");
  expect(waitingLabel("mergeability unknown")).toBe("Waiting: mergeability unknown");
});

test("a merged or closed pull request, no link and an archived change give the stage's step back", () => {
  const done = change({ stage: "done" });
  expect(split(done, pr({ state: "merged", mergedAt: "2026-10-02T10:00:00Z" }))).toEqual({ main: start("archive"), menu: [] });
  expect(split(done, pr({ state: "closed", closedAt: "2026-10-02T10:00:00Z" }))).toEqual({ main: start("archive"), menu: [] });
  expect(split(done)).toEqual({ main: start("archive"), menu: [] });
  // Archived: nothing is available, and an open archive pull request recommends nothing on its own.
  expect(split(change({ stage: "archived", archived: "2026-10-03" }), pr({ head: "chore/archive-rotate-keys" }))).toEqual({ main: undefined, menu: [] });
});

test("the pull request never changes the available actions", () => {
  const done = change({ stage: "done", subState: "validate" });
  const before = availableActions(done);
  for (const link of [pr(), pr({ checks: "failing" }), pr({ checks: "pending" }), pr({ mergeable: "conflicting" })]) {
    const { main, menu } = split(done, link);
    const starters = [main, ...menu].flatMap((s) => (s?.kind === "start" ? [s.action] : []));
    expect(starters.sort()).toEqual([...before].sort());
  }
});
