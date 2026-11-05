# Design

## Context

Ship currently reads work status and sends a configurable prompt, without checking task progress. Fast-forward embeds that prompt. Stage is derived from checkboxes and remains Implementing while any task is open; a merged PR does not settle a task. The snapshot limits listed awaiting task text and does not currently list open task text. The existing PR cache has aggregate checks and freshness, not proof that a particular command ran. See proposal.md and the delta specs.

## Goals / Non-Goals

**Goals:** Make unfinished work hard to overlook, preserve a PR-dependent verification path, and provide a post-merge route to evidence-based completion.

**Non-Goals:** Guarantee agent compliance, infer verification from a checkbox or merged PR, tick tasks in the dashboard, or block GitHub actions performed outside the dashboard.

## Decisions

1. Read a bounded task summary from the session's own worktree at Ship preflight, including open and awaiting text, with explicit unreadable, missing and truncated states. Recheck it at confirmation and return the changed result if it no longer matches. A board snapshot can describe a different checkout or be stale. Follow the framework's existing bounded read and symlink safety rules; treat unavailable or truncated state as unverified, never complete.
2. Preflight offers **Finish tasks**, **Ship anyway**, and cancel. Finish tasks sends an agent-neutral request to do the remaining work and report blockers; it does not implicitly ship. Ship anyway is a deliberate user choice, with the unresolved tasks visible, and asks the agent to identify PR-dependent checks and revisit them. This breaks the CI-before-PR cycle without silently shipping incomplete work. A missing or empty tasks file is unverified; show a clear explanation and the same explicit choice. Apply the gate to the session panel and end-session Ship instead, with server-side enforcement so direct API calls cannot bypass it. Fast-forward instructs the agent to follow the same discipline, but its combined prompt is not an enforceable dashboard gate; disclose that limitation.
3. Use the cached linked PR only to offer Finish checks, clearly saying its freshness; do not infer task success. Exclude proposal PRs, unrelated branches, closed-unmerged PRs and archived changes. A running session receives the request; otherwise resume the relevant implementation session. If it is unavailable, start a new agent in a safe existing implementation worktree or a newly created branch/worktree following session ownership rules; explain a refusal rather than touch the main checkout. The agent verifies evidence under its own permissions and prepares a follow-up PR when required, rather than pushing to the merged branch or altering main itself. Offer the action in the console and on the card without changing the ordinary stage-derived starters.
4. Extend preset implementation instructions without overwriting customized prompts or additional instructions. Ship's completion instruction applies to user-configured Ship prompts too, in a clearly documented position, and preserves title, branch-recording and auto-merge instructions. Do not auto-merge a PR with unresolved tasks as a consequence of this change; existing opt-in docs-only automation must not bypass preflight.

## Risks / Trade-offs

- [Agent ignores instructions] → The dashboard can expose and re-read task state, but cannot guarantee agent behavior or prevent external GitHub actions.
- [PR-only checks need a PR before they can pass] → Explicit Ship anyway allows the PR, preserves unresolved markers, and provides Finish checks once merged.
- [A stale PR cache or changed worktree misleads] → Name freshness, recheck before action, and tell the agent to verify evidence; never tick automatically.
- [Custom profiles and other spec frameworks differ] → Preserve custom prompt content and use framework-neutral task reading; if unavailable, show unknown rather than assuming completion.
- [Another worktree owns the implementation branch] → Reuse only under existing adoption and one-session rules; otherwise explain the refusal.

## Integration update

The merged agent-interoperability change replaced Ship prompts with deterministic server-side commit, push and PR operations. Preflight now runs before these writes; Finish tasks remains an agent request and never ships. Automatic Ship refuses unresolved or unknown tasks rather than treating awaiting tasks as complete. Proposal-only automatic Ship is exempt because it precedes implementation. Automatic docs merging is gated for implementation and archive sessions. Fast-forward keeps its Draft and Implement prompts, gains the evidence instruction, and relies on the same server task gate when the agent exits. Customized Ship prompt helpers retain their text and completion instruction for compatibility, but interactive Ship no longer sends them.
