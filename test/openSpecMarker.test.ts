import { describe, expect, test } from "bun:test";
import { parseMarker, setRecordedBranchInMarker } from "../src/server/frameworks/openspec/marker.ts";

describe("setRecordedBranchInMarker", () => {
  const BASE = "schema: spec-driven\ncreated: 2026-10-24\n";

  test("fresh files: sets branch under spec-control when none existed", () => {
    const updated = setRecordedBranchInMarker(BASE, "branch", "feat/rotate-keys");
    expect(updated).toBe(`${BASE}spec-control:\n  branch: feat/rotate-keys\n`);
    const marker = parseMarker(updated);
    expect(marker.recorded).toEqual({ branch: "feat/rotate-keys" });
    expect(marker.schema).toBe("spec-driven");
    expect(marker.created).toBe("2026-10-24");
  });

  test("fresh files: sets archive-branch under spec-control when none existed", () => {
    const updated = setRecordedBranchInMarker(BASE, "archive-branch", "chore/archive-rotate-keys");
    expect(updated).toBe(`${BASE}spec-control:\n  archive-branch: chore/archive-rotate-keys\n`);
    const marker = parseMarker(updated);
    expect(marker.recorded).toEqual({ archiveBranch: "chore/archive-rotate-keys" });
  });

  test("empty file: creates spec-control with branch", () => {
    const updated = setRecordedBranchInMarker("", "branch", "feat/my-change");
    expect(updated).toBe("spec-control:\n  branch: feat/my-change\n");
    expect(parseMarker(updated).recorded).toEqual({ branch: "feat/my-change" });
  });

  test("existing maps: preserves existing keys, other branch entry, comments, and top-level keys", () => {
    const initial = [
      "# top comment",
      "schema: spec-driven",
      "spec-control: # Spec Control record",
      "  branch: feat/rotate-keys # original branch",
      "  pr: 142",
      "",
      "created: 2026-10-20",
    ].join("\n") + "\n";

    const withArchive = setRecordedBranchInMarker(initial, "archive-branch", "chore/archive-rotate-keys");
    const marker = parseMarker(withArchive);
    expect(marker.recorded).toEqual({
      branch: "feat/rotate-keys",
      archiveBranch: "chore/archive-rotate-keys",
    });
    expect(withArchive).toContain("# top comment");
    expect(withArchive).toContain("branch: feat/rotate-keys # original branch");
    expect(withArchive).toContain("archive-branch: chore/archive-rotate-keys");
    expect(withArchive).toContain("pr: 142");
    expect(withArchive).toContain("created: 2026-10-20");

    // Updating branch replaces existing branch line while preserving other fields and comments
    const updatedBranch = setRecordedBranchInMarker(withArchive, "branch", "feat/new-keys");
    expect(updatedBranch).toContain("  branch: feat/new-keys");
    expect(updatedBranch).toContain("archive-branch: chore/archive-rotate-keys");
    expect(updatedBranch).toContain("pr: 142");
    expect(updatedBranch).toContain("created: 2026-10-20");
    const markerUpdated = parseMarker(updatedBranch);
    expect(markerUpdated.recorded).toEqual({
      branch: "feat/new-keys",
      archiveBranch: "chore/archive-rotate-keys",
    });
  });

  test("idempotent updates: leaves text byte-for-byte unchanged when value already matches", () => {
    const text = `${BASE}spec-control:\n  branch: feat/rotate-keys\n`;
    expect(setRecordedBranchInMarker(text, "branch", "feat/rotate-keys")).toBe(text);

    const quotedText = `${BASE}spec-control:\n  branch: "feat/rotate-keys" # comment\n`;
    expect(setRecordedBranchInMarker(quotedText, "branch", "feat/rotate-keys")).toBe(quotedText);

    const archiveText = `${BASE}spec-control:\n  branch: feat/rotate-keys\n  archive-branch: 'chore/archive-rotate-keys'\n`;
    expect(setRecordedBranchInMarker(archiveText, "archive-branch", "chore/archive-rotate-keys")).toBe(archiveText);
  });

  test("preserves Windows CRLF line endings", () => {
    const text = "schema: spec-driven\r\ncreated: 2026-10-24\r\n";
    const updated = setRecordedBranchInMarker(text, "branch", "feat/crlf");
    expect(updated).toBe("schema: spec-driven\r\ncreated: 2026-10-24\r\nspec-control:\r\n  branch: feat/crlf\r\n");
  });

  test("malformed inputs: throws on invalid branch names", () => {
    const badBranches = ["-bad", "/bad", ".bad", "bad/", "bad.lock", "a..b", "a b", "a//b", "x".repeat(201), ""];
    for (const bad of badBranches) {
      expect(() => setRecordedBranchInMarker(BASE, "branch", bad)).toThrow();
    }
  });

  test("malformed inputs: throws on invalid key", () => {
    expect(() => setRecordedBranchInMarker(BASE, "invalid" as any, "feat/valid")).toThrow();
  });
});
