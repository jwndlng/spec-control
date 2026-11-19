# Design

## Layout

Keep the nine phase and PR checkpoints on one equal-width grid row. Let the grid use the timeline container's full available width, wrap labels and compact controls, and clip no content. The existing progress fill remains aligned because each checkpoint is evenly spaced.

## Git observation

Lifecycle evidence is best-effort. Resolve the executable through the shared Git locator and pass its absolute path to `Bun.spawn`. If Git is unavailable or the worktree cannot be read, return no evidence so the coordinator waits for a later scan; do not log a spawn failure on every observation.
