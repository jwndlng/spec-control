import { afterEach, expect, test } from "bun:test";
import { ApiError, type Api, httpApi, setApi } from "../src/ui/api.ts";
import { filterIssues, importedIssues, importIssues, issuePrompt, nameProblem, rowProblems } from "../src/ui/importIssuesState.ts";
import { issueChangeName } from "../src/shared/issues.ts";
import type { ChangeIssueRef, GithubIssue } from "../src/shared/types.ts";

afterEach(() => setApi(httpApi));

const issue = (number: number, title: string, labels: string[] = [], body = ""): GithubIssue => ({
  number,
  title,
  body,
  url: `https://github.com/acme/alpha-infra/issues/${number}`,
  author: "octo",
  labels,
  createdAt: "2026-09-01T00:00:00Z",
});

test("the filter matches number, title and labels, ignoring case, and starts nothing", () => {
  const list = [issue(12, "Export TIMEOUT on large accounts"), issue(15, "Docs typo", ["timeout-related"]), issue(120, "Other")];
  expect(filterIssues(list, "timeout").map((i) => i.number)).toEqual([12, 15]);
  expect(filterIssues(list, "#12").map((i) => i.number)).toEqual([12, 120]);
  expect(filterIssues(list, "  ")).toHaveLength(3);
});

test("an issue is imported when an active or archived change of the same GitHub repository came from it", () => {
  const changes = [
    { name: "retry-webhooks", sourceIssue: { github: "acme/alpha-infra", number: 42 } },
    { name: "elsewhere", sourceIssue: { github: "acme/beta-soc", number: 7 } },
    { name: "plain" },
  ];
  const imported = importedIssues(changes, "Acme/Alpha-Infra");
  expect([...imported]).toEqual([[42, "retry-webhooks"]]);
  expect(importedIssues(changes, undefined).size).toBe(0);
});

test("names: the New change rule, taken by an existing change, or used by another checked issue", () => {
  const taken = new Set(["add-audit-trail"]);
  expect(nameProblem("", taken, [])).toBe("required");
  expect(nameProblem("foo/bar", taken, [])).toContain("only letters");
  expect(nameProblem("add-audit-trail", taken, [])).toContain("exists already");
  expect(nameProblem("fine", taken, ["fine"])).toContain("another checked issue");
  expect(nameProblem("fine", taken, ["other"])).toBeNull();
  expect(nameProblem("archive", taken, [])).toBe("archive is reserved for archived changes");
  expect(nameProblem("-wip", taken, [])).toBe("must not start with . or -");
  const rows = [
    { issue: issue(1, "Same"), name: issueChangeName("Same", 1) },
    { issue: issue(2, "same!"), name: issueChangeName("same!", 2) },
    { issue: issue(3, "Different"), name: "different" },
  ];
  expect(rowProblems(rows, taken)).toEqual(["another checked issue uses this name", "another checked issue uses this name", null]);
});

test("the prompt holds the title, the issue reference with its link, and the body as written", () => {
  const text = issuePrompt(issue(42, "Retry webhook delivery", [], "Deliveries fail on 503.\n\n- twice"), "acme/alpha-infra");
  expect(text).toBe("## Retry webhook delivery\n\nImported from acme/alpha-infra#42 — https://github.com/acme/alpha-infra/issues/42\n\nDeliveries fail on 503.\n\n- twice");
  expect(issuePrompt(issue(7, "  ", [], ""), "acme/alpha-infra")).toBe("## Issue #7\n\nImported from acme/alpha-infra#7 — https://github.com/acme/alpha-infra/issues/7");
});

function fakeApi(refuse: Record<string, ApiError> = {}, scanStarts = true) {
  const calls: { name: string; prompt?: string; issue?: ChangeIssueRef }[] = [];
  let scans = 0;
  let inFlight = 0;
  setApi({
    ...httpApi,
    createChange: async (_repoId, name, prompt, _dependsOn, issueRef) => {
      inFlight++;
      expect(inFlight).toBe(1);
      calls.push({ name, prompt, issue: issueRef });
      await Promise.resolve();
      inFlight--;
      if (refuse[name]) throw refuse[name];
      return { name, staged: true };
    },
    scan: async () => {
      scans++;
      return { started: scanStarts };
    },
  } satisfies Api);
  return { calls, scans: () => scans };
}

test("importing sends one create per issue, in order and one at a time, carrying the issue, then one scan", async () => {
  const fake = fakeApi();
  const progress: number[] = [];
  const results = await importIssues("a", "acme/alpha-infra", [
    { issue: issue(12, "Export timeout"), name: "export-timeout" },
    { issue: issue(15, "Docs"), name: " docs " },
  ], (n) => progress.push(n));
  expect(fake.calls.map((c) => [c.name, c.issue])).toEqual([
    ["export-timeout", { number: 12, title: "Export timeout" }],
    ["docs", { number: 15, title: "Docs" }],
  ]);
  expect(fake.calls[0].prompt).toContain("acme/alpha-infra#12");
  expect(progress).toEqual([12, 15]);
  expect(results).toEqual([
    { number: 12, name: "export-timeout", ok: true, staged: true },
    { number: 15, name: "docs", ok: true, staged: true },
  ]);
  expect(fake.scans()).toBe(1);
});

test("a refused import is that issue's result and does not stop the others", async () => {
  const fake = fakeApi({ "export-timeout": new ApiError(409, 'a change named "export-timeout" already exists') });
  const results = await importIssues("a", "acme/alpha-infra", [
    { issue: issue(12, "Export timeout"), name: "export-timeout" },
    { issue: issue(15, "Docs"), name: "docs" },
  ]);
  expect(fake.calls).toHaveLength(2);
  expect(results[0]).toEqual({ number: 12, name: "export-timeout", ok: false, message: 'a change named "export-timeout" already exists' });
  expect(results[1].ok).toBe(true);
});

test("one scan after the imports, also when a scan was already running", async () => {
  const fake = fakeApi({}, false);
  await importIssues("a", "acme/alpha-infra", [
    { issue: issue(12, "Export timeout"), name: "export-timeout" },
    { issue: issue(15, "Docs"), name: "docs" },
  ]);
  expect(fake.scans()).toBe(1);
});

test("nothing created, no scan asked for", async () => {
  const fake = fakeApi({ x: new ApiError(409, "taken") });
  await importIssues("a", "acme/alpha-infra", [{ issue: issue(1, "X"), name: "x" }]);
  expect(fake.scans()).toBe(0);
});
