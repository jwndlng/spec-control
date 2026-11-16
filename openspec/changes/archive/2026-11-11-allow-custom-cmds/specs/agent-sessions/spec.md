# Spec Delta

## ADDED Requirements

### Requirement: Custom commands belong to one project
A project SHALL support an optional list of custom command prefixes. The list SHALL apply to that project's change sessions and project console, including when a change selects another agent. It SHALL NOT apply to another project, the main console or an integration session. An absent or empty list SHALL preserve existing permissions. Command allowances SHALL NOT change workflow prompts or execute commands themselves.

#### Scenario: Project and change scope
- **WHEN** `demo-ops` allows `bun run lint` and a change selects an agent other than the project's default
- **THEN** the change's effective policy includes that project allowance, and `alpha-infra`, the main console and integration sessions do not inherit it

#### Scenario: Saving is configuration only
- **WHEN** a project command list is saved
- **THEN** no command runs, no workflow prompt changes and no tracked repository or global agent settings file is written

### Requirement: Custom command prefixes use a bounded literal syntax
A custom command prefix SHALL contain whitespace-separated literal tokens using only ASCII letters, digits and `_./:@%+=,-`. Entries SHALL be trimmed, internal spaces collapsed and duplicates removed in first-occurrence order. A list SHALL contain at most 50 entries, each at most 256 characters after normalization. Empty entries, control characters, shell syntax, wildcards, bypass flags and prefixes capable of overriding protected or gated operations SHALL be rejected.

#### Scenario: Normalize literal prefixes
- **WHEN** a list contains `  bun   run lint  `, `bun run lint` and `./scripts/check`
- **THEN** it is stored as `bun run lint` and `./scripts/check` in that order

#### Scenario: Reject executable shell syntax and oversized lists
- **WHEN** an entry includes a newline, `;`, `&&`, a pipe, redirection, quoting, command substitution, a wildcard or a bypass flag, or the list exceeds its bounds
- **THEN** validation refuses the entire update and leaves the previous configuration unchanged

#### Scenario: Reject broad or protected prefixes
- **WHEN** an entry is `git`, `gh pr`, `git push`, `git push --force`, `sudo`, `sh -c` or an interpreter or wrapper prefix that can authorize arbitrary commands
- **THEN** validation refuses it rather than allowing it to cover protected commands or merge and cleanup operations

### Requirement: Custom command allowances respect the effective profile and runtime
Custom prefixes SHALL supplement existing allowances only under `less-friction` and `full-automation`. Matching SHALL respect token boundaries and allow the prefix itself and trailing arguments. Protected rules, merge/cleanup opt-ins and host policies SHALL take precedence. Unsupported runtimes SHALL report unapplied allowances without weakening approval or sandbox settings. Preview and launch SHALL use the same translation.

#### Scenario: Claude receives an additional command allowance
- **WHEN** Claude starts under `less-friction` with `bun run lint` configured
- **THEN** its session permission list allows `bun run lint` and `bun run lint --fix`, keeps the existing defaults and restrictions, and does not allow `bun run lint-extra` through this entry

#### Scenario: Minimum retains planning permissions
- **WHEN** the effective profile is `minimum` and project commands are configured
- **THEN** the commands remain saved but no custom allowance is injected, and the preview explains that they are inactive under this profile

#### Scenario: Unsupported runtime reports the limitation
- **WHEN** custom commands are configured for Codex, Antigravity without session-rule delivery, or an unrecognized agent
- **THEN** the preview says these entries are not applied, and launch preserves that runtime's existing approval and sandbox configuration without writing global settings

#### Scenario: Restrictions outrank custom allowances
- **WHEN** an agent is launched with custom commands while merge and cleanup opt-ins are off
- **THEN** the generated permissions retain protected-command restrictions and the merge and cleanup gates

### Requirement: Command allowance edits take effect on the next agent launch
A running agent SHALL retain its launch permissions when project commands change. Every later process start, including resume and restart of an existing session and project console launch, SHALL resolve the project's latest list. Existing permission-profile inheritance SHALL remain unchanged. The dashboard SHALL NOT restart an agent or submit terminal input as a side effect of saving the list.

#### Scenario: Edit while a session is running
- **WHEN** `bun run lint` is replaced with `bun run typecheck` while an agent runs
- **THEN** the process is unchanged, and its next explicit resume or restart uses the updated project list with its applicable permission profile
