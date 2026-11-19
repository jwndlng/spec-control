import type { ArtifactStatus, ChangeSnapshot } from "../shared/types.ts";
import { Fragment, type ComponentChildren } from "preact";
import type { PullRequest } from "../shared/types.ts";
import type { LifecycleDeliveryView } from "./api.ts";
import { Meter } from "./kanban.tsx";
import { phasePullRequest, isProposalPullRequest } from "../shared/pullRequestLink.ts";
import { sessionBranch } from "../shared/sessionBranch.ts";

export const LIFECYCLE_PHASES = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
export type LifecyclePullRequestState = "upcoming" | "unshipped" | "shipping" | "checking" | "ready" | "conflicts" | "failed" | "merged" | "closed" | "waiting";

export interface LifecycleTimelineModel {
  current: LifecyclePhase;
  visualCurrent: LifecyclePhase;
  actionPhase?: LifecyclePhase;
  draftActionPhase?: LifecyclePhase;
  phases: { label: LifecyclePhase; state: "complete" | "current" | "next" | "upcoming" }[];
  artifacts: { id: string; label: string; status: string }[];
  artifactProgress?: { done: number; total: number };
  taskProgress?: { done: number; total: number; awaiting?: number };
  validation?: string;
  localProgress?: string;
  persistence: { id: string; label: string; pullRequestNumber?: number; pullRequestUrl?: string }[];
  pullRequest: { state: LifecyclePullRequestState; label: string; number?: number; url?: string };
  pullRequests: Record<LifecycleDeliveryView["phase"], { state: LifecyclePullRequestState; label: string; number?: number; url?: string; blocker?: string }>;
  workingPhase?: LifecyclePhase;
}

const stagePhase: Record<ChangeSnapshot["stage"], LifecyclePhase> = {
  backlog: "Backlog", drafts: "Drafts", unknown: "Backlog", ready: "Ready",
  implementing: "Implementing", done: "Done", archived: "Archived",
};

const PHASE_TRACK_COLUMN: Record<LifecyclePhase, number> = {
  Backlog: 1, Drafts: 2, Ready: 4, Implementing: 5, Done: 7, Archived: 8,
};

const DELIVERY_TRACK_COLUMN: Record<LifecycleDeliveryView["phase"], number> = {
  proposal: 3, implementation: 6, archive: 9,
};

function humanize(value: string): string {
  return value.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function lifecycleTimelineModel(
  change: Pick<ChangeSnapshot, "repoId" | "name" | "created" | "recorded" | "stage" | "archived" | "subState" | "tasks">,
  artifacts: readonly Pick<ArtifactStatus, "id" | "status" | "required">[],
  deliveries: readonly LifecycleDeliveryView[],
  pr?: PullRequest,
  prs: readonly PullRequest[] = [],
  workingPhase?: LifecyclePhase,
  progressPhase?: LifecyclePhase,
): LifecycleTimelineModel {
  const current = change.archived ? "Archived" : stagePhase[change.stage];
  const currentIndex = LIFECYCLE_PHASES.indexOf(current);
  const workingIndex = workingPhase ? LIFECYCLE_PHASES.indexOf(workingPhase) : -1;
  const progressIndex = progressPhase ? LIFECYCLE_PHASES.indexOf(progressPhase) : -1;
  const visualIndex = Math.max(currentIndex, workingIndex, progressIndex);
  const visualCurrent = LIFECYCLE_PHASES[visualIndex];
  const visualCurrentIndex = LIFECYCLE_PHASES.indexOf(visualCurrent);
  const nextPhase = LIFECYCLE_PHASES[currentIndex + 1];
  const latestDeliveries = new Map<LifecycleDeliveryView["phase"], LifecycleDeliveryView>();
  for (const delivery of deliveries) {
    const previous = latestDeliveries.get(delivery.phase);
    if (!previous || delivery.updatedAt.localeCompare(previous.updatedAt) > 0) latestDeliveries.set(delivery.phase, delivery);
  }
  const persistence = [...latestDeliveries.values()].map((delivery) => ({
    id: delivery.id,
    label: `${humanize(delivery.phase)} delivery: ${humanize(delivery.state)}${delivery.blocker ? ` · ${delivery.blocker}` : ""}`,
    pullRequestNumber: delivery.pullRequestNumber,
    pullRequestUrl: delivery.pullRequestUrl,
  }));
  const stateFor = (phase: LifecycleDeliveryView["phase"], delivery: LifecycleDeliveryView | undefined, phasePr: PullRequest | undefined) => {
    const phaseStarted = phasePr !== undefined || delivery !== undefined;
    const started = phaseStarted || (phase === "proposal" ? currentIndex >= 1 : phase === "implementation" ? currentIndex >= 3 : currentIndex >= 5);
    const state: LifecyclePullRequestState = phasePr?.state === "merged" || delivery?.state === "merged" ? "merged"
      : !phasePr ? !started ? "upcoming"
        : delivery && ["pending", "committing", "pushing", "opening-pr"].includes(delivery.state) ? "shipping"
          : delivery?.recovery.includes("resolve-conflicts") ? "conflicts"
            : delivery && ["blocked", "unavailable"].includes(delivery.state) ? "failed"
              : delivery?.state === "waiting-to-merge" ? "checking" : "unshipped"
        : phasePr.state === "closed" ? "closed"
          : phasePr.mergeable === "conflicting" ? "conflicts"
            : phasePr.checks === "failing" ? "failed"
              : phasePr.checks === "pending" || phasePr.mergeable === "unknown" || !phasePr.mergeable ? "checking"
                : phasePr.mergeable === "mergeable" && (phasePr.checks === "passing" || phasePr.checks === "none") ? "ready" : "waiting";
    const label = ({ upcoming: "Not started", unshipped: "Not shipped", shipping: "Shipping", checking: "Checks running", ready: "Checks passed", conflicts: "Conflicts", failed: delivery?.blocker ? "Delivery blocked" : "Checks failed", merged: "Merged", closed: "Closed", waiting: "Waiting" } as const)[state];
    return { state, label, ...(delivery?.blocker ? { blocker: delivery.blocker } : {}), ...(phasePr?.number ? { number: phasePr.number } : delivery?.pullRequestNumber ? { number: delivery.pullRequestNumber } : phase === "implementation" && pr?.number ? { number: pr.number } : {}), ...(phasePr?.url ? { url: phasePr.url } : delivery?.pullRequestUrl ? { url: delivery.pullRequestUrl } : phase === "implementation" && pr?.url ? { url: pr.url } : {}) };
  };
  const pullRequests = Object.fromEntries((['proposal', 'implementation', 'archive'] as const).map((phase) => {
    const delivery = latestDeliveries.get(phase);
    const recordedPr = phasePullRequest(change, phase, prs);
    const genericImplementationPr = phase === "implementation" && pr && !isProposalPullRequest(change, pr) && pr.head !== sessionBranch("archive", change.name) && pr.head !== change.recorded?.archiveBranch ? pr : undefined;
    const phasePr = (delivery?.pullRequestNumber ? prs.find((candidate) => candidate.number === delivery.pullRequestNumber) : undefined) ?? recordedPr ?? genericImplementationPr;
    return [phase, stateFor(phase, delivery, phasePr)];
  })) as LifecycleTimelineModel["pullRequests"];
  return {
    current,
    visualCurrent,
    ...(change.subState === "validate" ? { actionPhase: "Done" as const } : nextPhase ? { actionPhase: nextPhase } : {}),
    ...(current === "Ready" && artifacts.some((artifact) => artifact.required === false && artifact.status !== "done") ? { draftActionPhase: "Drafts" as const } : {}),
    phases: LIFECYCLE_PHASES.map((label, index) => ({ label, state: index < visualCurrentIndex ? "complete" : index === visualCurrentIndex ? "current" : index === visualCurrentIndex + 1 ? "next" : "upcoming" })),
    artifacts: artifacts.map(({ id, status }) => ({ id, label: humanize(id), status })),
    ...(current === "Drafts" && artifacts.length > 0 ? { artifactProgress: { done: artifacts.filter((artifact) => artifact.status === "done").length, total: artifacts.length } } : {}),
    ...(change.tasks && change.tasks.total > 0 && current !== "Backlog" && current !== "Drafts" ? { taskProgress: change.tasks } : {}),
    ...(change.subState === "validate" ? { validation: "Validation awaiting confirmation" } : {}),
    ...(change.tasks ? { localProgress: `${change.tasks.done}/${change.tasks.total} tasks complete${change.tasks.awaiting ? ` · ${change.tasks.awaiting} awaiting confirmation` : ""}` } : {}),
    persistence,
    pullRequest: pullRequests.implementation,
    pullRequests,
    workingPhase,
  };
}

export function LifecycleTimeline({ model, children, draftChildren, deliveryChildren, deliveryActions = {}, completionPhase, completionChildren }: {
  model: LifecycleTimelineModel;
  children?: ComponentChildren;
  draftChildren?: ComponentChildren;
  deliveryChildren?: ComponentChildren;
  deliveryActions?: Partial<Record<LifecycleDeliveryView["phase"], ComponentChildren>>;
  completionPhase?: LifecyclePhase;
  completionChildren?: ComponentChildren;
}) {
  const renderPullRequest = (phase: LifecycleDeliveryView["phase"], label: string) => {
    const item = model.pullRequests[phase];
    return <li class={`lifecycle-pr-checkpoint timeline-node ${item.state}`} style={{ gridColumn: DELIVERY_TRACK_COLUMN[phase], gridRow: 1 }} aria-label={`${label} pull request: ${item.label}`}>
      <span class="lifecycle-pr-marker" aria-hidden="true">{item.state === "ready" || item.state === "merged" ? "✓" : ""}</span>
      <span class="lifecycle-pr-label">{label} PR</span><span class="lifecycle-pr-state">{item.label}</span>
      {item.blocker && <span class="lifecycle-pr-blocker" title={item.blocker}>{item.blocker}</span>}
      {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{item.number ? `#${item.number}` : "Open PR"}</a>}
      {deliveryActions[phase] ?? (phase === "implementation" ? deliveryChildren : undefined)}
    </li>;
  };
  return (
    <section class="lifecycle-timeline" aria-label="Change lifecycle">
      <div class="lifecycle-timeline-wide">
        <ol class="lifecycle-phases" style={{ "--lifecycle-progress": `${Math.max(0, (PHASE_TRACK_COLUMN[model.visualCurrent] - 1) / 9) * 100}%` }}>
          {model.phases.map((phase) => <Fragment key={phase.label}>
            <li class={`lifecycle-phase timeline-node ${phase.state}${phase.label === model.actionPhase || phase.label === model.draftActionPhase ? " actionable" : ""}${phase.label === "Drafts" && model.artifacts.length ? " has-artifacts" : ""}${phase.label === "Implementing" && model.taskProgress ? " has-progress" : ""}${phase.label === model.workingPhase ? " working" : ""}`} style={{ gridColumn: PHASE_TRACK_COLUMN[phase.label], gridRow: 1 }} aria-current={phase.state === "current" ? "step" : undefined}>
              <span class="lifecycle-phase-marker" aria-hidden="true">{phase.state === "complete" ? "✓" : ""}</span>
              <span class="lifecycle-phase-label">{phase.label}</span>
              {phase.label === model.actionPhase && <section class="lifecycle-phase-action" aria-label={`Available action for ${phase.label}`}>{children}</section>}
              {phase.label === model.draftActionPhase && <section class="lifecycle-phase-action" aria-label="Draft action">{draftChildren}</section>}
              {phase.label === "Drafts" && model.artifacts.length > 0 && <ol class="lifecycle-artifact-segments" aria-label="Draft artifact progress">
                {model.artifacts.map((artifact) => <li key={artifact.id} class={`lifecycle-artifact-dot ${artifact.status}`} aria-label={`${artifact.label}: ${artifact.status}`} title={`${artifact.label}: ${artifact.status}`}>
                  <span class="lifecycle-artifact-segment" aria-hidden="true" />
                  <span class="lifecycle-artifact-label">{artifact.label}</span>
                </li>)}
              </ol>}
              {phase.label === "Implementing" && model.taskProgress && <div class="lifecycle-phase-progress"><Meter {...model.taskProgress} showUnit /></div>}
              {phase.label === completionPhase && <section class="lifecycle-phase-completion" aria-label={`Completion check for ${phase.label}`}>{completionChildren}</section>}
            </li>
            {phase.label === "Drafts" && renderPullRequest("proposal", "Drafts")}
            {phase.label === "Implementing" && renderPullRequest("implementation", "Implementation")}
            {phase.label === "Archived" && renderPullRequest("archive", "Archive")}
          </Fragment>)}
        </ol>
        {model.current === "Backlog" && <section class="lifecycle-fast-forward" aria-label="Fast-forward route from Backlog to Implementing">
          <span>Backlog</span><span class="lifecycle-fast-forward-line" aria-hidden="true">⟶</span><span>Implementing</span><strong>Fast-forward is in the action menu</strong>
        </section>}
      </div>
      <div class="lifecycle-status" aria-live="polite">
        {model.validation && <span>{model.validation}</span>}
        {model.persistence.map((item) => <span key={item.id}>{item.label}{item.pullRequestUrl && item.pullRequestNumber && <> · <a href={item.pullRequestUrl} target="_blank" rel="noopener noreferrer">PR #{item.pullRequestNumber}</a></>}</span>)}
      </div>
      {!model.actionPhase && <div class="lifecycle-timeline-action">{children}</div>}
    </section>
  );
}
