# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: `automate-lifecycle-delivery`.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

### 4. Organize detail around lifecycle progress

Add a shared lifecycle view model and a timeline component above artifact/Console tabs. Major nodes are Backlog, Drafts, Ready, Implementing, Done, and Archived; minor nodes derive from the framework artifact graph and validation milestones. Labels distinguish local completion from remote persistence. Do not imply the changes are independent of schema requirements or invent missing validation results.

Place one contextual Draft artifacts, Implement, or Archive button with the corresponding phase. Retain existing session eligibility, dependency explanations, agent selection, explicit handoff, and manual recovery routes. A session actions menu holds Resume, Clean up, Delete record, and Open in editor. Replace detail's Copy cd button with an accessible copy-path icon beside the path. Delete record remains a session-record operation, visibly distinct from Dismiss change and Delete change files.

Use a readable compact layout at narrow widths, keyboard focus and screen-reader labels, and text in addition to colors. Consume existing concise overview/delivery state; simplify-overview-messages owns the Finish checks presentation and automate-lifecycle-delivery owns its status contract.

### Layout sketch

```text
Change title                         [Session actions v]
Branch  /worktree/path [copy icon]       PR #42

Backlog —— Drafts —— Ready —— Implementing —— Done —— Archived
             · proposal · specs · tasks
                         [Implement]
             Persistence: proposal merged / PR #42

[Proposal] [Specs] [Tasks] [Console]       [Raw]
Selected artifact content or console
```

Concrete responsive mockup (before UI wiring):

```text
Wide (detail content >= 720 px)
┌ Change title ─────────────────────────── [Session actions ▾] ┐
│ Branch feat/example · /worktrees/example [Copy path] · PR #42 │
├──────────────────────────────────────────────────────────────┤
│ Backlog ── Drafts ── Ready ── Implementing ── Done ── Archived│
│            ● Proposal ● Specs ○ Tasks                         │
│                                      [Implement]              │
│ Delivery: proposal merged · implementation PR #42 checks pending│
├──────────────────────────────────────────────────────────────┤
│ Proposal   Specs   Tasks   Console                            │
└──────────────────────────────────────────────────────────────┘

Narrow (detail content < 720 px)
┌ Change title ─────────────── [Session ▾] ┐
│ feat/example · /…/example [Copy]          │
├──────────────────────────────────────────┤
│ Current: Drafts  →  Next: Ready           │
│ [Show full timeline ▾]                    │
│ Proposal ✓ · Specs ✓ · Tasks missing      │
│ Delivery: PR #42 · checks pending         │
│ [Draft artifacts]                         │
├──────────────────────────────────────────┤
│ Proposal  Specs  Tasks  Console           │
└──────────────────────────────────────────┘
```

Large labeled phase nodes carry local progress; smaller artifact milestones derive from the active schema and stay ordered within their phase. The narrow summary retains current/next phase, artifact state, persistence state, and the primary action without horizontal scrolling; the full ordered timeline is expandable. Labels distinguish local completion from remote persistence. Do not imply the changes are independent of schema requirements or invent missing validation results. Session maintenance stays in the labeled selected-session menu, separate from the one phase action. The mockup follows Backlog → Drafts → Ready → Implementing → Done → Archived and keeps pending delivery text visible at both widths.


## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
