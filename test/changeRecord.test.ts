// A change's record of its pull requests' branches in `.openspec.yaml` (spec-frameworks: "OpenSpec changes record their
// pull request's branch in `.openspec.yaml`"): parsing, the bundled library's tolerance of it, and the record instruction.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readChangeMetadata } from "../node_modules/@fission-ai/openspec/dist/utils/change-metadata.js";
import { parseMarker } from "../src/server/frameworks/openspec/marker.ts";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import { tempDir } from "./helpers.ts";

const BASE = "schema: spec-driven\ncreated: 2026-10-24\n";

test("a full record: the branch is read, schema and creation date as before", () => {
  const marker = parseMarker(`${BASE}spec-control:\n  branch: fix/rotate-keys\n`);
  expect(marker).toEqual({ schema: "spec-driven", created: "2026-10-24", skipSpecs: false, recorded: { branch: "fix/rotate-keys" }, warnings: [] });
});

test("both branches, quotes, comments and the end of the block", () => {
  const text = [
    "schema: spec-driven",
    "spec-control: # Spec Control's record",
    "  branch: \"feat/rotate-keys\" # implementation",
    "",
    "  # a comment line does not end the map",
    "  archive-branch: 'chore/archive-rotate-keys'",
    "created: 2026-10-20",
    "  branch: fix/not-in-the-map",
  ].join("\n");
  const marker = parseMarker(text);
  expect(marker.recorded).toEqual({ branch: "feat/rotate-keys", archiveBranch: "chore/archive-rotate-keys" });
  expect(marker.created).toBe("2026-10-20");
  expect(marker.warnings).toEqual([]);
  expect(parseMarker("schema: spec-driven\r\nspec-control:\r\n    branch: fix/rotate-keys\r\n").recorded).toEqual({ branch: "fix/rotate-keys" });
});

test("malformed values are dropped with a warning; the rest is read as before", () => {
  const marker = parseMarker(`${BASE}spec-control:\n  branch: -x\n  archive-branch: chore//archive\n`);
  expect(marker.recorded).toBeUndefined();
  expect(marker.warnings).toHaveLength(2);
  expect(marker.schema).toBe("spec-driven");
  expect(marker.created).toBe("2026-10-24");
  for (const bad of ["/x", ".x", "x/", "x.lock", "a..b", "a b", "a@{1}", "x".repeat(201), "feat/ä"]) {
    expect([bad, parseMarker(`spec-control:\n  branch: "${bad}"\n`).recorded]).toEqual([bad, undefined]);
  }
  for (const good of ["feat/rotate-keys", "x", "release/1.2_x", "x".repeat(200)]) {
    expect(parseMarker(`spec-control:\n  branch: ${good}\n`).recorded).toEqual({ branch: good });
  }
});

test("unknown keys, inside the map and at the top level, are ignored", () => {
  const marker = parseMarker(`${BASE}goal: rotate keys\nspec-control:\n  pr: 142\n  branch: fix/rotate-keys\n  reviewer: someone\n`);
  expect(marker.recorded).toEqual({ branch: "fix/rotate-keys" });
  expect(marker.warnings).toEqual([]);
});

test("no map, an empty or null value, an inline value and a tab-indented line record nothing", () => {
  for (const text of [BASE, `${BASE}spec-control:\n`, `${BASE}spec-control:\n  branch:\n  archive-branch: ~\n`, `${BASE}spec-control: {}\n  branch: x\n`, `${BASE}spec-control:\n\tbranch: x\n`, `${BASE}  spec-control:\n    branch: x\n`]) {
    const { recorded, warnings } = parseMarker(text);
    expect([text, recorded, warnings]).toEqual([text, undefined, []]);
  }
  // A nested map below another entry is not the record's.
  expect(parseMarker(`spec-control:\n  other:\n    branch: x\n  branch: y\n`).recorded).toEqual({ branch: "y" });
  expect(parseMarker(undefined)).toEqual({ skipSpecs: false, warnings: [] });
});

let dir: string;
beforeAll(async () => {
  dir = await tempDir();
});
afterAll(() => rm(dir, { recursive: true, force: true }));

test("the recorded branches come from the spec-control block only", () => {
  const text = "schema: spec-driven\ncreated: 2026-06-10\nspec-control:\n  branch: fix/rotate-keys # the agent's\n  archive-branch: 'chore/archive-rotate-keys'\n  pr: 12\nother:\n  branch: nope\n";
  expect(parseMarker(text).recorded).toEqual({ branch: "fix/rotate-keys", archiveBranch: "chore/archive-rotate-keys" });
  expect(parseMarker("schema: spec-driven\n").recorded).toBeUndefined();
  expect(parseMarker("spec-control:\n  branch: ../etc\n").recorded).toBeUndefined();
});

test("the module's change metadata reads a git ref's text as the checkout parser does", () => {
  const metadata = openSpec.changeMetadata;
  expect(metadata.file).toBe(".openspec.yaml");
  expect(metadata.parse(`${BASE}spec-control:\n  branch: fix/rotate-keys\n`)).toEqual({ created: "2026-10-24", recorded: { branch: "fix/rotate-keys" } });
  // A tab-indented entry, which stale detection used to read as a branch, records nothing — as in a checkout.
  expect(metadata.parse(`${BASE}spec-control:\n\tbranch: fix/rotate-keys\n`)).toEqual({ created: "2026-10-24" });
  expect(parseMarker(`${BASE}spec-control:\n\tbranch: fix/rotate-keys\n`).recorded).toBeUndefined();
  expect(metadata.parse("schema: spec-driven\n")).toEqual({});
});

test("the bundled OpenSpec library accepts a marker with the map and reads the same schema", async () => {
  const plain = join(dir, "plain");
  const recorded = join(dir, "recorded");
  for (const [d, text] of [
    [plain, BASE],
    [recorded, `${BASE}spec-control:\n  branch: fix/rotate-keys\n  archive-branch: chore/archive-rotate-keys\n`],
  ] as const) {
    await Bun.write(join(d, ".openspec.yaml"), text);
  }
  const without = readChangeMetadata(plain);
  const withMap = readChangeMetadata(recorded);
  expect(withMap?.schema).toBe("spec-driven");
  expect(withMap?.schema).toBe(without?.schema);
  expect(withMap?.created).toBe(without?.created);
});

test("the bundled OpenSpec library rewrites a marker only when it creates the change", async () => {
  // `writeChangeMetadata` drops keys it does not know. That is safe only while its one caller is `createChange`, which
  // runs before any record exists; a library upgrade that calls it anywhere else must fail here.
  const dist = join(import.meta.dir, "..", "node_modules", "@fission-ai", "openspec", "dist");
  const callers: string[] = [];
  for (const file of await readdir(dist, { recursive: true })) {
    if (!file.endsWith(".js")) continue;
    const text = await readFile(join(dist, file), "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (!/\bwriteChangeMetadata\(/.test(line) || /export (async )?function writeChangeMetadata\(/.test(line)) continue;
      const before = text.split("\n").slice(0, i).reverse();
      callers.push(`${file}:${before.find((l) => /^(export )?(async )?function /.test(l))?.match(/function (\w+)/)?.[1]}`);
    }
  }
  expect(callers).toEqual([join("utils", "change-utils.js:createChange")]);
});

test("the record instruction names the key, both paths, the map's shape and the one commit", () => {
  const implement = openSpec.recordInstruction({ change: "rotate-keys", archive: false });
  const archive = openSpec.recordInstruction({ change: "rotate-keys", archive: true });
  for (const text of [implement, archive]) {
    expect(text).toContain("openspec/changes/rotate-keys/.openspec.yaml");
    expect(text).toContain("openspec/changes/archive/<date>-rotate-keys/.openspec.yaml");
    expect(text).toContain("under the top-level key spec-control:");
    expect(text).toContain("indented two spaces");
    expect(text).toContain("Commit it with your work before you push");
    expect(text).toContain("add no pull request number and no later commit");
    expect(text).toContain("Change nothing else in the file.");
    expect(text).toContain("unless it already says so");
    expect(text).not.toContain("\n");
    // Short enough to be typed into a terminal after Ship's prompt and the auto-merge instruction (macOS: 1024 bytes a line).
    expect(text.length).toBeLessThan(420);
  }
  expect(implement).toContain("set branch: <the branch you push>");
  expect(implement).not.toContain("archive-branch");
  expect(archive).toContain("set archive-branch: <the branch you push>");
  expect(() => openSpec.recordInstruction({ change: "../x", archive: false })).toThrow();
});
