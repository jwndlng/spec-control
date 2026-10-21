// The repository board's project details overlay (project-overview: "Repository board header"): everything about the
// project that the header's quick view leaves out, in labelled sections. It shows only what the snapshot, the
// configuration and the cached pull-request list already hold — opening it starts no scan, fetch or query.
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import type { Config, RepoSnapshot } from "../shared/types.ts";
import { CheckoutList } from "./checkout.tsx";
import { relTime } from "./format.ts";
import { IconInfo } from "./icons.tsx";
import { LabelChips } from "./labels.tsx";
import { Modal } from "./modal.tsx";
import { autoFetchSecondsOf, CONFIG_UNREADABLE, DETAIL_SECTION_TITLES, detailSections, repoLabels, type DetailSection } from "./projectDetails.ts";
import { usePullRequests } from "./pullRequests.tsx";
import { openCount } from "./pullRequestsState.ts";
import { autoFetchEvery, branchNotice, fetchNote } from "./pullState.ts";
import { checkoutSummary } from "./overviewState.ts";

const headingId = (section: DetailSection) => `project-details-${section}`;

function Section({ section, children }: { section: DetailSection; children: ComponentChildren }) {
  return (
    <section class="details-section" aria-labelledby={headingId(section)}>
      <h3 id={headingId(section)} tabIndex={-1}>
        {DETAIL_SECTION_TITLES[section]}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="details-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ago(at: string, now: number): string {
  const rel = relTime(at, now);
  return rel === "just now" ? rel : `${rel} ago`;
}

function RepositorySection({ repo, now }: { repo: RepoSnapshot; now: number }) {
  return (
    <Section section="repository">
      <dl class="details-facts">
        <Fact label="Path">
          <code class="details-path">{repo.path}</code>
        </Fact>
        <Fact label="Kind">{repo.isGit ? "git repository" : "folder without git"}</Fact>
        {repo.currentBranch && (
          <Fact label="Main checkout">
            <span class="mono">{repo.currentBranch}</span>
          </Fact>
        )}
        {repo.lastUpdatedAt && (
          <Fact label="Last updated">
            <span title={new Date(repo.lastUpdatedAt).toLocaleString()}>{ago(repo.lastUpdatedAt, now)}</span>
          </Fact>
        )}
      </dl>
    </Section>
  );
}

function SyncSection({ repo, config, now }: { repo: RepoSnapshot; config: Config | null; now: number }) {
  const seconds = autoFetchSecondsOf(config, repo.id);
  const note = fetchNote({ ...repo, autoFetchSeconds: seconds }, now);
  const failed = note?.tone === "warning";
  const notice = branchNotice(repo);
  return (
    <Section section="sync">
      <dl class="details-facts">
        <Fact label="Last fetch">
          {repo.hasRemote !== true ? (
            "no remote to fetch from"
          ) : repo.lastFetchedAt ? (
            <span title={new Date(repo.lastFetchedAt).toLocaleString()}>
              {ago(repo.lastFetchedAt, now)} · {new Date(repo.lastFetchedAt).toLocaleString()}
            </span>
          ) : (
            "never fetched"
          )}
        </Fact>
        <Fact label="Auto fetch">{seconds ? autoFetchEvery(seconds) : "off"}</Fact>
      </dl>
      {failed && note && (
        <div class="notice warn" role="note">
          ⚠ {note.detail}
        </div>
      )}
      {notice && (
        <div class="notice warn" role="note">
          ⎇ {notice.long}
        </div>
      )}
    </Section>
  );
}

function PullRequestsSection({ repoId, onOpen }: { repoId: string; onOpen: () => void }) {
  // Only the cached list: reading it starts nothing; the dialog it opens keeps its own refresh-on-open rule.
  const ui = usePullRequests();
  const count = openCount(ui.data, repoId);
  return (
    <Section section="pullRequests">
      <p class="details-line">
        {count.open === undefined ? (count.reason ?? "pull requests have not been fetched yet") : `${count.open} open ${count.open === 1 ? "PR" : "PRs"}`}
        {count.awaitingMe > 0 && ` · ${count.awaitingMe} for you`}
        {count.fetchedAt && <span class="hint"> · listed {ago(count.fetchedAt, Date.now())}</span>}
      </p>
      <button type="button" class="btn sm" aria-haspopup="dialog" onClick={onOpen}>
        Show pull requests
      </button>
    </Section>
  );
}

function SharedConfigSection({ repo }: { repo: RepoSnapshot }) {
  const shared = repo.sharedConfig;
  if (!shared) return null;
  return (
    <Section section="sharedConfig">
      {shared.unreadable && (
        <div class="notice danger" role="note">
          ⚙ config unreadable: {CONFIG_UNREADABLE}
        </div>
      )}
      {shared.applied.length > 0 && (
        <ul class="details-profiles">
          {shared.applied.map((p) => (
            <li key={p.id}>
              <span class={`badge ${p.state === "in-sync" ? "" : "warning"}`} title="Shared OpenSpec config profile carried by openspec/config.yaml">
                ⚙ {p.id} · {p.state === "in-sync" ? "in sync" : p.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Details and the repository's name, over the dimmed page. `section` is brought into view and its heading focused, so
 * the branches control lands on the checkouts. Closing returns focus to the control that opened it.
 */
export function ProjectDetailsDialog({
  repo,
  config,
  now,
  section,
  returnFocus,
  onClose,
  onOpenPullRequests,
}: {
  repo: RepoSnapshot;
  config: Config | null;
  now: number;
  section?: DetailSection;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onOpenPullRequests: () => void;
}) {
  const sections = detailSections(repo, config);
  useEffect(() => {
    if (!section || !sections.includes(section)) return;
    const heading = document.getElementById(headingId(section));
    heading?.scrollIntoView({ block: "start" });
    heading?.focus();
  }, []);
  return (
    <Modal label={`Details of ${repo.name}`} title="Details" subtitle={repo.name} icon={<IconInfo size={18} />} onClose={onClose} returnFocus={returnFocus} wide>
      <div class="project-details">
        {sections.map((s) => {
          switch (s) {
            case "labels":
              return (
                <Section key={s} section="labels">
                  <LabelChips labels={repoLabels(repo, config)} />
                </Section>
              );
            case "repository":
              return <RepositorySection key={s} repo={repo} now={now} />;
            case "checkouts":
              return (
                <Section key={s} section="checkouts">
                  <p class="hint">{checkoutSummary(repo.worktrees).text} — unpushed and behind counts are as of the last fetch</p>
                  <CheckoutList checkouts={repo.worktrees} />
                </Section>
              );
            case "sync":
              return <SyncSection key={s} repo={repo} config={config} now={now} />;
            case "pullRequests":
              return <PullRequestsSection key={s} repoId={repo.id} onOpen={onOpenPullRequests} />;
            default:
              return <SharedConfigSection key={s} repo={repo} />;
          }
        })}
      </div>
    </Modal>
  );
}
