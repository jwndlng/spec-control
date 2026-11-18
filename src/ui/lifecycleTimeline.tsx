import type { ArtifactStatus, ChangeSnapshot } from "../shared/types.ts";
import { Fragment, type ComponentChildren } from "preact";
import type { PullRequest } from "../shared/types.ts";
import type { LifecycleDeliveryView } from "./api.ts";

export const LIFECYCLE_PHASES = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
export type LifecyclePullRequestState = "upcoming" | "unshipped" | "shipping" | "checking" | "ready" | "conflicts" | "failed" | "merged" | "closed" | "waiting";

export interface LifecycleTimelineModel {
  current: LifecyclePhase;
  actionPhase?: LifecyclePhase;
  phases: { label: LifecyclePhase; state: "complete" | "current" | "next" | "upcoming" }[];
  artifacts: { id: string; label: string; status: string }[];
  validation?: string;
  localProgress?: string;
  persistence: { id: string; label: string; pullRequestNumber?: number; pullRequestUrl?: string }[];
  pullRequest: { state: LifecyclePullRequestState; label: string; number?: number; url?: string };
}

const stagePhase: Record<ChangeSnapshot["stage"], LifecyclePhase> = {
  backlog: "Backlog", drafts: "Drafts", unknown: "Backlog", ready: "Ready",
  implementing: "Implementing", done: "Done", archived: "Archived",
};

function humanize(value: string): string {
  return value.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function lifecycleTimelineModel(
  change: Pick<ChangeSnapshot, "stage" | "archived" | "subState" | "tasks">,
  artifacts: readonly Pick<ArtifactStatus, "id" | "status">[],
  deliveries: readonly LifecycleDeliveryView[],
  pr?: PullRequest,
): LifecycleTimelineModel {
  const current = change.archived ? "Archived" : stagePhase[change.stage];
  const currentIndex = LIFECYCLE_PHASES.indexOf(current);
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
  const implementation = latestDeliveries.get("implementation");
  const prState: LifecyclePullRequestState = !pr
    ? change.stage !== "done" && change.stage !== "archived"
      ? "upcoming"
      : implementation && ["pending", "committing", "pushing", "opening-pr"].includes(implementation.state)
        ? "shipping"
        : implementation?.recovery.includes("resolve-conflicts")
          ? "conflicts"
          : implementation && implementation.state === "blocked"
          ? "failed"
          : implementation?.state === "merged"
            ? "merged"
            : implementation?.state === "waiting-to-merge"
              ? "checking"
          : "unshipped"
    : pr.state === "merged"
      ? "merged"
      : pr.state === "closed"
        ? "closed"
        : pr.mergeable === "conflicting"
          ? "conflicts"
          : pr.checks === "failing"
            ? "failed"
            : pr.checks === "pending" || pr.mergeable === "unknown" || !pr.mergeable
              ? "checking"
              : pr.mergeable === "mergeable" && (pr.checks === "passing" || pr.checks === "none")
                ? "ready"
                : "waiting";
  const prLabel = ({ upcoming: "Not started", unshipped: "Not shipped", shipping: "Shipping", checking: "Checks running", ready: "Checks passed", conflicts: "Conflicts", failed: implementation?.state === "blocked" && !pr ? "Delivery blocked" : "Checks failed", merged: "Merged", closed: "Closed", waiting: "Waiting" } as const)[prState];
  return {
    current,
    ...(change.subState === "validate" ? { actionPhase: "Done" as const } : nextPhase ? { actionPhase: nextPhase } : {}),
    phases: LIFECYCLE_PHASES.map((label, index) => ({ label, state: index < currentIndex ? "complete" : index === currentIndex ? "current" : index === currentIndex + 1 ? "next" : "upcoming" })),
    artifacts: artifacts.map(({ id, status }) => ({ id, label: humanize(id), status })),
    ...(change.subState === "validate" ? { validation: "Validation awaiting confirmation" } : {}),
    ...(change.tasks ? { localProgress: `${change.tasks.done}/${change.tasks.total} tasks complete${change.tasks.awaiting ? ` · ${change.tasks.awaiting} awaiting confirmation` : ""}` } : {}),
    persistence,
    pullRequest: {
      state: prState,
      label: prLabel,
      ...(pr?.number ? { number: pr.number } : implementation?.pullRequestNumber ? { number: implementation.pullRequestNumber } : {}),
      ...(pr?.url ? { url: pr.url } : implementation?.pullRequestUrl ? { url: implementation.pullRequestUrl } : {}),
    },
  };
}

export function LifecycleTimeline({ model, children, deliveryChildren, completionPhase, completionChildren }: {
  model: LifecycleTimelineModel;
  children?: ComponentChildren;
  deliveryChildren?: ComponentChildren;
  completionPhase?: LifecyclePhase;
  completionChildren?: ComponentChildren;
}) {
  return (
    <section class="lifecycle-timeline" aria-label="Change lifecycle">
      <div class="lifecycle-timeline-wide">
        <ol class="lifecycle-phases">
          {model.phases.map((phase) => <Fragment key={phase.label}>
            <li class={`lifecycle-phase ${phase.state}${phase.label === model.actionPhase ? " actionable" : ""}`} aria-current={phase.state === "current" ? "step" : undefined}>
              <span class="lifecycle-phase-marker" aria-hidden="true">{phase.state === "complete" ? "✓" : ""}</span>
              <span class="lifecycle-phase-label">{phase.label}</span>
              {phase.label === model.actionPhase && <section class="lifecycle-phase-action" aria-label={`Available action for ${phase.label}`}>{children}</section>}
              {phase.label === completionPhase && <section class="lifecycle-phase-completion" aria-label={`Completion check for ${phase.label}`}>{completionChildren}</section>}
            </li>
            {phase.label === "Done" && <li class={`lifecycle-pr-checkpoint ${model.pullRequest.state}`} aria-label={`Pull request: ${model.pullRequest.label}`}>
              <span class="lifecycle-pr-marker" aria-hidden="true">{model.pullRequest.state === "ready" || model.pullRequest.state === "merged" ? "✓" : ""}</span>
              <span class="lifecycle-pr-label">Pull request</span>
              <span class="lifecycle-pr-state">{model.pullRequest.label}</span>
              {model.pullRequest.url && <a href={model.pullRequest.url} target="_blank" rel="noopener noreferrer">{model.pullRequest.number ? `#${model.pullRequest.number}` : "Open PR"}</a>}
              {deliveryChildren}
            </li>}
          </Fragment>)}
        </ol>
        {model.current === "Backlog" && <section class="lifecycle-fast-forward" aria-label="Fast-forward route from Backlog to Implementing">
          <span>Backlog</span><span class="lifecycle-fast-forward-line" aria-hidden="true">⟶</span><span>Implementing</span><strong>Fast-forward is in the action menu</strong>
        </section>}
        {model.artifacts.length > 0 && <ol class="lifecycle-artifacts" aria-label="Artifact milestones">
          {model.artifacts.map((artifact) => <li key={artifact.id} class={`lifecycle-artifact ${artifact.status}`}><span>{artifact.label}</span><span class="lifecycle-artifact-state">{artifact.status}</span></li>)}
        </ol>}
      </div>
      <div class="lifecycle-status" aria-live="polite">
        {model.validation && <span>{model.validation}</span>}
        {model.localProgress && <span>{model.localProgress}</span>}
        {model.persistence.map((item) => <span key={item.id}>{item.label}{item.pullRequestUrl && item.pullRequestNumber && <> · <a href={item.pullRequestUrl} target="_blank" rel="noopener noreferrer">PR #{item.pullRequestNumber}</a></>}</span>)}
      </div>
      {!model.actionPhase && <div class="lifecycle-timeline-action">{children}</div>}
    </section>
  );
}
