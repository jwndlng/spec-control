# Proposal

## Why

Users want to start an agent with options of their own — for example Antigravity's `--mode auto`, so it asks fewer
permission questions, or a model choice. Today the only place for one is the profile's command, and that falls short in
three ways. An edited preset command is "the user's", so it no longer follows the preset when the preset's command
changes ("A former preset command is read as the current one"). The resume command is a separate argument list, so a
resumed session, and a Ship or Resolve conflicts on an ended session, starts without the option unless the user copies it there as
well. And the user has to know where in the argument list an option can go without breaking the `{prompt}` argument.

## What Changes

- An agent profile gains optional **launch arguments**: an argument list the dashboard puts directly after the
  executable every time it starts that agent — with an opening prompt, without one (main console, project console) and
  with the resume command (Resume, and Ship or Resolve conflicts on an ended session).
- Launch arguments follow the rules a command argument already follows, made stricter where a prompt could leak in: no
  shell, one argument per entry, no placeholder at all, no control character, and none may carry a permission-bypass
  mode or flag (the existing rule). An option like `--mode auto` or `--model fast` is accepted.
- Settings shows a **Launch arguments** field, one argument per line, in each agent's Command group, beside Command and
  Resume command. Empty means none, and nothing is stored.
- Presets carry no launch arguments, and keeping the user's options out of the command means a preset command still
  upgrades when the user has added options.
- A change takes effect at the agent's next start; a running agent keeps the arguments it was started with.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-sessions`: a profile may carry launch arguments, added after the executable to every start of that agent,
  validated like the rest of the profile and edited in the Agent sessions settings.

## Impact

- `src/shared/types.ts` — `AgentProfile.launchArgs`.
- `src/server/config.ts` — schema for the new field (no placeholder, no bypass, no control character).
- `src/server/sessions/agents.ts` — `launchCommand`, `launchWithoutPrompt` and a new helper for the resume command
  insert the arguments; `src/server/sessions/manager.ts` uses that helper where it starts `resumeCommand` today.
- `src/ui/agentSettings.tsx` — the Launch arguments field.
- Tests: `test/agents.test.ts`, `test/config.test.ts`, `test/agentSettingsUi.test.ts`.
- No new git command, path, network access or process; invariants 1–7 are unchanged.
