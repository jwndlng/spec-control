# Individual session plan

The original implementation proposal has been split into seven scoped changes. This parent change is a coordination index only; do not implement or archive the child changes from this worktree. Each child has proposal, design, tasks, the appropriate spec deltas (except the structure-only repair), a SESSION.md launch prompt, its own branch, and a dedicated worktree. Nothing here is an implementation result.

## Changes and required order

| Change | Merge these predecessors first | Worktree |
| --- | --- | --- |
| `repair-permission-spec-structure` | None | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/repair-permission-spec-structure |
| `resolve-agent-workflow-instructions` | `repair-permission-spec-structure` | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/resolve-agent-workflow-instructions |
| `automate-lifecycle-delivery` | `repair-permission-spec-structure`, `resolve-agent-workflow-instructions` | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/automate-lifecycle-delivery |
| `simplify-overview-messages` | None | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/simplify-overview-messages |
| `add-change-lifecycle-timeline` | `automate-lifecycle-delivery` | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/add-change-lifecycle-timeline |
| `make-change-dismissal-reversible` | `repair-permission-spec-structure` | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/make-change-dismissal-reversible |
| `recognize-merged-cleanup-branches` | None | /Users/jan/Workspace/projects/spec-control/.claude/worktrees/recognize-merged-cleanup-branches |

Start spec repair, overview messages, and cleanup as independent sessions. Start workflow discovery and dismissal after spec repair. Start delivery after workflow discovery and spec repair. Start the timeline after delivery provides its API/view-model contract.

Cleanup and delivery both touch PR evidence fields; cleanup owns merged head/merge commit fields, while delivery owns checks/protection evidence. Land cleanup's shared evidence additions before reconciling delivery's parser changes when both are in flight. Dismissal and timeline touch change detail and board/session presentation; dismissal owns its menu/filter only, timeline owns layout and lifecycle controls. Prefer landing dismissal's controls before the final timeline layout, without making independent backend work wait. Help/shared API/demo edits stay within each proposal's concern and must be rebased against earlier merges.

The existing ship-button-has-no-description, ship-button-should-only-block-implement, and add-validate-phase proposals remain separate and unchanged. Their contracts and ownership are listed in child SESSION.md files. Required predecessors are recorded in depends-on.yaml. Completion of planning is not completion of implementation.

## Launching a session

Open a new Codex or Antigravity session in the desired worktree and paste the Start here paragraph from its `openspec/changes/<name>/SESSION.md`. Each handoff explicitly names the tracked Claude skill path and CLI fallback, avoiding the current missing-native-skill-discovery trap. Work only on that child change's branch.

Before implementation, fetch origin and update the session's own branch against merged origin/main after its required predecessors land. Never edit or merge into the main checkout. Keep any overlapping spec updates scoped to the child delta. A missing predecessor is a reason to wait, not to silently implement it inside the wrong change.

## Review decisions preserved

Drafts → Ready persists and merges the proposal independently of optional docs auto-merge. Code implementation PRs open automatically but require human merge. Dismiss means reversible hiding; Delete change files is separately destructive. While an agent remains running, explicit current-action completion intent plus independently verified outputs is required before automatic publication; stable files alone do not prove finished drafting.

## Planning validation

Run openspec validate <child-name> --strict in each child worktree. The current main agent-sessions and dashboard-api specs contain misplaced delta headers; the repair session removes those structural defects before later deltas can be archived. Such informational upstream archive warnings do not mean child implementation is already complete.

## Ready planning commits

- `repair-permission-spec-structure`: `fb442ef`; planning committed; implementation pending.
- `resolve-agent-workflow-instructions`: `15cbbf3`; planning committed; implementation pending.
- `automate-lifecycle-delivery`: `252828d`; planning committed; implementation pending.
- `simplify-overview-messages`: `555b6d6`; planning committed; implementation pending.
- `add-change-lifecycle-timeline`: `9f0e820`; planning committed; implementation pending.
- `make-change-dismissal-reversible`: `dac1106`; planning committed; implementation pending.
- `recognize-merged-cleanup-branches`: `7d5a57c`; planning committed; implementation pending.

All seven children passed strict change validation and report apply state ready. Their dependency graph is acyclic. Branches and handoffs are local; no proposal PR has been pushed or merged. Start sessions in the listed worktrees rather than expecting the child artifacts on main.
