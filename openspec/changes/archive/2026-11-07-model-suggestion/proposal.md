# Proposal

## Why

Drafting a change with a capable reasoning model gives Spec Control a chance to assess the implementation before an agent starts coding. Today, per-phase model settings apply uniformly to every change, so users cannot use a cheaper configured Implement model for straightforward work while retaining the Draft model for changes that need deeper implementation reasoning.

## What Changes

- Have Draft artifacts assess implementation complexity and choose between the configured Draft and Implement models for that change.
- Record the choice with the change and use it when starting Implement, without changing the global or profile model settings.
- Show the recorded choice in the change detail view.
- Leave model selection unchanged when either candidate model is not configured or the change has no recorded choice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Use a recorded per-change implementation model choice when starting Implement, ahead of the profile phase model, while leaving other starters and defaults unchanged.
- `change-detail`: Show the per-change implementation model choice and let the user clear it.
- `change-scanner`: Read and validate the optional model choice recorded in a change's `.openspec.yaml`.

## Impact

- `src/server/sessions/`: resolve and apply a per-change Implement model choice.
- `src/server/frameworks/openspec/`, `src/server/scanner.ts`, `src/shared/types.ts`: read the optional metadata from `.openspec.yaml`.
- `src/server/` API and `src/ui/` change detail: expose, clear, and display the choice.
- `test/`: cover model-choice parsing, persistence, launch resolution, and change-detail behavior.
- OpenSpec's existing `.openspec.yaml` metadata and the `models-per-phase` model configuration; no new model provider or hard-coded model name.
