# Tasks

## 1. Reading the record (OpenSpec module)

- [ ] 1.1 Add `ChangeRecord` (`branch?`, `archiveBranch?`) and `recorded?` on `ChangeSnapshot` in `src/shared/types.ts` and on `FrameworkChange` in `src/server/frameworks/framework.ts`; verify with `bun run typecheck`
- [ ] 1.2 Extend `parseMarker` in `src/server/frameworks/openspec/marker.ts` to read the `spec-control:` map (indentation, quotes, comments, end of block, the two keys, branch validation, warnings for dropped values); verify with a unit test covering every scenario of "OpenSpec changes record their pull request in `.openspec.yaml`" except the library one
- [ ] 1.3 Pass the record through `readChangeOutputs` for active and archived changes; verify with a scanner test against a generated fixture change carrying a record
- [ ] 1.4 Add a test that the bundled `@fission-ai/openspec` reads a `.openspec.yaml` with a `spec-control:` map without error and that `writeChangeMetadata` is called only from change creation, so a library upgrade that breaks either fails loudly

## 2. Scanner

- [ ] 2.1 Rewrite `findBranchMatch` in `src/server/scanner.ts` as an exact match against the branch candidates (recorded branch, recorded archive branch, `feat/<name>`, `chore/archive-<name>`), main checkout first; verify with scanner tests for the sibling-branch, containing-name, recorded-branch and session-branch scenarios, and that the linked-worktree rule is unchanged
- [ ] 2.2 Carry `recorded` through `mergeChanges.ts` (leading copy, else the main checkout's copy); verify with merge tests for both scenarios and that columns and counts are unchanged

## 3. Link

- [ ] 3.1 Implement the two-step order in `linkedPullRequest` (`src/shared/pullRequestLink.ts`): recorded branches, then candidates, the creation-date rule applying to both; include recorded branches in `candidateBranches`; verify with `test/pullRequestLink.test.ts` covering every scenario of the modified requirement
- [ ] 3.2 Add `recorded` to the `Pick`s in `src/ui/pullRequests.tsx` and `src/ui/pullRequestsState.ts` so the detail header and the watch plan use the same rule; verify with `bun run check`

## 4. Record instruction

- [ ] 4.1 Add an optional `recordInstruction({ change, archive })` to `SpecFramework` and implement it in the OpenSpec module with the fixed text; verify with a unit test that it names both paths, the right key and the map's shape
- [ ] 4.2 Append it in `shipPrompt` (after the Conventional Commits sentence, before additional instructions and the auto-merge instruction) and after the archive auto-merge instruction, choosing the key from the session's action in `src/server/sessions/manager.ts`; Fast-forward gets it through Ship only; verify with `test/agents.test.ts` for every scenario of "An agent asked to open a pull request is asked to record it", including a custom Ship prompt and a framework without an instruction
- [ ] 4.3 Verify with a session test using the fake agent that Ship with the record instruction writes nothing in the worktree and runs no writing git command

## 5. Docs and verification

- [ ] 5.1 Explain in `src/ui/helpContent.tsx` how a change's pull request is found (recorded branch first, then the exact candidates) and that the agent records the branch on Ship; verify with `bun run check`
- [ ] 5.2 Run `bun run check` and `bun run build`, and verify the compiled binary reads a change's record and links its pull request
- [ ] 5.3 Add a What's new entry at the top of `src/ui/changelog.ts`: cards now follow the branch the agent recorded for the change, and no longer borrow the pull request of a change with a similar name
