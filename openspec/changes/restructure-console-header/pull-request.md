# Reviewer summary

## Problem

The Console panel header takes too much room from the terminal, keeps configuration controls expanded, and duplicates Ship outside the lifecycle timeline. The destructive detail actions also lack a persistent outline at rest.

## Intended outcome

Keep agent, project, branch, session state and work status at the Console panel's top left, with End session and Open in editor at the top right and no visible “Session actions” heading. Collapse the agent and permission dropdowns behind an accessible settings gear. Give the terminal at least 80% of the panel height, keep Ship in the timeline delivery checkpoint, and add persistent borders to Dismiss change and Delete change files.

## Planned verification

- Verify wide and narrow Console layouts, including top-left context, top-right controls, collapsed settings and terminal space.
- Run `bun test test/sessionPanelUi.test.ts test/changeDetail.test.ts` for Console and detail action behavior.
- Run `bun run check` to verify the What's new entry and full project checks.
