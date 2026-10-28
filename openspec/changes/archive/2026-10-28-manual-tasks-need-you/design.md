# Design

## D1 — One marker for "verify" and "carry out"

A second marker (say `- [!]` for "you have to do this", `- [~]` for "you have to check this") would be more precise, but
everything the dashboard does with the two is the same: the agent cannot finish the task, the change is settled from the
agent's side, the user is the next step, and **Validate** or **Archive** is where it is confirmed. A fourth checkbox
state would have to reach the scanner, the column derivation, the meter, the tasks view, every preset prompt and every
repository's existing `tasks.md` files, and unknown markers count as open today — so an agent or editor that does not
know `[!]` would silently put the change back into `Implementing`, which is the bug this change fixes. The difference
between the two cases is carried by the text instead (D2), where the user reads it anyway.

## D2 — What the user has to do lives on the task's line

The Implement prompt asks the agent to add, after the task's own text, what exactly the user has to check or do. The
dashboard does not parse that addition: it shows the whole line after the checkbox. No separator is prescribed, so the
prompt stays one line and agent-neutral, and a task written by hand, or by an older prompt, is shown just the same.
Editing the task line is the agent's write, in its own session, like ticking a box.

## D3 — The scan carries the text, bounded

The card needs the text without loading `tasks.md` (the detail view reads the file anyway and could derive it itself,
but a board does not). So the scanner, which already reads every task line to count it, keeps the `[~]` lines' text:
at most 10, each at most 200 characters. That keeps the snapshot small for a change with many manual tasks; `awaiting`
stays the full count so the card can say `and N more`. The text is plain text from a repository: rendered as text,
never as HTML, in the same way the rest of a change's content is treated as untrusted.

## D4 — Prompt upgrade

The Implement and Validate prompts are composed from shared tails, so the change is one edit per tail; each preset's
current Implement and Validate prompts are added to its `formerPrompts`, which upgrades a saved profile that still
carries them verbatim and leaves edited ones alone ("Session starters run a fixed prompt for a validated change").

## D5 — Existing changes

`- [~]` tasks written before this change still mean what they meant — a person has to confirm them — and are shown the
same new way. Nothing re-reads history or rewrites a repository. A change stuck in `Implementing` with an open manual
task gets out of it with one more **Implement** under the new prompt.
