# Reviewer summary

Explicit Ship and Archive can proceed once required artifacts are ready, while unresolved or unreadable task state remains visible and unchanged. Implement and automatic implementation remain task-gated. Ship reports the task summary with a created or existing pull request link and an explicit console follow-up; it does not claim checks passed, complete tasks or merge the pull request. Help and demo behavior reflect the revised flow.

Checks run:

- `bun run check` passed: lint, typecheck and 2,325 tests.
- `openspec validate ship-button-should-only-block-implement --strict` exited 1 with warnings: the PR-result requirement exceeds the 500-character recommendation, and `.openspec.yaml` contains the repository's `spec-control` metadata key, which the OpenSpec CLI does not recognize.
