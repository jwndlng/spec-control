# Design

## Context

`recordBranchInWorktree` currently locates only existing `.openspec.yaml` files. Deterministic Archive moves a markerless change into its archive directory before recording `archive-branch`, so the recording step fails even though the archived change directory is present. See the proposal and `agent-sessions` delta for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Record session branches for legacy changes without metadata markers.
- Keep all writes inside the session worktree and retain path safety checks.
- Preserve existing marker content and atomic replacement behavior.

**Non-Goals:**

- Add metadata to the main checkout or rewrite existing changes during scanning.
- Change how project or per-change schemas are inferred.

## Decisions

- Resolve a marker path from an existing active or archived change directory, even when the marker file itself is absent. Prefer archived paths for `archive-branch`, as today.
- For an absent marker, verify every parent segment with `lstat`, then create the branch-only marker using exclusive creation (`wx`). This prevents overwriting a marker created concurrently and emits only `spec-control.<branch-key>`; project schema inheritance remains unchanged.
- Keep the existing temporary-sibling-and-rename flow when a marker already exists. Skipping branch recording was rejected because scans and cleanup use the recorded branch as evidence.

## Risks / Trade-offs

- A legacy archive without a marker gains a minimal `.openspec.yaml` → The project-level schema remains authoritative because the new marker omits `schema`; existing marker files are not rewritten.
- A change directory can disappear or be replaced by a symlink during startup → Recheck path segments and use exclusive file creation; refusal leaves no file outside the worktree.
