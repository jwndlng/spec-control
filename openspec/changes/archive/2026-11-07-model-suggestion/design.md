# Design

## Context

See [proposal.md](proposal.md) for the motivation and [specs/agent-sessions/spec.md](specs/agent-sessions/spec.md), [specs/change-scanner/spec.md](specs/change-scanner/spec.md), and [specs/change-detail/spec.md](specs/change-detail/spec.md) for behavior. The `models-per-phase` change supplies model resolution for each starter. OpenSpec changes already carry optional dashboard metadata in `.openspec.yaml` under `spec-control:`; the scanner exposes validated metadata and the detail view reads it.

## Goals / Non-Goals

**Goals:**

- Reuse the configured Draft and Implement models as the two candidates.
- Keep the complexity decision scoped to one change and one Implement starter.
- Preserve model selection behavior for existing changes and for all other starters.
- Keep the UI read-only toward repository files.

**Non-Goals:**

- Selecting or checking model availability, pricing, or provider capabilities.
- Changing global, profile, or phase model settings.
- Allowing the dashboard UI to edit `.openspec.yaml`.

## Decisions

### Store the selected model in change metadata

Use `spec-control.implement-model` in the change's `.openspec.yaml`. This marker is already the home for Spec Control's change-specific metadata, and the selected model belongs to one change rather than to a project or agent profile. Preserve other marker keys when the Draft agent writes it, including an existing branch record. A missing or invalid value is treated as absent.

**Alternative considered:** Store a map of per-change model overrides in the global dashboard configuration. That would put repository-specific change state outside the change and require config migration and cleanup as changes are archived or removed.

### Supply candidates and record guidance in the Draft session

When starting Draft artifacts, resolve the effective Draft and Implement models with the existing phase hierarchy. If both resolve to distinct model names, append a short instruction with those exact candidates. Ask the Draft agent to assess the implementation work described by the artifacts, choose the Draft model for complex work or the Implement model for straightforward work, and write the selected value under `spec-control.implement-model`. If either candidate is missing or they match, add no model-choice instruction. Do not infer the choice from terminal output.

**Alternative considered:** Have Spec Control analyze generated artifacts itself. That would require introducing another model call or an unreliable heuristic, while the drafting agent already has the change context and reasoning capability.

### Apply the choice only to Implement

When starting Implement, resolve the change's recorded choice before the profile's normal Implement phase resolution and pass the result through the model argument handling from `models-per-phase`. Draft, Validate, Archive, console, and other changes continue to use their existing resolution. A currently running session keeps its launch arguments.

**Alternative considered:** Change the profile's Implement model when Draft finishes. That would affect every change using the profile and make model settings depend on session order.

### Validate metadata at the framework boundary

Parse `spec-control.implement-model` with the same single-line, non-empty, bounded model-string validation used for configured model values. Invalid data is ignored as absent, rather than making a change unreadable. Include the optional value in the neutral change data so the API and detail view remain framework-neutral.

## Risks / Trade-offs

- [Risk] Complexity classification is an agent judgment and can be wrong. → The recorded choice is visible in the change detail, and the user can inspect the artifacts and marker.
- [Risk] The configured phase models may change after a choice is recorded. → Keep the recorded model as an explicit per-change choice until the marker is changed; never silently reclassify on scan.
- [Risk] A malformed or hand-edited marker may contain an unsafe value. → Apply the configured model validator before exposing or passing it to a process; ignore invalid values.

## Migration Plan

No migration is needed. The marker field is optional. Changes without it keep using the model resolution from `models-per-phase`; rollback can remove the optional field from a change marker without changing any global or profile settings.
