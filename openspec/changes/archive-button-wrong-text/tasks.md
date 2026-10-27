# Tasks

## 1. Typing in pieces

- [ ] 1.1 Add `submissionPieces(text, maxBytes)` to `src/server/sessions/submit.ts`: pieces of at most `maxBytes` UTF-8 bytes, cut only between code points, joined back equal to `text`; verify with table tests in `test/submitText.test.ts` (ASCII, `—` and emoji on a boundary, exactly `maxBytes`, a 4096-character text)
- [ ] 1.2 Make `submitText` write the pieces in order with `PIECE_PAUSE_MS` after each but the last, start the echo timeout after the last piece, and keep Enter as a separate write after the settle pause; add `pieceBytes`/`piecePauseMs` to `SubmitOptions` (defaults 256 bytes, ~25 ms); verify with an in-memory terminal test that a 1200-byte text arrives as writes of at most 256 bytes, in order, followed by one `"\r"`, and that an echo arriving only after the last piece still submits
- [ ] 1.3 Confirm the existing `test/submitText.test.ts` cases (menu, ANSI-interleaved echo, chunked echo, exit marker) still pass unchanged

## 2. End-to-end proof

- [ ] 2.1 Add `--paste-threshold <n>` to `test/fixtures/fake-agent.ts`: raw mode, a read larger than `n` bytes prints `[pasted N bytes]` instead of its text, smaller reads are echoed, Enter prints the whole line received; verify the existing fake-agent tests still pass
- [ ] 2.2 Add a session test that submits a prompt longer than 1024 bytes (with `—` characters) to a running fake agent started with `--paste-threshold 512` in a real pseudo-terminal, and assert `submitted: true`, no `[pasted` in the output, and the full line received equal to the prompt; verify it fails against the old single-write `submitText`
- [ ] 2.3 Manually press **Archive** in a running Claude Code session for a change with a long name in a project with docs auto-merge on, in `dist/spec-control` built with `bun run build`, and confirm the input box shows the prompt's text (not `[Pasted text #1]` plus a fragment) and that it is submitted

## 3. Finish

- [ ] 3.1 Add a What's new entry at the top of `src/ui/changelog.ts` saying long prompts (Archive, Ship, Merge) now reach a running agent intact instead of as a paste placeholder and a fragment; verify `bun run check` passes
