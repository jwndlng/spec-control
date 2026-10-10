// The Help view's text: built into the UI bundle, so it shows without a request — also when the server is gone.
// Keep it true to the dashboard: a change that alters behaviour described here updates this file too (CONTRIBUTING.md).
// Examples use made-up names and paths only.
import { type ComponentChildren, Fragment, type VNode } from "preact";
import { STAGE_COLUMN, type Stage } from "../shared/types.ts";
import { followInApp, hrefWithQuery } from "./url.ts";

/** An in-app link: a real link (opens in a new tab with a modifier), navigating in place on a plain click. */
export function AppLink({ path, query = "", children }: { path: string; query?: string; children: ComponentChildren }) {
  return (
    <a href={hrefWithQuery(path, query)} onClick={(e) => followInApp(e, path, query)}>
      {children}
    </a>
  );
}

/**
 * What each board column means. A `Record` over every stage, so a column added to the board without an explanation
 * here fails type checking.
 */
export const COLUMN_HELP: Record<Stage, string> = {
  backlog: "A change whose directory exists, but none of its planning artifacts (proposal, specs, design, tasks) is written yet.",
  drafts: "Some planning artifacts are written, but not yet every one needed to implement. The card's bar shows how many.",
  unknown: "The dashboard could not tell which artifacts the change has — for example an unknown schema. The column only appears while a change is in it.",
  ready: "Every artifact needed to implement is written and no task is ticked yet: ready to implement. Which ones are needed is up to the schema (its apply.requires) — for spec-driven only tasks, so a design is optional.",
  implementing: "At least one task in tasks.md is ticked, or marked as awaiting validation, and others are still open.",
  done: "Every task is ticked (- [x]) or awaiting your confirmation (- [~]). With tasks awaiting you, the card says Validate; the change is ready to archive either way.",
  archived: "The change was moved to openspec/changes/archive/, on the main checkout or on a worktree's branch that is not merged yet.",
};

export interface HelpSection {
  /** Part of the deep-link contract: /help?section=<id>. */
  id: string;
  title: string;
  body: () => VNode;
}

const ColumnGlossary = () => (
  <dl class="help-glossary">
    {(Object.keys(STAGE_COLUMN) as Stage[]).map((stage) => (
      <Fragment key={stage}>
        <dt>{STAGE_COLUMN[stage]}</dt>
        <dd>{COLUMN_HELP[stage]}</dd>
      </Fragment>
    ))}
  </dl>
);

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    body: () => (
      <>
        <p>
          Spec Control shows the OpenSpec changes of the repositories on this machine. It finds them under the folders you
          tell it about, and reads them; it does not need a server, an account or a network.
        </p>
        <p>
          On the first start, <strong>setup</strong> walks you through the essentials: where your projects live, which agent
          to use, and a check of the tools Spec Control relies on, with the commands to install whatever is missing. Every
          step can be skipped, and <strong>Run setup again</strong> above opens it once more. By hand, it comes down to this:
        </p>
        <ol>
          <li>
            In <AppLink path="/settings" query="?section=roots">Settings → Workspace roots</AppLink>, add the folder your
            repositories live in, such as <code>~/Workspace</code>.
          </li>
          <li>
            Open <AppLink path="/">Projects</AppLink>. Repositories that use OpenSpec are listed under Unmanaged projects;
            <strong> Enable</strong> starts tracking one, and its changes appear on the boards.
          </li>
          <li>
            Projects on GitHub? <strong>Add from GitHub</strong> on the projects overview, or in setup, clones the ones you
            choose into a workspace root with git. The clones run in the background: Unmanaged projects, and setup's last
            step, show each one's progress, and <strong>Cancel</strong> stops one. A clone that uses OpenSpec is tracked once
            it has finished.
          </li>
          <li>
            A git repository that does not use OpenSpec yet offers <strong>Integrate</strong>: your agent runs{" "}
            <code>openspec init</code> in it, and the dashboard tracks it once <code>openspec/config.yaml</code> exists. This
            needs agent sessions to be on.
          </li>
          <li>
            <strong>New change</strong> on a board creates <code>openspec/changes/&lt;name&gt;/</code>, optionally with a
            prompt, and stages it. Nothing is committed.
          </li>
          <li>
            <strong>Import from issues</strong> on a project's board lists its open GitHub issues; check the ones you want
            and each becomes a change, named after its title (you can rename it), with the issue's text as its prompt and an{" "}
            <code>issue.yaml</code> recording where it came from. The card then links to the issue, and an issue already
            imported is marked so it is not imported twice.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "board",
    title: "The board",
    body: () => (
      <>
        <p>
          <AppLink path="/board">All changes</AppLink> is one Kanban board across every tracked project; each project also
          has a board of its own, opened from its row on Projects. Changes in git worktrees count too, so work shows up
          before it is merged. A change's column follows from its files alone — which artifacts are written and how many
          tasks are ticked — so it moves by itself as you or your agent work.
        </p>
        <ColumnGlossary />
        <p>
          The filter bar narrows the board to some projects or to a search over change and project names, and keeps your
          choice in the URL, so a filtered board can be bookmarked or shared.
        </p>
        <p>
          A card is tinted as <strong>working</strong> while an agent works on its change, and also while the change's pull
          request is open but not ready yet — a draft, a conflict, failing or running checks — whether or not an agent still
          runs. Its badge says why, for example <code>PR #125 · checks running</code>; once every check is green and the
          branch merges cleanly it reads <code>ready</code> and the tint ends. Its name sweeps only while something is still
          being worked out on GitHub. The tint never changes the column, the progress or what you can start.
        </p>
      </>
    ),
  },
  {
    id: "detail",
    title: "A change in detail",
    body: () => (
      <p>
        <strong>Show details</strong> on a card opens the change's proposal, design, specs and tasks over the board.{" "}
        <kbd>Esc</kbd> closes it and brings you back to the board as you left it. A change you are not going ahead with can
        be <strong>dismissed</strong> from there: the confirmation lists every file and says which ones git can restore.
      </p>
    ),
  },
  {
    id: "agent-sessions",
    title: "Agent sessions",
    body: () => (
      <>
        <p>
          Off by default. Turn them on, and pick your agent CLI, in{" "}
          <AppLink path="/settings" query="?section=agents">Settings → Agent sessions</AppLink>.
        </p>
        <ul>
          <li>
            A card offers the next step for its column — <strong>Draft artifacts</strong>, <strong>Implement</strong>,{" "}
            <strong>Validate</strong> or <strong>Archive</strong>. It starts your agent in a git worktree of its own, on its
            own branch, under <code>~/.spec-control/worktrees/</code>; your main checkout is not touched.
          </li>
          <li>
            The agent's terminal is the <strong>Console</strong> tab of the change's detail view. What it changes is decided by
            its own permission prompts.
          </li>
          <li>
            <strong>Ship</strong> asks the agent to commit, push and open a pull request; <strong>Resolve conflicts</strong>{" "}
            asks it to bring a branch that no longer merges up to date. The dashboard itself commits, merges and pushes
            nothing.
          </li>
          <li>
            <strong>FF</strong> (Fast-forward), beside <strong>Draft artifacts</strong> on a change that is not planned yet,
            asks the agent to write the artifacts, implement the change and open a pull request in one go, without
            stopping for your review — the pull request is the only review, and it is never merged for you. It asks you
            to confirm first; <strong>Don't show this warning again</strong> skips that, and{" "}
            <AppLink path="/settings" query="?section=agents">Settings → Agent sessions</AppLink> brings it back.
          </li>
          <li>
            <strong>Open work</strong> in the top bar lists running agents and worktrees that still hold something.{" "}
            <strong>End session</strong> stops an agent and, by default, pulls the repository and — when nothing would be
            lost — removes its worktree; clear either box before confirming to skip it.
          </li>
          <li>
            The <strong>Console</strong> button in the top bar opens your agent outside every change, in a console folder of its
            own. Which agent that is — your default agent unless you pick another — is set under Settings → Agent sessions →
            Console.
          </li>
          <li>
            Each project's <strong>console</strong> button — on its overview row or tile and on its board — opens its agent
            in the project's own folder, for anything that is not a change. It works there directly, with no branch and no
            undo. The session that set a new project up shows here until you start a new console.
          </li>
        </ul>
        <p>
          In a tracked folder that is not a git repository, the agent works in the folder itself, with no branch and no
          undo. So it does in a git repository with no commit yet, such as a new project: there is nothing to branch from,
          so the agent works in the checkout. Once the repository has a commit, new sessions get their own worktree.
        </p>
        <p>
          A running session's badge is a guess from its terminal: <strong>working</strong> while it prints,{" "}
          <strong>may need you</strong> once it has been silent for 20 seconds. Opening, resizing or focusing a console
          does not count as the agent printing. For a badge that knows, let your agent report its state: every session
          gets the variable <code>SPEC_CONTROL_STATE_FILE</code>, naming a file the dashboard reads. Write{" "}
          <code>waiting</code> or <code>working</code> into it from your agent's own hooks — for example{" "}
          <code>echo waiting &gt; "$SPEC_CONTROL_STATE_FILE"</code> when it finishes a turn or asks for permission, and{" "}
          <code>echo working &gt; "$SPEC_CONTROL_STATE_FILE"</code> when you submit a prompt. While the report says{" "}
          <code>waiting</code>, the badge reads <strong>waiting for you</strong> until you type into the session. The file
          is under <code>~/.spec-control/sessions/</code>, so the hook has to be allowed to write there.
        </p>
      </>
    ),
  },
  {
    id: "keeping-current",
    title: "Keeping repositories current",
    body: () => (
      <ul>
        <li>
          <strong>Pull</strong> fetches and fast-forwards a repository's main checkout; <strong>Pull all</strong> on Projects
          does it for every repository. It never merges, rebases, stashes or switches branches.
        </li>
        <li>
          <strong>Auto fetch</strong>, a project's own setting on Projects, fetches its remote every minute unless you pick
          another interval — from every 15 seconds to every hour — or switch it off, so a branch whose pull request merged
          shows as merged without a pull. It only fetches: the checkout itself changes only when you Pull. Beside Pull you see when the project was last fetched, and why if an automatic
          fetch failed.
        </li>
        <li>
          <strong>Clean up</strong> on a repository's board removes leftover worktrees and local branches whose work is
          merged. Only what provably holds no work of its own is offered, and nothing goes before you confirm.
        </li>
        <li>
          <strong>Refresh</strong> scans now; the clock beside it repeats that at an interval you choose. Scanning only
          reads.
        </li>
      </ul>
    ),
  },
  {
    id: "pull-requests",
    title: "Pull requests",
    body: () => (
      <p>
        <AppLink path="/pull-requests">Pull requests</AppLink> lists the open pull requests of your tracked GitHub
        repositories, and those merged or closed in the last week. It reads them with your own GitHub CLI (
        <code>gh</code>), signed in with <code>gh auth login</code>, only when you open a view that shows them or press
        Refresh — and while an open board shows a pull request that is not ready yet: then that board asks again for those
        projects on its own, every minute while checks run, every five minutes while it waits on a draft, a conflict or a
        failing check, and not at all while the tab is hidden. <strong>Import from issues</strong> reads a project's open
        issues the same way, only when you open it or press its Refresh. Nothing is ever changed on GitHub. Without{" "}
        <code>gh</code> the view says so and everything else works.
      </p>
    ),
  },
  {
    id: "what-it-writes",
    title: "What the dashboard changes",
    body: () => (
      <>
        <p>
          The dashboard reads your repositories; scanning, polling and discovery write nothing and contact no remote. It
          changes a repository only when you click something:
        </p>
        <ul>
          <li>Pull, New change, Import from issues, Dismiss, Clean up and applying shared config, each on the repository you chose;</li>
          <li>creating and removing an agent session's worktree;</li>
          <li>fetching a project's remote every minute, or on the interval you set, unless you switched its Auto fetch off — refs only, never its files.</li>
        </ul>
        <p>
          Its own state — configuration, activity history, session records — lives in <code>~/.spec-control/</code>. It
          listens on <code>127.0.0.1</code> only. Theme, auto-refresh and whether you saw the tour are kept in this browser.
        </p>
        <p>
          Once a day it asks github.com for the tag of its own latest release — one request carrying only the version you
          run — and shows a banner when a newer one exists. Nothing is downloaded or installed: to update, replace the
          binary or the app, and your settings and sessions stay. Turn it off in{" "}
          <AppLink path="/settings" query="?section=updates">Settings → Updates</AppLink>.
        </p>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    body: () => (
      <ul>
        <li>
          A warning badge in the top bar names what is missing on this machine; the details and how to fix each are in{" "}
          <AppLink path="/settings" query="?section=environment">Settings → Environment</AppLink>.
        </li>
        <li>A red badge with a project's name means its last scan failed; hover it for the reason.</li>
        <li>
          A project missing from the board may be disabled or ignored: look under Unmanaged projects on{" "}
          <AppLink path="/">Projects</AppLink>.
        </li>
      </ul>
    ),
  },
];

export const HELP_SECTION_IDS = HELP_SECTIONS.map((s) => s.id);
