// What the Pull requests view puts on screen for one entry. Rendered without a DOM: the list and its entries use no
// hooks, so the vnode helpers can expand them.
import { expect, test } from "bun:test";
import { type ComponentChildren, h } from "preact";
import type { PullRequest } from "../src/shared/types.ts";
import { CardPullRequest, Notices, PullRequestList } from "../src/ui/pullRequests.tsx";
import type { PrEntry, PrGroups, PrNotice } from "../src/ui/pullRequestsState.ts";
import { byTag, elements, textOf } from "./vnode.ts";

const pr = (patch: Partial<PullRequest> & { number: number }): PullRequest => ({
  title: `change ${patch.number}`,
  url: `https://github.com/acme/alpha-infra/pull/${patch.number}`,
  author: "octo",
  head: "feat/change",
  base: "main",
  draft: false,
  state: "open",
  createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "none",
  mergeable: "mergeable",
  ...patch,
});

const entry = (p: PullRequest, patch: Partial<PrEntry> = {}): PrEntry => ({ pr: p, repoId: "alpha", repoName: "alpha-infra", github: "acme/alpha-infra", alsoIn: [], ...patch });

const render = (groups: PrGroups, showRepo = true) => h(PullRequestList, { groups, showRepo });

test("an entry links to GitHub in a new tab, safely, and shows number, title, author and branch", () => {
  const tree = render({ open: [entry(pr({ number: 42, title: "Add the thing", author: "demo-kit", head: "feat/add-the-thing" }))], closed: [] });
  const link = byTag(tree, "a").find((a) => String(a.props.class).includes("pr-title"));
  expect(link?.props.href).toBe("https://github.com/acme/alpha-infra/pull/42");
  expect(link?.props.target).toBe("_blank");
  expect(link?.props.rel).toBe("noopener noreferrer");
  const text = textOf(tree);
  expect(text).toContain("#42");
  expect(text).toContain("Add the thing");
  expect(text).toContain("demo-kit");
  expect(text).toContain("feat/add-the-thing");
  expect(text).toContain("alpha-infra");
  // Only the repository's own list hides the repository name.
  expect(textOf(render({ open: [entry(pr({ number: 42 }))], closed: [] }, false))).not.toContain("alpha-infra");
});

test("state, review and checks are shown as text with a tooltip, never colour alone", () => {
  const tree = render({ open: [entry(pr({ number: 7, review: "changes_requested", checks: "failing" }))], closed: [] });
  const chips = elements(tree).filter((el) => String(el.props.class ?? "").includes("pr-chip"));
  expect(chips.map((c) => textOf(c.props.children))).toEqual(["Open", "Changes requested", "✕ Checks"]);
  for (const chip of chips) expect(String(chip.props.title).length).toBeGreaterThan(0);

  expect(textOf(render({ open: [entry(pr({ number: 8, draft: true }))], closed: [] }))).toContain("Draft");
  expect(textOf(render({ open: [], closed: [entry(pr({ number: 9, state: "merged", mergedAt: new Date().toISOString() }))] }))).toContain("Merged");
  expect(textOf(render({ open: [], closed: [entry(pr({ number: 10, state: "closed", closedAt: new Date().toISOString() }))] }))).toContain("Closed");
  // Nothing to say about checks or the review decision means no chip at all.
  const plain = elements(render({ open: [entry(pr({ number: 11 }))], closed: [] })).filter((el) => String(el.props.class ?? "").includes("pr-chip"));
  expect(plain).toHaveLength(1);
});

test("a pull request awaiting the user's review is marked, and a shared clone is named", () => {
  const tree = render({ open: [entry(pr({ number: 5, reviewRequestedFromViewer: true }), { alsoIn: ["alpha-infra-2"] })], closed: [] });
  expect(textOf(tree)).toContain("review requested from you");
  const repo = elements(tree).find((el) => String(el.props.class ?? "") === "repo");
  expect(repo?.props.title).toContain("alpha-infra-2");
});

test("the two groups are headed and counted, and an empty group is left out", () => {
  const tree = render({ open: [entry(pr({ number: 1 })), entry(pr({ number: 2 }))], closed: [entry(pr({ number: 3, state: "merged", mergedAt: new Date().toISOString() }))] });
  const headings = byTag(tree, "h2").map((el) => textOf(el.props.children));
  expect(headings).toEqual(["Open2", "Recently merged or closed1"]);
  expect(byTag(render({ open: [entry(pr({ number: 1 }))], closed: [] }), "h2").map((el) => textOf(el.props.children))).toEqual(["Open1"]);
  expect(byTag(render({ open: [], closed: [] }), "h2")).toEqual([]);
});

// ---- readiness on the card and in the header ----

const FETCHED = new Date(Date.now() - 3 * 60_000).toISOString();
const card = (p: PullRequest) => CardPullRequest({ pr: p, repoName: "alpha-infra", fetchedAt: FETCHED });
const readinessOf = (tree: ComponentChildren) => elements(tree).find((el) => String(el.props.class ?? "").includes("card-pr-ready"));

test("every readiness reads as text in its role, never info, with what it waits for and when it was fetched", () => {
  const cases: [Partial<PullRequest>, string, string][] = [
    [{ checks: "passing" }, "ready", "success"],
    [{ checks: "none" }, "ready", "success"],
    [{ checks: "failing" }, "checks failing", "danger"],
    [{ mergeable: "conflicting" }, "conflicts", "warning"],
    [{ checks: "pending" }, "checks running", "branch"],
    [{ mergeable: "unknown" }, "mergeability unknown", "branch"],
  ];
  for (const [patch, word, role] of cases) {
    const tree = card(pr({ number: 125, ...patch }));
    const ready = readinessOf(tree);
    expect(textOf(ready)).toContain(word);
    expect(String(ready?.props.class).split(" ")).toContain(role);
    expect(String(ready?.props.class)).not.toContain("info");
    const link = byTag(tree, "a")[0];
    expect(String(link.props["aria-label"])).toContain(word === "ready" ? ", ready," : `not ready: ${word}`);
    expect(String(link.props.title)).toContain("list fetched 3m ago");
  }
  // A draft's state already says it; merged and closed have no readiness.
  expect(readinessOf(card(pr({ number: 1, draft: true })))).toBeUndefined();
  expect(byTag(card(pr({ number: 1, draft: true })), "a")[0].props["aria-label"]).toContain("not ready: draft");
  expect(readinessOf(card(pr({ number: 2, state: "merged", mergedAt: FETCHED })))).toBeUndefined();
});

const notice = (patch: Partial<PrNotice> & Pick<PrNotice, "repoId" | "kind">): PrNotice => ({
  repoName: patch.repoId,
  status: patch.kind === "failed" ? "failed" : "unavailable",
  hasList: false,
  ...patch,
});

test("a repository that is not on GitHub is a note, not a failure", () => {
  const tree = h(Notices, { notices: [notice({ repoId: "quill-docs", kind: "not-on-github", reason: "not on GitHub" })] });
  const details = byTag(tree, "details");
  expect(details).toHaveLength(1);
  expect(String(details[0].props.class)).not.toContain("warn");
  expect(textOf(details[0])).toContain("1 repository isn't on GitHub");
  expect(textOf(details[0])).toContain("quill-docs");
  expect(textOf(tree)).not.toContain("could not be listed");
  expect(textOf(tree)).not.toContain("failed");
});

test("not on GitHub and failed repositories get one summary each, listing only their own", () => {
  const tree = h(Notices, {
    notices: [
      notice({ repoId: "plain-notes", kind: "not-on-github", reason: "not a git repository" }),
      notice({ repoId: "quill-docs", kind: "not-on-github", reason: "not on GitHub" }),
      notice({ repoId: "alpha-infra", kind: "failed", reason: "gh timed out", hasList: true }),
    ],
  });
  const [info, failed] = byTag(tree, "details");
  expect(textOf(byTag(info, "summary")[0])).toBe("2 repositories aren't on GitHub");
  expect(textOf(info)).toContain("not a git repository");
  expect(textOf(info)).not.toContain("alpha-infra");
  expect(String(failed.props.class)).toContain("warn");
  expect(textOf(byTag(failed, "summary")[0])).toBe("⚠ 1 repository could not be listed");
  expect(textOf(failed)).toContain("gh timed out");
  expect(textOf(failed)).toContain("showing the last list that was fetched");
  expect(textOf(failed)).not.toContain("quill-docs");
});

test("no notices, no summary", () => {
  expect(byTag(h(Notices, { notices: [] }), "details")).toHaveLength(0);
});
