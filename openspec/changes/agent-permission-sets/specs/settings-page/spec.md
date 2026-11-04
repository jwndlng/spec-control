# Spec Delta

## ADDED Requirements

### Requirement: Agent sessions settings configure permission profiles and show capability matrix
The Agent sessions section in Settings SHALL provide controls to configure agent permission profiles and inspect agent capabilities:
1. A **Default permission profile** selector under general agent settings offering `minimum`, `less-friction` (marked as recommended), and `full-automation`.
2. When `full-automation` is selected, secondary opt-in checkboxes for **Autonomous pull request merge** (`optInMerge`) and **Autonomous worktree and branch cleanup** (`optInCleanup`), both disabled by default.
3. An **Agent capability matrix** table displaying the permission capabilities and differences across Claude Code, OpenAI Codex, and Antigravity, including:
   - Tool-level restriction granularity (command regex/pattern filtering vs workspace-level sandbox);
   - Worktree filesystem isolation support;
   - PR creation and git remote interaction support;
   - Unattended execution capabilities and approval models.
4. An **Effective CLI arguments preview** showing the exact flags and settings injected into each configured agent CLI for the chosen profile.
5. A **Protected commands list** detailing operations that always require interactive confirmation regardless of the selected profile (such as recursive deletion `rm -rf`, `git push --force`, `git reset --hard`, and `sudo`).

#### Scenario: Selecting less-friction shows recommended badge
- **WHEN** the user views the permission profile selector in Agent sessions settings
- **THEN** the `less-friction` option is present and labeled as recommended

#### Scenario: Full-automation exposes sub-capability toggles
- **WHEN** the user selects `full-automation` in Settings
- **THEN** checkboxes for autonomous PR merge and autonomous branch cleanup appear unchecked by default

#### Scenario: Capability matrix displays cross-agent differences
- **WHEN** the user inspects the capability matrix in Settings
- **THEN** the matrix explicitly notes that Claude Code supports command-level filtering whereas Codex enforces workspace-level filesystem boundaries

#### Scenario: Protected commands are displayed
- **WHEN** the user views the permission profile panel in Settings
- **THEN** the protected commands list displays operations that always require confirmation (including recursive deletion and force push)

### Requirement: Settings displays runtime limitation disclosures and effective CLI previews
The Settings page SHALL display an interactive preview and security disclosure before saving changes to permission profiles:
1. The preview SHALL present the exact CLI flags that will be appended to agent invocations for all enabled agents.
2. The page SHALL display an immutable security notice stating: "Running tests, linters, and package scripts executes repository code. Automated profiles do not isolate your system from malicious code within the repository."
3. The page SHALL clearly highlight any known limitations of the selected profile for each installed agent runtime (e.g., lack of fine-grained bash command filtering in Codex, or inability to auto-approve network egress).

#### Scenario: CLI preview reflects profile selection
- **WHEN** the user switches the selected profile from `minimum` to `less-friction`
- **THEN** the CLI preview updates immediately to show `--permission-mode acceptEdits` for Claude Code and `--sandbox workspace-write` for Codex

#### Scenario: Security notice is displayed
- **WHEN** Settings is viewed with any permission profile
- **THEN** the repository code execution security notice is visible within the Agent sessions permission panel
