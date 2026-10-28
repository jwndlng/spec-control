# Design

## Context

Invariant 1 enumerates the git commands that write to a tracked repository and promises what each does: the pull never
stashes, the automatic fetch never prunes, cleanup never runs hooks. Each promise is today kept only as long as the
user's configuration and the project's position in its repository happen to agree. Git reads configuration from the
system, the user and the repository; a writing command whose effect a setting can widen does not keep the promise on
its own. And a project may sit in a subfolder of its git repository (`change-scanner`: "Project in a subdirectory of its
repository"), where git prints some paths relative to the top level and reads others relative to the working directory.

## Decisions

### D1. One helper for every writing git command

`src/server/gitWrite.ts` exports `gitWrite(cwd, args, options)`, which runs
`git -c core.hooksPath=<empty folder> -c gc.auto=0 -c maintenance.auto=false <args>` with the same environment as today
(`GIT_TERMINAL_PROMPT=0`, batch SSH where the pull sets it, `GIT_OPTIONAL_LOCKS=0` where a module sets it), and nothing
else. The empty folder is the one the GitHub clone already makes under the home (`emptyHooksDir`, moved here; its path
is kept, so nothing on disk changes). `core.hooksPath` replaces the repository's `.git/hooks`, the user's global
`core.hooksPath` and any template's hooks in one setting, which is why a folder known to be empty is used rather than
`/dev/null` (which only works because git fails to find a file in it).

Every writing command enumerated in invariant 1 goes through it, including the session worktree commands and the home
migration's `worktree repair`, not only those whose requirement mentions hooks. Rejected: only the pull, fetch and
cleanup commands, as the specs name them. A `reference-transaction` or `post-index-change` hook fires for `worktree add`,
`branch -D`, `git add` and `rm --cached` alike, and a rule that holds for some writers is a rule the next writer forgets.
A `post-checkout` hook a repository relies on after `worktree add` (dependency installation, for example) no longer runs
there; the agent works in the worktree and can run what the project needs, under its own permission prompts. `git init`
of a new project and `git clone` keep their own invocations: `init` runs no hook, and the clone already does this.

A test (`test/gitWrite.test.ts`) asserts that no `Bun.spawn(["git"` call in the writer modules passes a writing
subcommand except through the helper, so a new writer cannot bypass it.

### D2. Pin each command's effect with options, not by reading configuration

- Fast-forward: `merge --ff-only --no-autostash --quiet <upstream>` with `-c submodule.recurse=false`. `--no-autostash`
  overrides `merge.autoStash`; `submodule.recurse` would make the merge update submodules, which the pull must not touch.
- Fetch: `fetch --no-recurse-submodules --no-prune --no-prune-tags --quiet <remote>`. The command-line options override
  `fetch.prune`, `fetch.pruneTags`, `remote.<name>.prune` and `remote.<name>.pruneTags`.

Rejected: reading the configuration and refusing when a setting is on. It needs a list of settings to check and still
leaves the effect to git; an option on the command line wins over every configuration level by git's own rules. Each
is an option of a subcommand already in the list, so the "never writes" requirement's subcommands are unchanged.

### D3. Merge checks name files from the top level

`contentIsInBase(cwd, base, ref)` becomes:

1. `git diff --name-only -z --no-relative --no-renames <base>...<ref>` — every path either side of a rename, relative to
   the top level whatever `diff.relative` says.
2. `git diff --quiet --no-ext-diff --no-textconv <base> <ref> -- :(top,literal)<path>…` — the same paths, read from the
   top level and taken literally (a file name with `*` or `:` is not a pattern).

The answer is then the same from the project's folder, a worktree or the top level. Rejected: running from
`rev-parse --show-toplevel`. It resolves symbolic links (the reason `knownStatusPaths` uses `--show-cdup`) and changes
the working directory of a function that is otherwise cwd-agnostic; pathspec magic fixes the one place paths cross.
`--no-renames` also makes a rename count its deleted source path, which without it was never compared.

The other `--name-only` and porcelain outputs were audited: `shipsOnlyOpenSpec` and the worktree status reads in
cleanup and stale cleanup run in a worktree's top level, where both sides agree; `ls-tree` uses in `staleChanges.ts` and
`worktree.ts` read and print cwd-relative paths consistently, and `HEAD:./<path>` is cwd-relative by design;
`knownStatusPaths` already joins with `--show-cdup`. Only `contentIsInBase` and pull's `blockingReport` cross bases.

### D4. Pull's blocking files are top-level paths throughout

`blockingReport` and `resolvePull` take `top = join(repoPath, cdup)` (`rev-parse --show-cdup`) and `prefix`
(`rev-parse --show-prefix`) once, and then:
- `diff --name-only --no-relative` and `status --porcelain` give top-level paths, as now;
- `ls-tree --full-name -r <upstream> -- :(top,literal)<path>…` and `ls-files --full-name -s -- :(top,literal)<path>…`
  print and read them the same way;
- `hash-object --path=<path> -- <path>`, the backup copy, `lstat`, the removal and the put-back run in, or join against,
  `top`;
- `rm --cached` and the restoring `add` use `:(top,literal)` pathspecs.

A path is a change-leftover candidate only when it starts with `prefix + "openspec/changes/<name>/"`; paths elsewhere in
the repository, inside or outside the project, are local work. Blocking files are shown as git reports them, relative to
the top level, so a root project's output is unchanged.

### D5. Locks keyed by the git common directory

`exclusively`/`fetchRepository` (pull) and `running` (cleanup, branch deletion, stale cleanup) take the key
`rev-parse --path-format=absolute --git-common-dir`, resolved with `realpath`, instead of the project id; a project whose
git directory cannot be read keeps its id as key (it cannot be pulled or cleaned up anyway). The semantics of each lock
stay exactly as specified per project — a pull waits for an automatic fetch, a second pull is refused, an automatic
fetch is skipped — only now across every project of one repository. The automatic fetch's outcome is still recorded per
project: a skipped fetch of the second project is reported as skipped, and its next attempt is one interval later.
Pull and cleanup stay two separate locks, as today.

### D6. Branch deletion stays `branch -D`

See Non-goals in the proposal: `update-ref -d <ref> <old>` would be a compare-and-delete, but it is not in the
subcommand list and leaves `branch.<name>.*` configuration behind. Not changed.
