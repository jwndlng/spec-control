## MODIFIED Requirements

### Requirement: Pull requests are read through the GitHub CLI, read-only
The dashboard SHALL obtain pull requests by running the GitHub CLI (`gh`) without a shell, using `gh pr list` with JSON output and `gh api user` to learn the signed-in login. When docs or proposal automatic merge is enabled for a tracked project, it SHALL also read the rules that apply to each open pull request's exact base branch through `gh api repos/{owner}/{repo}/rules/branches/{branch}`. All such calls SHALL run outside tracked repositories, with prompts disabled, no standard input, and a timeout. They SHALL NOT write to repositories or GitHub. The dashboard SHALL rely on `gh`'s own sign-in and MUST NOT read, store, request, log or forward credentials or tokens; browser-visible failure text SHALL have credentials in URLs masked.

#### Scenario: Refresh includes read-only rules for a merge candidate
- **WHEN** an eligible open pull request is returned for a docs or proposal merge project
- **THEN** the refresh reads the rules for that pull request's base branch and binds the result to its current head commit

#### Scenario: Rule evidence is unavailable or malformed
- **WHEN** the rules query fails or does not return a complete supported rule list
- **THEN** required-check policy remains unknown and automatic merge is withheld

### ADDED Requirement: Automatic merge uses fresh exact-head required-check policy
The automatic merge decision SHALL require a fresh rules response associated with the pull request's current head commit. A known policy with no required status checks MAY merge when GitHub reports no checks or all reported checks pass. A known policy with required checks SHALL merge only when the check rollup passes. Missing policy evidence, unsupported required workflow or code-scanning rules, stale head identity, unknown or pending checks, failing checks, conflicts, drafts, wrong base branches, and fork pull requests SHALL remain blocked.

#### Scenario: No required checks are configured
- **WHEN** GitHub returns a complete supported rule list with no required status checks for the pull request's base branch
- **THEN** the exact-head policy is recorded as having no required checks, and a non-draft, mergeable docs-only proposal may merge even when the check rollup is empty

#### Scenario: Required checks are configured
- **WHEN** the base branch requires status checks and any check is missing, unknown, pending, or failing
- **THEN** automatic merge is withheld until the exact-head check rollup passes
