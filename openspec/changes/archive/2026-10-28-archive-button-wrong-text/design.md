# Design

## Context

See proposal.md — Why. Every text the dashboard submits for the user goes through `submitText` in
`src/server/sessions/submit.ts` (submit-agent-input D1/D4): one `terminal.write(text)`, an echo check on the first 48
normalised characters, then `"\r"` as a separate write. `SessionManager.submit` serialises submissions per session and
caps them at 4096 characters.

What breaks is the single write. A pseudo-terminal's input queue is bounded (1024 bytes on macOS); a longer write
reaches the agent in more than one read, split wherever the kernel's queue filled — in the reported case inside
`.openspec.yaml`. An agent that classifies input by the size of one read (Claude Code collapses a large read into
`[Pasted text #N]`) then sees one paste plus a fragment. The default Archive prompt for a running session with docs
auto-merge on is ~1130 bytes for a 25-character change name and grows by two bytes per extra name character (the record
instruction names the change twice), which is why only some changes hit it.

Constraints: agent-neutral, no reading of agent output beyond the echo check, no blind Enter.

## Goals / Non-Goals

**Goals:**
- A submitted text of any allowed length reaches the agent whole, in order, with no split point chosen by the kernel.
- The echo check and separate Enter keep working for long texts.

**Non-Goals:**
- Raising the 4096-character limit or shortening the prompts (the prompts are specified elsewhere and stay as they are).
- Bracketed paste or any other agent-specific input protocol.
- Changing keystroke input (`write`), which is the user's own typing and is relayed unchanged.

## Decisions

### D1: Type the text in pieces of at most 256 bytes, with a pause after each
`submitText` splits the text into pieces of at most `PIECE_BYTES = 256` UTF-8 bytes, cutting only between code points
(never inside a multi-byte character or a surrogate pair), writes them in order, and waits `PIECE_PAUSE_MS` (≈ 25 ms) after
each one except the last. 256 bytes is a quarter of the smallest input queue we know of, so a piece is never split by
the kernel even if the agent is a little slow to read, and it is far below the size at which known agents treat a read
as a paste. The pause gives the agent time to drain the queue so pieces do not pile up into one read. At the 4096-
character cap that is at most ~48 pieces (multi-byte text) — well under two seconds, typically 4–5 pieces and ~0.1 s.

The splitting is a pure exported function (`submissionPieces(text, maxBytes)`) so it is table-tested; the paced writing
stays inside `submitText`. Piece size and pause are options alongside `echoTimeoutMs`/`settleMs` so tests run fast.

*Alternatives considered:*
- *Bracketed paste (`ESC[200~ … ESC[201~`) when the agent enabled it.* Tells the agent where the paste ends regardless
  of reads, but an agent that collapses long pastes would still show a placeholder, so the echo check could never see
  the text and Enter would never be pressed. It also means watching the output for a mode switch — more reading of
  agent output than the one question the echo check answers.
- *Retry a partial write / check what `terminal.write` accepted.* Whatever we write, the agent still reads it in
  queue-sized parts; the split point stays the kernel's.
- *Shorten the Archive prompt.* Fixes today's case only; Ship, Merge and user-configured prompts with additional
  instructions can be just as long.

### D2: The echo wait starts after the last piece
The timeout in D1 of submit-agent-input counts from the last piece's write, and output is observed from before the
first piece, as today. So a long text has the same `echoTimeoutMs` to appear as a short one, and the echo of early
pieces is not missed. The probe (first 48 normalised characters) is unchanged: with pieces shown as typing, the
beginning of the text is on screen.

### D3: A raw "paste-detecting" mode in the fake agent proves it
`test/fixtures/fake-agent.ts` gains `--paste-threshold <n>`: raw mode, each read of more than `n` bytes is answered with
`[pasted N bytes]` instead of its text, smaller reads are echoed, and Enter prints the full line received. A session
test submits a prompt longer than 1024 bytes and asserts the line arrives intact, the placeholder never appears, and the
submission reports `submitted: true`. A unit test with an in-memory terminal asserts the piece sizes and the order of
writes (all pieces, then Enter). Cooked mode is unsuitable for this test: its line buffer is itself capped at 1024 on
macOS.

## Risks / Trade-offs

- [An agent slower than the pause still reads two pieces at once] → two pieces are 512 bytes, still below the queue and
  below Claude Code's paste threshold; the worst case is the old behaviour for that agent, never a blind Enter.
- [An agent with a timing-based paste heuristic merges the pieces into one paste] → that is a whole, unsplit paste,
  which such an agent shows inline; if it does not, the echo check fails safe and the user is told.
- [Submitting takes slightly longer] → ~25 ms per piece; invisible next to the 400 ms settle pause.
- [Interleaving with the user's own keystrokes during the pieces] → the same exposure as today's echo wait; submissions
  are still serialised among themselves.
