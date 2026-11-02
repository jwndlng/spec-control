# Proposal: Custom Session Per Change

## Why

Today, every agent session started for a change is tied to a specific lifecycle step: **Draft artifacts**, **Implement**, **Validate**, or **Archive** (plus the composite **Fast-forward**). Each starter automatically submits a fixed opening prompt (such as `/opsx:draft <change>` or `/opsx:apply <change>`) into the agent's terminal upon start-up.

Users often need to talk to their agent in the context of a specific change without running an automated workflow prompt—for instance, to clarify requirements, explore design trade-offs, ask questions about the current implementation, or give bespoke interactive instructions. Currently, the dashboard offers unprompted agent sessions only for the project as a whole (the project console, which runs in-place in the main checkout without branch isolation) or globally (the main console). To discuss a change safely inside its isolated worktree and branch, users are either forced to trigger an automated starter like Implement or drop out of the dashboard into a terminal. Adding a **Custom session** starter per change fills this gap.

## What Changes

- **A new starter: Custom session (`custom`).** Every active (non-archived) change offers a **Custom session** action that launches the change's agent directly inside the change's worktree without typing or submitting any pre-set prompt or instructions.
- **Unprompted launch:** The agent process starts without a shell using `launchWithoutPrompt`, omitting any `{prompt}` argument from the command line and sending no text to the terminal on start-up. The user writes the first instruction.
- **No profile prompt required:** Unlike prompt-driven starters, Custom session requires no prompt template in the agent profile. Any configured agent whose executable is found can run a custom session.
- **Universal availability across stages:** Custom session is available in all active lifecycle stages (`unknown`, `backlog`, `drafts`, `ready`, `implementing`, and `done`), and is offered even when a change is blocked by dependencies (since asking questions and discussion do not violate implementation ordering). It is not offered for archived changes.
- **Split button menu integration:** On cards and in the change detail Console tab, **Custom session** is offered in the split button's dropdown menu in fixed order after the lifecycle starters (`Draft artifacts`, `Fast-forward`, `Implement`, `Validate`, `Archive`, `Custom session`, then pull request steps). When no prompt-driven starter is available for a change, Custom session serves as the recommended action in the main part.
- **API support:** `POST /api/sessions` accepts `{ repoId, change, action: "custom" }`. Duplicate start requests for an already running session return the running session without sending anything to its terminal.

## Capabilities

### Modified Capabilities
- `agent-sessions`: Adds the Custom session starter (`custom`) running without a prompt in the change's worktree for any active change regardless of stage or dependency blocks.
- `dashboard-api`: `POST /api/sessions` accepts `action: "custom"` without requiring an opening prompt in the agent profile or enforcing stage/dependency restrictions.
- `kanban-board`: "A change's actions are one split button" includes **Custom session** in the split button menu for all active changes.

## Impact

- `src/shared/types.ts`: Adds `"custom"` to `SessionAction` and `SESSION_ACTIONS`; updates `availableActions` to include `"custom"` for all non-archived changes.
- `src/shared/nextStep.ts`: Adds `"custom"` to `MENU_ORDER` after `"archive"`.
- `src/server/sessions/manager.ts`: Updates `openNow` to handle `action === "custom"`, using `launchWithoutPrompt(agent)` and bypassing prompt lookup and blocked/pastDrafting refusals.
- `src/server/sessions/agents.ts`: Ensures `launchWithoutPrompt` is used for custom change sessions.
- `src/ui/sessionState.ts` & `src/ui/sessions.tsx`: Adds display labels, tooltips, and starter controls for `custom`.
- `src/ui/changelog.ts`: Adds a What's new entry describing the custom session feature.
- Test suites: Unit and integration tests in `test/agentSessions.test.ts`, `test/sessionsApi.test.ts`, `test/cardActions.test.ts`, and `test/whatsNew.test.ts`.
