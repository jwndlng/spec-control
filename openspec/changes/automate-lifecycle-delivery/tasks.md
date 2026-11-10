# Tasks

## 1. Scoped implementation and verification

- [ ] 1.1 Add versioned lifecycle checkpoint identities, states, blockers, recovery actions, and project/change incarnation contracts in shared types and dashboard-home storage; verify atomic save/reload, concurrent writes, and older records with focused tests.

- [ ] 1.2 Add a coordinator that observes only managed action completion from bounded framework outputs, task summaries, archive identity, and stable snapshots while agents remain running; verify Ready, Done, Archived, incomplete/malformed evidence, and historical scan bootstrap with fixtures.

- [ ] 1.3 Bind phase-completion intent to the current server-issued action identity and independently verify stable artifacts/tasks/git before shipping; verify mid-draft pauses, running-agent completion, missing signal recovery, stale report replay, and clean-exit fallback with fake-agent tests.

- [ ] 1.4 Expose delivery status and validated retry through the API and first-party/demo clients; verify same-origin checks, obsolete identities, unavailable GitHub projects, and duplicate concurrent retries.

- [ ] 1.5 Document local completion versus remote persistence in Help; verify terminology matches the returned state and blocker model.

- [ ] 1.6 Extract reusable deterministic Ship operations behind worktree/repository guards shared by manual and automatic callers; verify changed branch/head/index/content evidence cannot publish unintended files.

- [ ] 1.7 Give managed Draft sessions a dedicated proposal branch independent of docs auto-merge and enqueue scoped proposal delivery on verified Ready; verify docs auto-merge off, long-running agents, title conventions, mixed-work blockers, and existing open proposal reuse.

- [ ] 1.8 Enqueue implementation delivery on verified Done and archive delivery on verified archival; verify code PRs open without automatic merge, all-checked implementation gating, and explicitly accepted unresolved archive publication without fabricated completion.

- [ ] 1.9 Persist operation intent and reconcile commit/push/PR outcomes after failure or restart; verify crash boundaries, uncertain remote responses, manual Ship races, and no duplicate PR/commit for unchanged evidence.

- [ ] 1.10 Preserve explicit proposal-session handoff and newer agent work during merge/cleanup; verify continuation before proposal merge, running-agent preservation, and no automatic implementation launch.

- [ ] 1.11 Integrate PR body selection from `ship-button-has-no-description` and preserve explicit action gating from `ship-button-should-only-block-implement`; verify combined Ship scenarios and document any artifact reconciliation before touching their owned files.

- [ ] 1.12 Implement a shared exact-head documentation classifier for local and GitHub diffs; verify OpenSpec, README, docs Markdown, renames, scripts, workflows, manifests, symlinks/submodules, unknown paths, and incomplete diffs.

- [ ] 1.13 Read and cache fresh exact-head required-check/protection evidence through the GitHub integration; verify no-required-check projects can merge and empty/unknown, pending, failing, conflicting, draft, wrong-base, and fork cases remain blocked.

- [ ] 1.14 Merge proposal checkpoints independently of docs auto-merge while applying the setting to other documentation/archive checkpoints; verify both setting values and that implementation code is never auto-merged.

- [ ] 1.15 Replace permanent once-per-head failure suppression with serialized attempts, bounded transient retry, and actionable policy/permission/conflict blockers; verify successful recovery at the same head and no duplicate concurrent merge.

- [ ] 1.16 Update launch/settings/Help descriptions for standard proposal persistence and optional documentation merge scope; verify copy no longer promises only OpenSpec files or implies blanket code merge authorization.

- [ ] 1.17 Exercise a complete fake-agent lifecycle from Draft to merged proposal, implementation PR, explicit implementation merge, and archive PR, including a restart and same-head merge retry; verify GitHub writes and server records with fake GitHub fixtures and no real agent/network in automated tests.

- [ ] 1.18 Exercise installed Codex and Antigravity in disposable repositories using documented arguments; record actual versions, skill discovery/fallback and action completion behavior, permission blockers, and recovery. Keep unresolved manual evidence explicit; never mark unsupported runtime features verified.

- [ ] 1.19 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Build the compiled binary and verify the affected terminal/API behavior in the compiled runtime.

- [ ] 1.20 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
