# Design

## Context

The macOS runner can delay asynchronous clone completion beyond a fixed sleep, and PTY output arrives in chunks that may split a long startup banner. PTYs can also coalesce writes while the child is not scheduled.

## Goals / Non-Goals

**Goals:** Synchronize tests with observable completion and keep input pieces small enough to tolerate short PTY scheduling gaps.

**Non-Goals:** Change terminal confirmation semantics, agent prompts, or demo clone behavior.

## Decisions

- Poll the clone's reported state with a bounded timeout, just as session tests already do for PTY output.
- Keep the production input chunk bound at 64 UTF-8 bytes with a 15 ms pause between chunks; the maximum valid submission remains bounded by the existing guard.
- Make the delayed-echo test derive its expected write count from the default piece count rather than an obsolete fixed number.

## Risks / Trade-offs

- [Long prompts take slightly longer to type] → Smaller writes reduce macOS paste coalescing; the maximum submission adds under one second of pacing at the configured limit.
