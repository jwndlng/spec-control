# Design: Custom Session Per Change

## Context

See `proposal.md` — Why for the problem statement. Currently, Spec Control change sessions are initiated exclusively via stage-dependent starters: Draft artifacts, Implement, Validate, and Archive (along with composite Fast-forward). Each starter constructs and automatically submits a fixed prompt (such as `/opsx:apply {change}`) into the agent's pseudo-terminal upon launch.

For global and project-level interactions, the dashboard supports unprompted sessions via `main-console` and `project-console` using `launchWithoutPrompt(agent)` (defined in `src/server/sessions/agents.ts`), which strips `{prompt}` arguments and starts the agent CLI with no initial input typed. However, project console runs directly in the main checkout without git branch isolation, and main console runs in an isolated directory detached from any repository or change context. Users wanting to converse with their agent inside a specific change's isolated worktree and branch without triggering an automated workflow command currently have no sanctioned path.

## Goals / Non-Goals

**Goals:**
- Provide a first-class **Custom session** starter (`action: "custom"`) for every active (non-archived) change.
- Run the change's agent inside the change's git worktree (`feat/<change>` or existing worktree) without submitting any pre-set prompt or instructions.
- Allow starting a custom session at any stage of a change (`unknown`, `backlog`, `drafts`, `ready`, `implementing`, `done`), including when the change is blocked by unfinished dependencies.
- Enable custom sessions without requiring any prompt template configured in the agent profile.
- Seamlessly integrate Custom session into the split button menu on Kanban cards and the change detail Console tab.

**Non-Goals:**
- Allowing custom opening prompts entered from the browser on launch (opening prompts are fixed or absent; no arbitrary unvalidated text is passed to the command line or typed on start).
- Running custom sessions in the main checkout for git repositories (they must run in the change's isolated worktree).
- Modifying prompt templates or configuration schema for agent presets (custom sessions require no prompt template).

## Decisions

### 1. Model as a first-class `SessionAction` (`"custom"`)
- **Choice:** Add `"custom"` to `SessionAction` and `SESSION_ACTIONS` in `src/shared/types.ts`.
- **Rationale:** `SessionAction` represents all actions that can create or run a change session. Adding `"custom"` aligns with `"draft"`, `"implement"`, `"validate"`, and `"archive"`. Unlike `"fastForward"` (which is composite), `"custom"` is an independent starter that records its action on `ChangeSession.action`.
- **Alternatives considered:**
  - *Adding an ad-hoc flag like `{ noPrompt: true }` to `POST /api/sessions`:* Rejected because session records, worktrees, activity events, and UI badges track `action`. Making it a dedicated action preserves consistent typing and auditing across the system.

### 2. Reuse `launchWithoutPrompt` for process execution
- **Choice:** In `SessionManager.openNow`, when `action === "custom"`, invoke `launchWithoutPrompt(agent)` to build the argument list, and pass `undefined` as the initial typed text to `start(...)`.
- **Rationale:** `launchWithoutPrompt` is already tested and proven in `main-console` and `project-console`. It filters out command arguments containing `{prompt}` and leaves standard flags and launch args intact. Starting with no typed text leaves the terminal waiting for the user's first input.
- **Alternatives considered:**
  - *Sending an empty string:* Rejected because typing an empty line or newline could trigger default CLI prompts or confuse agent interactive repls.

### 3. Stage independence and dependency bypass
- **Choice:** `availableActions(change)` appends `"custom"` for any change where `!change.archived`. Neither stage checks nor `blockedReason` checks restrict `"custom"`.
- **Rationale:** Asking questions, discussing requirements, and clarifying implementation decisions are valid and helpful at any point in a change's lifecycle, especially when a change is blocked by dependencies (where understanding the blockage is essential).
- **Alternatives considered:**
  - *Only allowing custom sessions in `Drafts` or `Implementing`:* Rejected because users also need to discuss backlog ideas, clarify validate tasks, or inspect completed code before archiving.

### 4. Split button placement and menu order
- **Choice:** In `src/shared/nextStep.ts`, place `"custom"` in `MENU_ORDER` after `"archive"`: `["draft", "fastForward", "implement", "validate", "archive", "custom"]`.
- **Rationale:** The split button's main part should recommend the change's primary lifecycle action for its stage (or the pull request action). Custom session is an intentional escape hatch and belongs in the secondary menu, unless no lifecycle starter is available (e.g. an agent with no prompt configured), where it can act as the fallback starter.
- **Alternatives considered:**
  - *Giving Custom session a separate top-level button on cards:* Rejected because card space is strictly constrained and split buttons keep card actions clean and unified.

### 5. Worktree and branch semantics
- **Choice:** Use standard change worktree naming: worktree `<change>` on branch `feat/<change>`. If an existing worktree or adopted worktree exists for that change (e.g. from an earlier Draft or Implement session), reuse it. If the repository runs change sessions in place (no commit / non-git), run in place.
- **Rationale:** A custom session is about the change; it should see the exact files and commits of the change's feature branch.
- **Alternatives considered:**
  - *Creating a separate `custom-<change>` worktree:* Rejected because work and conversation belong to the change's feature branch, avoiding split worktrees and stale sync issues.

## Risks / Trade-offs

- **[Risk] User runs unguided commands that modify files unexpectedly** → *Mitigation:* The agent runs inside its own isolated git worktree on `feat/<change>`. The main checkout is completely untouched, and the user must still approve any agent tool executions according to their configured agent permissions.
- **[Risk] Concurrent session start attempts** → *Mitigation:* Spec Control enforces "one open session per change". Requesting a custom session while a session is already running returns the existing running session without interrupting it or sending text to its terminal.

## Migration Plan

- No database or persistent file schema migrations required.
- Agent profiles in `config.json` require no changes; existing profiles can run custom sessions immediately.
- Rollback: Reverting the code cleanly removes `"custom"` from `SessionAction` with no orphaned settings.
