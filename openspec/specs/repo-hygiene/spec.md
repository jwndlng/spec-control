# repo-hygiene Specification

## Purpose
Defines the repository's housekeeping rules: which files are never tracked, how text, binary and vendored files are declared, shared editor defaults, the pinned toolchain version, the single verification command, the CI gates on pull requests, and the documented contribution and agent conventions.

## Requirements

### Requirement: Generated and local-only files are never tracked
The repository SHALL ignore dependencies (`node_modules/`), build output (`dist/`, `*.bun-build`, `*.tsbuildinfo`), logs, coverage output, environment files (`.env` and `.env.*` except `.env.example`), OS and editor metadata, and local agent settings (`.claude/settings.local.json`). The ignore rules MUST NOT match the lockfile (`bun.lock`), anything under `test/fixtures/`, `openspec/`, `.claude/commands/` or `.claude/skills/`.

#### Scenario: Clean tree after a full local cycle
- **WHEN** a contributor runs `bun install`, `bun run check` and `bun run build` on a clean checkout
- **THEN** `git status --porcelain` is empty

#### Scenario: Secrets cannot be added by accident
- **WHEN** a file named `.env` or `.env.local` exists in the repository root
- **THEN** `git status` does not list it, while `.env.example` would be listed

#### Scenario: Fixtures stay tracked
- **WHEN** the ignore rules are evaluated against every file under `test/fixtures/`
- **THEN** `git check-ignore` matches none of them and the number of tracked fixture files is unchanged

### Requirement: Text, binary and vendored files are declared
The repository SHALL declare via `.gitattributes` that text files are normalised to LF, that `*.woff2` is binary, that `bun.lock` is generated, and that `test/fixtures/**` is vendored. Applying these attributes MUST NOT change the content of any fixture file.

#### Scenario: Renormalisation is a no-op for fixtures
- **WHEN** `git add --renormalize .` is run after adding `.gitattributes`
- **THEN** no file under `test/fixtures/` shows as modified

#### Scenario: Fonts are treated as binary
- **WHEN** a font file under `src/ui/fonts/` changes
- **THEN** git reports a binary change rather than a text diff

### Requirement: Editor defaults are shared
The repository SHALL provide an `.editorconfig` setting UTF-8, LF line endings, a final newline and 2-space indentation for source files, and preserving trailing whitespace in Markdown.

#### Scenario: New file follows the defaults
- **WHEN** a contributor creates a new `.ts` file in an EditorConfig-aware editor
- **THEN** it is indented with 2 spaces, uses LF and ends with a newline

### Requirement: The toolchain version is pinned
The repository SHALL pin the Bun version in `.bun-version` and in `package.json` `packageManager`, and CI MUST install exactly that version and install dependencies with a frozen lockfile. Changing the pinned version SHALL be an explicit commit, not an automated dependency bump.

#### Scenario: CI uses the pinned version
- **WHEN** the CI workflow runs
- **THEN** `bun --version` in the job equals the content of `.bun-version`

#### Scenario: Lockfile drift fails the build
- **WHEN** `package.json` declares a dependency that `bun.lock` does not contain
- **THEN** the CI install step fails

### Requirement: A single command verifies the project
`bun run check` SHALL run linting (and, once the code base has been formatted, format verification), type checking and the test suite, and SHALL exit non-zero if any of them fails. Lint and format tooling MUST exclude `dist/`, `node_modules/`, `test/fixtures/`, `openspec/` and bundled fonts.

#### Scenario: Type error fails the check
- **WHEN** a source file contains a type error
- **THEN** `bun run check` exits non-zero

#### Scenario: Failing test fails the check
- **WHEN** any test fails
- **THEN** `bun run check` exits non-zero

#### Scenario: Fixtures are not linted or formatted
- **WHEN** `bun run format` is run
- **THEN** no file under `test/fixtures/` or `openspec/` is modified

### Requirement: Continuous integration gates every pull request
A CI workflow SHALL run on pull requests and on pushes to `main`, on Linux, executing `bun run check`, the single-binary build, the demo build, a smoke invocation of the built binary and a check that the tree is clean afterwards. The same workflow SHALL also run on macOS for every push to `main` and for every manual dispatch, but MUST NOT run on macOS for a pull request event. On macOS it SHALL execute the tests, the single-binary build and the smoke invocation. Lint, typecheck, the demo build and the clean-tree check do not depend on the platform and MAY be left to Linux. A change that touches only `openspec/**` or Markdown files at the repository root SHALL start neither the CI workflow nor the demo-site deployment. Markdown files elsewhere, including under `test/fixtures/`, MUST still start them. A separate workflow SHALL verify that pull request titles follow Conventional Commits. Workflows MUST request only read permissions, with these exceptions, each granted to that job only and to no other job in its workflow:
- the job that deploys the demo site to GitHub Pages MAY request `pages: write` and `id-token: write`, in a workflow that runs only for pushes to `main` or manual dispatch and never for pull requests;
- the job that updates the draft release MAY request `contents: write`, in a workflow that runs only for pushes to `main`;
- the job that labels a pull request from its title MAY request `pull-requests: write`, and MUST NOT check out or execute any code from the pull request;
- the job that attaches binaries to a published release MAY request `contents: write`, `id-token: write` and `attestations: write`, in a workflow that runs only when a release is published; the jobs that build those binaries MUST stay read-only.

Workflows MUST pin third-party actions to a full commit SHA, and automated updates SHALL be configured for the actions. Automated package updates SHALL be added once the update service can read the lockfile format written by the pinned Bun version; until then package updates are manual.

#### Scenario: Broken build blocks the pull request
- **WHEN** a pull request makes `bun run build` fail
- **THEN** the CI workflow reports failure on that pull request

#### Scenario: Broken demo blocks the pull request
- **WHEN** a pull request makes `bun run build:demo` fail
- **THEN** the CI workflow reports failure on that pull request

#### Scenario: Binary smoke test
- **WHEN** the CI build step succeeds, on Linux or on macOS
- **THEN** the job runs `./dist/spec-control --help` and `./dist/spec-control --version` and fails if either exits non-zero

#### Scenario: Pull requests run on Linux only
- **WHEN** a commit is pushed to a pull request that changes `src/`
- **THEN** the CI workflow runs its Linux job for it and starts no macOS job

#### Scenario: macOS is checked after the merge
- **WHEN** a pull request that changes `src/` is merged to `main`
- **THEN** the CI workflow runs on both Linux and macOS for the merge commit, and a test that fails only on macOS makes that run fail

#### Scenario: macOS on request
- **WHEN** a maintainer dispatches the CI workflow manually for a branch
- **THEN** it runs on both Linux and macOS for that branch

#### Scenario: Documentation-only change starts no CI
- **WHEN** a pull request, or a push to `main`, changes only files under `openspec/` and `README.md`
- **THEN** neither the CI workflow nor the demo-site deployment starts for it

#### Scenario: Fixture Markdown still runs CI
- **WHEN** a pull request changes only a `.md` file under `test/fixtures/`
- **THEN** the CI workflow runs its Linux job for it

#### Scenario: Non-conventional title is rejected
- **WHEN** a pull request is titled `update stuff`
- **THEN** the title workflow fails, and a title such as `feat(discovery): ignore paths` passes

#### Scenario: Superseded runs are cancelled
- **WHEN** a second commit is pushed to a pull request, or a second merge lands on `main`, while CI is still running for the first
- **THEN** the earlier run is cancelled

#### Scenario: Write scopes are confined to the deploy job
- **WHEN** the workflows are inspected
- **THEN** workflow-level permissions are read-only everywhere, the only jobs declaring a write scope are the Pages deploy, the draft-release update, the pull request labeller and the release upload, each declares only the scopes listed for it, and none of them has a checkout of pull request code

#### Scenario: A pull request cannot reach the release scopes
- **WHEN** a pull request is opened, from this repository or from a fork
- **THEN** no job holding `contents: write`, `id-token: write`, `attestations: write` or `pages: write` runs for it

### Requirement: Contribution and agent conventions are documented
The repository SHALL contain `CONTRIBUTING.md` describing branch naming (`feat/<openspec-change-name>`, `fix/…`, `chore/…`), Conventional Commits including the `openspec` scope for proposals and archives, one OpenSpec change per pull request, and running `bun run check` before pushing. It SHALL contain `CLAUDE.md` stating the project commands and the invariants agents must preserve — read-only behaviour towards tracked repositories with the read-only git allow-list, loopback-only binding, framework-specific code only in that framework's module under `src/server/frameworks/<id>/` and access to `@fission-ai/openspec` internals only through `src/server/frameworks/openspec/adapter.ts`, a self-contained UI without runtime network access, state confined to `~/.spec-control/`, and staying within a change's declared Impact when sessions run in parallel — and an `AGENTS.md` that points to `CLAUDE.md`.

#### Scenario: Branch name matches the change
- **WHEN** a contributor starts implementing the OpenSpec change `dedupe-discovery`
- **THEN** the documented branch name is `feat/dedupe-discovery`, which the dashboard's branch matching associates with that change

#### Scenario: Agent finds the invariants
- **WHEN** an agent session opens the repository
- **THEN** `CLAUDE.md` (or `AGENTS.md` pointing to it) lists the invariants and the `dev`, `check` and `build` commands

#### Scenario: Agent finds where framework code belongs
- **WHEN** an agent session is asked to change how OpenSpec changes are read
- **THEN** `CLAUDE.md` names `src/server/frameworks/openspec/` as the place for that code and the framework contract it implements

### Requirement: The README is an overview for people
`README.md` SHALL be written for a person deciding whether to use Spec Control, and SHALL present, in this order: the
product's name with a one- or two-sentence description of what it is; the live-demo link and board screenshot required
by the demo site; a short statement of the problem it solves; a short list of key features, one line each and at most
ten; a section explaining how the dashboard is organised in three levels — global (the projects overview and the
console), project (a repository's board and its project console) and change (a card, its detail view and its agent
session in its own worktree); the **Run** section required for release downloads, followed by first-run steps and
building from source; a brief summary of what the dashboard reads, writes and sends over the network that links to the
dashboard-api spec for the full list; a Contributing section; and the license.

The README SHALL stay an overview: it MUST NOT document individual feature edge cases, file-name lists, badge glyphs or
column rules, which belong to the built-in Help and to `openspec/specs/`, and it SHALL link to both once. Every claim it
makes SHALL be true of the current release, and its examples SHALL use only made-up names and paths.

#### Scenario: Newcomer understands the project quickly
- **WHEN** a person who has never heard of Spec Control opens the repository page
- **THEN** before the first install command they read what it is, the problem it solves, the key features as a short list and how global, project and change relate

#### Scenario: Feature detail is not in the README
- **WHEN** a reader looks for the list of technology-label marker files or the meaning of a work-status chip
- **THEN** the README does not contain it and points to the built-in Help and the specs instead

#### Scenario: Trust summary stays accurate
- **WHEN** the README's summary of what the dashboard touches is compared with the dashboard-api spec's "never writes" requirement
- **THEN** it contradicts nothing there and links to it as the complete list

### Requirement: Outside contributions start as GitHub Issues
The README's Contributing section SHALL ask people outside the project to report bugs and propose ideas as GitHub
Issues on the project's repository rather than opening pull requests, and SHALL point maintainers and agents working
on the project to `CONTRIBUTING.md` and `CLAUDE.md`. `CONTRIBUTING.md` SHALL state at its start that it describes how
the project itself is developed and that outside contributors start with an issue. `CONTRIBUTING.md` SHALL also state
that a change puts feature detail into the built-in Help and its spec, and changes the README only when a key feature,
the three-level structure, the run steps or what the dashboard touches changes.

#### Scenario: Someone wants to report a bug
- **WHEN** a user reads the README's Contributing section to report a bug
- **THEN** it links to the repository's GitHub Issues and asks for an issue rather than a pull request

#### Scenario: A feature change is documented
- **WHEN** a contributor implements a change that adds an option to an existing feature
- **THEN** `CONTRIBUTING.md` directs them to document it in the built-in Help and the spec, and the README is left unchanged
