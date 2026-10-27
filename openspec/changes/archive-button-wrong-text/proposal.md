# Proposal

## Why

Pressing **Archive** for a change whose agent is already running sometimes leaves garbage in the agent's input box —
`[Pasted text #1]` followed by the tail of the prompt, cut mid-word (`nspec.yaml if this branch archived it), indented
two spaces, …`) — instead of the prompt, and the prompt is not sent. The Archive prompt with the docs auto-merge and
record instructions is about 1.1 KB, and longer for longer change names; the dashboard writes it into the agent's
pseudo-terminal in one go, but a pseudo-terminal's input queue holds only about 1 KB (1024 bytes on macOS). The agent
therefore reads the prompt in two bursts at a split point the kernel chose: an agent that treats a large burst as a
paste collapses the first into a placeholder and shows the rest as typed text. The echo check then cannot find the
prompt's beginning, so Enter is (rightly) never pressed, and the user is left with a broken input box. That is why it
happens "for some changes": it depends on the prompt's length, which depends on the change name and the project's
settings. Ship, Merge and typed opening prompts go through the same path and break the same way once they are long
enough.

## What Changes

- Text the dashboard submits on the user's behalf is typed in **pieces small enough that the terminal never splits
  them** — a bounded number of bytes, never splitting a character — with a short pause after each, instead of in one
  write. Every piece reaches the agent whole and in order, so the agent sees ordinary typing rather than one paste cut
  in two, and the echo check and the separate Enter work as before.
- The echo check's wait starts once the last piece is written, so a long text gets the same time to show as a short one.
- Nothing else changes: still no Enter unless the text showed up, still one submission per session at a time, still
  agent-neutral, and the 4096-character limit on submitted text stays.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-sessions`: "Text sent on the user's behalf is submitted only after the agent showed it" — the text is typed in
  pieces small enough to reach the agent whole, so a text longer than a terminal's input queue is neither split at an
  arbitrary point nor taken for a paste cut in two; a scenario covers a prompt longer than 1024 bytes.

## Impact

- `src/server/sessions/submit.ts` — `submitText` types the text in pieces (pure splitting helper plus the paced writes).
- `test/submitText.test.ts` — piece splitting (byte bound, multi-byte characters intact, order) and the echo wait.
- `test/fixtures/fake-agent.ts` — an optional raw mode that, like a paste-detecting agent, shows any single read above a
  threshold as a placeholder instead of echoing it; used to prove a long prompt is echoed and submitted.
- A session-level test (real pseudo-terminal, fake agent) submitting a prompt longer than 1024 bytes.
- `src/ui/changelog.ts` — What's new entry.
- No API, config, UI layout or invariant changes; no new git, `gh` or network use.
