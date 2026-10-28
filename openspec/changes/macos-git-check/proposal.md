# Proposal

## Why

Every macOS installation has `/usr/bin/git`, also without Apple's command line developer tools: it is a placeholder
that, when run, asks the system to offer installing those tools and exits with an error. The `git` check
(`checkGit` in `src/server/environment.ts`) only looks the executable up on the PATH (`whichOnPath`), so on a Mac
without the tools it reads `ok` with `/usr/bin/git`, and the macOS instruction `xcode-select --install` is never shown.
The `git-identity` check then runs `git config --get user.name` and `user.email` through that placeholder: that can open
Apple's "install the command line developer tools" dialog without the user having asked for anything, and it reports
`user.name and user.email are not configured for this user` with the `git config --global` remedy — which cannot work,
because there is no git.

The same lookup gates **New project** (`createProject.ts`), **Add from GitHub** (`githubClone.ts`, and the
`gitAvailable` flag of `GET /api/github/clones` in `api.ts`): on such a Mac they are offered, then `git init` or
`git clone` runs the placeholder, which fails — after New project has already created its folder.

Confidence is medium: the placeholder's behaviour is Apple's documented one, but the report was not run on a Mac
without the tools. On a Mac with them, `xcode-select -p` prints `/Library/Developer/CommandLineTools` and
`/var/db/xcode_select_link` points there, and `/Library/Developer/CommandLineTools/usr/bin/git` exists.

## What Changes

- **On macOS, `/usr/bin/git` counts as git only when the developer tools provide it.** When the first `git` on the PATH
  resolves to `/usr/bin/git`, git is found only when the active developer directory holds `usr/bin/git`. The developer
  directory is found the way `xcode-select -p` finds it — `DEVELOPER_DIR` when set, else the target of
  `/var/db/xcode_select_link`, else `/Applications/Xcode.app/Contents/Developer`, else
  `/Library/Developer/CommandLineTools` — by file-system lookups only, with no process started.
- **The `git` check reports the placeholder.** Without the tools, `git` is not `ok`, says that `/usr/bin/git` is
  Apple's placeholder and the command line developer tools are not installed, and carries the existing macOS
  instruction `xcode-select --install`.
- **The identity check does not run the placeholder.** When git is not found in this sense, `git-identity` starts no
  process and reports, as it does today with no git, that the identity could not be read because git was not found,
  with the install instruction first.
- **New project and Add from GitHub use the same answer**, so they say git was not found instead of running the
  placeholder.
- The report still starts no process but `git config --get`; no network, nothing read in a tracked repository.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `environment-check`: what counts as git being found on macOS; the identity check never runs a placeholder.
- `setup-wizard`: the System check step on a Mac without the developer tools.
- `project-creation`: the `git` precondition uses the same answer.
- `github-repositories`: Add from GitHub's "git was not found" uses the same answer.

## Impact

- `src/server/paths.ts`: a `gitExecutable()` helper beside `whichOnPath` — the PATH lookup plus the macOS
  developer-directory check, with the platform and file-system lookups injectable for tests.
- `src/server/environment.ts`: `checkGit` and `checkGitIdentity` use it; the placeholder's own `found` text.
- `src/server/createProject.ts`, `src/server/githubClone.ts`, `src/server/api.ts` (`gitAvailable`): use it instead of
  `whichOnPath("git")`.
- Tests: `test/environment.test.ts`, `test/createProject.test.ts`, `test/githubClone.test.ts`, with a fake developer
  directory under a temp folder; none needs a Mac.

### Overlaps

- `contain-repository-reads` (PR #371, open) and `serialise-home-writes` (PR #359, open) both change
  `src/server/api.ts`; this change touches only the `gitAvailable` expression of `GET /api/github/clones`.
- No in-flight change touches `environment.ts`, `paths.ts`, `createProject.ts` or `githubClone.ts`.
