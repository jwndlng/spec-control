# Design

## Context

The timeline receives all phase delivery records but currently reduces them to one implementation PR checkpoint. The detail view also has the cached repository PR list and the selected session state. The existing flexible list layout positions connector lines relative to each item's left edge, which causes markers and line centers to drift as phase content widths vary.

## Goals / Non-Goals

**Goals:** Make phase geometry predictable, put each phase's PR state at the associated checkpoint, and reserve motion for real work.

**Non-Goals:** Change server delivery semantics, GitHub refresh behavior, or action eligibility.

## Decisions

- Use equal grid columns for phase checkpoints, with each marker at the column center and connectors spanning from center to center. Allow horizontal scrolling only when minimum widths cannot fit.
- Represent each delivery checkpoint from the latest delivery for its phase plus the PR with that delivery's PR number in the already cached repo list. Keep implementation's existing fallback linked PR for legacy/no-delivery cases.
- Derive active phase animation from a running session reporting active work, while shipping/checking states animate their own delivery marker. Waiting, ready, Done, and Ready never pulse merely because they are the current/next stage.
- Render artifact milestones as a centered horizontal row that can wrap within the Drafts checkpoint.

## Risks / Trade-offs

- [Cached PR data can be stale] → Use the same cached snapshot and explicit delivery state already shown in detail; do not add network refreshes.
- [Six equal columns plus nested checkpoints can be wide] → Keep the phase rail horizontally scrollable and make small artifact milestones wrap within their phase.
