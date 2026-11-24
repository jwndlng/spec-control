import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { h, render, type ComponentChildren } from "preact";
import type { ChangeArtifactEntry, ChangeSnapshot, PullRequest } from "../src/shared/types.ts";
import type { LifecycleDeliveryView } from "../src/ui/api.ts";
import { phaseReadyForVerification, LifecycleTimeline, lifecycleTimelineModel, latestLifecycleDeliveries, shouldShowDirectShipAction, visibleLifecycleDeliveries } from "../src/ui/lifecycleTimeline.tsx";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";

const change = (overrides: Partial<ChangeSnapshot> = {}) => ({
  repoId: "repo", name: "rotate-keys", created: "2026-11-01", stage: "drafts", artifacts: [], tasks: null, ...overrides,
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
  test("renders the Backlog step without a separate Fast-forward route banner", () => {
    const model = lifecycleTimelineModel(change({ stage: "backlog" }), [], []);
    const view = mount(h(LifecycleTimeline, { model }));
    expect(view.querySelector('[data-phase="Backlog"][aria-current="step"]')).not.toBeNull();
    expect(view.querySelector('[aria-label="Fast-forward route from Backlog to Implementing"]')).toBeNull();
    expect(view.textContent).not.toContain("Fast-forward is in the action menu");
  });

  test("manual shipping waits for the evidence required by each delivery phase", () => {
    const incomplete = change({ stage: "implementing", tasks: { total: 2, done: 1 } });
    const done = change({ stage: "done", tasks: { total: 2, done: 2 } });
    expect(phaseReadyForVerification("proposal", change())).toBe(false);
    expect(phaseReadyForVerification("proposal", change({stage: "ready"}))).toBe(true);
    expect(phaseReadyForVerification("implementation", incomplete)).toBe(false);
    expect(phaseReadyForVerification("implementation", done)).toBe(true);
    expect(phaseReadyForVerification("archive", done)).toBe(false);
    expect(phaseReadyForVerification("archive", {...done, stage: "archived", archived: "2026-11-21"})).toBe(true);
    expect(phaseReadyForVerification("archive", {...incomplete, stage: "archived", archived: "2026-11-21"}, true)).toBe(true);
  });

  test("working phases describe the action in progress", () => {
    for (const [phase, label] of [["Drafts", "Drafting…"], ["Implementing", "Implementing…"], ["Done", "Validating…"], ["Archived", "Archiving…"]] as const) {
      const model = lifecycleTimelineModel(change(), [], [], undefined, [], phase);
      expect(mount(h(LifecycleTimeline, { model })).querySelector(`[data-phase="${phase}"] .lifecycle-phase-label`)?.textContent).toContain(label);
    }
  });

  test("hides a direct Ship action only for the phase with an active completion confirmation", () => {
    expect(shouldShowDirectShipAction("archive", "archive")).toBe(false);
    expect(shouldShowDirectShipAction("implementation", "archive")).toBe(true);
    expect(shouldShowDirectShipAction("archive", undefined)).toBe(true);
  });

  test("shows only the latest delivery per phase and hides merged delivery retries", () => {
    const oldProposal = delivery({ id: "old", phase: "proposal", state: "waiting-to-merge", updatedAt: "2026-11-16T10:00:00Z", recovery: ["open-pr"] });
    const blockedProposal = delivery({ id: "blocked", phase: "proposal", state: "blocked", updatedAt: "2026-11-16T11:00:00Z", blocker: "there is nothing to ship (merged)", recovery: ["retry"] });
    const implementation = delivery({ id: "implementation", phase: "implementation", updatedAt: "2026-11-16T09:00:00Z" });
    const model = lifecycleTimelineModel(
      change({ stage: "archived", archived: "2026-11-16" }), [], [oldProposal, blockedProposal, implementation], undefined,
      [pullRequest({ head: "docs/rotate-keys", state: "merged" })],
    );

    expect(latestLifecycleDeliveries([oldProposal, blockedProposal, implementation]).map(({ id }) => id)).toEqual(["blocked", "implementation"]);
    expect(visibleLifecycleDeliveries([oldProposal, blockedProposal, implementation], model.pullRequests).map(({ id }) => id)).toEqual(["implementation"]);
    expect(model.pullRequests.proposal).toMatchObject({ state: "merged", number: 42 });
    const view = mount(h(LifecycleTimeline, { model }));
    expect(view.querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery')?.textContent).toContain("Merged");
    expect(view.querySelector(".lifecycle-status")?.textContent).not.toContain("Proposal delivery");
  });

  test("uses schema artifact names and does not fabricate missing evidence", () => {
    const model = lifecycleTimelineModel(change(), [artifact("overview", "done"), artifact("quality-gate", "blocked")], []);
    expect(model.current).toBe("Drafts");
    expect(model.actionPhase).toBe("Drafts");
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

  test("shows Ready complete when implementation is actively running from a Ready snapshot", () => {
    const model = lifecycleTimelineModel(change({ stage: "ready" }), [], [], undefined, [], "Implementing");
    expect(model.current).toBe("Ready");
    expect(model.visualCurrent).toBe("Implementing");
    expect(model.phases.find((phase) => phase.label === "Ready")?.state).toBe("complete");
    expect(model.phases.find((phase) => phase.label === "Implementing")?.state).toBe("current");
    const view = mount(h(LifecycleTimeline, { model }));
    expect(view.querySelector('.lifecycle-phase[aria-current="step"] .lifecycle-phase-label')?.textContent).toBe("Implementing…");
    expect(view.querySelector('.lifecycle-phase.complete[style*="grid-column: 3"] .lifecycle-phase-label')?.textContent).toBe("Ready");
  });

  test("keeps an ended implementation attempt current without animating it", () => {
    const model = lifecycleTimelineModel(change({ stage: "ready" }), [], [], undefined, [], undefined, "Implementing");
    expect(model.phases.find((phase) => phase.label === "Ready")?.state).toBe("complete");
    expect(model.phases.find((phase) => phase.label === "Implementing")?.state).toBe("current");
    const view = mount(h(LifecycleTimeline, { model }));
    expect(view.querySelector(".lifecycle-phase.working")).toBeNull();
  });

  test("shows validation and local progress only when snapshot evidence exists", () => {
    const model = lifecycleTimelineModel(change({ stage: "done", subState: "validate", tasks: { done: 2, awaiting: 1, total: 4 } }), [], []);
    expect(model.current).toBe("Done");
    expect(model.actionPhase).toBe("Done");
    expect(model.validation).toBe("1 task needs review");
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
    expect(draftView.querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery')).not.toBeNull();

    const implementing = lifecycleTimelineModel(change({ stage: "implementing", tasks: { done: 2, awaiting: 1, total: 4 } }), [], []);
    expect(implementing.taskProgress).toEqual({ done: 2, awaiting: 1, total: 4 });
    const implementationView = mount(h(LifecycleTimeline, { model: implementing }));
    expect(implementationView.querySelector(".lifecycle-phase.current .meter")?.getAttribute("aria-label")).toBe("2 of 4 tasks complete, 1 needs the user, 1 open");
  });

  test("uses compact artifact labels while exposing each full name to assistive technology and on hover", () => {
    const artifacts = [artifact("proposal", "done"), artifact("specs", "done"), artifact("design", "ready"), artifact("tasks", "blocked")];
    const view = mount(h(LifecycleTimeline, { model: lifecycleTimelineModel(change(), artifacts, []) }));
    expect([...view.querySelectorAll(".lifecycle-artifact-label")].map((node) => node.textContent)).toEqual(["Pro", "Spe", "Des", "Tas"]);
    expect([...view.querySelectorAll(".lifecycle-artifact-dot")].map((node) => [node.getAttribute("aria-label"), node.getAttribute("title")])).toEqual([
      ["Proposal: done", "Proposal: done"], ["Specs: done", "Specs: done"], ["Design: ready", "Design: ready"], ["Tasks: blocked", "Tasks: blocked"],
    ]);
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

  test("opens the schema document list from a segment and answers the question in its phase", async () => {
    const model = lifecycleTimelineModel(change(), [artifact("quality-gate", "done")], []);
    let answered = false;
    const view = mount(h(LifecycleTimeline, {
      model, documentLink: () => "#quality-gate",
      question: { phase: "Drafts", open: () => { answered = true; } },
    }));
    const list = view.querySelector<HTMLElement>(".timeline-documents")!;
    expect(list.hidden).toBe(true);
    view.querySelector<HTMLButtonElement>(".draft-segment-button")!.click();
    await Promise.resolve();
    expect(list.hidden).toBe(false);
    expect(list.querySelector("a")?.textContent).toBe("Quality gate");
    expect(list.querySelector("a")?.getAttribute("href")).toBe("#quality-gate");
    view.querySelector<HTMLButtonElement>('[data-phase="Drafts"] > button')!.click();
    expect(answered).toBe(true);
  });

  test("returning to a change distinguishes unknown PR data, pending checks and a local archive", () => {
    const current = change({ stage: "implementing", tasks: { total: 6, done: 4, awaiting: 0 } });
    const remote = { localOnly: false, unavailable: true };
    const model = lifecycleTimelineModel(current, [], [], pullRequest({ checks: "pending" }), [], undefined, undefined, remote);
    expect(model.pullRequest).toMatchObject({ state: "waiting", label: "Status unavailable", number: 42 });
    expect(model.actionPhase).toBe("Implementing");
    expect(model.taskProgress?.done).toBe(4);
    expect(model.workingPhase).toBeUndefined();
    const archived = lifecycleTimelineModel(change({ stage: "archived" }), [], [], undefined, [], undefined, undefined, { localOnly: true, unavailable: true });
    expect(archived.pullRequests.archive.state).toBe("upcoming");
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

  test("Implementing shows its recorded model even when another phase owns the action", () => {
    for (const implementModel of ["reasoning-model", undefined]) {
      const model = lifecycleTimelineModel(change({ stage: "drafts", implementModel }), [], []);
      const view = mount(h(LifecycleTimeline, { model }));
      const phase = view.querySelector('[data-phase="Implementing"]')!;
      expect(phase.querySelector(".lifecycle-phase-action")).toBeNull();
      expect(phase.textContent?.includes("Implement model: reasoning-model")).toBe(Boolean(implementModel));
    }
  });

  test("maps each lifecycle delivery to its own pull request checkpoint", () => {
    const deliveries = [
      delivery({ id: "proposal", phase: "proposal", pullRequestNumber: 11 }),
      delivery({ id: "implementation", phase: "implementation", pullRequestNumber: 22 }),
      delivery({ id: "archive", phase: "archive", pullRequestNumber: 33 }),
    ];
    const prs = [pullRequest({ number: 11, url: "/pull/11", state: "merged" }), pullRequest({ number: 22, url: "/pull/22", checks: "pending" }), pullRequest({ number: 33, url: "/pull/33", mergeable: "conflicting" })];
    const model = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-18" }), [], deliveries, undefined, prs);
    expect(model.pullRequests.proposal).toMatchObject({ state: "merged", number: 11 });
    expect(model.pullRequests.implementation).toMatchObject({ state: "checking", number: 22 });
    expect(model.pullRequests.archive).toMatchObject({ state: "conflicts", number: 33 });
    const view = mount(h(LifecycleTimeline, { model }));
    expect([...view.querySelectorAll(".lifecycle-phase-delivery")].map((node) => [
      node.querySelector(".visually-hidden")?.textContent?.trim(), node.querySelector(".lifecycle-delivery-state")?.textContent,
    ])).toEqual([
      ["Proposal pull request", "Merged"], ["Implementation pull request", "Checks running"], ["Archive pull request", "Conflicts"],
    ]);
    expect([...view.querySelectorAll(".lifecycle-phase-delivery a")].map((link) => link.getAttribute("href"))).toEqual(["/pull/11", "/pull/22", "/pull/33"]);
    expect(view.querySelectorAll(".lifecycle-pr-checkpoint")).toHaveLength(0);
    expect(view.querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery')).not.toBeNull();
    expect(view.querySelector('.lifecycle-phase[data-phase="Implementing"] .lifecycle-phase-delivery')).not.toBeNull();
    expect(view.querySelector('.lifecycle-phase[data-phase="Archived"] .lifecycle-phase-delivery')).not.toBeNull();
  });

  test("does not show a recorded proposal branch again as the Implementation PR", () => {
    const proposalPr = pullRequest({ number: 17, head: "docs/rotate-keys", checks: "passing" });
    const model = lifecycleTimelineModel(
      change({ stage: "implementing", recorded: { branch: "docs/rotate-keys" } }),
      [], [], proposalPr, [proposalPr],
    );
    expect(model.pullRequests.proposal).toMatchObject({ state: "ready", number: 17 });
    expect(model.pullRequests.implementation).toMatchObject({ state: "unshipped" });
    expect(model.pullRequests.implementation.number).toBeUndefined();
    const view = mount(h(LifecycleTimeline, { model }));
    expect(view.querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery')?.textContent).toContain("#17");
    expect(view.querySelector('.lifecycle-phase[data-phase="Implementing"] .lifecycle-phase-delivery')?.textContent).not.toContain("#17");
  });

  test("keeps the implementation PR out of the Archive checkpoint even with a legacy archive delivery", () => {
    const implementation = pullRequest({ head: "feat/rotate-keys" });
    const active = change({ stage: "done", recorded: { archiveBranch: implementation.head } });
    for (const branch of [undefined, implementation.head]) {
      const legacy = delivery({ phase: "archive", branch, state: "waiting-to-merge", pullRequestNumber: implementation.number, pullRequestUrl: implementation.url });
      const model = lifecycleTimelineModel(active, [], [legacy], implementation, [implementation]);
      expect(model.pullRequests.implementation).toMatchObject({ state: "ready", number: implementation.number });
      expect(model.pullRequests.archive.number).toBeUndefined();
      expect(model.persistence).toEqual([]);
      const view = mount(h(LifecycleTimeline, { model, archivePrerequisite: "Merge #42 to archive" }));
      expect(view.querySelectorAll('a[href="https://github.com/example/repo/pull/42"]')).toHaveLength(1);
      expect(view.querySelector('[data-phase="Archived"]')?.textContent).toContain("Merge #42 to archive");
    }
  });

  test("associates a distinct archive delivery with the Archive checkpoint", () => {
    const implementation = pullRequest({ head: "feat/rotate-keys", state: "merged" });
    const archive = pullRequest({ number: 43, head: "chore/archive-rotate-keys", url: "https://github.com/example/repo/pull/43" });
    const record = delivery({ phase: "archive", branch: archive.head, pullRequestNumber: archive.number });
    const model = lifecycleTimelineModel(change({ stage: "archived" }), [], [record], undefined, [implementation, archive]);
    expect(model.pullRequests.implementation).toMatchObject({ state: "merged", number: 42 });
    expect(model.pullRequests.archive).toMatchObject({ state: "ready", number: 43 });
  });

  test("keeps the artifact milestone label row on one line", async () => {
    const css = await Bun.file(new URL("../src/ui/styles.css", import.meta.url)).text();
    const labelRule = css.match(/\.lifecycle-artifact-label\s*\{([^}]*)\}/)?.[1];
    expect(labelRule).toContain("white-space: nowrap");
    expect(labelRule).toContain("overflow-wrap: normal");
  });

  test("marks an unattempted Drafts PR as skipped after implementation starts", () => {
    const beforeImplementation = lifecycleTimelineModel(change({ stage: "ready" }), [], []);
    expect(beforeImplementation.pullRequests.proposal).toMatchObject({ state: "unshipped", label: "Not shipped" });

    const implementing = lifecycleTimelineModel(change({ stage: "implementing" }), [], []);
    expect(implementing.pullRequests.proposal).toMatchObject({ state: "skipped", label: "Skipped" });
    expect(mount(h(LifecycleTimeline, { model: implementing })).querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery')?.textContent).toContain("Skipped");
  });

  test("preserves Drafts PR and delivery statuses after implementation starts", () => {
    const proposalPr = pullRequest({ number: 17, head: "docs/rotate-keys", checks: "pending" });
    const withPr = lifecycleTimelineModel(change({ stage: "implementing" }), [], [], undefined, [proposalPr]);
    expect(withPr.pullRequests.proposal).toMatchObject({ state: "checking", number: 17 });

    const attempted = lifecycleTimelineModel(change({ stage: "implementing" }), [], [delivery({ phase: "proposal", state: "blocked", blocker: "push rejected" })]);
    expect(attempted.pullRequests.proposal).toMatchObject({ state: "failed", label: "Delivery blocked", blocker: "push rejected" });
  });

  test("does not offer Archive again after lifecycle progress already reached Archived", () => {
    const model = lifecycleTimelineModel(change({ stage: "done" }), [], [], undefined, [], undefined, "Archived");
    expect(model.phases.at(-1)).toMatchObject({ label: "Archived", state: "current" });
    expect(model.actionPhase).toBeUndefined();
    expect(mount(h(LifecycleTimeline, { model, children: h("button", {}, "End proposal session and archive") })).querySelector(".lifecycle-phase.current .lifecycle-phase-action")).toBeNull();
  });

  test("keeps an archived change's lifecycle action inside Archived", () => {
    const model = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-20" }), [], []);
    const view = mount(h(LifecycleTimeline, { model, children: h("button", {}, "Archive") }));
    expect(model.actionPhase).toBe("Archived");
    expect(view.querySelector('.lifecycle-phase[data-phase="Archived"] .lifecycle-phase-action')?.textContent).toBe("Archive");
    expect(view.querySelector(".lifecycle-timeline-action")).toBeNull();
  });

  test("discovers implementation and archive PRs from their own branches", () => {
    const implementation = pullRequest({ number: 51, head: "feat/rotate-keys", checks: "passing" });
    const archive = pullRequest({ number: 52, head: "chore/archive-rotate-keys", checks: "pending" });
    const model = lifecycleTimelineModel(
      change({ stage: "archived", archived: "2026-11-18", recorded: { branch: "feat/rotate-keys", archiveBranch: "chore/archive-rotate-keys" } }),
      [], [], archive, [implementation, archive],
    );
    expect(model.pullRequests.implementation).toMatchObject({ state: "ready", number: 51 });
    expect(model.pullRequests.archive).toMatchObject({ state: "checking", number: 52 });
  });

  test("does not animate a ready or done phase and only marks actively working phase", () => {
    const ready = lifecycleTimelineModel(change({ stage: "ready" }), [], [], undefined, [], undefined);
    const readyView = mount(h(LifecycleTimeline, { model: ready }));
    expect(readyView.querySelector(".lifecycle-phase.working")).toBeNull();
    const done = lifecycleTimelineModel(change({ stage: "done" }), [], [delivery({ phase: "implementation", state: "merged" })], pullRequest({ state: "merged" }));
    const doneView = mount(h(LifecycleTimeline, { model: done }));
    expect(doneView.querySelector(".lifecycle-phase.current.working")).toBeNull();
    expect(doneView.querySelector('.lifecycle-phase[data-phase="Implementing"] .lifecycle-phase-delivery.merged')).not.toBeNull();
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
    expect(view.querySelector('.lifecycle-phase[data-phase="Implementing"] .lifecycle-phase-delivery')?.textContent).toContain("Ship");

    const archived = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-19" }), [], []);
    const archiveView = mount(h(LifecycleTimeline, {
      model: archived,
      deliveryActions: { archive: h("button", {}, "Ship archive") },
    }));
    expect(archiveView.querySelector('.lifecycle-phase[data-phase="Archived"] .lifecycle-phase-delivery')?.textContent).toContain("Ship archive");

    const active = change({ stage: "implementing" });
    const confirmation = mount(h(LifecycleTimeline, {
      model: lifecycleTimelineModel(active, [], []),
      completionPhase: "Implementing",
      completionChildren: h("button", {}, "Confirm complete"),
    }));
    expect(confirmation.querySelector(".lifecycle-phase.current .lifecycle-phase-completion")?.textContent).toContain("Confirm complete");
  });

  test("shows one delivery status within its phase, without a duplicate status row", () => {
    const model = lifecycleTimelineModel(
      change({ stage: "drafts" }), [],
      [delivery({ phase: "proposal", state: "waiting-to-merge", pullRequestNumber: 35, recovery: ["open-pr"] })],
    );
    const view = mount(h(LifecycleTimeline, { model }));
    const proposal = view.querySelector('.lifecycle-phase[data-phase="Drafts"] .lifecycle-phase-delivery');
    expect(proposal?.textContent).toContain("#35");
    expect(proposal?.textContent).toContain("Awaiting merge");
    expect(view.querySelector(".lifecycle-status")?.textContent).not.toContain("Proposal delivery");
  });

  test("demo includes fictional pending, blocked and archive delivery examples", async () => {
    const api = createDemoApi({ now: () => Date.parse("2026-11-16T12:00:00Z"), latencyMs: 0 });
    expect((await api.lifecycleDeliveries("demo", "idempotency-keys"))[0]?.state).toBe("pending");
    expect((await api.lifecycleDeliveries("demo", "deprecate-v1-auth"))[0]?.state).toBe("blocked");
    expect((await api.lifecycleDeliveries("demo", "add-health-endpoint"))[0]?.phase).toBe("archive");
  });
});
