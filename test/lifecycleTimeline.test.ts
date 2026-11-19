import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { h, render, type ComponentChildren } from "preact";
import type { ChangeArtifactEntry, ChangeSnapshot, PullRequest } from "../src/shared/types.ts";
import type { LifecycleDeliveryView } from "../src/ui/api.ts";
import { LifecycleTimeline, lifecycleTimelineModel } from "../src/ui/lifecycleTimeline.tsx";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";

const change = (overrides: Partial<ChangeSnapshot> = {}) => ({
  stage: "drafts", artifacts: [], tasks: null, ...overrides,
}) as ChangeSnapshot;
const artifact = (id: string, status: ChangeArtifactEntry["status"]): ChangeArtifactEntry => ({ id, status, files: [] });
const delivery = (overrides: Partial<LifecycleDeliveryView> = {}): LifecycleDeliveryView => ({
  id: "delivery-1", phase: "implementation", revision: 1, state: "pending", recovery: [], attempts: 1, updatedAt: "2026-11-16T12:00:00Z", ...overrides,
});
const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 42, title: "Implement the change", url: "https://github.com/example/repo/pull/42", author: "agent", head: "impl-example", base: "main", draft: false,
  state: "open", createdAt: "2026-11-16T12:00:00Z", review: "none", reviewRequestedFromViewer: false, checks: "passing", mergeable: "mergeable", ...overrides,
});
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let browser: Window | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  browser = undefined;
  root = undefined;
});

function mount(node: ComponentChildren) {
  if (root) render(null, root);
  browser?.happyDOM.abort();
  browser = new Window({ url: "http://localhost/change" });
  globalThis.window = browser as unknown as typeof window;
  globalThis.document = browser.document as unknown as Document;
  root = document.createElement("div");
  document.body.append(root);
  render(node, root);
  return root;
}

describe("lifecycleTimelineModel", () => {
  test("uses schema artifact names and does not fabricate missing evidence", () => {
    const model = lifecycleTimelineModel(change(), [artifact("overview", "done"), artifact("quality-gate", "blocked")], []);
    expect(model.current).toBe("Drafts");
    expect(model.actionPhase).toBe("Ready");
    expect(model.phases.find((phase) => phase.label === "Drafts")?.state).toBe("current");
    expect(model.phases.find((phase) => phase.label === "Ready")?.state).toBe("next");
    expect(model.phases.find((phase) => phase.label === "Archived")?.state).toBe("upcoming");
    expect(model.artifacts).toEqual([
      { id: "overview", label: "Overview", status: "done" },
      { id: "quality-gate", label: "Quality gate", status: "blocked" },
    ]);
    expect(model.validation).toBeUndefined();
    expect(model.persistence).toEqual([]);
  });

  test("shows validation and local progress only when snapshot evidence exists", () => {
    const model = lifecycleTimelineModel(change({ stage: "done", subState: "validate", tasks: { done: 2, awaiting: 1, total: 4 } }), [], []);
    expect(model.current).toBe("Done");
    expect(model.actionPhase).toBe("Done");
    expect(model.validation).toBe("Validation awaiting confirmation");
    expect(model.localProgress).toBe("2/4 tasks complete · 1 awaiting confirmation");
  });

  test("places the segmented draft progress and implementation task meter inside their timeline phases", () => {
    const drafts = lifecycleTimelineModel(change({ stage: "drafts" }), [artifact("proposal", "done"), artifact("design", "ready")], []);
    expect(drafts.artifactProgress).toEqual({ done: 1, total: 2 });
    const draftView = mount(h(LifecycleTimeline, { model: drafts }));
    expect(draftView.querySelectorAll(".lifecycle-artifact-segment")).toHaveLength(2);
    expect(draftView.querySelector(".lifecycle-artifact-dot.done .lifecycle-artifact-segment")).not.toBeNull();
    expect(draftView.querySelector(".lifecycle-artifact-dot.ready .lifecycle-artifact-segment")).not.toBeNull();
    expect(draftView.querySelector(".lifecycle-phase.current")?.getAttribute("style")).toContain("grid-column: 2");
    expect(draftView.querySelector('.lifecycle-pr-checkpoint[aria-label^="Drafts pull request"]')?.getAttribute("style")).toContain("grid-column: 3");

    const implementing = lifecycleTimelineModel(change({ stage: "implementing", tasks: { done: 2, awaiting: 1, total: 4 } }), [], []);
    expect(implementing.taskProgress).toEqual({ done: 2, awaiting: 1, total: 4 });
    const implementationView = mount(h(LifecycleTimeline, { model: implementing }));
    expect(implementationView.querySelector(".lifecycle-phase.current .meter")?.getAttribute("aria-label")).toBe("2 of 4 tasks complete, 1 needs the user, 1 open");
  });

  test("keeps optional Draft artifacts under Drafts and Implement under Implementing", () => {
    const model = lifecycleTimelineModel(change({ stage: "ready" }), [{ ...artifact("design", "ready"), required: false }], []);
    expect(model.actionPhase).toBe("Implementing");
    expect(model.draftActionPhase).toBe("Drafts");
    const view = mount(h(LifecycleTimeline, {
      model,
      children: h("button", {}, "Implement"),
      draftChildren: h("button", {}, "Draft artifacts"),
    }));
    expect(view.querySelector(".lifecycle-phase.next .lifecycle-phase-action")?.textContent).toContain("Implement");
    expect(view.querySelector(".lifecycle-phase.complete .lifecycle-phase-action")?.textContent).toContain("Draft artifacts");
  });

  test("labels pending pull-request delivery and archived local state separately", () => {
    const model = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-16" }), [], [delivery({ phase: "archive", pullRequestNumber: 42 })]);
    expect(model.current).toBe("Archived");
    expect(model.phases.at(-1)?.state).toBe("current");
    expect(model.persistence).toEqual([{ id: "delivery-1", label: "Archive delivery: Pending", pullRequestNumber: 42, pullRequestUrl: undefined }]);
  });

  test("shows Ship and live PR readiness at the delivery checkpoint", () => {
    const done = change({ stage: "done" });
    expect(lifecycleTimelineModel(done, [], []).pullRequest.state).toBe("unshipped");
    expect(lifecycleTimelineModel(done, [], [delivery({ state: "pushing" })]).pullRequest.state).toBe("shipping");
    expect(lifecycleTimelineModel(done, [], [], pullRequest({ checks: "pending" })).pullRequest.state).toBe("checking");
    expect(lifecycleTimelineModel(done, [], [], pullRequest({ mergeable: "conflicting" })).pullRequest.state).toBe("conflicts");
    expect(lifecycleTimelineModel(done, [], [], pullRequest()).pullRequest.state).toBe("ready");
    expect(lifecycleTimelineModel(done, [], [], pullRequest({ state: "merged" })).pullRequest.state).toBe("merged");
  });

  test("maps each lifecycle delivery to its own pull request checkpoint", () => {
    const deliveries = [
      delivery({ id: "proposal", phase: "proposal", pullRequestNumber: 11 }),
      delivery({ id: "implementation", phase: "implementation", pullRequestNumber: 22 }),
      delivery({ id: "archive", phase: "archive", pullRequestNumber: 33 }),
    ];
    const prs = [pullRequest({ number: 11, state: "merged" }), pullRequest({ number: 22, checks: "pending" }), pullRequest({ number: 33, mergeable: "conflicting" })];
    const model = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-18" }), [], deliveries, undefined, prs);
    expect(model.pullRequests.proposal).toMatchObject({ state: "merged", number: 11 });
    expect(model.pullRequests.implementation).toMatchObject({ state: "checking", number: 22 });
    expect(model.pullRequests.archive).toMatchObject({ state: "conflicts", number: 33 });
    const view = mount(h(LifecycleTimeline, { model }));
    expect([...view.querySelectorAll(".lifecycle-pr-checkpoint")].map((node) => node.getAttribute("aria-label"))).toEqual([
      "Drafts pull request: Merged", "Implementation pull request: Checks running", "Archive pull request: Conflicts",
    ]);
  });

  test("does not animate a ready or done phase and only marks actively working phase", () => {
    const ready = lifecycleTimelineModel(change({ stage: "ready" }), [], [], undefined, [], undefined);
    const readyView = mount(h(LifecycleTimeline, { model: ready }));
    expect(readyView.querySelector(".lifecycle-phase.working")).toBeNull();
    const done = lifecycleTimelineModel(change({ stage: "done" }), [], [delivery({ phase: "implementation", state: "merged" })], pullRequest({ state: "merged" }));
    const doneView = mount(h(LifecycleTimeline, { model: done }));
    expect(doneView.querySelector(".lifecycle-phase.current.working")).toBeNull();
    expect(doneView.querySelector(".lifecycle-pr-checkpoint.merged")).not.toBeNull();
    const active = lifecycleTimelineModel(change({ stage: "implementing" }), [], [], undefined, [], "Implementing");
    expect(mount(h(LifecycleTimeline, { model: active })).querySelector(".lifecycle-phase.working")?.textContent).toContain("Implementing");
  });

  test("places lifecycle and delivery actions inside their progress checkpoints", () => {
    const done = change({ stage: "done" });
    const view = mount(h(LifecycleTimeline, {
      model: lifecycleTimelineModel(done, [], []),
      children: h("button", {}, "Archive"),
      deliveryChildren: h("button", {}, "Ship"),
    }));
    expect(view.querySelector(".lifecycle-phase.actionable")?.textContent).toContain("Archive");
    expect(view.querySelector('.lifecycle-pr-checkpoint[aria-label^="Implementation pull request"]')?.textContent).toContain("Ship");

    const active = change({ stage: "implementing" });
    const confirmation = mount(h(LifecycleTimeline, {
      model: lifecycleTimelineModel(active, [], []),
      completionPhase: "Implementing",
      completionChildren: h("button", {}, "Confirm complete"),
    }));
    expect(confirmation.querySelector(".lifecycle-phase.current .lifecycle-phase-completion")?.textContent).toContain("Confirm complete");
  });

  test("demo includes fictional pending, blocked and archive delivery examples", async () => {
    const api = createDemoApi({ now: () => Date.parse("2026-11-16T12:00:00Z"), latencyMs: 0 });
    expect((await api.lifecycleDeliveries("demo", "idempotency-keys"))[0]?.state).toBe("pending");
    expect((await api.lifecycleDeliveries("demo", "deprecate-v1-auth"))[0]?.state).toBe("blocked");
    expect((await api.lifecycleDeliveries("demo", "add-health-endpoint"))[0]?.phase).toBe("archive");
  });
});
