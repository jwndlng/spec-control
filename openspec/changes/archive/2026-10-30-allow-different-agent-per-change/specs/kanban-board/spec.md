# Spec Delta

## ADDED Requirements

### Requirement: A card follows its change's agent
A card SHALL offer the starters available for its change's agent (`agent-sessions`: "A change may use an agent other
than its project's") — narrowed to the prompts that profile has, and disabled with an explanation naming that profile
when its executable is not found — instead of its repository's agent. When the change has an agent override, the card
SHALL show that profile's name in its footer as text, with a tooltip saying that the change uses this agent instead of
the project's; without an override the card SHALL show no agent name. The card SHALL NOT offer a control that changes
the override.

#### Scenario: A card with an override
- **WHEN** change `rotate-keys` has the override `codex` and the project uses `claude`
- **THEN** its card shows "Codex" in its footer and its split button starts `codex`, while the project's other cards show no agent name

#### Scenario: The overriding agent lacks a prompt
- **WHEN** change `rotate-keys` in `Backlog` has the override `my-agent`, whose profile has an Implement prompt but no Draft prompt
- **THEN** its card offers Implement and no Draft artifacts
