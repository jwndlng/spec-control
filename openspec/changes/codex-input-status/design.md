## Approach

Keep the terminal relay opaque. Reuse the existing report format and the waiting state already consumed by cards and the lifecycle timeline. A separate activity file allows Codex hooks to report waiting without replacing structured phase completion. The Help example configures reporting for Codex approval events and uses tool hooks for structured questions where Codex exposes those calls. Managed prompts also ask the agent to report waiting when it pauses for a question.

Open work counts only current waiting reports. Terminal silence alone is ambiguous.
