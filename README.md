# Spec Control

A local Kanban board that shows where every [OpenSpec](https://github.com/Fission-AI/OpenSpec) change stands, across
all the repositories on your machine — and lets you hand each one to a coding agent without leaving the board.

**[Live demo →](https://wndlng.ch/spec-control/)** — the real UI on sample data, nothing to install.

<a href="https://blog.wndlng.ch/spec-control/#/board">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://wndlng.ch/spec-control/screenshots/board-dark.png">
    <img alt="The combined Kanban board: one column per lifecycle step from Backlog to Archived, cards grouped and coloured by repository, with task progress, last activity, branch badges and warnings." src="https://blog.wndlng.ch/spec-control/screenshots/board-light.png">
  </picture>
</a>

## Why

OpenSpec keeps every change as plain files in its repository: a proposal, specs, a design, a task list. That works
well for one repository. With ten of them, and agents working on several changes at once in different branches and
worktrees, you lose track: which changes are still drafts, which are being implemented, which are done and waiting
for you, which can be archived, and which agent is still running.

Spec Control reads your repositories and puts all of that on one board. There is no server to host, no account and
no database — the repositories are the source of truth, and the dashboard only looks at them unless you click
something.

## Features

- **One board for everything** — a column per lifecycle step (Backlog, Drafts, Ready, Implementing, Done, Archived),
  per repository or across all of them, including work that only exists in a worktree so far.
- **Projects at a glance** — open changes, work in progress (uncommitted, unpushed, stale checkouts) and your own
  labels for every repository under your workspace folders.
- **Agent sessions** — start Claude Code, Codex or any terminal agent on a change; it works in its own git worktree,
  and its terminal opens in the browser next to the change.
- **Everyday actions** — create or dismiss a change, pull a repository, clean up merged branches and worktrees —
  each only when you ask for it.
- **Activity** — a feed of what happened across your repositories, even while the dashboard was not running,
  summed up in figures and charted per day and per project for the last 7 days.
- **Pull requests** — each change's pull request on its card, with checks and readiness, read through your GitHub CLI.
- **New projects** — set up OpenSpec in an existing repository, or start a new one, with your agent doing the
  `openspec init`.
- **Add from GitHub** — keep your projects on GitHub only? Pick repositories from your account (or type
  `owner/name`) and they are cloned into a workspace folder; one that uses OpenSpec is tracked at once.
- **One file, offline** — a single binary with the UI built in, a setup and a short tour on first start and a Help
  page for the details.

The built-in **Help** explains every part of the dashboard; the full requirements are in
[`openspec/specs/`](openspec/specs/).

## How it is organised

Spec Control has three levels, and an agent can work at each of them. The further down you go, the narrower its
reach.

| Level | What you see | Where an agent runs |
| --- | --- | --- |
| **Global** | The projects overview and the board across all repositories | The **console**: your agent in a folder of its own, outside every repository — for drafting, comparing or chores |
| **Project** | One repository's board and settings | The **project console**: your agent in the repository's own folder, for anything that is not a change |
| **Change** | A card and its detail view: proposal, specs, design, tasks | An **agent session** on its own branch, in its own git worktree, so your checkout stays untouched |

## Run

**On an Apple silicon Mac, use the app.** Download `Spec-Control-<tag>-darwin-arm64.dmg` from the
[releases page](https://github.com/jwndlng/spec-control/releases), open it and drag **Spec Control** to Applications.
It needs macOS 14 or later. It is not notarised (no Apple Developer account behind this project), so the first time
macOS says it cannot verify the app: allow it once with
`xattr -dr com.apple.quarantine "/Applications/Spec Control.app"`, or choose **Open Anyway** in
System Settings → Privacy & Security after the first attempt.
The app runs the same `spec-control` binary in its own window, uses the same `~/.spec-control/` and, if a
`spec-control` you started in a terminal is already running, shows that one instead of starting another. Closing the
window keeps the server and your agent sessions running (the app stays in the menu bar); **Quit** stops them, asking
first while sessions run. The app makes no network request of its own and does not update itself; see
[Updating](#updating).

**On an Intel Mac or Linux, use the binary.**

1. Download `spec-control-<tag>-<platform>` for macOS (`darwin-x64` on Intel, `darwin-arm64`) or Linux (`linux-x64`,
   `linux-arm64`) from the [releases page](https://github.com/jwndlng/spec-control/releases). It needs nothing else.
2. Verify it: `shasum -a 256 -c --ignore-missing SHA256SUMS` and
   `gh attestation verify <file> --repo jwndlng/spec-control`. The same two commands verify the app's `.dmg`.
3. `chmod +x` it and run it; it opens your browser. Options: `--port N`, `--no-open`, `--version`.

The macOS binaries are not notarised either: if macOS refuses to open one, run
`xattr -d com.apple.quarantine <file>`.
Releases from before the rename are named `openspec-dashboard-<tag>-<platform>` and verify with
`--repo jwndlng/openspec-dashboard`.

**First run.** A short **setup** opens on the first start: choose the folder your projects live in — with **Choose
folder…**, which opens your system's folder dialog (Finder on macOS), by typing a path, or from suggestions such as
`~/Workspace` — or create a new one, pick which of the OpenSpec projects found under it to track, and add GitHub
repositories to clone into it; check every agent CLI you use, add
your own, and choose the default; choose the agent the top-bar **console** runs; set your projects' settings (PR titles,
Docs auto-merge, auto fetch and more), the same for all of them or one project at a time; and check the tools Spec
Control relies on, with the command to install whatever is missing — shown for you to copy, never run. Every step can
be skipped and changed later in **Settings** or on **Projects**, and **Help → Run setup again** opens it once more.
Agent sessions are off until you turn them on; setup offers that switched on, so continuing past its Agents
step turns them on unless you uncheck it.

**From source.** Needs [Bun](https://bun.sh) ≥ 1.4.

```sh
bun install
bun run build                  # → dist/spec-control
bun run build:desktop          # → the macOS app under desktop/build (Apple silicon, ad-hoc signed)
bun run dev                    # or run from source on http://127.0.0.1:4711
```

## Updating

**Knowing there is a new version.** Once a day Spec Control asks github.com for the tag of its latest release and,
when it is newer than yours, shows a banner at the top of every page, in the browser and in the app. That is one
`HEAD` request to `github.com/jwndlng/spec-control/releases/latest`; it carries the version you run (as its user
agent) and nothing else — nothing about you, this machine or your projects. Development builds never check. Turn it
off in **Settings → Updates** (**Check for new versions**), or with `"updateCheck": false` in
`~/.spec-control/config.json`; the same section has **Check now**. Nothing is downloaded or installed for you.

**Installing it.** Your settings, sessions, worktrees and history live in `~/.spec-control/`, so replacing the
program loses nothing:

- **The app:** quit Spec Control (menu bar → **Quit Spec Control**), download the new `.dmg` from the
  [releases page](https://github.com/jwndlng/spec-control/releases), drag **Spec Control** over the old one in
  Applications and open it — allowing it once more as described under [Run](#run).
- **The binary:** stop it (`Ctrl+C`), download and verify the new `spec-control-<tag>-<platform>` as under
  [Run](#run), replace the old file with it, `chmod +x` it and start it again.

Agent sessions that were running when you quit end as resumable and can be resumed after the update.

## What it touches

- It listens on `127.0.0.1` only.
- It reads your repositories with read-only git commands. Scanning and polling never write, fetch or contact a remote.
- It changes a repository only on something you do — Pull, New change, Dismiss, Clean up, applying shared config,
  or starting and ending an agent session's worktree — plus **Auto fetch**, which fetches each project's remote every
  minute (refs only, never your files) unless you switch it off in the project's settings. It never commits or pushes;
  your agent does that, under its own permission prompts.
- Outside your repositories it creates a folder only when you ask: **New project**, a workspace folder in setup, or a
  repository cloned with **Add from GitHub** — each one new folder, never inside a repository; the only thing it
  ever removes there is the empty folder of a clone that failed.
- It uses the network only for **Pull**, **Auto fetch** and **Add from GitHub**'s clone (through git), to read pull
  requests, issues and your GitHub repositories (through `gh`), with those tools' own sign-ins, and for the daily [update check](#updating) unless you turn it off. It never
  sees your credentials and never changes anything on GitHub.
- Its own state lives in `~/.spec-control/`.

The complete list is in the [dashboard-api spec](openspec/specs/dashboard-api/spec.md).

## Contributing

Found a bug, or have an idea? Please [open an issue](https://github.com/jwndlng/spec-control/issues) rather than a
pull request. Every change here is planned as an OpenSpec change and implemented by the maintainer and their agents,
so an issue is the quickest way to get something in.

Working on the project itself? Start with [CONTRIBUTING.md](CONTRIBUTING.md) and, for agents, [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE) © 2026 Jan Wendling
