# Design

## Context

Ship may run deterministic background git and GitHub operations while the UI offers little confirmation that it started or finished. Users cannot tell whether to wait, retry, or look for a PR.

## Goals / Non-Goals

Implement only the UI/API concern in this proposal. Preserve permission policy, project defaults, explicit Ship gating, PR descriptions, and automatic merge rules.

## Decisions

The existing ship-button-should-only-block-implement change owns explicit Ship gating and the returned PR URL/result contract. Consume that contract rather than implement a competing task gate or response shape. This session owns presentation and ongoing operation status. Allocate a stable operation identity at request acceptance and return/query its server-derived state so the UI is not dependent on a single pending HTTP response. Share the existing Ship serialization with status records and retry; do not start an agent to report progress. Distinguish preflight confirmation from actual shipping. Immediately show Shipping and disable duplicate Ship controls, then show only stages the server actually reports: preparing/committing, pushing, opening or finding PR, refreshing. Render an accessible result with Open PR and optional copy URL once the PR identity is verified. Errors name the failed step and preserve verified partial outcomes (for example pushed but PR creation failed). Retry rechecks git and remote state, reuses the same open PR, and never force-pushes or duplicates a PR. Keep the result visible until dismissed or superseded; tab switches and session-list refreshes do not erase it. After navigation/reload, reconcile a known active operation from server status. Never announce success on timeout, transport loss, unsent prompt, or task-preflight cancellation. Lifecycle delivery may later consume the same status primitives; this change does not implement its automatic triggers or merge policy.

## Risks / Trade-offs

- Shared session UI changes may conflict with the timeline session → keep changes scoped and preserve a single control owner when reconciling.
- An async request can fail after a side effect → render only verified state and recover from server evidence rather than guessing.

## Migration Plan

Use the existing saved config/session contracts where possible. Land predecessor contracts before implementation where declared. Update fake/demo clients with API changes and preserve old records on read. Rollback leaves current profile overrides, git work, and PRs intact.
