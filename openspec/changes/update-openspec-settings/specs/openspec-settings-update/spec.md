# Spec Delta

## Purpose

Lets users revisit a managed project's OpenSpec tool setup and refresh its generated instructions through the project's agent.

## ADDED Requirements

### Requirement: Managed OpenSpec projects offer setup guidance

The project settings dialog SHALL offer an **Update OpenSpec setup** action for managed OpenSpec projects. It SHALL explain that this can add support for tools such as Codex or refresh generated instructions, and that the project console's agent works directly in the project folder. The action SHALL use the project's existing console availability rules and give a visible reason when unavailable. Projects using other frameworks MUST NOT be offered this OpenSpec-specific action.

#### Scenario: Add a tool
- **WHEN** the user opens the settings of a managed OpenSpec project
- **THEN** Update OpenSpec setup is offered and explains that it can add tool support such as Codex

#### Scenario: Agent unavailable
- **WHEN** the project's console cannot be opened because agent sessions are disabled or its agent is unavailable
- **THEN** the setup action is unavailable and states why

#### Scenario: Another framework
- **WHEN** the user opens settings for a project using another framework
- **THEN** the OpenSpec setup action is not offered

### Requirement: Setup guidance uses the project console

Activating the action SHALL open the existing project console and present a copyable, agent-neutral request to revisit OpenSpec setup. The request SHALL ask the agent to inspect the existing setup, ask the user which tools to add, preserve existing configured tools and project content, use the appropriate OpenSpec CLI setup or update commands, and report the result or any failure. The user SHALL choose whether to copy and send that request; opening the action MUST NOT automatically send it to a running or new console. Existing console sessions and their output SHALL be preserved under the project-console rules. The dashboard MUST NOT run the OpenSpec CLI or itself write project files for this action.

#### Scenario: User adds Codex
- **WHEN** the user opens Update OpenSpec setup, copies and sends the request, and asks the agent to add Codex
- **THEN** the agent can guide the user through adding Codex while retaining the existing tool setup, and the console shows the agent's output

#### Scenario: Existing console
- **WHEN** the project's console is already running and the user opens Update OpenSpec setup
- **THEN** the existing console and its output are shown with the request available to copy, and no text is sent automatically

#### Scenario: Opening alone makes no changes
- **WHEN** the user opens the setup action without sending the request
- **THEN** the dashboard does not run OpenSpec or write to the project and does not send a setup request to the agent

#### Scenario: Setup fails
- **WHEN** the agent cannot run the CLI or complete setup
- **THEN** its console remains available for the user to see the failure and decide how to proceed; the dashboard does not claim success
