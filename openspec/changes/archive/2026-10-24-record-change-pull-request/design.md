# Design

## Context

`linkedPullRequest` (`src/shared/pullRequestLink.ts`) derives a change's pull request on display from three candidate
head branches — `branchMatch`, `feat/<name>`, `chore/archive-<name>` — compared exactly against the cached
`gh pr list` output of the change's own repository. `branchMatch` comes from the scan: the branch of the linked worktree
the leading copy was read from, or, for a change in the main checkout, `findBranchMatch`, which returns the main
checkout's branch or the first worktree branch that *contains* the change name. That containment is where a sibling
change's pull request gets linked. A branch the agent named itself is never a candidate, so its pull request is missed.

Nothing persistent records "this change was shipped from `fix/foo`". Session records under `~/.spec-control/`
were considered and rejected by the user: they are not the repository, they vanish with the session, and another
machine or clone would not see them.

## Goals / Non-Goals

**Goals:** a record of the branch a change's pull request is opened from that lives in the repository, travels with the
change's branch and its archive, is written by the agent that pushes it, and outranks every guess; no containment in any
branch matching.

The record holds branches only, never pull request numbers. The branch is known before the push, so the agent records it
in the same commit as its work; a number exists only after the pull request is opened and would cost a second commit and
CI run per pull request. A branch identifies the pull request exactly enough — the link compares head branches exactly
within the change's own repository — and the record does not have to be kept in sync with GitHub.

**Non-Goals:** no write by the dashboard (no new invariant-1 entry), no new `gh` or git subcommand, no change to columns,
counts, actions or the activity log, no backfill of existing changes (they fall back to the exact candidates), and no use of the record by other features in this change — `resolve-pr-conflicts` and
`stale-means-archived-and-merged` build on it separately.

## Decisions

### D1 The record lives in `.openspec.yaml`, under one namespaced map

```yaml
schema: spec-driven
created: 2026-10-24
spec-control:
  branch: feat/rotate-keys
  archive-branch: chore/archive-rotate-keys
```

Why it is safe to add keys to OpenSpec's own marker, checked against `@fission-ai/openspec`:

- `ChangeMetadataSchema` (`dist/core/change-metadata/schema.js`) is a plain, non-strict zod object, so unknown keys
  pass validation when OpenSpec reads the file (`readChangeMetadata`, item discovery, the instruction loader).
- `writeChangeMetadata` (`dist/utils/change-metadata.js`) re-serialises only the parsed data and therefore drops
  unknown keys — but its only caller is `createChange` (`dist/utils/change-utils.js:142`), i.e. when the change is
  created, before any record exists.
- `openspec archive` moves the change directory as a whole; the file and the map move with it into
  `archive/<date>-<name>/`.

One map named after the tool, rather than flat prefixed keys, keeps the file readable, makes "everything Spec Control
reads" one block, and leaves room for later keys without a naming scheme. Should OpenSpec ever make the schema strict
or rewrite the file elsewhere, the record is lost and the link falls back to today's guess — a degradation, not a
failure. A test pins the two library facts above so an upgrade that breaks them fails loudly.

### D2 A separate key for the archive branch

An archive usually ships as its own pull request on `chore/archive-<name>`, after the implementation pull request has
merged. If it reused `branch` it would overwrite the implementation record that `stale-means-archived-and-merged` needs
("is the implementation branch's work in the default branch?"), and the card of an archived change could no longer find
both. So an archive session records `archive-branch`; every other session records `branch`. Which key a session writes
is decided by the server from the session's action, never by the agent.

### D3 The agent writes the record; the dashboard only asks

The dashboard knows the branch a session starts on, but not the one the agent finally pushes. Writing it itself would be a new write to a tracked repository
(invariant 1) and, in the main checkout, exactly the uncommitted leftover the stale-change work is trying to remove. The
agent already commits and pushes in its own worktree under its own permission prompts, so it records too: before its
commit, set `spec-control.branch` (or `archive-branch`) to the branch it is about to push, and include that in the same
commit as the work; leave a record that already names this branch alone, correct it otherwise. No extra commit, push or
CI run.

The instruction is **appended**, not written into `DEFAULT_SHIP_PROMPT`. A profile with its own Ship prompt would
otherwise never record, and the user's prompt text stays theirs. Appending also means no saved configuration carries a
former default to be migrated, so no `FORMER_PROMPTS` entry is needed. The order is: Ship prompt, Conventional Commits
sentence (when set), record instruction, the user's additional Ship instructions, auto-merge instruction (when
included) — the user's own words still come last before the fixed auto-merge text, as today.

The text is framework-specific (it names `.openspec.yaml` and the change's directories), so the OpenSpec module supplies
it (`recordInstruction({ change, archive })`, optional on `SpecFramework`); a framework without one gets no record
instruction and keeps the guess. It says where the file is in both states — `openspec/changes/<name>/` or, once
archived in this branch, `openspec/changes/archive/<date>-<name>/` — and gives the exact YAML shape.

It is appended wherever the dashboard's text may lead the agent to open a pull request: Ship, Fast-forward (which ends
with Ship's text, so it is included once, through Ship) and the archive auto-merge instruction ("if you open one").

`shipsOnlyOpenSpec` is unaffected: `.openspec.yaml` is under `openspec/`, so recording never turns a docs-only branch
into a code branch.

### D4 Reading: the OpenSpec module, line-based, validated

`marker.ts` already reads `.openspec.yaml` without a YAML parser. It gains a reader for one top-level `spec-control:`
key followed by indented `key: value` lines (spaces only, optional single or double quotes, a trailing `# comment`
ignored); the block ends at the next line that is not indented. Only the two keys are read; unknown keys — a `pr` an
agent added on its own among them — are ignored.

- `branch`, `archive-branch`: kept only when they look like a branch name git would accept and that the dashboard can
  pass around safely: 1–200 characters from `[A-Za-z0-9._/-]`, not starting with `-`, `/` or `.`, not ending with `/`
  or `.lock`, no `..`, `//` or `@{`.

A malformed value is dropped and reported as a warning on the change, like other problems reading a change; it never
fails the scan. The module reports `recorded?: { branch?, archiveBranch? }` on `FrameworkChange`, and the
scanner copies it to `ChangeSnapshot.recorded`, framework-neutral.

When copies are merged, the record is the leading copy's; when the leading copy records nothing, the main checkout's
copy's. The record is on a branch until it merges, so a change whose worktree was removed before the merge falls back to
the guess until the user pulls — the same state as today, not worse.

### D5 The link order

`linkedPullRequest(change, lists)`:

1. **Recorded branches.** Pull requests of the change's own repository whose head is exactly `branch` or
   `archive-branch`, best by today's `better` rule (open first, then most recently moved, then higher number).
2. **Candidates.** Otherwise, today's rule over `branchMatch`, `feat/<name>`, `chore/archive-<name>`.

The "settled more than a day before the change was created" rule applies to both steps alike: a branch name can be
reused by a later change just as a session branch can, and one rule for every match keeps the link simple. A recorded
branch whose pull request is not in the cache (merged more than 7 days ago, or beyond the list's limits) falls through
to the candidates. `candidateBranches` includes the recorded branches, so the watch plan and the detail header keep
using one rule.

### D6 `branchMatch` without containment

For a change in the main checkout, `findBranchMatch` returns the main checkout's branch if it is exactly one of the
change's candidates (recorded `branch`, recorded `archive-branch`, `feat/<name>`, `chore/archive-<name>`, in that order),
else the branch of the first linked worktree that is exactly one of them, else nothing. The rule for a change whose
leading copy is in a linked worktree is unchanged: that worktree's branch, whatever its name — the change really lives
there.

## Risks / Trade-offs

- **The agent forgets or gets it wrong.** Then the link falls back to the exact candidates. A wrong branch can only
  name a pull request of the change's own repository with exactly that head. The record instruction is fixed text the
  user cannot accidentally delete with their own prompt.
- **Several pull requests from one branch** (one closed, one reopened): the `better` rule picks one, as today.
- **Library drift.** Covered by the test in D1 and by the fallback.
- **Old changes** fall back to the exact candidates. No backfill, and no prompt in the help to add one.
