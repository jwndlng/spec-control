# Proposal

## Why

The dialog that appears when a session is ended or cleaned up is a wall of text: a sentence about stopping the agent
"as if you closed its terminal window", a paragraph about which worktree and branch are kept, and long parenthesised
explanations after every checkbox ("also pull … (fast-forwards its main checkout, so the board does not keep showing
this change as unmerged)"). Nobody reads it, so the parts that do matter — what will be cleaned up — get lost. And one
option, **Clean up leftovers**, starts cleared when a worktree holds files outside the change, so the user has to
notice and tick it by hand, even though those files are copied before anything is deleted.

## What Changes

- The end-session dialog gets a **headline** ("End session · `<change>`" / "Clean up · `<change>`") and **one line**
  saying that the options below tidy up after the session and can be chosen.
- Each option is a **checkbox with a short label of a few words** — *Remove worktree*, *Pull `<repo>`*, *Clean up
  leftovers* — and the explanation that used to follow it moves into a **hover description** (the control's tooltip,
  also exposed to assistive technology).
- **Every offered checkbox is ticked by default.** That is already true for the worktree removal and the pull; it now
  also holds for Clean up leftovers when a worktree holds uncommitted files outside the change. Those files are still
  named in one short line under the option and are still copied under the dashboard's home before deletion.
- The prose blocks go: the "stopped as if you closed its terminal window" sentence, the "worktree and its branch are
  kept…" paragraph and the leftover list's closing paragraph about backups become hover text or are dropped. What must
  stay visible stays visible, in one line each: the unshipped-work warning, why a worktree cannot be removed, and the
  stale leftovers being removed.
- The reports shown after a pull or cleanup that needs saying keep their content but drop the explanatory sentences
  in the same way.
- Nothing changes in what confirming does, in the server's checks, or in the order end → clean up → pull.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-sessions`: the end-session dialog gains a requirement for its concise layout (headline, one line, short
  labels with hover descriptions, every offer ticked); "Ending a session cleans up a stale change's leftovers" drops
  the exception that left the offer cleared when files outside the change are involved, and moves its backup note to
  the option's hover description.

## Impact

- `src/ui/endSessionDialog.tsx` — layout and wording of the dialog and its two reports.
- `src/ui/staleState.ts` — `endCleanupOffer` pre-selects whenever it offers; `keptUntilStale` shortened.
- `src/ui/staleCleanup.tsx` — `StaleLeftoverList` loses its closing paragraph (as hover text instead) when used by the
  dialog; the board's **Clean up leftovers…** dialog keeps its current wording.
- `src/ui/styles.css` — spacing for the shorter dialog, if needed.
- `test/staleState.test.ts` — the pre-selection expectations.
- `src/ui/changelog.ts` — a What's new entry.
- No API, server, git or invariant change: the server still requires and re-checks the acknowledgement it gets today
  when the option is selected.
