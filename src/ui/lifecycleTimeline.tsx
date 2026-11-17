import type { ArtifactStatus, ChangeSnapshot } from "../shared/types.ts";
import type { ComponentChildren } from "preact";
import type { LifecycleDeliveryView } from "./api.ts";

export const LIFECYCLE_PHASES = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export interface LifecycleTimelineModel {
  current: LifecyclePhase;
  phases: { label: LifecyclePhase; state: "complete" | "current" | "upcoming" }[];
  artifacts: { id: string; label: string; status: string }[];
  validation?: string;
  localProgress?: string;
  persistence: { id: string; label: string; pullRequestNumber?: number; pullRequestUrl?: string }[];
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
): LifecycleTimelineModel {
  const current = change.archived ? "Archived" : stagePhase[change.stage];
  const currentIndex = LIFECYCLE_PHASES.indexOf(current);
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
  return {
    current,
    phases: LIFECYCLE_PHASES.map((label, index) => ({ label, state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming" })),
    artifacts: artifacts.map(({ id, status }) => ({ id, label: humanize(id), status })),
    ...(change.subState === "validate" ? { validation: "Validation awaiting confirmation" } : {}),
    ...(change.tasks ? { localProgress: `${change.tasks.done}/${change.tasks.total} tasks complete${change.tasks.awaiting ? ` · ${change.tasks.awaiting} awaiting confirmation` : ""}` } : {}),
    persistence,
  };
}

export function LifecycleTimeline({ model, children }: { model: LifecycleTimelineModel; children?: ComponentChildren }) {
  return (
    <section class="lifecycle-timeline" aria-label="Change lifecycle">
      <div class="lifecycle-timeline-wide">
        <ol class="lifecycle-phases">
          {model.phases.map((phase) => <li key={phase.label} class={`lifecycle-phase ${phase.state}`} aria-current={phase.state === "current" ? "step" : undefined}>{phase.label}</li>)}
        </ol>
        {model.artifacts.length > 0 && <ol class="lifecycle-artifacts" aria-label="Artifact milestones">
          {model.artifacts.map((artifact) => <li key={artifact.id} class={`lifecycle-artifact ${artifact.status}`}><span>{artifact.label}</span><span class="lifecycle-artifact-state">{artifact.status}</span></li>)}
        </ol>}
      </div>
      <details class="lifecycle-timeline-narrow">
        <summary>Current: {model.current}{model.phases[model.phases.findIndex((phase) => phase.state === "current") + 1] ? ` · Next: ${model.phases[model.phases.findIndex((phase) => phase.state === "current") + 1].label}` : ""}</summary>
        <ol class="lifecycle-phases">{model.phases.map((phase) => <li key={phase.label} class={`lifecycle-phase ${phase.state}`} aria-current={phase.state === "current" ? "step" : undefined}>{phase.label}</li>)}</ol>
        {model.artifacts.length > 0 && <ol class="lifecycle-artifacts">{model.artifacts.map((artifact) => <li key={artifact.id}>{artifact.label}: {artifact.status}</li>)}</ol>}
      </details>
      <div class="lifecycle-status" aria-live="polite">
        {model.validation && <span>{model.validation}</span>}
        {model.localProgress && <span>{model.localProgress}</span>}
        {model.persistence.map((item) => <span key={item.id}>{item.label}{item.pullRequestUrl && item.pullRequestNumber && <> · <a href={item.pullRequestUrl} target="_blank" rel="noopener noreferrer">PR #{item.pullRequestNumber}</a></>}</span>)}
      </div>
      <div class="lifecycle-timeline-action">{children}</div>
    </section>
  );
}
