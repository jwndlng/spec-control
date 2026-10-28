import { expect, test } from "bun:test";
import { isGithubRepo, issueChangeName, issueRef, issueUrl, toSourceIssue } from "../src/shared/issues.ts";
import { CHANGE_NAME_PATTERN } from "../src/shared/types.ts";
import { isNewChangeName } from "../src/shared/changeNames.ts";

test("issueChangeName follows the spec's examples", () => {
  expect(issueChangeName("Retry webhook delivery on 5xx (again!)", 42)).toBe("retry-webhook-delivery-on-5xx-again");
  expect(issueChangeName("???", 7)).toBe("issue-7");
  expect(issueChangeName("", 8)).toBe("issue-8");
  expect(issueChangeName("  Ünïcödé — only?  ", 9)).toBe("n-c-d-only");
  expect(issueChangeName("日本語", 10)).toBe("issue-10");
});

test("issueChangeName steps around the reserved archive root", () => {
  expect(issueChangeName("Archive", 12)).toBe("archive-12");
  expect(issueChangeName("ARCHIVE!", 13)).toBe("archive-13");
  expect(issueChangeName("Archive old boards", 14)).toBe("archive-old-boards");
});

test("issueChangeName cuts long titles at a hyphen, to at most 48 characters", () => {
  const name = issueChangeName("Make the dashboard remember the last opened board across restarts and machines", 1);
  expect(name).toBe("make-the-dashboard-remember-the-last-opened");
  expect(name.length).toBeLessThanOrEqual(48);
  const unbroken = issueChangeName("x".repeat(80), 2);
  expect(unbroken).toBe("x".repeat(48));
});

test("every proposed name is a valid change name", () => {
  for (const title of ["a/b\\c", "..", "-lead-", "UPPER case", "a".repeat(200), "tab\tand\nnewline", "x-".repeat(40)]) {
    const name = issueChangeName(title, 3);
    expect([title, isNewChangeName(name) && CHANGE_NAME_PATTERN.test(name) && name.length <= 48 && !name.startsWith("-") && !name.endsWith("-")]).toEqual([title, true]);
  }
});

test("issueUrl and issueRef are always built from owner/name and the number", () => {
  expect(issueUrl({ github: "acme/alpha-infra", number: 42 })).toBe("https://github.com/acme/alpha-infra/issues/42");
  expect(issueRef({ github: "acme/alpha-infra", number: 42 })).toBe("acme/alpha-infra#42");
});

test("toSourceIssue accepts only a well-formed owner/name and a positive integer", () => {
  expect(toSourceIssue({ github: "acme/alpha-infra", number: 42, title: "T", url: "https://evil.example.test" })).toEqual({ github: "acme/alpha-infra", number: 42, title: "T" });
  for (const raw of [null, [], "x", { github: "acme/alpha-infra" }, { github: "acme/alpha-infra", number: 0 }, { github: "acme/alpha-infra", number: "4" }, { github: "../etc", number: 1 }, { github: "acme/a/b", number: 1 }, { github: "acme/..", number: 1 }, { github: "https://github.com/acme/x", number: 1 }]) {
    expect(toSourceIssue(raw)).toBeUndefined();
  }
  expect(isGithubRepo("acme/alpha.infra_2")).toBe(true);
  expect(toSourceIssue({ github: "acme/alpha-infra", number: 1, title: "x".repeat(300) })?.title?.length).toBe(256);
});
