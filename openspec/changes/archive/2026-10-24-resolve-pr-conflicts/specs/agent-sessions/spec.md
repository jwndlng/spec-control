## MODIFIED Requirements

### Requirement: Resolve conflicts asks the agent to make the branch mergeable again
The dashboard SHALL offer a Resolve conflicts action for a change when either of two **conflict signals** holds: the
**local signal** — a session worktree of the change reports a conflict in its work status — or the **GitHub signal** —
the change's linked pull request is `open` (drafts included) and has mergeability `conflicting` in the cached
pull-request list. Both signals SHALL be derived by one shared rule, so that the change detail, the session panel and
the server's refusals never disagree. Where a pull request is linked, the local signal SHALL be read from the session
worktree on that pull request's head branch. The offered action SHALL name, for each signal that holds, the base it
conflicts with and how fresh it is: the local signal "as of your last fetch", pointing at the pull action; the GitHub
signal as of the last refresh of that repository's pull-request list. When both signals are available and disagree,
the action SHALL still be offered and both SHALL be shown. When the change's worktree on the head branch has a `HEAD`
other than the pull request's cached head commit, the GitHub signal SHALL still offer the action and SHALL carry a
**push pending** hint saying that the worktree has commits GitHub has not seen, so the conflict may already be resolved
locally. Offering, showing or running the action MUST NOT
start a `gh` query or a fetch.

The action uses the agent profile's resolve-conflicts prompt, or an agent-neutral default asking the agent to bring the
branch up to date with the base, resolve the conflicts while keeping what the branch set out to do, run the project's
checks and push the result. When a pull request is linked, a fixed sentence SHALL follow the prompt and its additional
instructions, naming the pull request's number, head branch and base branch — all taken from the server's cached list,
never from the request — and asking the agent to bring the branch level with `origin/<head branch>` first if it is
behind, resolve against that base and push to that head branch. Where the action runs is decided before anything is
created:

- when a session for the change is **running** in a worktree on the pull request's head branch (or, with no pull
  request, in any session worktree of the change), the prompt SHALL be submitted to its terminal under the rules for text
  sent on the user's behalf, so that one activation sends it;
- otherwise, when a session worktree of the change on that branch exists, the agent SHALL be started there — with its
  resume command and the prompt submitted after start-up when it has one, else with its command and the prompt as
  opening prompt — in the same session record, under the same checks as Ship;
- otherwise, for the GitHub signal, a session SHALL be started on the pull request's head branch as the requirement "A
  conflicting pull request without a worktree gets a session on its head branch" specifies.

The result SHALL state whether the prompt was submitted, and when it was only typed the panel SHALL say so.

The dashboard itself MUST NOT resolve anything: it MUST NOT merge, rebase, cherry-pick, commit, push, or write any file
in the repository for this action, and MUST NOT check out anything beyond creating a session's worktree as specified.
Everything beyond handing over the prompt is the agent's doing under its own permission prompts.

The resolve-conflicts prompt SHALL be a configurable prompt of the profile like any other: it MAY use `{change}` and no
other placeholder, MUST NOT carry a permission-bypass mode or flag, SHALL be offered in Settings beside the other
prompts, and SHALL take that key's additional instructions — appended to the profile's prompt, or to the agent-neutral
default when the profile has none, exactly as Ship does. Additional instructions for another action MUST NOT reach it.
The fixed pull-request sentence is not configurable.

The action SHALL NOT be offered, and a request for it SHALL be refused with the reason, when neither signal holds — the
local signal does not hold for a worktree whose status is `missing`, `clean` or `merged` or whose conflict check was
unavailable; when a session for the change is running in a worktree on another branch than the pull request's head
branch, naming that session and branch; when a session worktree of the change exists on another branch than the pull
request's head branch, naming it; and for an in-place session, which has no worktree and no branch.

#### Scenario: Resolving in a running session
- **WHEN** Resolve conflicts is used on a running session whose worktree conflicts and whose agent waits at its text
  prompt
- **THEN** the prompt is typed, shown by the agent, submitted with a separate Enter, and no git command that changes the
  repository is run by the dashboard

#### Scenario: The agent shows a menu
- **WHEN** Resolve conflicts is used on a running session whose agent shows a selection menu
- **THEN** no Enter is pressed, nothing is confirmed, and the panel says the prompt was typed but not sent

#### Scenario: Resolving after the session ended
- **WHEN** Resolve conflicts is used on an ended session of an agent with a resume command
- **THEN** the agent is started again in the same worktree and session record, and the prompt is submitted after
  start-up

#### Scenario: GitHub reports a conflict the local check does not see
- **WHEN** change `rotate-keys` has an ended session whose worktree on `feat/rotate-keys` reports no conflict as of the
  last fetch, and its linked open pull request `#88` from `feat/rotate-keys` into `main` is cached as `conflicting`
- **THEN** Resolve conflicts is offered, saying GitHub reports conflicts with `main` as of the last pull-request refresh,
  and using it resumes the agent in that worktree with the prompt followed by the sentence naming `#88`,
  `feat/rotate-keys` and `main`

#### Scenario: Both signals
- **WHEN** a change's worktree reports a conflict with `origin/main` and its linked pull request is cached as
  `conflicting`
- **THEN** the action is offered once, and both signals are shown, each with its own freshness

#### Scenario: A local fix not pushed yet
- **WHEN** the linked pull request `#88` is cached as `conflicting` at head commit `a1…` and the worktree on
  `feat/rotate-keys` is at commit `b2…`
- **THEN** Resolve conflicts is still offered, and the GitHub signal says push pending: the worktree has commits GitHub
  has not seen

#### Scenario: Nothing to resolve
- **WHEN** Resolve conflicts is requested for a change whose worktree reports no conflict and whose linked pull request
  is cached as `mergeable`
- **THEN** the request is refused with the reason and no process is started

#### Scenario: A session running on another branch
- **WHEN** a session for `rotate-keys` is running on `wip/rotate-keys-spike` and the linked pull request `#88` from
  `feat/rotate-keys` is cached as `conflicting`
- **THEN** Resolve conflicts is refused with a reason naming that session and `wip/rotate-keys-spike`, and nothing is
  typed into it

#### Scenario: The action starts no query and no fetch
- **WHEN** Resolve conflicts is offered and used
- **THEN** no `gh` process and no `git fetch` is started for it

#### Scenario: Not offered without git
- **WHEN** a session runs in place in a tracked folder that is not a git repository
- **THEN** no conflict is reported for it, no Resolve conflicts control is shown, and a request for it is refused

#### Scenario: A configured prompt and its additional instructions are used
- **WHEN** a profile has no resolve-conflicts prompt of its own but additional resolve-conflicts instructions
  `We rebase here, never merge.`, and Resolve conflicts is used on a conflicting session without a linked pull request
- **THEN** the text handed to the agent is the agent-neutral default followed by one space and that sentence, and a
  configuration carrying either of them survives being saved and loaded

#### Scenario: The user is told how fresh it is
- **WHEN** a worktree's branch is reported as conflicting with `origin/main`
- **THEN** the dashboard names `origin/main`, says that this is as of the user's last fetch, and points at the pull
  action

## ADDED Requirements

### Requirement: A conflicting pull request without a worktree gets a session on its head branch
When Resolve conflicts is used for a change whose GitHub signal holds and no session worktree of the change exists, the
dashboard SHALL start a session for the change in a new worktree **on the linked pull request's head branch**, as an
exception to the branch naming of "Every session works in its own git worktree, created by the dashboard", and with the
resolve-conflicts prompt, including its fixed pull-request sentence, as the opening prompt. The session SHALL be
recorded with the action `archive` when the head branch is the change's archive branch — its recorded archive branch,
else `chore/archive-<name>` — and `implement` otherwise, and
its worktree SHALL be placed where a session of that action is placed. The head branch, the pull request's number, its
base and whether it comes from a fork SHALL be taken from the server's own cached list through the shared
link rule, never from the request, and the head branch SHALL be validated as a branch name before any git command.

The worktree SHALL be made with the session worktree commands already enumerated, decided read-only first so that a
refusal creates nothing:

- when a local branch of that name exists, it SHALL be checked out in the new worktree as it is, whether it is level
  with, behind or diverged from `origin/<head branch>`;
- otherwise, when the remote-tracking branch `origin/<head branch>` exists, the branch SHALL be created from it with
  that remote-tracking branch as its upstream;
- when the branch is checked out in a linked worktree in which no session runs, that worktree SHALL be adopted as the
  existing adoption rule specifies.

The dashboard MUST NOT contact a remote for this. The request SHALL be refused with the reason, and nothing created,
when the pull request comes from a fork, or the cached list does not say that it does not, with a one-line reason; when the head
branch is the default branch; when it is checked out in the main checkout; when neither a local branch nor
`origin/<head branch>` exists, saying to fetch or pull first; when agent sessions are disabled or the repository is
excluded from them; and for a repository whose sessions run in place.

#### Scenario: Worktree gone, branch only on the remote
- **WHEN** change `rotate-keys` has no session worktree, no local branch `feat/rotate-keys`, `origin/feat/rotate-keys`
  exists locally, and its linked open pull request `#88` from `feat/rotate-keys` into `main` is cached as `conflicting`
- **THEN** a session starts in a new worktree on a new branch `feat/rotate-keys` created from `origin/feat/rotate-keys`
  with it as upstream, its opening prompt names `#88`, `feat/rotate-keys` and `main`, and no `feat/` branch of another
  name is created

#### Scenario: A pull request recorded on an off-convention branch
- **WHEN** the change `rotate-keys` recorded `fix/rotate-keys` as its branch in its metadata, the pull request `#91`
  from that branch is cached as `conflicting`, and no worktree exists
- **THEN** the session's worktree is on `fix/rotate-keys`, not on `feat/rotate-keys`

#### Scenario: A local branch behind the remote
- **WHEN** a local branch `feat/rotate-keys` exists two commits behind `origin/feat/rotate-keys` and no worktree has it
  checked out
- **THEN** the new worktree checks out the local branch as it is, and the prompt asks the agent to bring it level with
  `origin/feat/rotate-keys` first

#### Scenario: A pull request from a fork
- **WHEN** the conflicting pull request comes from a fork
- **THEN** the request is refused with the one-line reason that its branch is in a fork, and no worktree or branch is
  created

#### Scenario: Branch not known locally
- **WHEN** neither `feat/rotate-keys` nor `origin/feat/rotate-keys` exists in the repository
- **THEN** the request is refused saying to fetch or pull first, and no fetch, worktree or branch is made

#### Scenario: Head branch in the main checkout
- **WHEN** the pull request's head branch is the branch the main checkout is on
- **THEN** the request is refused, and the main checkout's branch, index and working tree are unchanged

#### Scenario: The request cannot choose the branch
- **WHEN** `POST /api/sessions` with `resolveConflicts: true` also carries a branch or a pull-request number
- **THEN** those fields are ignored and the branch comes from the cached list
