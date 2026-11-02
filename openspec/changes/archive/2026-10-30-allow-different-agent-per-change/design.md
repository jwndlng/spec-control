# Design

## Context

`agentFor(config, repo)` (`src/server/sessions/agents.ts`) picks a profile from `repos[].agent.agentId`, else
`agentSessions.defaultAgent`, and every change-session start in `SessionManager` calls it. A session record already
stores `agentId`, and resume, Ship and Resolve conflicts on an ended session look the profile up from that record
(`prepareAgainAnywhere`). The UI decides which starters a card and the Console tab offer from the repository's profile
and the availability list. See proposal.md for why a per-change choice is wanted.

## Goals / Non-Goals

**Goals:**
- One place that answers "which agent does this change use", used by the server for every new change session and by
  the UI for starter availability.
- No new write to a tracked repository; the override lives in the dashboard config like the project's choice.

**Non-Goals:**
- Choosing the agent per action (e.g. Draft with one agent, Implement with another) — the override is per change.
- Choosing the agent in the New change dialog; it can be set in the Console tab right after creating.
- Switching a running session to another agent, or carrying a conversation from one agent to another.

## Decisions

**D1 — Store in the config, under the repository.** `repos[].agent.changeAgents?: Record<changeName, agentId>`. Keys
are validated with `CHANGE_NAME`, values must name a configured profile (the same superRefine that checks
`agent.agentId`). Alternative: a file in the change directory (e.g. `agent.yaml`) would travel with the change and
reach other machines, but it is a new write path into the repository under invariant 1, would let a repository's
content choose which program the dashboard starts, and would be committed into pull requests. Rejected.

**D2 — Key by change name, prune lazily.** Changes have no stable id other than their name. A renamed, archived or
dismissed change leaves a harmless entry: `agentFor` only consults the entry for the change being started, and an
archived change starts nothing. The new endpoint prunes entries whose names are not active in the repository's latest
scan whenever it writes, so the map stays bounded by the active changes without a scan ever writing the config.
Alternative: prune on scan — rejected, scans must not write the config.

**D3 — `agentFor(config, repo, change?)`.** The change argument is given for change sessions (starters, Ship/Resolve
conflicts when they start a fresh agent, carry-over and remove-duplicate archive follow-ups) and omitted for the
project console and Integrate. Ended sessions keep resolving from `session.agentId`, so the existing resume path is
unchanged. A shared helper in `src/shared/` (`changeAgentId(config, repo, change)`) gives the UI the same answer.

**D4 — Removing a profile drops overrides.** The Settings save that already rewrites `repos[].agent.agentId` and
`consoleAgent` for a removed profile also deletes `changeAgents` entries naming it, and removes an emptied map.

**D5 — Endpoint per change.** `POST /api/repos/<id>/changes/<name>/agent` sits beside the other change routes, under
`crossSiteRefusal`, serialised through the same config-write queue as the per-repository endpoints. Extending
`POST /api/repos/<id>/agent` with a change field was considered; a change-scoped route keeps that endpoint's "absent
field leaves it unchanged" contract simple and lets the route check the change name against the snapshot.

**D6 — UI.** The picker reuses the projects overview's agent picker component; its first option names the project's
resolved agent. The card shows the override's profile name as small muted text in the footer; nothing is shown
without an override, so boards look exactly as today for users who never use it.

## Risks / Trade-offs

- [The override is local to this machine and does not travel with the change] → Stated by placing it beside the
  project's agent choice, which is also local; a repository-borne choice would be a separate, invariant-changing change.
- [A running session on the old agent receives next-step prompts from its own profile, not the newly chosen one] →
  The Console tab says which agent the running session uses and that the next session starts the chosen one.
- [A rename leaves the override behind] → Pruned on the next write; the user re-picks for the new name.

## Migration Plan

The key is optional; configurations without it load and save unchanged. Rolling back to an older binary drops the
unknown key on its next save (zod strips it), returning every change to its project's agent.
