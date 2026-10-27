# Proposal

## Why

Some tasks can only be finished by a person: entering a secret, signing in to an account, trying a change on a real
device. The `- [~]` marker was meant to hand such work to the user, but the preconfigured Implement prompt only covers
tasks the user has to **verify** ("when a task can only be verified by me…"). A task the user has to **carry out** is not
covered, so the agent leaves it `- [ ]`. One open box is enough to keep the change in `Implementing`, and there:

- **Implement stays the recommended action**, although nothing is left that the agent can do — sending it again only
  makes the agent report the same open task.
- **Archive is not offered**, because it is only offered in `Done`.
- **Nothing says what the user has to do.** Even where the agent did use `- [~]`, the card only shows a `Validate` badge
  and a count; what to check or do is in `tasks.md`, which the user has to open and search.

## What Changes

- **`- [~]` means "needs you": verify or carry out.** One marker for both cases. The Implement prompt of every preset
  tells the agent, for a task only the user can verify or carry out, to do every part it can, leave the task as
  `- [~]` instead of ticking it or leaving it open, and add to the task's own line what exactly the user has to check or
  do. Such a change settles into `Done` with the sub-state `validate` as before, so **Validate** is recommended,
  **Archive** is offered and **Implement** is not.
- **Validate walks through both kinds.** The Validate prompt tells the agent to say for each `- [~]` task exactly what to
  check or do, help with what it can, and tick off only what the user confirms as done.
- **Saved preset prompts upgrade.** The current Implement and Validate prompts become former prompts of their presets,
  so a profile still carrying them verbatim gets the new ones; edited prompts are left alone.
- **The scan reports what the user has to do.** Next to the counts, the scanner reports `awaitingTasks`: the text of the
  change's `- [~]` tasks in file order, plain text, at most 10 entries of at most 200 characters each.
- **The card says "needs you", and what.** The `Validate` badge becomes a **Needs you** badge reading `N need you`;
  its tooltip and accessible name list the tasks' text, and activating it opens the change's detail view on its tasks.
  The progress label reads `13 + 2 need you / 15 Tasks`.
- **The tasks view lists them first.** Where tasks need the user, the detail view says `N tasks need you` and lists
  their text above the checklist.
- No new write to a tracked repository: the dashboard still never writes `tasks.md`. No new git subcommand, no network
  access. Columns, sub-states and which starters are available are unchanged — only what the agent is asked to do with a
  task it cannot finish, and how the result is shown.

## Non-goals

- A separate marker for "carry out" versus "verify" (see design): both are "a person has to do something before this is
  done", and both are confirmed the same way.
- Ticking a task from the dashboard. Confirming stays the agent's, in a Validate or Archive session, under its own
  permission prompts.
- Notifications or a cross-project "needs you" list. The badge makes the state visible on the board; a list across
  projects can build on `awaitingTasks` later.
- Changes that are already stuck in `Implementing` with open manual tasks are not rewritten: sending **Implement** once
  more with the new prompt lets the agent mark them, or the user edits `tasks.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: the meaning of `- [~]` in the preset prompts covers tasks only the user can carry out, and the
  agent adds what the user has to do to the task's line; the former Implement and Validate prompts upgrade.
- `change-scanner`: `- [~]` means "needs the user"; the scan reports `awaitingTasks`, bounded.
- `kanban-board`: the card's **Needs you** badge with the tasks' text replaces the `Validate` badge; the progress label
  says "need you".
- `change-detail`: the tasks view says `N tasks need you` and lists them above the checklist.

## Impact

- `src/shared/agentDefaults.ts` — Implement and Validate tails, former prompts per preset.
- `src/server/scanner.ts` (or the task-counting module it uses) and `src/shared/types.ts` — `awaitingTasks` on
  `TaskProgress`.
- `src/ui/kanban.tsx`, `src/ui/changeDetail.tsx`, `src/ui/styles.css` — badge, progress label, tasks view.
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`, `src/ui/demo/sampleData.ts` — Help, What's new, demo data.
- Tests: `test/scanner.test.ts`, `test/agents.test.ts` / `test/config.test.ts`, the card and detail view tests, and the
  task fixtures they read (`test/fixtures/`).
