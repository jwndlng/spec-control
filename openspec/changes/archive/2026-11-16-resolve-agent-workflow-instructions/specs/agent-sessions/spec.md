## ADDED Requirements

### Requirement: Managed actions have a verified OpenSpec workflow
Before launching a managed OpenSpec action, the dashboard SHALL verify its workflow in the actual session checkout. It SHALL resolve readable project skill instructions or supply the supported OpenSpec CLI workflow as a fallback. Missing skill discovery SHALL NOT authorize improvised artifact editing or bypass blocked state, context, task tracking, or verification. Missing CLI and skill support SHALL produce an actionable setup blocker.

#### Scenario: Fresh worktree lacks untracked skills
- **WHEN** the main checkout has untracked agent skills that are absent from a fresh session worktree
- **THEN** the dashboard does not claim those skills are available and uses a verified CLI fallback or reports the setup blocker

#### Scenario: Skill exists outside runtime discovery
- **WHEN** a readable repository OpenSpec skill exists in a project directory not automatically discovered by the selected runtime
- **THEN** the action provides its resolved checkout-relative path explicitly instead of relying only on a skill name or another runtime's slash command

#### Scenario: Apply falls back to CLI instructions
- **WHEN** openspec-apply-change cannot be resolved but the installed CLI supports status and apply instructions
- **THEN** the agent receives the selected change, status and instructions commands, resolved context files, task tracking rules, and blocked-state handling, rather than permission to invent a workflow

#### Scenario: Workflow unavailable
- **WHEN** neither a readable compatible skill nor the required CLI workflow is available
- **THEN** launch is blocked with the missing capability and a project setup action; global agent settings are not changed automatically

#### Scenario: Runtime parity
- **WHEN** Codex or Antigravity starts the same managed action in equivalent fresh worktrees
- **THEN** both receive the same workflow contract and action boundaries without requiring identical native skill-discovery behavior
