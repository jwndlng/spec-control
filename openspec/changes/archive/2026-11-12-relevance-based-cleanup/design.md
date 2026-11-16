# Design

## Context

See proposal.md for the motivation and specs/repository-cleanup/spec.md for the preview behavior. Cleanup currently reads branch commit dates and worktree commit dates, but branch eligibility stops as soon as it finds commits outside the base. Worktree eligibility is delegated to `readWorkStatus` and `checkWorktreeRemovable`. The preview and apply path share the same judges, so changes to eligibility must remain safe when confirmation is re-checked.

## Goals / Non-Goals

**Goals:**
- Apply the same active-change and recency rules to worktree and branch previews.
- Keep apply-time checks authoritative and preserve existing safety gates.
- Explain kept items with a reason that identifies active-change protection or recent unmerged work.

**Non-Goals:**
- Change cleanup execution, confirmation, backup, or deletion behavior.
- Infer activity from agent sessions or remote pull requests beyond the existing session safeguard.

## Decisions

- Determine active changes from the repository's active `openspec/changes/<name>/` directories and associate work when the branch name equals the change name or ends in `/<name>` (for example, `feat/rotate-keys`). Archived changes do not protect work. This keeps the rule local and deterministic without querying an agent or remote service.
- Use the existing latest-commit timestamps and a 30-day age boundary for unmerged work. Merged work remains eligible independent of age, after all existing worktree safety checks pass.
- Centralize eligibility in the existing worktree and branch judges, which are called by both preview and apply. The apply path therefore re-evaluates current files, dates, merge state, sessions, locks, and branch ownership.
- Keep existing `CleanupWorktree` and `CleanupBranch` reason fields as the user-facing explanation; no new persisted data or API shape is needed.
- Alternative considered: treat every unmerged branch as protected until a separate archival signal exists. That preserves the current behavior and does not address old unrelated work; recent commit time provides a bounded local signal.

## Risks / Trade-offs

- [A branch/change name match can protect unrelated work that happens to share a name] → Require an exact full branch name or exact final path segment and keep all existing safeguards; this is conservative because it only prevents cleanup.
- [Commit dates can be rewritten or missing] → Treat missing or invalid timestamps as recent/unknown and keep the item, avoiding unsafe deletion.
- [A change directory can appear or disappear between preview and confirmation] → Re-read active change directories in the shared apply-time judge.
