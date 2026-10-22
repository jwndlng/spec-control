# Design

## Context

See proposal.md for why. What exists today:

- `AUTO_MERGE_DOCS_INSTRUCTION` / `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION` (`src/shared/types.ts`) are appended by
  `shipPrompt` / `openingPrompt` (`src/server/sessions/agents.ts`) when `agent.autoMergeDocs` is on and
  `shipsOnlyOpenSpec` (`src/server/sessions/workStatus.ts`) proves the worktree holds only `openspec/` paths. Doing so
  sets `ChangeSession.autoMergeAskedAt`.
- `postPullRequestsRefresh` (`src/server/api.ts`) hands every good list to `SessionManager.endMergedAutoMerge`, which
  ends sessions whose recorded pull request merged after `autoMergeAskedAt`. This is the hook the new decision joins.
- `PullRequestStore` (`src/server/pullRequests.ts`) runs two `gh pr list` calls per GitHub repository (open, recently
  closed) with a fixed `FIELDS` string, caches the parsed `PullRequest`s and serves them to the UI.
- The board's watch (`watchPlan`, `src/ui/pullRequestsState.ts`) only knows readiness, which comes from
  `pullRequestReadiness` (`src/shared/pullRequestReadiness.ts`). It does not know about sessions.
- Text sent into a running agent goes through `SessionManager.submit` → `submit.ts` (typed, echo-checked, separate
  Enter). Resolve conflicts (`resolveConflicts` in the manager, `POST /api/sessions/<id>/resolve-conflicts`) is the
  closest model for a new prompt-only action.

## Goals / Non-Goals

**Goals:**
- Docs-only pull requests merge on a free private repository, with the dashboard's `gh` still read-only.
- The automatic path can never merge something that is not docs-only, not green, or not what was checked.
- One manual Merge action that works for any ready pull request of a running session.

**Non-Goals:**
- Merging from a session whose agent has exited (no automatic resume).
- Choosing the merge method. That is the repository's convention, which the agent knows.
- Running a pull-request query on the server's own timer. The decision rides on queries that already run.
- Merging with Fast-forward, which keeps its pull request open for review.

## Decisions

### D1. The prompt carries the number and the commit, not a placeholder

Profile prompts have exactly one placeholder, `{change}`, and that rule should stay. So `mergePrompt(agent, change,
{ pr, head })` composes `prompts.merge ?? DEFAULT_MERGE_PROMPT` with its additional instructions (`compose(agent,
"merge", …)`), substitutes `{change}`, and appends a fixed `MERGE_TARGET_SENTENCE` built from `pr` and `head`. `pr`
must be a positive integer and `head` must match `/^[0-9a-f]{40}$/`, or it throws. Both come from the parsed `gh`
output on the server, never from the request body. The route `POST /api/sessions/<id>/merge` takes no body fields.

`DEFAULT_MERGE_PROMPT` names `gh pr merge <n> --match-head-commit <sha>` as the way to do it with the GitHub CLI. The
GitHub CLI is the host's tool, not an agent vendor, and it is the only thing that makes "merge exactly this commit"
precise. The method flags (`--squash`/`--merge`/`--rebase`) are left to the agent.

*Alternative:* `{pr}` and `{head}` placeholders. Rejected because they break the one-placeholder rule, the preset
upgrade logic, and the validation story for every other prompt.

### D2. The pull-request list gains `headOid` and `docsOnly`, not paths

`FIELDS` gains `headRefOid` for every call. For the **open** call only, and only when some enabled target mapped to
that GitHub repository has `agent.autoMergeDocs === true`, it also gains `files,changedFiles`. `toPullRequest` turns
these into `headOid?: string` (40 hex characters, otherwise absent) and `docsOnly?: boolean`. `docsOnly` is true
exactly when `changedFiles >= 1`, `files.length === changedFiles`, and every `files[].path` starts with `openspec/`.
The paths are dropped right after parsing, so the cache and the API response grow by two small fields per pull
request.

`gh` fetches at most 100 files per pull request. Comparing the count with `changedFiles` turns a truncated list into
"not docs-only" instead of a false positive. A cached entry without the fields reads as no head commit and not
docs-only, so an old cache can never trigger a merge.

*Alternative:* `gh pr view --json files` per candidate. Rejected because it is a new invocation on its own schedule,
and the spec allows only `gh pr list`.

### D3. GitHub's file list and the local worktree must both agree

GitHub's `files` gives one path per file, which loses the source side of a rename. A `src/x` moved into `openspec/`
would look docs-only from GitHub's side alone. So the automatic decision also requires:

- `git rev-parse HEAD` in the worktree equals `headOid`, and
- `shipsOnlyOpenSpec(worktree, baseRef(repo))` holds. That function already counts both sides of a rename and
  everything uncommitted.

Both checks are read-only git that the module already runs. If the agent pushed from the worktree, HEAD equals the
pushed head. If HEAD differs (unpushed commits, or a push from somewhere else), nothing is sent, which is the safe
direction. This makes D2's `docsOnly` a second opinion against the base GitHub actually uses, and the local check the
authority on renames.

### D4. Record per session, pull request and head commit, taken before the first await

`ChangeSession.mergeAsked?: { pr: number; head: string; at: string; submitted: boolean; by: "dashboard" | "user" }`
is persisted with the session. `requestReadyMerges(repoId, pullRequests)` lives in the manager next to
`endMergedAutoMerge`. It uses an in-memory `merging: Set<sessionId>`, like `autoEnding`, taken before the first
`await`. It writes `mergeAsked` before calling `submit`, so two queries that complete close together cannot both type
the prompt. A candidate is skipped when `mergeAsked.pr === pr.number && mergeAsked.head === pr.headOid`. A new head
replaces the record on the next send. A manual Merge writes the same record (`by: "user"`), so the automatic path
does not repeat what the user just sent.

This answers the proposal's first open question. One record per session is enough: a session has one branch and so
at most one open pull request, and keying on the head commit is what lets a pushed fix be retried while nothing
repeats in between.

`submitted: false` is kept and never retried automatically (spec). Typing again into a terminal that already holds
the unsent text would double it, or worse, land in a menu.

Order in `api.ts`: `endMergedAutoMerge` and `requestReadyMerges` both run for every good list. They cannot both act
on one pull request, because one needs it merged and the other needs it open.

### D5. The watch learns about pending merges from the session list it already has

`watchPlan` gains a `pendingMerges` input. This is a set of `repoId/change → {pr, head}` built by the board from the
sessions it already polls (`src/ui/sessionState.ts`). A card whose linked pull request is open and matches a pending
record by number and `headOid` counts as watched and in progress, even when it is ready. When the pull request
merges, closes or gets a new head, the match fails and the watch falls back to readiness alone. The rule lives in
`src/shared/pullRequestReadiness.ts` as `mergePending(pr, mergeAsked)`, so the card, the panel and the watch share
it.

The watch still runs only while a board is open and visible. Without an open board, the merge is noticed on the next
query the user causes. That is the same limit "A merged auto-merge pull request ends its session" already accepts.

### D6. The instruction text

Ship's `AUTO_MERGE_DOCS_INSTRUCTION` becomes, in substance: "This project lets a pull request that changes only files
under openspec/ merge without review once its checks pass; Spec Control will ask you to merge it when it is ready. So
open the pull request as asked, do not merge it and do not enable auto-merge on it, and tell me whether every file it
changes is under openspec/." The Archive one keeps "Do not open a pull request just because of this" and is
otherwise the same. Both stay one line, fixed and not editable. The constant names stay, so the composition order and
its tests are untouched. Only the texts and the panel's wording change.

### D7. Panel and card wording

- After an automatic or manual send that was submitted: "Asked the agent to merge #88 at c0ffee1." (short SHA in the
  text, full SHA in the tooltip). This shows while `mergePending` holds.
- Not submitted: "The Merge prompt for #88 was typed but not sent. Press Enter in the terminal to send it."
- Ready but the session is not running: the existing ready badge, plus "Resume the session to merge." in the panel.
  Nothing is automatic.

This answers the proposal's third open question. Merge sits in the panel's action list next to Ship and Resolve
conflicts. It is enabled only under the spec's conditions, and the reason is shown in its tooltip when it is not.

### D8. Field cost

This answers the proposal's second open question. The cost is bounded by D2: `files` is requested only on the
open-PR call (at most 101 pull requests), only for repositories with the opt-in, and gh caps it at 100 paths each.
That is at most about 10k short strings, parsed and dropped. No extra call and no extra cache weight.

## Risks / Trade-offs

- [The agent is busy when the prompt arrives] → The echo check still applies. An agent that queues input (Claude
  Code) runs it next, and one that shows nothing gets no Enter, and the panel says so. Sending is deliberately not
  gated on the `waiting` badge: the badge comes from the agent's own report, which many agents never write.
- [The agent ignores `--match-head-commit`] → The dashboard asserts nothing beyond its prompt. The commit check is
  the agent's own guard, and the dashboard re-derives the outcome from the next query. This is the same trust the
  current instruction places in the agent, minus GitHub's auto-merge.
- [Checks `none` on a repository without CI never auto-merges] → This is intended (spec). The user can press Merge.
  The tooltip says so.
- [Another tracked repository shares the GitHub repository but has the opt-in off] → `files` is requested because
  one of them opted in. `docsOnly` is computed for all of them, but only sessions of an opted-in repository act on it.
- [`changedFiles` drift or a missing field after a `gh` upgrade] → It is parsed defensively and reads as not
  docs-only. The worst case is that nothing merges automatically.

## Migration Plan

- Existing sessions that carry `autoMergeAskedAt` from the old instruction become eligible for the automatic Merge.
  If GitHub's auto-merge already merged their pull request, `endMergedAutoMerge` handles them as before.
- `agent.autoMergeDocs` keeps its name and meaning (the opt-in). No config migration is needed. `prompts.merge` is
  optional and absent from every preset, so the preset upgrade table is unchanged.
- Rollback: reverting restores the old instructions. A persisted `mergeAsked` and the new cache fields are ignored
  by older readers.
