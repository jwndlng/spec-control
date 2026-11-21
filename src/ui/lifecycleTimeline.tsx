import type { ArtifactStatus, ChangeSnapshot } from "../shared/types.ts";
import type { ComponentChildren } from "preact";
import type { PullRequest } from "../shared/types.ts";
import type { LifecycleDeliveryView } from "./api.ts";
import { Meter } from "./kanban.tsx";
import { phasePullRequest, isProposalPullRequest } from "../shared/pullRequestLink.ts";
import { sessionBranch } from "../shared/sessionBranch.ts";

export const LIFECYCLE_PHASES = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
export type LifecyclePullRequestState = "upcoming" | "unshipped" | "skipped" | "shipping" | "checking" | "ready" | "conflicts" | "failed" | "merged" | "closed" | "waiting";

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

/** The newest delivery record per phase; older retries are history, not separate current status rows. */
export function latestLifecycleDeliveries(deliveries: readonly LifecycleDeliveryView[]): LifecycleDeliveryView[] {
  const latest = new Map<LifecycleDeliveryView["phase"], LifecycleDeliveryView>();
  for (const delivery of deliveries) {
    const previous = latest.get(delivery.phase);
    if (!previous || delivery.updatedAt.localeCompare(previous.updatedAt) > 0) latest.set(delivery.phase, delivery);
  }
  return [...latest.values()];
}

/** Current, actionable delivery rows; merged checkpoints are already represented by their green phase marker. */
export function visibleLifecycleDeliveries(
  deliveries: readonly LifecycleDeliveryView[],
  pullRequests: LifecycleTimelineModel["pullRequests"],
): LifecycleDeliveryView[] {
  return latestLifecycleDeliveries(deliveries).filter((delivery) =>
    delivery.state !== "merged" &&
    !/there is nothing to ship \(merged\)/i.test(delivery.blocker ?? "") &&
    pullRequests[delivery.phase].state !== "merged"
  );
}

const stagePhase: Record<ChangeSnapshot["stage"], LifecyclePhase> = {
  backlog: "Backlog", drafts: "Drafts", unknown: "Backlog", ready: "Ready",
  implementing: "Implementing", done: "Done", archived: "Archived",
};

const PHASE_TRACK_COLUMN: Record<LifecyclePhase, number> = {
  Backlog: 1, Drafts: 2, Ready: 3, Implementing: 4, Done: 5, Archived: 6,
};

const DELIVERY_PHASE: Partial<Record<LifecyclePhase, LifecycleDeliveryView["phase"]>> = {
  Drafts: "proposal", Implementing: "implementation", Archived: "archive",
};

const DELIVERY_LABEL: Record<LifecycleDeliveryView["phase"], string> = {
  proposal: "Proposal", implementation: "Implementation", archive: "Archive",
};

const ARTIFACT_SHORT_LABEL: Record<string, string> = {
  Proposal: "Pro", Specs: "Spe", Design: "Des", Tasks: "Tas",
};

function compactArtifactLabel(label: string): string {
  return ARTIFACT_SHORT_LABEL[label] ?? label.replace(/[^a-z0-9]/gi, "").slice(0, 3);
}

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
  const actionPhase = change.subState === "validate" ? "Done" as const
    : current === "Archived" ? "Archived" as const
      : nextPhase === "Archived" && visualCurrent === "Archived" ? undefined
      : nextPhase;
  const latestDeliveries = new Map(latestLifecycleDeliveries(deliveries).map((delivery) => [delivery.phase, delivery]));
  const persistence = [...latestDeliveries.values()].map((delivery) => ({
    id: delivery.id,
    label: `${humanize(delivery.phase)} delivery: ${humanize(delivery.state)}${delivery.blocker ? ` · ${delivery.blocker}` : ""}`,
    pullRequestNumber: delivery.pullRequestNumber,
    pullRequestUrl: delivery.pullRequestUrl,
  }));
  const stateFor = (phase: LifecycleDeliveryView["phase"], delivery: LifecycleDeliveryView | undefined, phasePr: PullRequest | undefined) => {
    const alreadyMerged = phasePr?.state === "merged" || delivery?.state === "merged" || /there is nothing to ship \(merged\)/i.test(delivery?.blocker ?? "");
    const phaseStarted = phasePr !== undefined || delivery !== undefined;
    const started = phaseStarted || (phase === "proposal" ? currentIndex >= 1 : phase === "implementation" ? currentIndex >= 3 : currentIndex >= 5);
    const skipped = phase === "proposal" && visualCurrentIndex >= LIFECYCLE_PHASES.indexOf("Implementing") && !phasePr && !delivery;
    const state: LifecyclePullRequestState = alreadyMerged ? "merged"
      : skipped ? "skipped"
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
    const label = ({ upcoming: "Not started", unshipped: "Not shipped", skipped: "Skipped", shipping: "Shipping", checking: "Checks running", ready: "Checks passed", conflicts: "Conflicts", failed: delivery?.blocker ? "Delivery blocked" : "Checks failed", merged: "Merged", closed: "Closed", waiting: "Waiting" } as const)[state];
    return { state, label, ...(!alreadyMerged && delivery?.blocker ? { blocker: delivery.blocker } : {}), ...(phasePr?.number ? { number: phasePr.number } : delivery?.pullRequestNumber ? { number: delivery.pullRequestNumber } : {}), ...(phasePr?.url ? { url: phasePr.url } : delivery?.pullRequestUrl ? { url: delivery.pullRequestUrl } : {}) };
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
    ...(actionPhase ? { actionPhase } : {}),
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
  const renderDelivery = (phase: LifecycleDeliveryView["phase"]) => {
    const item = model.pullRequests[phase];
    if (item.state === "upcoming") return null;
    const label = DELIVERY_LABEL[phase];
    return <div class={`lifecycle-phase-delivery ${item.state}`} title={item.blocker ? `${label} pull request: ${item.label} · ${item.blocker}` : `${label} pull request: ${item.label}`}>
      <span class="visually-hidden">{label} pull request </span>
      <span class="lifecycle-delivery-marker" aria-hidden="true">{item.state === "ready" || item.state === "merged" ? "✓" : ""}</span>
      <span class="lifecycle-delivery-kind" aria-hidden="true">PR</span>
      <span class="lifecycle-delivery-state">{item.label}</span>
      {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} pull request #${item.number ?? ""}`}>{item.number ? `#${item.number}` : "Open"}</a> : item.number && <span>#{item.number}</span>}
      {item.blocker && <span class="lifecycle-delivery-blocker">{item.blocker}</span>}
      {deliveryActions[phase] ?? (phase === "implementation" ? deliveryChildren : undefined)}
    </div>;
  };
  const renderPhaseDelivery = (phase: LifecyclePhase) => {
    const delivery = DELIVERY_PHASE[phase];
    return delivery ? renderDelivery(delivery) : null;
  };
  return (
    <section class="lifecycle-timeline" aria-label="Change lifecycle">
      <div class="lifecycle-timeline-wide">
        <ol class="lifecycle-phases" style={{ "--lifecycle-progress": `${Math.max(0, (PHASE_TRACK_COLUMN[model.visualCurrent] - 1) / 6) * 100}%` }}>
          {model.phases.map((phase) => <li key={phase.label} data-phase={phase.label} class={`lifecycle-phase timeline-node ${phase.state}${phase.label === model.actionPhase || phase.label === model.draftActionPhase ? " actionable" : ""}${phase.label === "Drafts" && model.artifacts.length ? " has-artifacts" : ""}${phase.label === "Implementing" && model.taskProgress ? " has-progress" : ""}${phase.label === model.workingPhase ? " working" : ""}`} style={{ gridColumn: PHASE_TRACK_COLUMN[phase.label], gridRow: 1 }} aria-current={phase.state === "current" ? "step" : undefined}>
              <span class="lifecycle-phase-marker" aria-hidden="true">{phase.state === "complete" ? "✓" : ""}</span>
              <span class="lifecycle-phase-label">{phase.label}</span>
              {renderPhaseDelivery(phase.label)}
              {phase.label === model.actionPhase && <section class="lifecycle-phase-action" aria-label={`Available action for ${phase.label}`}>{children}</section>}
              {phase.label === model.draftActionPhase && <section class="lifecycle-phase-action" aria-label="Draft action">{draftChildren}</section>}
              {phase.label === "Drafts" && model.artifacts.length > 0 && <ol class="lifecycle-artifact-segments" aria-label="Draft artifact progress">
                {model.artifacts.map((artifact) => <li key={artifact.id} class={`lifecycle-artifact-dot ${artifact.status}`} aria-label={`${artifact.label}: ${artifact.status}`} title={`${artifact.label}: ${artifact.status}`}>
                  <span class="lifecycle-artifact-segment" aria-hidden="true" />
                  <span class="lifecycle-artifact-label" aria-hidden="true">{compactArtifactLabel(artifact.label)}</span>
                </li>)}
              </ol>}
              {phase.label === "Implementing" && model.taskProgress && <div class="lifecycle-phase-progress"><Meter {...model.taskProgress} showUnit /></div>}
              {phase.label === completionPhase && <section class="lifecycle-phase-completion" aria-label={`Completion check for ${phase.label}`}>{completionChildren}</section>}
            </li>
          )}
        </ol>
        {model.current === "Backlog" && <section class="lifecycle-fast-forward" aria-label="Fast-forward route from Backlog to Implementing">
          <span>Backlog</span><span class="lifecycle-fast-forward-line" aria-hidden="true">⟶</span><span>Implementing</span><strong>Fast-forward is in the action menu</strong>
        </section>}
      </div>
      <div class="lifecycle-status" aria-live="polite">
        {model.validation && <span>{model.validation}</span>}
      </div>
      {!model.actionPhase && <div class="lifecycle-timeline-action">{children}</div>}
    </section>
  );
}
