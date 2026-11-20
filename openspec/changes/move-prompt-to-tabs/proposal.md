# Proposal

## Why

The change prompt currently occupies the detail header above the artifact tabs, where it competes with status and lifecycle information. Moving it into the tab strip gives it a consistent place beside the proposal, design, specs, tasks and Console while keeping the header focused on change facts.

## What Changes

- Add a Prompt tab to change detail when the change has readable prompt text, and show the prompt body in that tab.
- Remove the prompt body from the detail header while preserving the existing behavior of stripping the generated `# Prompt` heading.
- Keep prompt selection in the detail URL and preserve it across refreshes like other tabs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Move prompt display from the header into a selectable tab alongside the change artifacts.

## Impact

Affects the change detail UI and its tab selection/rendering, the `change-detail` specification, and focused UI tests. No API or persisted data changes are needed; prompt text already comes from the change snapshot.
