# Design

## Context

The timeline currently uses a nine-column grid to alternate six phase nodes with three standalone PR nodes. Artifact milestone names are full-width text inside the Drafts phase. See `proposal.md` and `specs/change-detail/spec.md` for the intended behavior.

## Goals / Non-Goals

**Goals:**
- Use six evenly spaced phase columns and place each PR status, link, and delivery action inside its owning phase.
- Keep full artifact names accessible while shortening their visible milestone labels.
- Preserve current delivery state derivation, actions, links, and eligibility rules.

**Non-Goals:**
- Changing which branch or pull request belongs to a lifecycle phase.
- Changing shipping, conflict recovery, phase completion, or agent session behavior.

## Decisions

- Keep the lifecycle model and delivery state calculation intact. Change only the timeline's rendered structure and grid mapping so the UI continues to use the same server evidence and action props.
- Render a compact, labeled delivery row as a child of Drafts, Implementing, or Archived. Omit an upcoming delivery row until that phase has started; show skipped and all recorded delivery states. This avoids adding three empty status labels to every timeline.
- Keep one status marker with a short text label and optional PR number/link inside each delivery row. Place retry, Ship, and conflict recovery controls in that row as they are today, but inside the owning phase node.
- Render `Pro`, `Spe`, `Des`, and `Tas` for the standard artifacts. Derive a three-character visible label for other schema artifacts; retain the full label and state in the element's accessible name and tooltip.
- Use consecutive grid columns for the six phases. Keep progress-line fill based on the current phase's center so node alignment and line progress share the same coordinates.

## Risks / Trade-offs

- Phase nodes containing both local progress and delivery controls can become tall. Keep delivery presentation inline and compact, and avoid showing future PR states until needed.
- Three-character labels can be ambiguous for unfamiliar schema artifacts. Their full names remain available on hover and to assistive technology.
- Removing the intermediate columns shifts phase centers. Update the progress-line geometry and add layout assertions for each phase and its delivery row.
