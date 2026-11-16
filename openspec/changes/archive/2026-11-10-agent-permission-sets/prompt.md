# Prompt

Create an OpenSpec proposal in spec-control for predefined agent permission profiles. Follow AGENTS.md, CLAUDE.md, and CONTRIBUTING.md. This request is for a proposal only; do not implement yet.

Problem:
Claude, Codex, and Antigravity currently require different amounts of prompting and permission confirmation to complete the same Spec Control workflow. Implementation should normally finish with checks, a commit, a pushed task branch, and an open PR.

Propose three opt-in profiles:
1. Minimum: inspection and planning; confirmation for mutations.
2. Less friction (recommended): implementation in the task worktree, required checks, commits, pushing the task branch, and creating/updating its PR.
3. Full workflow automation: known Spec Control workflows, with explicit opt-ins for merge and cleanup. Unknown operations still require approval.

Requirements:
- Scope permissions to sessions launched by Spec Control; preserve users’ global agent settings.
- Define one shared policy with adapters for Claude, Codex, and Antigravity.
- Inspect the installed agents and current official documentation to verify their actual permission capabilities. Identify unsupported restrictions and enforcement differences explicitly.
- Keep workflow instructions separate from permissions: authorization to create a PR alone does not ensure the agent completes that step.
- Show effective permissions, limitations, and changes before enabling a profile.
- Keep project-specific commands, credentials, deployment, and infrastructure access separate from built-in profiles.
- Do not describe any profile as harmless: checks, builds, and package scripts execute repository code.
- Preserve existing user restrictions; do not silently weaken them.
- Address profile inheritance, defaults, existing sessions, persistence, and compatibility with agent/model selection.
- Keep the initial implementation scope focused on implementation through PR creation. Consider merge, archive, cleanup, and deployment as separate capabilities.

Produce the proposal, design, specs, and actionable tasks required by this repository’s OpenSpec workflow. Include a capability matrix for the three agents, security boundaries, acceptance criteria, and a proposed phased implementation. Flag unresolved product decisions.
