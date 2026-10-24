# Design

## Context

A profile (`AgentProfile`, `src/shared/types.ts`) has three argument lists that reach a process: `command` (with
`{prompt}` or a typed prompt, `launchCommand`), the same command with every `{prompt}` argument dropped for the consoles
(`launchWithoutPrompt`), and `resumeCommand`, which `src/server/sessions/manager.ts` spreads directly in three places
(Resume, Ship and Resolve conflicts on an ended session). Validation lives in `src/server/config.ts`, where `BYPASS`
already refuses permission-bypass wording in the command, resume command, prompts, suffixes and shortcuts. Preset
commands upgrade only when they match a former command argument for argument (`upgradeFormerDefaults`).

## Goals / Non-Goals

**Goals:**
- One field the user fills once and every start of the agent honours.
- Keep the preset upgrade path working for a user who only wants extra options.

**Non-Goals:**
- Per-project or per-action arguments. A project picks a profile; a user who wants other options for one project adds a
  second profile. Per-project arguments can follow later without changing this field.
- Environment variables to *set* (only `unsetEnv` exists). Separate concern.
- Knowing what any agent's options mean: the dashboard passes them through and never checks them against a vendor.

## Decisions

### D1 — A separate `launchArgs` list, not edits to `command`

`launchArgs?: string[]` on the profile. Alternatives: tell users to edit `command` (today's state — loses preset
upgrades and misses the resume command), or edit both `command` and `resumeCommand` (the same option kept in two places).
A separate list is the only one that is applied everywhere by construction.

### D2 — Inserted directly after the executable

`[argv[0], ...launchArgs, ...argv.slice(1)]` for every launch. Appending at the end would put options after a
positional prompt or after a subcommand (`codex resume --last`), where many CLIs stop parsing options; directly after
the executable is where global options are accepted by every CLI the presets cover. One helper in
`src/server/sessions/agents.ts` (`withLaunchArgs(agent, argv)`) is used by `launchCommand`, `launchWithoutPrompt` and a
new `resumeLaunch(agent)` that replaces the three `[...agent.resumeCommand]` spreads in `manager.ts`, so no start path
can skip it. The executable check (`Bun.which(argv[0])`) and `availability` are unaffected: the first argument never
changes.

### D3 — Stricter validation than `command`

Each entry: `min(1)`, no `{…}` at all, no control character, `noBypass`. A command argument may contain `{prompt}`; a
launch argument may not, because it is also used for the console launch, which promises that no prompt text reaches the
command line, and for the resume command, which has no prompt argument. Whitespace inside an entry is allowed (it is
one argument, never shell text). An empty array is normalised to absent by the UI (as `resumeCommand` already is) and
accepted by the schema as absent-equivalent, so a hand-edited `[]` does not fail a save.

### D4 — The bypass rule stays as it is

The request's example, Antigravity's `--mode auto`, is not matched by `BYPASS` and is accepted. The rule is not widened
to "anything that reduces permission prompts": the dashboard cannot tell an agent's auto mode, which keeps its own
checks, from a model choice, and the project's line is "never helps switching off an agent's permission checks", which
the existing pattern encodes. No preset ships launch arguments, so the dashboard suggests none.

## Risks / Trade-offs

- [An option the agent's resume subcommand rejects, e.g. one `codex resume` does not accept] → The agent prints its own
  error in the terminal and exits; the session shows `exited` and the user edits the field. The Settings hint says the
  arguments apply to resumes too.
- [A user puts `--mode auto` on one line, giving one argument `--mode auto`] → The hint says one argument per line, as
  the Command field does; the agent reports the unknown option. Not split by the dashboard: splitting on spaces would
  be shell-like parsing, which the profile deliberately avoids.

## Migration Plan

None: the field is optional, absent in every saved configuration, and loading does not write it.
