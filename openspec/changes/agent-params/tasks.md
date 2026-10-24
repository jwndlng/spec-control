# Tasks

## 1. Profile field and validation

- [x] 1.1 Add `launchArgs?: string[]` to `AgentProfile` in `src/shared/types.ts` with a doc comment (inserted after the executable on every start, no placeholder); verify with `bun run check` (typecheck)
- [x] 1.2 Add `launchArgs` to `agentProfileSchema` in `src/server/config.ts`: each entry non-empty, no `{…}`, no control character, `noBypass`; an empty array read as absent (design D3); verify with `test/config.test.ts` cases accepting `--mode`, `auto` and `--model fast`, refusing `--prompt={prompt}`, `{change}`, a newline and `--dangerously-skip-permissions` with an error naming `launchArgs`, and a config without the field loading unchanged
- [x] 1.3 Verify in `test/config.test.ts` that an `agy` profile with the former command `agy`, `-i`, `{prompt}` and launch arguments `--mode`, `auto` loads with the current preset command and its launch arguments kept, and that every preset still validates and carries no launch arguments

## 2. Launch paths

- [x] 2.1 Add `withLaunchArgs(agent, argv)` in `src/server/sessions/agents.ts` (design D2) and use it in `launchCommand` and `launchWithoutPrompt`; verify with `test/agents.test.ts` cases: Antigravity with `--mode`, `auto` and a prompt argument, a typed-prompt command, the prompt-less console launch (no leftover option), and a profile without launch arguments giving exactly today's argv
- [x] 2.2 Add `resumeLaunch(agent)` returning the resume argv with launch arguments, and replace the three `[...agent.resumeCommand]` spreads in `src/server/sessions/manager.ts` (Resume, Ship and Resolve conflicts on an ended session); verify with `test/agents.test.ts` for `agy`, `--mode`, `auto`, `--continue`, and with a fake-agent session test that Resume of an ended session starts the agent with the launch arguments
- [x] 2.3 Confirm with `grep -n "resumeCommand\]" src/server` that no start path spreads `resumeCommand` or `command` without the helper, and that `availability` and the `Bun.which` checks still look at the unchanged first argument

## 3. Settings

- [x] 3.1 Add the **Launch arguments** textarea to the Command group of `src/ui/agentSettings.tsx`, one argument per line via `parseArgLines`, empty stored as `undefined`, with a hint saying the arguments go after the executable on every start, resumes included; verify with a `test/agentSettingsUi.test.ts` case that typing `--mode` and `auto` on two lines stores `["--mode", "auto"]` and clearing it stores nothing
- [x] 3.2 Mention launch arguments where the help page describes an agent profile's command in `src/ui/helpContent.tsx`, if it does; verify with `bun run check` — it does not, so nothing to add

## 4. Verification

- [x] 4.1 Run `bun run check` and `bunx openspec validate agent-params --strict`, both passing
- [~] 4.2 Build with `bun run build`, add `--mode`, `auto` to an Antigravity (or a stand-in) profile in Settings, start a console and a change session, and check the agent's process arguments (`ps -o args`) include them right after the executable
