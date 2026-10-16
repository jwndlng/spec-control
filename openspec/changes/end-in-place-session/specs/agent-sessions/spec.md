## ADDED Requirements

### Requirement: Ending an in-place change session can always be confirmed
When the user asks to end or clean up a change session that runs in place (in a tracked folder that is not a git
repository, or in a git repository with no commit yet), the confirmation dialog SHALL let them confirm at once. It SHALL
NOT wait for, ask for or show a worktree status, SHALL NOT offer to remove a worktree, and SHALL NOT offer to pull the
repository. Confirming SHALL end the agent as **End session** does everywhere else and SHALL leave the folder as the
agent left it. Cancelling SHALL end nothing. A session that has a worktree SHALL keep its current dialog, including
waiting for its worktree status before it can be confirmed.

#### Scenario: Running in-place session in a repository with no commit
- **WHEN** a change session runs in place in a git repository with no commit, and the user clicks **End session**
- **THEN** the dialog's **End session** button can be clicked straight away, no pull or worktree removal is offered,
  and confirming stops the agent

#### Scenario: In-place session in a folder without git
- **WHEN** the user ends a change session that runs in place in a folder that is not a git repository
- **THEN** the dialog can be confirmed straight away and offers no pull

#### Scenario: Ended in-place session
- **WHEN** an in-place change session has already ended and the user clicks **Clean up**
- **THEN** the dialog's **Done** button can be clicked straight away

#### Scenario: In-place session after the repository got its first commit
- **WHEN** a change session that started in place keeps running after the repository got its first commit and an
  upstream, and the user ends it
- **THEN** the dialog still offers no pull or worktree removal and can be confirmed straight away

#### Scenario: Worktree session still waits for its status
- **WHEN** the user ends a session that has a worktree, and its worktree status has not arrived yet
- **THEN** the confirm button stays disabled until the status arrives, as before
