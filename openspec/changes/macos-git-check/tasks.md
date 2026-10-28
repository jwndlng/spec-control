# Tasks

## 1. Finding git

- [x] 1.1 Add `gitExecutable()` to `src/server/paths.ts`: the first `git` on the PATH, and on macOS, when it resolves to `/usr/bin/git`, only when the active developer directory (D1) holds `usr/bin/git`; platform, environment and file-system lookups injectable; verify with `test/environment.test.ts` cases for a developer directory from `DEVELOPER_DIR`, from the link, none at all, and a git before `/usr/bin` on the PATH
- [x] 1.2 Use it in `checkGit`, with the placeholder's own `found` text and the existing `xcode-select --install` instruction; verify with a `test/environment.test.ts` case "the macOS placeholder is not git" in both the Settings and the setup view

## 2. Identity without the placeholder

- [x] 2.1 Make `checkGitIdentity` start no process when `gitExecutable()` finds no git; verify with `test/environment.test.ts` "no git config runs through the placeholder", with a fake `/usr/bin/git` stand-in on the PATH that records being run

## 3. Other callers

- [x] 3.1 Use `gitExecutable()` in `createProject.ts`, `githubClone.ts` and `api.ts` (`gitAvailable`); verify with `test/createProject.test.ts` (refused, no folder created) and `test/githubClone.test.ts` (refused, `gitAvailable: false`) under a simulated macOS without developer tools

## 4. Check

- [x] 4.1 Run `bun run check`
