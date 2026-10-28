import { expect, test } from "bun:test";
import { isChangeDirName, isNewChangeName, newChangeNameProblem } from "../src/shared/changeNames.ts";

test("a new name may not be the archive root, in any letter case", () => {
  for (const name of ["archive", "Archive", "ARCHIVE"]) expect([name, newChangeNameProblem(name)]).toEqual([name, "archive is reserved for archived changes"]);
});

test("a new name may not start with . or -", () => {
  for (const name of [".", "..", ".git", ".hidden", "-wip"]) expect([name, newChangeNameProblem(name)]).toEqual([name, "must not start with . or -"]);
});

test("a new name must work as a git branch component", () => {
  expect(newChangeNameProblem("a..b")).toBe("must not contain ..");
  expect(newChangeNameProblem("x.")).toBe("must not end in .");
  expect(newChangeNameProblem("notes.")).toBe("must not end in .");
  expect(newChangeNameProblem("x.lock")).toBe("must not end in .lock");
});

test("a new name is at most 128 characters", () => {
  expect(newChangeNameProblem("a".repeat(128))).toBeNull();
  expect(newChangeNameProblem("a".repeat(129))).toBe("at most 128 characters");
});

test("an empty name or one with other characters keeps its old reason", () => {
  expect(newChangeNameProblem("")).toBe("required");
  expect(newChangeNameProblem("foo/bar")).toBe("only letters, digits, dots, dashes and underscores");
});

test("ordinary names are accepted", () => {
  for (const name of ["add-audit-trail", "v1.2-notes", "archive-12", "my_change", "x.lock-free"]) {
    expect([name, newChangeNameProblem(name), isNewChangeName(name)]).toEqual([name, null, true]);
  }
  expect(isNewChangeName(42)).toBe(false);
});

test("an existing directory only needs to be safe: `.draft` and `-wip` may be acted on, the archive root may not", () => {
  for (const name of [".draft", "-wip", "a..b", "x.lock", "add-audit-trail", "a".repeat(200)]) expect([name, isChangeDirName(name)]).toEqual([name, true]);
  for (const name of ["archive", "Archive", ".", "..", "", "a/b", "../x"]) expect([name, isChangeDirName(name)]).toEqual([name, false]);
  expect(isChangeDirName(undefined)).toBe(false);
});
