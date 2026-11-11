# Tasks

## 1. Determine active change association

- [ ] 1.1 Read active change directory names from the repository's OpenSpec tree and associate exact branch names or exact final path segments (such as `feat/<change>`); verify with cleanup tests covering active protection and archived/non-matching names.
- [ ] 1.2 Apply the active-change reason and protection in the shared worktree and branch judges; verify merged and old active work remains kept in preview and confirmation re-checks.

## 2. Add relevance rules for unrelated work

- [ ] 2.1 Add the 30-day recent-unmerged decision for branches and worktrees, keeping missing or invalid timestamps conservatively; verify recent and older unmerged fixtures on both item types.
- [ ] 2.2 Keep merged unrelated clean work eligible regardless of age while retaining dirty, session, lock, default-branch, main-checkout and stale-record safeguards; verify corresponding cleanup test cases.
- [ ] 2.3 Update cleanup preview tests for user-facing active-change and recent-work reasons, and run `bun test test/cleanup.test.ts`.

## 3. Document the user-visible change

- [ ] 3.1 Add an independent What's New JSON entry under `src/ui/changelog/entries/` describing the relevance-based cleanup preview; verify the entry follows the format documented in CONTRIBUTING.md.
