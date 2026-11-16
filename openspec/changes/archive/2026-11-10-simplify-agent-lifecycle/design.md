# Design

## Context

This is the coordination plan for seven individual OpenSpec implementation sessions. SESSION-PLAN.md is the authoritative handoff index. The original broad proposal is preserved in git history; implementation contracts now live only in the child changes.

## Goals / Non-Goals

Make individual sessions ready to start with explicit ownership and dependencies. This parent does not own behavior changes or implementation tasks.

## Decisions

Separate low-coupling concerns into dedicated changes. Keep delivery and docs merge policy together because they share the session state machine. Require predecessor merges where API/workflow contracts are needed. Preserve the existing shipping-description, Ship-gating, and validation proposals as separate owners.

## Risks / Trade-offs

Shared-file merge conflicts remain possible; each child has concern-specific ownership and landing guidance. Dedicated worktrees isolate uncommitted work. The index prevents accidental duplicate implementation of the former umbrella.
