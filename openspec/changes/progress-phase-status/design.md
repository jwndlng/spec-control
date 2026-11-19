# Design

The lifecycle timeline is a summary of change phase and pull-request delivery. `SessionControls` currently renders session badges in the timeline because it also serves cards and the console. Add a presentation flag for the timeline call sites to suppress those badges there; leave them visible in their existing card and console contexts.

Use the most advanced lifecycle session action as the displayed phase when it is later than the phase inferred from the snapshot. Keep the snapshot phase when it is later. Animate that phase only while its session is running and not waiting for the user. This makes Ready complete while implementation is underway or awaiting another session, without changing server eligibility, artifact evidence, or session state.

Find each pull request independently from its delivery record's PR number or the exact recorded/managed branch for its phase. Never use the single best linked PR as every phase's fallback: changes can have implementation and archive PRs open at the same time.

The Antigravity argument test waits until a complete JSON argument line is available before parsing it. The terminal may deliver the earlier `--mode` text before the rest of that line during parallel test load.

## Risks

- Draft and archive work can also be active while a snapshot still reports the preceding phase. The same ordering rule should apply consistently to all `workingPhase` values.
- Session status remains available in the Console tab, where it describes the selected session rather than change progress.
