# Spec Control — agent guide

Spec Control (`spec-control`, formerly OpenSpec Dashboard): local-first, read-only Kanban across OpenSpec repositories,
shipped as a single Bun binary. Releases are `spec-control-<tag>-<platform>`; the demo is at
`https://blog.wndlng.ch/spec-control/`.
See `README.md` for what it does and `CONTRIBUTING.md` for the branch, commit and PR conventions.

## Commands

```sh
bun install
bun run dev        # build the UI, serve http://127.0.0.1:4711 from source
bun run check      # lint + typecheck + tests — run before every push; CI runs exactly this
bun run build      # dist/spec-control (UI and fonts embedded); --version prints dev, or $SPEC_CONTROL_VERSION
bun test test/scanner.test.ts   # a single test file
```

## Layout

- `src/server/` — config, discovery, scanner, HTTP API, CLI entry. `src/server/frameworks/` — the spec framework
  modules: the contract (`framework.ts`, an abstract `SpecFramework`), the registry that picks a repository's module
  (`registry.ts`), and one directory per framework — today only `openspec/`. Everything specific to a framework (its
  layout, markers, how a change's artifacts and tasks are read, its scaffold) lives in its module; the scanner,
  discovery, API and UI stay framework-neutral, and the Kanban derives every column from the module's neutral shape
  (`openspec/specs/spec-frameworks/spec.md`). `src/shared/` — types and column derivation used by both sides.
  `src/ui/` — Preact SPA built into one self-contained `dist/ui/index.html` by `scripts/build-ui.ts`.
- `desktop/` — the macOS app (Electrobun, Apple silicon only; `openspec/specs/desktop-app/spec.md`), with its own
  `package.json` and lockfile. It runs the bundled `spec-control` binary as a child process with `--no-open` and shows
  `http://127.0.0.1:<port>/` in its window — no bridge, no injected script, no server of its own — or attaches to a
  Spec Control already on the port. It adds no network access: its own process requests only `127.0.0.1`, links to other
  hosts open in the default browser — as does a request for a new window on its own origin, which never replaces the
  window's page — and there is no updater, so invariant 4 is unchanged: a new version is noticed
  through the server's update check, whose banner the window shows like any other page. Its testable decisions live
  in `desktop/src/logic/` (no Electrobun import), tested by `test/desktop/` in the root `bun test`; `src/main.ts` is the
  Electrobun wiring only and is not part of the root typecheck. `bun run build:desktop` builds it.
- `test/fixtures/` — synthetic `openspec/` trees written for the tests (see `test/fixtures/README.md`). Tests assert on
  their structure: change them together with the tests, and never reformat or lint them.
- `openspec/` — this project's own specs (`openspec/specs/`) and changes. Requirements live there; read the relevant
  spec before changing behaviour.
- **The old name survives only where it is read for compatibility.** The home `~/.spec-control/` is moved from
  `~/.openspec-dashboard/` on first start (`src/server/homeMigration.ts`, which leaves a link at the old path);
  `OPENSPEC_DASHBOARD_HOME` and `OPENSPEC_DASHBOARD_VERSION` are still read after their `SPEC_CONTROL_*` successors;
  browser keys `openspec-dashboard.*` are copied once to `spec-control.*` (`src/ui/storage.ts`); and
  `openspec-dashboard:shared` markers are still recognised, though only `spec-control:shared` is written
  (`src/server/sharedConfig.ts`); and the desktop app reads the old home only to find the port the server will use
  and to write nothing of its own until the server has moved it (`desktop/src/logic/home.ts`). Do not add new uses of the old name.

## Invariants — do not break these

1. **Read-only towards tracked repositories, with enumerated exceptions.** The dashboard writes to a tracked
   repository only in response to an explicit user action, only to the paths enumerated in the "never writes"
   requirement of `openspec/specs/dashboard-api/spec.md`, deletes nothing there beyond the worktrees, branches, change directories and confirmed change leftovers enumerated below, and runs a git
   command that writes only where enumerated below. Today that list has nine entries: the managed sections of `openspec/config.yaml` (applying shared config profiles,
   `src/server/sharedConfig.ts`), only when neither `openspec/` nor `openspec/config.yaml` is a symbolic link, written by
   renaming over it a temporary `openspec/.config.yaml.<random>.tmp` the apply created exclusively and removes whenever
   that rename does not happen; for agent sessions, off by default, a session's git worktree, created with
   `git worktree add` (directory under `~/.spec-control/worktrees/`, never inside the repository's working tree)
   and removed with a non-forcing `git worktree remove` after the user confirmed and read-only checks proved nothing
   would be lost (`src/server/sessions/worktree.ts`) — or, with no dialog, when a pull-request query that already ran
   shows merged the pull request of a session whose prompt carried the Docs auto-merge instruction, in a project that
   still has Docs auto-merge on (the opt-in is the confirmation; same checks, same command, the branch kept, no fetch,
   no new git or `gh` subcommand, `SessionManager.endMergedAutoMerge`); the **pull action** — `git fetch` of the repository's own
   remote with `--no-prune --no-prune-tags`, then a fast-forward-only `git merge --no-autostash` of the main checkout's
   upstream with `submodule.recurse=false`, never a merge commit, rebase, stash, reset, force or branch switch, one at a
   time per git repository (keyed by its git common directory, so projects sharing a repository share the lock), and only fetching when the checkout is off its default branch,
   has no upstream, has diverged or has overlapping local edits — and, when a fast-forward is refused because
   uncommitted files would be overwritten, listing those blocking files and, only when every one of them is a **change
   leftover** (inside the project's own `openspec/changes/<name>/`, every path read from the top level, not in the current commit, only added locally, an ordinary file, and
   present in the incoming commit) and only after the user confirmed **Resolve and pull** and the whole classification
   was re-proved without fetching again, copying every leftover that differs under
   `~/.spec-control/pull-backups/`, removing exactly those files from the working tree and, for the staged ones,
   from the index with `git rm --cached` (never `-f`), then retrying the fast-forward and, if it is still refused,
   writing them back and re-staging them with `git add -- <those paths>` (`src/server/pull.ts`, the only place that
   contacts a remote or changes a main checkout); the **automatic fetch** — for every enabled git project with a remote
   unless the user switched its auto fetch off (`autoFetchSeconds`: every minute when absent, `0` for off) and never while
   setup is still pending (`setup: "pending"`, so the setup wizard's projects wait for the user's choice), exactly the
   pull action's `git fetch` and nothing after it, on that interval (`fetchRepository` in `src/server/pull.ts`, scheduled by `src/server/autoFetch.ts`): remote-tracking
   refs, `FETCH_HEAD` and objects only, never a fast-forward, merge, prune or anything in a working tree or index, never
   overlapping a pull or fetch of the same git repository, and never in the demo — the per-project setting, which the user can
   switch off, is what allows it; and the
   **create-change action** — a new `openspec/changes/<name>/` directory, only when neither `openspec/` nor
   `openspec/changes/` is a symbolic link, with the schema marker `.openspec.yaml`, when the user typed one, `prompt.md`, when the user picked any
   dependencies, `depends-on.yaml` (a `depends_on:` list of validated change names), and, for a change imported from a
   GitHub issue, `issue.yaml` (the `owner/name` read from the repository's own `origin`, never from the request, the
   issue number and its title — `src/shared/issues.ts`), written directly with an
   exclusive-create so two concurrent requests cannot both succeed, and never through git or the `openspec` CLI
   (`src/server/createChange.ts`, `POST /api/repos/<id>/changes`); and, once those files are written, **staging that
   new directory** — a single `git add -- openspec/changes/<name>/`, the directory just created and nothing else,
   best-effort (a non-git repository or any git failure leaves the change in place, merely untracked, reported as
   `staged: false`), never run for a refused create, and never followed by a commit (same module and route); and
   **repository cleanup** — on the user's confirmation of items they selected, a non-forcing `git worktree remove` of
   any linked worktree (unlocking only worktrees the dashboard created) that read-only checks proved clean and merged
   or pushed, `git worktree prune` of records whose directory is gone, and `git branch -D` of a local branch other than
   the default branch and the main checkout's branch whose work read-only checks proved is in the default branch and
   that still points at the commit the user saw, whether selected in repository cleanup or confirmed as a stale leftover
   in a **stale change's cleanup** (`src/server/cleanup.ts`, the only place that deletes a branch; never a
   remote branch or remote-tracking ref) — and, as the one forced removal, **deleting a branch with its worktree**: for
   each linked worktree the user confirmed after seeing what it holds, either the single one of the project details'
   deletion dialog or each one listed in a stale change's cleanup (`applyStaleCleanup`, only for a change archived on
   the default branch and a worktree on one of its exactly named branches that is merged) (never the main
   checkout, the default branch, a worktree with a running session or one the user locked), and only once a re-read
   proved the worktree, branch, commit and uncommitted files are what the dialog showed, a copy of its uncommitted,
   non-ignored files under `~/.spec-control/branch-backups/`, then `git worktree remove --force` (unlocking only a
   worktree the dashboard created) and `git branch -D` of its branch whatever its merge state, if it still points at
   that commit (`deleteBranch` in the same module); and **dismissing a change** — on the user's confirmation, deleting an active
   change's directory `openspec/changes/<name>/` from the main checkout (never under `archive/`, never a symbolic link
   or its target, never when `openspec/`, `openspec/changes/` or the change directory is one — checked segment by
   segment with `lstat` at the preview and again immediately before the delete — never anything in a linked worktree) after re-checking that its content is what the confirmation
   showed and that no agent session for the change runs, then staging that removal with a single
   `git add --all -- openspec/changes/<name>/`, best-effort and never followed by a commit
   (`src/server/dismissChange.ts`, `POST /api/repos/<id>/changes/<name>/dismiss`, the only place that deletes a change
   directory) — and the same deletion and `git add --all` for the main checkout's copy of a change archived on the
   default branch that none of whose files is in `HEAD`, confirmed as a stale leftover in a stale change's cleanup,
   after its files were re-checked by content hash and those that differ from the archive's copy were copied under
   `~/.spec-control/branch-backups/` (`removeStaleChangeDirectory`, `POST /api/repos/<id>/changes/<name>/stale-cleanup`); and the **home migration** — once, when the user starts a binary that finds only the pre-rename home,
   `git worktree repair` of each session worktree the dashboard created, with its new path under
   `~/.spec-control/worktrees/`, which rewrites only that worktree's record in the repository and its `.git` file and is
   retried on later starts until it succeeds (`src/server/homeMigration.ts` through `repairMovedWorktree` in
   `src/server/sessions/worktree.ts`). Those six modules and the home migration are the only places that write to a
   tracked repository, and every writing git command they run goes through `gitWrite` (`src/server/gitWrite.ts`): `-c
   core.hooksPath=` an empty folder under `~/.spec-control/` and automatic maintenance off, so no hook of the
   repository, of the user's global hooks folder or of a template ever runs (`test/gitWrite.test.ts` fails on a writing
   subcommand spawned anywhere else; `git init` and `git clone` keep their own invocations, the clone with the same
   folder). Merge checks (`contentIsInBase`) and the pull's blocking files name paths from the repository's top level, so
   a project in a subfolder is judged exactly like one at the top level; cleanup, branch deletion and stale cleanup hold
   one lock per git repository, like the pull. Apart from the pull action, the
   automatic fetch and those two `git add`s, the main checkout's index and files are never touched and no remote is ever
   contacted; the main
   checkout's branch is never changed by anything; and the pull action runs only on the user's explicit request — never
   on a timer, during a scan, on page load or as a side effect; the only fetch on a timer is the automatic fetch above,
   for the projects that did not switch it off (`test/pull.test.ts` proves scans, discovery and the state endpoint leave a recording
   remote untouched, with auto fetch on too). Starting the user's
   agent in that worktree on the user's click is not a write by the dashboard: what the agent changes is decided by its
   own permission prompts. That is also why **Integrate** (`src/server/integration.ts`) needs no entry in the list
   above: it starts the default agent in a git repository that is not tracked yet so the agent can run `openspec init`
   there, while the dashboard runs no git command and writes no file in that repository and adds it to its own config
   only once `openspec/config.yaml` is on disk. The same holds for the **main console** (`openConsole`, `src/server/sessions/consoleFolder.ts`):
   the default agent in the console folder — `~/.spec-control/console/` or a folder the user configured, which is
   refused when it is, or lies inside, a tracked repository — with no worktree, no branch and no git command. And for a
   **project console** (`openProjectConsole`, `src/server/sessions/manager.ts`, `POST /api/repos/<id>/console`): the
   project's agent, without a prompt, in place in a tracked repository's own folder — for a git repository its main
   checkout — with no worktree, no branch and no git command by the dashboard. The same holds for the user's **editor** started with **Open in editor**
   (`src/server/sessions/editor.ts`): offered only where agent sessions apply and only for a change's session or session
   worktree, started without a shell, detached and left alone, on a folder the server took from its own session records
   or session worktree list — what the editor changes is the user's doing. Outside every tracked
   repository, the dashboard writes beyond its home in exactly three places, each on the user's confirmation and each
   one new folder checked by `src/server/newFolder.ts` before it exists and made with a non-recursive (exclusive)
   `mkdir`, refused in or below a tracked repository, an ignore path or the dashboard home. **Creating a new project**
   (`src/server/createProject.ts`, `POST /api/projects`): the folder directly inside a configured workspace root, then
   `git init` in that folder and nothing else — no other file, no commit, no remote, nothing deleted even when
   `git init` fails; the folder is then handed to an integration session, so `openspec init` is the agent's, exactly as
   for **Integrate**. **Cloning a GitHub repository** (`src/server/githubClone.ts`, `POST /api/github/clone`, Add from
   GitHub on the overview or a setup wizard Continue): the folder directly inside a configured workspace root, then
   `git clone` into it from `https://github.com/<owner>/<name>.git` — a URL built from an `owner/name` validated by
   `src/shared/github.ts`, never taken from the request — with the pull action's rules (no prompt, batch SSH, no stdin,
   credentials masked), `core.hooksPath` pointed at an empty folder under the home so no hook runs, no automatic
   maintenance, no submodules and a ten-minute timeout, working directory in the home, at most two at a time; on
   failure a non-recursive `rmdir` of the folder only if git left it empty, and nothing else is ever deleted, written
   into the clone or configured in it. A clone holding `openspec/config.yaml` is tracked through the same serialised
   write as a confirmed integration; the in-memory clone list is never an input to scanning, and discovery leaves out
   folders still being cloned into. **Creating a workspace folder** (`createWorkspaceFolder` in `src/server/setup.ts`,
   `POST /api/setup/workspace-folder`, the setup wizard's **Create folder**): one empty folder whose parent exists,
   nothing written into it, no process, and the configuration left for the wizard to save. With agent sessions disabled no process that can modify a repository is ever started. Scanning, polling, discovery, previews and saving settings
   write nothing to a repository. In particular `tasks.md` is never written: the dashboard reads the three checkbox
   states (`[x]`, `[~]` — finished, awaiting the user's confirmation — and `[ ]`) and shows them; only the agent, in its
   own session under its own permission prompts, ticks a box or writes a `- [~]`. All other writes stay under `~/.spec-control/` (or `SPEC_CONTROL_HOME`
   in tests), apart from those three folders. Apart from the worktree commands (the home migration's `worktree repair` among them), the pull action's and the automatic fetch's `fetch`, the pull action's `merge --ff-only`, leftover `rm --cached`
   and restoring `add`, the create-change and dismissal `add`, the cleanup's `branch -D`, the new project's `git init` and the GitHub clone's `git clone`, git is invoked only with
   the read-only subcommands listed in that spec — among them `ls-tree`, `cat-file` and `hash-object` without `-w`,
   which is how a leftover is told from the user's own work, and `merge-tree --write-tree`, which answers whether a
   session's branch still merges into its base. That last one is the only read-only subcommand that writes anything at
   all: it puts the tree it merges into an object database, so it is always invoked with `GIT_OBJECT_DIRECTORY` pointed
   at a scratch store under `~/.spec-control/` and the repository's own objects offered only as
   `GIT_ALTERNATE_OBJECT_DIRECTORIES` — it reads everything and writes nothing into the repository, and it is never
   given a working tree, an index or a ref. The **pull-request query** (`src/server/pullRequests.ts`), the **issue query**
   (`src/server/issues.ts`) and the **repository listing** of Add from GitHub (`listGithubRepos` in `src/server/gh.ts`,
   `POST /api/github/repos`) are the other things that leave this machine besides the clone, and none is a write: they
   run the GitHub CLI's read-only `gh pr list`, `gh api user`, `gh issue list` and `gh repo list` and no other
   subcommand, all through `runGh` in `src/server/gh.ts`, without a shell, with their working directory in the dashboard
   home and the repository named with `--repo owner/name` (the listing's owner passed as one validated argument), so no
   `gh` process ever runs inside a tracked repository, runs no git and changes nothing on GitHub. The pull-request query runs only when the user opens or refreshes a view that shows pull requests, or as an open
   board's **pull-request watch** (while the board is open in a visible tab and one of its cards links an open pull
   request that is not ready: only those repositories, at most once a minute, `src/ui/pullRequestsState.ts`
   `watchPlan`); the issue query runs only when the user opens a board's **Import from issues** dialog or presses its
   Refresh, for that one repository, and keeps nothing — never on any other timer, during a scan or from the projects
   overview; the repository listing runs only when the Add from GitHub dialog opens, its owner changes or its Refresh is
   pressed, and keeps nothing (`test/pullRequestsApi.test.ts`, `test/issuesApi.test.ts` and `test/githubApi.test.ts`
   prove a scan, discovery and the endpoints' reads start no `gh` and no clone, and that a full refresh, an issue
   listing or a repository listing leaves every fixture repository byte-for-byte unchanged).
   Adding a path or a subcommand means changing that spec first.
2. **Loopback only.** The server binds `127.0.0.1`; there is no auth because nothing else can reach it. Every request,
   whatever its method or path — reads, the page, `/api/version` and the starting handler included — must also be
   addressed to a loopback host name (`127.0.0.1`, `localhost`, `[::1]`): `hostRefusal` in `src/server/api.ts` answers
   anything else `403` before any route runs, which is what stops a DNS-rebound page from reading the API.
2a. **Mutating API routes are same-origin only.** Every non-GET `/api/` request also passes `crossSiteRefusal` in
   `src/server/api.ts` (JSON content type, loopback host, own origin); the terminal WebSocket has `webSocketRefusal`. Loopback binding alone does not stop a web page
   in the same browser; do not add a route, of any method, that bypasses the host check or a mutating route that bypasses the guard.
3. **Framework code only in its module; `@fission-ai/openspec` internals only through
   `src/server/frameworks/openspec/adapter.ts`.** A module only reads: where a write depends on a framework, the module
   supplies paths and contents and the writers of invariant 1 write, and only for a module `writablePaths` allows.
   Do not call the library's `resolveSchema`/`loadChangeContext`: they locate files via `import.meta.url`, which does not exist inside the
   compiled binary. The adapter embeds the schema at build time. Anything that works under `bun run` but reads files
   relative to a module path must also be verified in `dist/spec-control`.
4. **No network at runtime, except the pull action, the automatic fetch, a GitHub clone, the pull-request, issue and
   repository-list queries and the update check.** The UI is one HTML file with inlined
   JS, CSS and fonts; do not add CDN links, remote fonts or fetches to other hosts — the links to github.com in the
   Pull requests view, the Import from issues dialog, on cards, in the detail header and in the update banner are links the user follows, not requests the page makes. The server reaches a network in exactly
   three places, each on the user's own action or setting: when git does, inside the pull action, a project's automatic fetch of invariant 1 (on unless switched off) or a GitHub clone the user confirmed in Add from GitHub, a setup wizard Continue or a Retry (`src/server/githubClone.ts`), and when `gh` does,
   inside the pull-request, issue or repository-list query of invariant 1 (`src/server/pullRequests.ts`, `src/server/issues.ts`, `src/server/gh.ts`) — for
   the repository list, the user opened Add from GitHub, changed its owner or pressed its Refresh; for
   issues, the user opened Import from issues or pressed its Refresh; for pull requests, the user activated Refresh, or opened
   the Pull requests view, a repository's pull-request dialog or a Kanban board (whose cards link to their change's pull
   request) with a list older than five minutes, or an open, visible board watches its cards' pull requests that are not
   ready yet (every minute while checks run or mergeability is unknown, every five minutes otherwise, only those
   repositories, never in the demo), at most one refresh at a time. All of them use the
   tool's own credentials: the dashboard never sees, stores or asks for them, never prompts, and masks credentials in
   any error text it passes on. Without `gh`, or without it being signed in, the feature reports itself unavailable and
   nothing else changes.
   The third is the **update check** (`src/server/updateCheck.ts`, `openspec/specs/update-notice/spec.md`): the server's
   own `fetch` of one unauthenticated `HEAD` to `https://github.com/jwndlng/spec-control/releases/latest`, redirects not
   followed and only `Location` read, carrying nothing but `User-Agent: spec-control/<version>` — no git, no `gh`, no
   credential, nothing about the user, a path or a repository. It runs about a minute after start and then at most once
   every 24 hours (remembered in `~/.spec-control/update-check.json`), or when the user presses **Check now**; never for
   a build whose version is not a release tag (`dev`), never while the user turned **Check for new versions** off
   (`updateCheck: false`), and never in the demo. Its URL is a constant: do not make it configurable.
5. **The repository is the source of truth.** The dashboard indexes; everything it shows about the *current state* of a
   change is derived from the repositories. The one thing it keeps that cannot be re-derived is history: the activity
   log (`~/.spec-control/activity.jsonl`, `src/server/activity/`) records what the dashboard observed and when.
   It is never an input to scanning, columns, counts or actions, and deleting it loses history only.
6. **Change names reaching git or the file system are validated** (`CHANGE_NAME` in `src/server/source.ts`).
7. **Nothing from a real repository goes into this one.** No copied `openspec/` trees, repo names, paths, hostnames or
   people from other projects — not in fixtures, tests, specs, proposals or commit messages. Use made-up names
   (`demo-ops`, `alpha-infra`, `/w/acme/...`). Fixtures are generated, never copied. This repository may be public.

## Agent sessions (`src/server/sessions/`)

- A session is an agent CLI in a **pseudo-terminal**, relayed byte for byte to an xterm.js view. Do not parse, filter or
  summarise its output, and do not add anything vendor-specific: an agent is a profile (`agents.ts` — argument list,
  prompts, resume command). Agents are started without a shell; the prompt is one whole argument or typed input.
- `GET /api/sessions/<id>/terminal` is the most sensitive endpoint in the project: whoever holds that WebSocket types
  into an agent on this machine. It has its own guard, `webSocketRefusal` (loopback Host, the dashboard's own `Origin`,
  missing `Origin` refused) because the JSON guard cannot cover a WebSocket handshake. Never loosen it, and never bind
  anything but loopback.
- Text the dashboard sends into a *running* agent for the user (next-step prompts, default responses, Ship) goes
  through `submit.ts` and never gets a blind Enter: it is typed, the terminal's own output is watched for that same
  text, and only then is Enter pressed as a separate key press. A terminal cannot tell us whether the agent shows a
  prompt or a selection menu, and in a menu Enter confirms whatever is highlighted — possibly a permission; so when
  the text never appears, nothing is sent and the user is told it was typed but not confirmed. That echo check is the
  one thing the dashboard may read out of an agent's output, and only to decide about Enter. One running session per
  worktree; archiving has its own.
- A running session's badge has exactly two inputs, neither of them the agent's output: the time of its last output
  that counts as activity — output within `ECHO_WINDOW_MS` after a resize or input the dashboard passed on is relayed but
  not stamped, so opening a console does not wake the badge — and the agent's own report, one word (`waiting` or
  `working`) in the file `SPEC_CONTROL_STATE_FILE` names under `~/.spec-control/sessions/<id>/`
  (`src/server/sessions/reportedState.ts`). The dashboard only reads that file, removes it before each start, and never
  configures an agent to write it; a `waiting` report is current until the user's next input (terminal replies such as
  focus reports do not count).
- **Integrate** (`src/server/integration.ts`, `POST /api/integrations`) is the second in-place case, and the first one
  in a git repository: the agent runs in the repository's **main checkout**, with no worktree and no branch, because
  `openspec init` has to leave `openspec/config.yaml` where discovery looks for it — on a branch in a worktree the
  repository would stay integratable. An `IntegrationSession` belongs to no tracked repository, no change and no
  action, so `changeSessions()` keeps it out of Open work, the activity log, work status, Ship, pull and cleanup, the
  same way it keeps the console out. The panel uses the same in-place wording. What decides that it worked is the
  marker on disk, re-checked when the session ends and on every discovery run — never anything the agent printed.
- A **project console** (`openProjectConsole`, `src/shared/types.ts` `ProjectConsoleSession`) is the third in-place
  case and the second one in a git repository's main checkout: one per tracked project, the project's
  agent without a prompt, for anything that is not a change. It carries a `repoId` but no change, action or branch;
  `isChangeless()` keeps it out of Open work, the activity log, work status, Ship, prompts and cleanup exactly as for
  the console and integrations. An integration session in a tracked project's folder counts as that project's console
  (`projectConsoleSessions`), which is how the agent **New project** started stays reachable once its overlay is
  closed. A change session never runs in a main checkout — except in a git repository with no commit yet, below; in
  every in-place folder, one agent per folder still holds.
- A tracked folder **without git** is a supported repository, so its sessions run **in place**: the agent's working
  directory is the folder itself, no worktree and no branch are made, and no git command runs for the session
  (`Session.inPlace`). It is decided from the scan's `isGit`, never by letting a git command fail. Such a session has
  no work status, no Ship, no worktree to remove and no pull; the panel says the agent edits the folder directly, with
  no undo. A **git repository with no commit yet** (what **New project** leaves) is treated the same way: nothing to
  branch a worktree from, so its change sessions run in place in the main checkout, decided from the scan's
  `noCommit` (`HEAD` names no commit and there is no `origin/HEAD`). A session started that way stays in place after the
  first commit; later sessions get worktrees. `NoCommitError` in `worktree.ts` only covers an out-of-date scan. A
  starter that cannot start says why **on the card** — `start` resolves with the reason, because a session
  that was never created has no panel to report itself in.
- **Work status** (`workStatus.ts`) is read per worktree *directory* — directories outlive session records — with
  read-only git and no network, so `merged` means "as of the user's last fetch"; squash merges are recognised by
  comparing the content of the files the branch touched. The dashboard never commits or pushes, and the only `gh` it ever
  runs is the read-only pull-request query of invariant 1, which is not part of a session: **Ship** only
  hands the agent a prompt (`prompts.ship`, else `DEFAULT_SHIP_PROMPT`), plus `AUTO_MERGE_DOCS_INSTRUCTION` when the
  project opted in (`agent.autoMergeDocs`) and `shipsOnlyOpenSpec` proved, at that moment, that everything it ships is
  under `openspec/`; an **Archive** prompt, started or sent, likewise gets `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION` — for a
  pull request the agent opens, if any — when the same check, with `allowEmpty` for a fresh archive worktree, proves the
  worktree holds nothing else. Neither instruction asks the agent to merge or to enable GitHub's auto-merge: both say
  to open the pull request and leave it, because the dashboard decides when it is ready. A session records when it was
  asked (`autoMergeAskedAt`); once the refresh route's completed query lists its branch's pull request open, not a
  draft, against the default branch, mergeable, checks `passing` (never `none`) and docs-only — GitHub's changed files,
  read with the same `gh pr list` and dropped after parsing — at the commit its worktree has checked out, and
  `shipsOnlyOpenSpec` still holds there, the running agent is sent the **Merge** prompt once per pull request and head
  commit (`requestReadyMerges`, recorded as `mergeAsked` before anything is typed). **Merge** is the third prompt-only
  action (`prompts.merge`, else `DEFAULT_MERGE_PROMPT`, then a fixed sentence naming `#<number>` and the full head
  commit, both from the server's list, never from the browser): the agent merges, with `--match-head-commit`, behind
  its own permission prompts; the user can send it from the panel for any ready pull request of a running session.
  Once the query lists the pull request merged after `autoMergeAskedAt`, the session is ended and its worktree removed
  as described in invariant 1 (`autoEnded` records the outcome). No query, timer or agent start is ever begun for any
  of this. A status that holds work the base lacks also
  carries a **conflict signal** — whether the branch still merges into that base, and which files clash — computed with
  `merge-tree` as invariant 1 describes, and as stale as the last fetch, which the UI says. **Resolve conflicts** is the
  second prompt-only action, shaped exactly like Ship (`prompts.resolveConflicts`, else
  `DEFAULT_RESOLVE_CONFLICTS_PROMPT`): the dashboard merges, rebases, checks out, commits and pushes nothing for it —
  it hands over the prompt and re-derives what came of it from git, never from what the agent said.
- Tests never start a real agent or use the network: `test/fixtures/fake-agent.ts` is a tiny interactive program run in
  real pseudo-terminals and temp git repositories, and `test/fixtures/fake-gh.ts` (behind a shim `test/ghHelpers.ts`
  puts first on `PATH`) answers the pull-request queries from a JSON scenario.
- Anything here must also work in the compiled binary (`bun run build`), not just under `bun run`.

## One agent, one worktree

Several agent sessions work on this repository at the same time. **Every agent session that changes files works in its
own git worktree on its own branch — never in the main checkout, and never in another session's worktree.**

1. Before your first edit, create a worktree from the latest `origin/main`, on a branch named after your OpenSpec change:
   ```sh
   git fetch origin
   git worktree add .claude/worktrees/<change-name> -b feat/<change-name> origin/main   # or fix/…, chore/…, docs/…
   cd .claude/worktrees/<change-name> && bun install
   ```
   With the Claude Code CLI, `claude --worktree <change-name>` does the same. `.claude/worktrees/` is git-ignored.
2. Do all edits, `bun run check`, commits and the push from inside that worktree. One change = one worktree = one
   branch = one pull request (see `CONTRIBUTING.md`).
3. If your change's `openspec/changes/<change-name>/` directory exists only uncommitted in the main checkout, copy it
   into your worktree first and commit it there; do not edit it in the main checkout.
4. When the pull request is merged, remove your worktree: `git worktree remove .claude/worktrees/<change-name>`.

In the main checkout you may read, run the dashboard and run read-only commands. Do not edit files there, do not switch
its branch, do not stage or commit in it, and never commit, revert or "tidy up" work that belongs to another session
without the user's confirmation. Stay inside the files listed under **Impact** in your change's proposal; if you must
touch a file another in-flight change owns, say so in your proposal first.
