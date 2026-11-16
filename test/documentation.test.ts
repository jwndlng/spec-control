import { expect, test } from "bun:test";
import { documentationOnly, isDocumentationPath } from "../src/shared/documentation.ts";
import { parseDocsOnly } from "../src/server/pullRequests.ts";

test("classifies documented paths and rejects executable or operational files", () => {
  for (const path of ["openspec/changes/demo/tasks.md", "openspec/changes/demo/.openspec.yaml", "docs/guide.rst", "README.md", "notes/decision.markdown"])
    expect(isDocumentationPath(path)).toBe(true);
  for (const path of ["docs/build.sh", ".github/workflows/docs.yml", "openspec/script.ts", "docs/package.json", "src/app.ts", "../README.md", "/README.md", "docs\\guide.md", ".gitmodules"])
    expect(isDocumentationPath(path)).toBe(false);
});

test("requires a complete nonempty diff and rejects links and submodules", () => {
  expect(documentationOnly({ paths: ["README.md"], complete: true })).toBe(true);
  expect(documentationOnly({ paths: [], complete: true })).toBe(false);
  expect(documentationOnly({ paths: ["README.md"], complete: false })).toBe(false);
  expect(documentationOnly({ paths: ["docs/readme.md"], complete: true, containsLinkOrSubmodule: true })).toBe(false);
});

test("GitHub docs-only parsing checks every path and refuses incomplete or malformed entries", () => {
  expect(parseDocsOnly({ changedFiles: 2, files: [{ path: "README.md" }, { path: "docs/guide.md" }] })).toBe(true);
  expect(parseDocsOnly({ changedFiles: 2, files: [{ path: "docs/guide.md", previousFilename: "src/guide.ts" }, { path: "README.md" }] })).toBe(false);
  expect(parseDocsOnly({ changedFiles: 2, files: [{ path: "README.md" }] })).toBe(false);
  expect(parseDocsOnly({ changedFiles: 1, files: [{ path: "docs/ln.md", mode: "120000" }] })).toBe(false);
});
