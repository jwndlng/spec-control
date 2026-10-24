## ADDED Requirements

### Requirement: An agent asked to open a pull request is asked to record its branch
Whenever the dashboard composes text that asks or allows an agent to open a pull request for a change — the Ship
prompt, Fast-forward's prompt through the Ship text it ends with, and the archive auto-merge instruction — it SHALL
include the record instruction the repository's framework module supplies for that change (spec-frameworks: "OpenSpec
changes record their pull request's branch in `.openspec.yaml`"). For a session whose action is archive it SHALL be the
archive branch's instruction; for every other session the implementation branch's. Which one SHALL be decided by the server from the
session record, never from the request or from anything the agent printed.

The instruction SHALL be appended and SHALL NOT replace any part of the prompt: in Ship it SHALL follow the profile's
Ship prompt (or the agent-neutral default) and the Conventional Commits sentence when the project has one, and precede
the profile's additional Ship instructions and the auto-merge instruction; in Fast-forward it SHALL appear once, as part
of the Ship text; with the archive auto-merge instruction it SHALL follow that instruction. A profile with its own Ship
prompt SHALL get it all the same. When the module supplies no record instruction, the text SHALL be exactly what it is
without this requirement.

The dashboard MUST NOT write the record itself, and MUST NOT check, read back or act on anything the agent printed about
it: what the agent recorded is read from the repository by the scan like any other file.

#### Scenario: Ship carries the implementation record instruction
- **WHEN** Ship is used on the implement session of `rotate-keys` in an OpenSpec repository with no title convention and no additional Ship instructions
- **THEN** the submitted text is the Ship prompt followed by the implementation record instruction for `rotate-keys`

#### Scenario: Order with every addition
- **WHEN** Ship is used in a project with Conventional Commits titles, additional Ship instructions and auto-merge included
- **THEN** the text is the Ship prompt, the Conventional Commits sentence, the record instruction, the additional instructions and the auto-merge instruction, in that order

#### Scenario: A custom Ship prompt
- **WHEN** the profile has its own Ship prompt
- **THEN** the record instruction is still appended to it

#### Scenario: Archive session
- **WHEN** Ship is used on the archive session of `rotate-keys`
- **THEN** the record instruction is the archive branch's, naming `archive-branch`

#### Scenario: Fast-forward
- **WHEN** Fast-forward is started for `rotate-keys`
- **THEN** its prompt contains the implementation record instruction exactly once, within its Ship part

#### Scenario: Archive with docs auto-merge
- **WHEN** an Archive prompt is started with the archive auto-merge instruction
- **THEN** the archive record instruction follows that instruction

#### Scenario: Nothing written by the dashboard
- **WHEN** Ship with the record instruction is used
- **THEN** the dashboard wrote no file in the repository or worktree and ran no git command that writes
