// What's new: the user-visible features, written for the people running the dashboard — what they can now do and
// where. Compiled into the UI, so the binary and the demo show it without a request. Newest first; one entry per
// feature, added by the pull request that ships it (CONTRIBUTING.md, "What's new"). Entries are history: they describe
// the feature as it shipped and are not rewritten when it changes later.

export interface ChangelogEntry {
  /** `<date>-<kebab-case-slug>`; never changed once released, since browsers remember which ids they have seen. */
  id: string;
  /** Calendar date the feature was merged, `YYYY-MM-DD`. */
  date: string;
  title: string;
  /** One or two sentences of Markdown. */
  summary: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    id: "2026-10-24-recorded-pull-request",
    date: "2026-10-24",
    title: "Cards follow the branch the agent recorded",
    summary:
      "When it ships, the agent now records the branch it pushed in the change's `.openspec.yaml`, so a card shows that branch's pull request even when it is not named `feat/<change>` — and a card no longer borrows the pull request of a change with a similar name.",
  },
  {
    id: "2026-10-22-stale-changes",
    date: "2026-10-22",
    title: "Stale changes are marked, with a way out",
    summary:
      "A card now says **Stale** when its work already landed but the board cannot tell: an archive committed on a branch that never reached the default branch, or a session worktree left over after its change was archived. The change's detail offers **Carry over archive** or **Remove worktree…** accordingly.",
  },
  {
    id: "2026-10-22-delete-branches",
    date: "2026-10-22",
    title: "Delete a branch and its worktree from Details",
    summary:
      "A project's **Details** now marks every worktree whose branch belongs to no active change, and each worktree offers **Delete…**: it shows what would be lost, keeps a copy of the uncommitted files under `~/.spec-control/branch-backups/`, and then deletes the worktree and its branch even when they hold unfinished work.",
  },
  {
    id: "2026-10-21-agent-merges-docs-prs",
    date: "2026-10-21",
    title: "Docs-only pull requests merge on any GitHub plan",
    summary:
      "With **Docs auto-merge** on, Spec Control now waits until a pull request that only changes files under `openspec/` is mergeable and its checks pass, then asks your agent to merge it — so it works on free private repositories too, without GitHub's auto-merge. A new **Merge** action in a session's console asks the agent to merge any ready pull request by hand.",
  },
  {
    id: "2026-10-21-clearer-board-header",
    date: "2026-10-21",
    title: "A clearer project board header",
    summary:
      "A project's board now groups its actions under **Agent**, **Repository** and **Changes**, each explained when you hover it. Under the title a quick view shows what matters at a glance, **Details** opens everything else about the project, and the gear beside the name opens the project's settings without going back to Projects.",
  },
  {
    id: "2026-10-16-desktop-links",
    date: "2026-10-16",
    title: "Links open in your browser from the macOS app",
    summary:
      "In the macOS app, links to pull requests, issues, release notes and other sites open in your default browser again, while the app window keeps showing the dashboard.",
  },
  {
    id: "2026-10-13-keep-awake",
    date: "2026-10-13",
    title: "Your Mac stays awake while agents work",
    summary:
      "While an agent session is busy, Spec Control now keeps your Mac from going to sleep on its own, and lets it sleep again once no agent is busy. The display still sleeps, and closing the lid still sleeps the machine. Switch it off under **Settings → Agent sessions → Keep awake while agents work**.",
  },
  {
    id: "2026-10-13-version-in-header",
    date: "2026-10-13",
    title: "See which version you run",
    summary: "The header now shows the release you run next to **Spec Control**, linked to its release notes — in the browser and in the macOS app.",
  },
  {
    id: "2026-10-10-add-from-github",
    date: "2026-10-10",
    title: "Add your GitHub repositories",
    summary:
      "**Add from GitHub** on **Projects** clones repositories from your account — or any `owner/name` — into a workspace folder, and one that uses OpenSpec is tracked at once. Setup can now create a new workspace folder and clone your repositories into it, so you can start with nothing checked out.",
  },
  {
    id: "2026-10-09-setup-wizard-more",
    date: "2026-10-09",
    title: "A fuller setup",
    summary:
      "Setup now opens your system's folder dialog with **Choose folder…**, takes every agent CLI you use (and your own), lets you pick the **console**'s agent, and walks through your **project settings** — the same for all projects or one at a time — in a larger, roomier dialog. Run it again from **Help**.",
  },
  {
    id: "2026-10-09-setup-wizard",
    date: "2026-10-09",
    title: "Set up in a few steps",
    summary:
      "A fresh installation now opens a short **setup**: where your projects live, which agent to use, and a check of the tools Spec Control relies on, with the command to install whatever is missing. Every check in **Settings → Environment** now shows those commands too. Run it again from **Help**.",
  },
  {
    id: "2026-10-09-console-agent",
    date: "2026-10-09",
    title: "Pick the console's agent",
    summary:
      "The top-bar **console** can now run a different agent from your default — Codex or Antigravity for questions, say, while Claude Code keeps doing your changes. Choose it under **Settings → Agent sessions → Console**.",
  },
  {
    id: "2026-10-09-update-notice",
    date: "2026-10-09",
    title: "Know when a new version is out",
    summary:
      "A banner at the top now tells you when a newer Spec Control is released, with its release notes and how to update — in the browser and in the macOS app. It asks github.com once a day, sending only the version you run. Turn it off, or **Check now**, in **Settings → Updates**.",
  },
  {
    id: "2026-10-09-activity-charts",
    date: "2026-10-09",
    title: "Activity in charts",
    summary:
      "**Activity** now opens with tiles that show each figure's trend over the week, events per day stacked by kind, a heatmap of the hours you worked and each project's activity by kind. Hover or focus a chart for its numbers, or switch to **Table** to read them all.",
  },
  {
    id: "2026-10-08-styled-dmg-installer",
    date: "2026-10-08",
    title: "The Mac app's disk image shows how to install it",
    summary:
      "Opening the macOS app's `.dmg` now shows **Spec Control** and your **Applications** folder side by side, with an arrow between them: drag the app onto Applications to install it.",
  },
  {
    id: "2026-10-08-auto-fetch-by-default",
    date: "2026-10-08",
    title: "Auto fetch is on, every minute",
    summary:
      "Every project now fetches its remote **every minute** unless you change it, so merged pull requests and conflicts show up quickly. A project's **Auto fetch** setting now also offers every 15 or 30 seconds and every 10 minutes, and **Off** for a project you do not want fetched. An interval you picked before is kept.",
  },
  {
    id: "2026-10-08-activity-metrics",
    date: "2026-10-08",
    title: "Activity per day and per project",
    summary:
      "Below its figures, **Activity** now charts the week: events per day, and which projects were busiest, with the changes each touched. Click a project to see only its activity, or **Hide details** to keep just the figures.",
  },
  {
    id: "2026-10-08-fast-forward",
    date: "2026-10-08",
    title: "Fast-forward a small change to a pull request",
    summary:
      "A card that is not planned yet now offers **FF** beside **Draft artifacts**: the agent writes the artifacts, implements the change and opens a pull request in one go, and the pull request is the only review. It asks you to confirm first — tick **Don't show this warning again** to skip that, and turn it back on under **Settings › Agent sessions**.",
  },
  {
    id: "2026-10-08-auto-fetch",
    date: "2026-10-08",
    title: "Projects can fetch on their own",
    summary:
      "A project's settings on **Projects** now have **Auto fetch**: every 5, 15 or 30 minutes or every hour, the dashboard fetches its remote, so a branch whose pull request merged shows as merged without a pull. It only fetches — your checkout changes only when you **Pull** — and beside **Pull** you see when the project was last fetched.",
  },
  {
    id: "2026-10-07-activity-summary",
    date: "2026-10-07",
    title: "Activity at a glance",
    summary:
      "**Activity** now opens with the week in figures: changes created, moved and archived, tasks completed, sessions run, and the entries that need attention. They count the whole log and follow your filters. A busy day shows its newest 20 entries, and **Show more** brings back the rest.",
  },
  {
    id: "2026-10-07-project-settings-dialog",
    date: "2026-10-07",
    title: "Project settings in one dialog",
    summary:
      "On **Projects**, each row and tile now has a gear that opens the project's settings: **Agent sessions**, **Agent**, **PR titles**, **Docs auto-merge**, **Labels** and **Disable**, the same from the table and the tiles. The table loses its **Agent sessions** column, and **Console** and **Pull** stay on the row and the tile.",
  },
  {
    id: "2026-10-07-agent-reports-waiting",
    date: "2026-10-07",
    title: "Know when your agent waits for you",
    summary:
      "Opening an agent's console no longer turns **may need you** back into **working**. And an agent can now say it is waiting: have its own hooks write `waiting` or `working` into the file named by `SPEC_CONTROL_STATE_FILE`, and its badge reads **waiting for you** until you answer. See **Help › Agent sessions**.",
  },
  {
    id: "2026-10-07-overview-polish",
    date: "2026-10-07",
    title: "A tidier projects table, and a way home",
    summary:
      "Label chips and the **Agent sessions** and **Docs auto-merge** toggles in the projects table stay in their own row at any zoom. **Pull requests** now says a repository simply *isn't on GitHub* instead of reporting it as one that could not be listed, and the **Spec Control** title and mark take you back to **Projects**.",
  },
  {
    id: "2026-10-07-section-navigation",
    date: "2026-10-07",
    title: "Help has the side navigation Settings has",
    summary:
      "**Help** now lists its sections in a navigation beside them that moves along as you read, like **Settings**, instead of a row of links at the top. On Settings the navigation no longer jumps to the bottom when you scroll to the end of the page.",
  },
  {
    id: "2026-10-07-spec-control-home",
    date: "2026-10-07",
    title: "Your settings moved to ~/.spec-control",
    summary:
      "On its first start Spec Control moves its folder from `~/.openspec-dashboard/` to `~/.spec-control/`, worktrees included, and leaves a link at the old path so nothing that points there breaks. Set `SPEC_CONTROL_HOME` instead of `OPENSPEC_DASHBOARD_HOME`. Sessions that ended before the move may resume without their earlier conversation, for agents that remember conversations by folder.",
  },
  {
    id: "2026-10-07-spec-control",
    date: "2026-10-07",
    title: "OpenSpec Dashboard is now Spec Control",
    summary:
      "The dashboard has a new name: **Spec Control**, mission control for every agent change across your repositories. The binary and the release downloads are now called `spec-control`; your settings, sessions and worktrees carry over untouched.",
  },
  {
    id: "2026-10-06-project-overview-tiles",
    date: "2026-10-06",
    title: "Tidier project tiles",
    summary:
      "Every tile on **Projects › Tiles** now has the same layout: name, badges, the **open**, **to archive** and **open PRs** figures side by side, its worktrees and branches, and a footer with **Console**, **Pull** and **Settings**. A project's own settings, **Labels** and **Disable** moved into that **Settings** panel.",
  },
  {
    id: "2026-10-06-overview-without-stage-counts",
    date: "2026-10-06",
    title: "A calmer projects overview",
    summary:
      "The projects overview no longer repeats the Kanban columns: each row and tile shows how many changes are open and ready to archive, without a count per stage. The breakdown per stage is on each project's board and on **All changes**.",
  },
  {
    id: "2026-10-06-cleanup-by-default",
    date: "2026-10-06",
    title: "End session cleans up and pulls by default",
    summary:
      "**End session** now ticks **also remove the worktree** whenever nothing would be lost, and **also pull** for every git repository, not only once the work shows as merged. Clear either box before confirming to keep the worktree or skip the pull; the branch is always kept.",
  },
  {
    id: "2026-10-06-auto-merge-cleanup",
    date: "2026-10-06",
    title: "Merged docs pull requests clean up after themselves",
    summary:
      "With **Docs auto-merge** on, once a pull-request refresh shows the pull request your agent was asked to auto-merge as merged, the dashboard ends that session and removes its worktree when that is safe. The session panel and card say so, or why the worktree was kept; the branch stays for repository cleanup.",
  },
  {
    id: "2026-10-06-project-console-button",
    date: "2026-10-06",
    title: "An easier-to-find project console",
    summary:
      "The project console is now a labelled **Console** button: first among a board's actions, next to **Pull** and **New change**, and set apart from the agent settings on each project's row and tile. While it runs, the button says whether your agent is `working` or `may need you`.",
  },
  {
    id: "2026-10-06-agent-without-commit",
    date: "2026-10-06",
    title: "Agents in a project with no commit yet",
    summary:
      "In a git repository with no commit yet — such as one made with **New project** — **Draft artifacts**, **Implement** and the other starters now start your agent in the project's checkout instead of refusing. Once the repository has a commit, new sessions get their own worktree again.",
  },
  {
    id: "2026-10-05-design-optional",
    date: "2026-10-05",
    title: "A design is optional",
    summary:
      "A change moves to **Ready** and offers **Implement** as soon as its tasks are written, with or without a `design.md` — only the artifacts the schema needs for implementing count. **Draft artifacts** stays on the card if you still want a design.",
  },
  {
    id: "2026-10-05-archive-auto-merge-docs",
    date: "2026-10-05",
    title: "Docs auto-merge reaches Archive",
    summary:
      "With **Docs auto-merge** on, an **Archive** session whose worktree holds only files under `openspec/` now asks your agent to enable auto-merge on the pull request it opens for the archive — if your Archive instructions have it open one. The session panel says when it did.",
  },
  {
    id: "2026-10-05-pr-title-convention",
    date: "2026-10-05",
    title: "Pull request title convention per project",
    summary:
      "Pick **Conventional Commits** under **PR titles** for a project on the **Projects** overview, and **Ship** asks the agent to title that project's pull requests and commits that way. Without it, Ship no longer asks for Conventional Commits and the agent follows the repository's own conventions.",
  },
  {
    id: "2026-10-05-change-dependencies",
    date: "2026-10-05",
    title: "Changes that wait for other changes",
    summary:
      "Pick what a new change **Depends on** in the **New change** form, or list it in the change's `depends-on.yaml`. Until those changes are done or archived on your main checkout, the card shows `waits for …` instead of **Implement**, and the details view lists both directions.",
  },
  {
    id: "2026-10-05-docs-auto-merge",
    date: "2026-10-05",
    title: "Auto-merge docs-only pull requests",
    summary:
      "Switch on **Docs auto-merge** for a project on the **Projects** overview, and **Ship** asks your agent to enable auto-merge on a pull request that only changes files under `openspec/`, such as an archive. Every other pull request still waits for review.",
  },
  {
    id: "2026-10-03-whats-new",
    date: "2026-10-03",
    title: "What's new",
    summary:
      "The **What's new** button in the top corner lists the features added to the dashboard, newest first, and counts the ones you have not seen yet. It works offline: the list is part of the dashboard itself.",
  },
  {
    id: "2026-10-02-project-settings-on-overview",
    date: "2026-10-02",
    title: "Project settings on the overview",
    summary:
      "Each project on the **Projects** overview carries its own settings, saved at once: switch agent sessions on or off, pick its agent, rename it in place and edit its labels. Unmanaged projects offer **Forget**.",
  },
  {
    id: "2026-10-02-archived-cards-keep-their-session",
    date: "2026-10-02",
    title: "Archived cards stay while their session runs",
    summary:
      "With **Hide merged** on, an archived change whose agent session is still running keeps its card in the Archived column, so the way back to that console does not disappear.",
  },
  {
    id: "2026-10-02-project-labels",
    date: "2026-10-02",
    title: "Project labels",
    summary:
      "Give repositories your own labels, and see technology labels detected from the files in each project. Labels show on the overview and the board header, and filter the overview.",
  },
  {
    id: "2026-10-01-integrate-with-any-agent",
    date: "2026-10-01",
    title: "Integrate works with every agent",
    summary:
      "**Integrate** and **New project** no longer need an integrate prompt in the agent's profile: every agent gets a default prompt that sets up OpenSpec in the repository.",
  },
  {
    id: "2026-10-01-start-sessions-from-the-board",
    date: "2026-10-01",
    title: "Start sessions without leaving the board",
    summary:
      "Starting an agent from a card keeps you on the board. The card's session badge takes the starter's place and opens the **Console** tab when you want it.",
  },
  {
    id: "2026-10-01-manage-repositories-from-overview",
    date: "2026-10-01",
    title: "Manage repositories from the overview",
    summary:
      "The **Projects** overview lists disabled, discovered and not-yet-OpenSpec repositories under *Untracked & disabled*, with **Enable**, **Ignore** and **Integrate**; every tracked project can be disabled from its row or tile.",
  },
  {
    id: "2026-10-01-activity-keeps-seven-days",
    date: "2026-10-01",
    title: "Activity keeps the last 7 days",
    summary: "The **Activity** feed keeps a week of history and says so at its end; older events are dropped from the log.",
  },
  {
    id: "2026-10-01-new-project",
    date: "2026-10-01",
    title: "Create a new project",
    summary:
      "**New project** on the overview creates an empty folder in one of your workspace roots, initialises git in it and starts an agent that sets up OpenSpec there.",
  },
  {
    id: "2026-10-01-pull-request-on-cards",
    date: "2026-10-01",
    title: "Pull requests on cards",
    summary:
      "A card shows its change's pull request — `PR #<n>` with its state — and the detail header shows its title, review and checks, linking to GitHub.",
  },
  {
    id: "2026-09-30-pull-requests-view",
    date: "2026-09-30",
    title: "Pull requests",
    summary:
      "The **Pull requests** view lists the open pull requests of your GitHub repositories, read through the GitHub CLI (`gh`) when you open it or press **Refresh**. The overview counts them per project.",
  },
];
