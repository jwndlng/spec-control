# Design

## Context

The lifecycle timeline already receives the current phase, phase-specific pull requests discovered through `.openspec.yaml` branch records, and lifecycle delivery records. The Drafts checkpoint currently reports an unshipped state whenever implementation has begun but no Drafts PR is linked.

## Goals / Non-Goals

**Goals:**
- Distinguish an intentionally passed Drafts delivery from one that is still upcoming or unshipped.
- Preserve visible status for any recorded PR or delivery attempt.

**Non-Goals:**
- Persist a separate “Drafts skipped” flag in `.openspec.yaml`.
- Change proposal delivery, branch discovery, or Ship behavior.

## Decisions

- Derive “Skipped” when the timeline's visual phase has reached Implementing and the proposal phase has neither a linked PR nor a delivery record. The visual phase accounts for snapshot stage and lifecycle session progress.
- Give existing PR and delivery evidence precedence. This prevents the skipped state from hiding a linked PR, a shipping operation, or a recorded failure.
- Keep `.openspec.yaml` for explicit metadata such as recorded branch names. A skipped delivery is fully derivable from existing phase and delivery evidence, so persisting a second flag would add a source of stale state.

## Risks / Trade-offs

- [Phase history can be ahead of the snapshot] → Use the timeline's already-computed visual phase so a started implementation session is reflected promptly.
- [Delivery evidence may arrive later] → Recompute from the current PR and delivery data on each render; the checkpoint transitions from Skipped when evidence becomes available.
