# Design

## Context

Proposal sessions use `docs/<change>` and record that branch in the same `.openspec.yaml` field used by implementation sessions. Phase PR matching must classify that exact branch before considering it for Implementation. Draft milestone labels share the narrow Drafts checkpoint, so line wrapping makes the row taller and harder to scan.

## Goals / Non-Goals

**Goals:**
- Keep the proposal branch exclusive to the Drafts checkpoint.
- Display artifact milestone names without line wrapping while retaining full accessible names.

**Non-Goals:**
- Change how `.openspec.yaml` records branch identity.
- Change PR selection for implementation branches or other delivery phases.

## Decisions

- Exclude `proposalBranch(change.name)` from the Implementation checkpoint's recorded branch candidates. `.openspec.yaml` remains the durable branch record; no additional phase field is needed.
- Prevent wrapping on the visual artifact labels. Keep their complete text in the existing title and accessible label so narrow presentation does not discard the actual milestone name.

## Risks / Trade-offs

- [A custom implementation branch may resemble the proposal branch] → The exact managed proposal branch remains reserved for proposal delivery, consistent with the existing proposal PR classifier.
- [Long schema-specific artifact names can extend beyond a narrow segment] → Keep text single-line and preserve its full value in the tooltip and accessible label.
