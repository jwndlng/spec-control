# Design

## Context

The detail header currently places task progress alongside change identity and state. The lifecycle timeline already owns phase actions and artifact milestones, so local progress can be displayed at the phase it describes.

## Goals / Non-Goals

**Goals:** Put draft artifact progress in Drafts and task progress in Implementing; keep the optional Draft action in Drafts while Implement remains in Implementing; center checkpoint controls and completion confirmation.

**Non-Goals:** Change how the server derives stage, artifacts, tasks, or action eligibility. Change delivery status or progress.

## Decisions

- Reuse the existing accessible `Meter` component for artifact and task progress, with an explicit unit label in the timeline.
- Keep schema artifact dots under Drafts and display the aggregate artifact meter beside them.
- When an unfinished optional artifact keeps Draft artifacts available on a Ready change, render that action as a separate control in Drafts and filter it from the Implementing action menu. Keep other actions under their existing phase.
- Keep the timeline model's progress evidence sourced only from the existing snapshot. Do not derive missing tasks or artifacts.
- Center progress meters, actions, and completion confirmation within their phase checkpoints.

## Risks / Trade-offs

- The Draft action is split from the normal action menu only for this Ready state; both controls must retain the existing eligibility and start behavior.
- Narrow timelines may need horizontal scrolling to keep phase checkpoints readable.

## Migration Plan

No data migration. Existing snapshots provide the progress inputs.
