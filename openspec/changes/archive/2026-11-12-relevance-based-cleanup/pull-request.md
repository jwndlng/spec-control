# Reviewer summary

Cleanup currently retains every unmerged branch, even when no active OpenSpec change uses it and its latest commit is old. The change makes the preview prioritize work that still appears relevant: active changes stay protected, unmerged work from the last 30 days is retained, and older unrelated unmerged work can be cleaned up. Merged work remains eligible regardless of age, subject to existing safety checks.

The implementation will apply these rules in the shared branch and worktree judges, re-check them at confirmation, and explain why items are retained. Verification will add focused cleanup tests for active, recent, old and merged work, including existing dirty, running-session, locked and stale-record safeguards, then run `bun test test/cleanup.test.ts`.
