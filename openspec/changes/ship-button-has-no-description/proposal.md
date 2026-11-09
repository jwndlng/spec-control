# Proposal

## Why

Pull requests created by Ship have no useful description. Ship now commits and opens a pull request directly, without
asking the agent to compose the pull request first, so the `gh pr create` body is empty or generic. Reviewers need a
concise account of the change and its verification. That description should be prepared during drafting and kept
current during implementation, when the relevant context is already available.

## What Changes

- Add a `pull-request.md` artifact to each change. Draft artifacts writes an initial reviewer-facing summary and
  implementation plan; Implement updates it to describe the delivered change and checks.
- Ship reads that artifact from the session's own checkout and uses it as the pull request body when creating a pull
  request. If the artifact is missing or blank, Ship uses a useful deterministic fallback instead of an empty body.
- Preserve an existing pull request's body; Ship does not edit pull requests that already exist.

## Non-goals

- Generating or editing pull request descriptions by starting or prompting an agent when the user presses Ship.
- Changing pull request titles, commit messages, merge behavior, or branch handling.
- Requiring the description artifact for older changes or preventing Ship when it is absent.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: Draft and Implement maintain the pull request description artifact; deterministic Ship uses it as the
  body of a newly created pull request.

## Impact

- `openspec/specs/agent-sessions/spec.md`: artifact lifecycle and Ship body requirements.
- `src/server/sessions/`: read and validate the description from the session worktree before `gh pr create`.
- Agent profile prompts for Draft and Implement: author and maintain `pull-request.md`.
- Tests: Ship body selection and safe fallback; prompt expectations for Draft and Implement.
