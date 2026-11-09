# Proposal

## Why

Ship currently makes an unfinished task list block opening a pull request, even after the change artifacts are ready
for review. Archive can be delayed for the same reason. That leaves checks which need a pull request or human review
blocking the very step that would make those checks possible. Ship also gives little useful feedback after the pull
request is created, so the user has no direct route to review it or ask an agent to address feedback and conflicts.

## What Changes

- Keep task completion as a prerequisite for starting or continuing implementation, but do not make unfinished task
  state prevent an explicit Ship or Archive action once the required artifacts are present.
- Allow Ship to open or update the pull request while clearly reporting remaining tasks for follow-up; do not mark
  tasks complete or imply checks passed.
- Return the pull request URL and a clear success result from Ship so the UI can link directly to the pull request and
  offer the user a follow-up path to review feedback or resolve conflicts with the agent.
- Keep automatic actions bounded by their existing eligibility and safety rules; this change does not infer task
  completion from a successful Ship or pull request creation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Task completion gates implementation, while artifact-ready explicit Ship and Archive can proceed;
  Ship reports the created pull request and preserves unresolved-task follow-up.

## Impact

- `openspec/specs/agent-sessions/spec.md`: task gating and Ship result requirements.
- `src/server/sessions/` and Ship API/UI: remove the task-completion block for artifact-ready Ship/Archive and surface a
  pull request URL and follow-up action.
- Agent session prompts and tests: preserve accurate unresolved task reporting and route pull request feedback or
  conflicts into an agent follow-up.

