# Design

## Context

Ship is deliberately deterministic and does not start or message an agent. The server creates a pull request with a
body supplied to `gh pr create`; the existing flow has no dependable source for that body. Prompting an agent from the
Ship button would make a direct action dependent on another asynchronous agent interaction and could cause edits after
the user asked to ship.

## Decisions

### D1. Store the draft beside the change artifacts

Use `openspec/changes/<name>/pull-request.md` as the source of truth. Draft writes the first version from the proposal,
design and intended verification. Implement revises it to reflect the actual implementation and verified checks. The
file stays with the change and travels on the same branch as its code. It is part of the change artifacts, not a
dashboard-side cache or session metadata.

Rejected: adding a description field to session state. Session records are transient and do not travel with the branch
or remain available to archive and fast-forward workflows.

### D2. Read only the current session checkout

At Ship time, resolve the validated change's `pull-request.md` inside the session worktree. Trim surrounding whitespace
and pass its contents as the `--body` value. Never read a similarly named file from the main checkout or another
worktree. If the file is absent, empty after trimming, unreadable, or not a regular file, use a fixed fallback that
identifies the change and points reviewers to its OpenSpec artifacts. This keeps older changes shippable and ensures a
new pull request always has a non-empty body.

The existing pull-request lookup remains authoritative: when a pull request for the branch already exists, Ship leaves
its body untouched.

### D3. Keep the artifact reviewer focused

The Draft prompt asks for a concise summary of the problem, intended outcome, and planned verification. The Implement
prompt asks the agent to replace plans with what changed and the checks actually run, and to remove unsupported claims.
It must not include credentials, private data, or content copied from outside the change. No separate template system
or front matter is needed; plain Markdown is easy for the agent to maintain and GitHub to render.

## Risks

- The agent may leave stale planned text. Implement instructions and the explicit rule to state only verified outcomes
  reduce this risk; reviewers can see and edit the body in the pull request.
- A malformed or missing artifact may produce only the fallback. Ship still opens a non-empty pull request and the
  artifact can be corrected in a later commit.

## Open Questions

None.
