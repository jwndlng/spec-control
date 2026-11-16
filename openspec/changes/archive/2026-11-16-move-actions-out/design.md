# Design

## Context

The change Console tab renders Ship separately from a native disclosure containing pull request, change, and session action groups. The groups already filter unavailable controls; see `sessionPanel.tsx` and the `.console-more-actions` styles. See proposal.md for motivation and specs/change-detail/spec.md for the behavior contract.

## Goals / Non-Goals

**Goals:** Remove the extra disclosure interaction while preserving the existing grouping and responsive action layout.

**Non-Goals:** Change which actions appear, their labels or handlers, Ship progress, or the separate main and project consoles.

## Decisions

- Render the existing action groups directly in the Console header and remove the disclosure wrapper. This reuses the current action components and group conditions; a second action layout would risk behavior drift.
- Retain category headings and spacing, adjusting the existing styles only as needed for the always-visible layout. Keep Ship in its current primary section.

## Risks / Trade-offs

- [More controls increase the Console header's height] → Keep the category groups compact and let the existing Console panel layout contain the added content.
