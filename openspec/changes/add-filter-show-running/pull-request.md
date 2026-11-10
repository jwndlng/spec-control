# Summary

The board has no direct way to isolate changes with live agent sessions. Recent activity and lifecycle stages make users scan unrelated cards when checking their running agents.

This proposal defines a default-off **Show running** filter on combined and project boards. It includes working, waiting and quiet agents, matches sessions by repository and change name, and excludes ended sessions and consoles. The choice persists as `running=1`, composes with existing filters and archive rules, and clears through **Clear filters**. Implementation reuses the existing session list and running-session predicate.

This pull request contains the proposal, behavior delta, design and unchecked implementation tasks; it is ready for implementation.

# Planned verification

- Test URL defaults, parsing, round trips, clearing and accessible switch behavior.
- Test running/ended/archive/in-place sessions, repository isolation, multiple sessions, filter composition and counts.
- Check session updates, reload and board-return navigation on both boards and in demo routing using synthetic data or the fake agent.
- Run strict OpenSpec validation and `bun run check`; update Help and validate an independent What's new entry during implementation.
