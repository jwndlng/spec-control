# Proposal

## Why

A project already set up for OpenSpec may need another agent tool, such as Codex, or refreshed instructions. Spec Control offers initial setup but no discoverable way to revisit it for a managed project.

## What Changes

- Offer an OpenSpec setup action in each managed OpenSpec project's settings, with guidance for adding tools and refreshing instructions.
- Use the project's existing console and its agent to make changes interactively, preserving existing tool selections and letting the user decide what to install.
- Explain that the agent works in the project folder and report unavailable console conditions clearly.

## Capabilities

### New Capabilities

- `openspec-settings-update`: Guide users through updating OpenSpec tool support and instructions for a managed project.

### Modified Capabilities

None.

## Impact

- Project settings UI and project console integration in `src/ui/`, with corresponding demo behavior if needed.
- Help content and What's new entry; UI and integration tests under `test/`.
- OpenSpec CLI is used by the user's agent, not invoked by Spec Control; no new dashboard writes to tracked repositories or new server endpoints are required.
