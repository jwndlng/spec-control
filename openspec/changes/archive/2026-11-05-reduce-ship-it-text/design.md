# Design

## Context

See proposal.md for motivation and scope. `shipPrompt()` combines a profile's Ship prompt or the built-in default, the optional Conventional Commits sentence, the framework's branch-record instruction, additional profile instructions and the optional docs auto-merge instruction. Fast-forward reuses Ship's composition. The framework record instruction also appears outside Ship.

## Goals / Non-Goals

**Goals:** Reduce the built-in text materially, keeping explicit actions and constraints easy to identify.

**Non-Goals:** Change eligibility, submission, prompt ordering, merge policy, stored configuration or user-authored text. Do not introduce a new setting or prompt compression mechanism.

## Decisions

### Edit the source strings, preserving composition

Use short imperative sentences in the existing constants and framework method. Do not post-process assembled prompts: that could alter custom instructions or drop a conditional addition.

Suggested default: “Commit this work using the repository's conventions, push the branch, and open a PR against the default branch if needed. Do not merge. Report the PR URL.”

Suggested title addition: “Use Conventional Commits for commit messages and the PR title: <type>(<optional scope>): <summary>.”

Suggested Ship auto-merge addition: “For an openspec/-only PR, Spec Control will request the merge once checks pass. Do not merge or enable auto-merge now. Confirm whether all changed files are under openspec/.”

These are implementation starting points; final wording must retain all current obligations and be shorter than the replaced text. Retain the worktree scope in the default wording if needed for clarity.

### Keep the branch-record instruction self-contained

Shorten repeated explanations while retaining the selected `branch` or `archive-branch` key, top-level `spec-control` mapping, two-space indentation, active and archived marker locations, actual pushed branch, no-op when already correct, preservation of other fields, inclusion in the work's commit before push, and exclusion of PR numbers or later record-only commits. Do not remove this instruction to save space: scanning relies on the resulting marker.

Keep its existing call sites and ordering. A separate shorter Ship-only variant would duplicate a shared contract and risk divergence.

### Verify meaning and reduction together

Review the fully composed default Ship prompt with and without Conventional Commits and docs auto-merge. Compare character counts before and after for each changed string and the full composition. Update existing prompt assertions; preserve coverage for custom prompts, additional instructions, record ordering, archive keys and Fast-forward's single record instruction. Do not add brittle snapshots solely to freeze prose.

## Risks / Trade-offs

- Shortening can obscure a constraint → review every obligation above and run existing prompt tests.
- Shared record wording reaches Archive and other PR-opening prompts → exercise their existing tests too.
- Custom prompts can remain long → preserve user text; the reduction applies to built-in wording only.

## Migration Plan

No configuration migration is needed. Existing custom Ship prompts remain as saved; profiles using the default receive the shorter wording after upgrade. Rollback restores the previous strings.

## Implementation verification

Character counts use `rotate-keys` and the implementation `branch` key; separators count as one space.

| Built-in instruction | Before | After |
| --- | ---: | ---: |
| Default Ship | 271 | 185 |
| Conventional Commits | 170 | 99 |
| Branch record | 400 | 357 |
| Docs auto-merge | 320 | 210 |

| Convention | Branch record | Docs auto-merge | Before | After |
| --- | --- | --- | ---: | ---: |
| No | No | No | 271 | 185 |
| No | No | Yes | 592 | 396 |
| No | Yes | No | 672 | 543 |
| No | Yes | Yes | 993 | 754 |
| Yes | No | No | 442 | 285 |
| Yes | No | Yes | 763 | 496 |
| Yes | Yes | No | 843 | 643 |
| Yes | Yes | Yes | 1164 | 854 |

Reviewed all eight compositions against the original obligations: worktree scope, repository conventions,
push, default-branch PR only if absent, URL reporting, no immediate merge or auto-merge, docs-only
confirmation and merge after passing checks without review. The shared record retains both paths,
the selected key and actual pushed branch, the top-level map and indentation, the already-correct
no-op, preservation of other fields, inclusion before push and exclusions of PR numbers and later
record-only commits. Archive and Draft auto-merge strings are unchanged.

The 79 targeted tests pass across `agents`, `recordInstruction`, `changeRecord` and `whatsNew`,
including custom prompts, additional-instruction ordering, archive recording, shared consumers
and exactly one branch-record instruction in Fast-forward.

Final checks: lint and type checking pass. The full `bun run check` ran 2,197 tests,
with 2,190 passing and seven failures: one stale Fast-forward wording assertion (now
updated to use the source constants), five five-second timeouts and one terminal-menu
failure. Both affected terminal/artifact files pass on rerun (48 tests), including the
menu test. The other three failed files pass with `--timeout 30000` (75 tests).
All seven failures are covered by these passing reruns; the full suite was not repeated.
Strict OpenSpec validation and `git diff --check` pass. No task requires user-only action.

### Integration with current main

Before opening the PR, rebased onto `5918e23`. The intervening agent-interoperability
change moved Ship/Merge execution to the server and removed branch-record composition
and the Fast-forward Ship tail. Preserve those changes: this PR only shortens the
retained prompt constants and framework instruction, without restoring any old call site.
The measurements and original verification above describe the pre-rebase composition;
current-main tests cover its updated composition. The terminal Fast-forward assertion
stays as main defines it. The changelog describes the retained prompt text rather than
claiming the Ship action sends it.

Post-rebase validation: `bun run check --timeout 30000` passes lint, type checking and
all 2,230 tests across 176 files. The initial post-rebase run with the default timeout
had two five-second scan timeouts and the intermittent terminal-menu failure; all
three pass in the final full run without code changes.
