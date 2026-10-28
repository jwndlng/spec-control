# Proposal

## Why

The agent is chosen per project: every session of every change in a project starts the same profile. Users who keep
several agents configured want to hand one change to a different agent — try Codex on one change while the rest of the
project stays on Claude Code, or give a hard change to a slower, stronger profile — without switching the whole project
back and forth and remembering to switch it back.

## What Changes

- A change MAY carry an **agent override**: one configured agent profile that its new sessions start instead of the
  project's agent. Without one, nothing changes: the change uses the project's agent, else the default agent.
- The override is the user's choice, kept in the dashboard's own configuration under the project
  (`repos[].agent.changeAgents`, keyed by validated change name) — never written into the repository, so invariant 1
  is unchanged.
- **The change's agent** (override, else project's agent, else default) decides, for that change, which starters are
  offered (by which prompts its profile has), the opening prompt, launch arguments and environment, the executable
  check, and the agent started by Ship, Resolve conflicts and the archive follow-ups when they start a new agent.
  Resume and Ship of an ended session keep using the agent that session ran, as today; a running session is never
  restarted or sent anything because the override changed.
- The project console, the main console and Integrate are not changes and keep their own agent choice.
- A new endpoint `POST /api/repos/<id>/changes/<name>/agent` with `{ agentId }` sets (`string`) or clears (`null`) the
  override of one active change, refusing unknown profiles, invalid or unknown change names and excluded repositories.
- The change detail's Console tab gets an **Agent** picker ("Project agent (<name>)" plus every profile), shown only
  when more than one profile is configured; it says when a running session uses a different agent than the next one
  will. A card whose change has an override shows the agent's name, and its starters follow the change's agent.
- Removing a profile in Settings drops every override that names it, like it already returns projects and the console
  to the default agent. Overrides of changes that are no longer active are pruned when an override is next set in that
  project and never affect anything.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: profiles are chosen per change as well as per project — the change's agent governs its sessions;
  removing a profile drops change overrides that named it.
- `dashboard-api`: a new mutating endpoint to set or clear a change's agent override.
- `change-detail`: the Console tab offers the per-change agent picker and says which agent the next session starts.
- `kanban-board`: a card shows its change's overriding agent, and its starters follow the change's agent.

## Impact

- `src/server/config.ts` (schema: `repos[].agent.changeAgents`, validation, dropping overrides of removed profiles),
  `src/shared/types.ts`.
- `src/server/sessions/agents.ts` (`agentFor` takes the change), `src/server/sessions/manager.ts` (every change-session
  start), `src/server/api.ts` (new route under the same-origin guard).
- `src/ui/` — the Console tab picker, the card's agent name, starter availability per change; `src/ui/changelog.ts`.
- Tests: `test/config.test.ts`, session manager and API tests, UI logic tests.
- No new write to a tracked repository, no new git or `gh` command, no network access.
