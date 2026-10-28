import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, lstat, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { readProjectConfig } from "../node_modules/@fission-ai/openspec/dist/core/project-config.js";
import { newRepoConfig } from "../src/server/config.ts";
import {
  applyShared,
  applyTo,
  CHANGED_SINCE_PREVIEW,
  contextBegin,
  contextEnd,
  FORMER_MARKER,
  loadSharedConfig,
  MARKER,
  MAX_CONTEXT_BYTES,
  previewFor,
  repoSharedConfig,
  resolveProfiles,
  ruleComment,
  SharedConfigValidationError,
  saveSharedConfig,
  validateSharedConfig,
} from "../src/server/sharedConfig.ts";
import type { RepoConfig, SharedConfig, SharedProfile } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";

// What `openspec init` writes: both keys exist only as commented examples.
const SCAFFOLD = `schema: spec-driven

# Project context (optional)
# This is shown to AI when creating artifacts.
# Example:
#   context: |
#     Tech stack: TypeScript, React, Node.js

# Per-artifact rules (optional)
# Example:
#   rules:
#     proposal:
#       - Keep proposals under 500 words
`;
const WITH_LOCAL = `schema: spec-driven

# our own notes
context: |
  Tech stack: Go.
  Domain: alert triage.

rules:
  proposal:
    - Mention the on-call impact # keep this
  design:
    - Include a rollback section
`;
const QUOTED = `schema: spec-driven\ncontext: "One line of local context."\n`;
const UNKNOWN_KEYS = `# top comment\nschema: spec-driven\nprofile: strict # trailing\nguidance:\n  apply:\n    - run the linter\n`;
const FIXTURES = { SCAFFOLD, WITH_LOCAL, QUOTED, UNKNOWN_KEYS };

const BASE: SharedProfile = { id: "base", name: "Base", context: "We use conventional commits.\nSpecs use SHALL.", rules: { proposal: ["Always include Non-goals"], tasks: ["Max 2h per task"] } };
const SECURITY: SharedProfile = { id: "security", name: "Security", context: "Threat-model every new endpoint.", rules: { proposal: ["State the data classification"], design: ["List trust boundaries"] } };
const RULES_ONLY: SharedProfile = { id: "style", name: "Style", context: "", rules: { specs: ["One scenario per behaviour"] } };
const SHARED: SharedConfig = { profiles: [BASE, SECURITY, RULES_ONLY] };

const readBack = (text: string): { context?: string; rules?: Record<string, string[]> } => parse(text) ?? {};
const states = (text: string | undefined, shared = SHARED) => repoSharedConfig(text, shared);

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(() => cleanup());

test("validation: profile ids, names, shapes; marker text and multi-line rules are refused", () => {
  expect(validateSharedConfig({ profiles: [{ id: "base", name: " Base ", context: "  x  ", rules: { proposal: [" a "], design: [] } }] })).toEqual({ profiles: [{ id: "base", name: "Base", context: "x", rules: { proposal: ["a"] } }] });
  expect(validateSharedConfig({ profiles: [] })).toEqual({ profiles: [] });
  const ok = { id: "base", name: "Base", context: "", rules: {} };
  for (const bad of [{}, { profiles: {} }, { profiles: [{ ...ok, id: "Bad Id" }] }, { profiles: [{ ...ok, id: "../x" }] }, { profiles: [ok, ok] }, { profiles: [{ ...ok, name: " " }] }, { profiles: [{ ...ok, context: 1 }] }, { profiles: [{ ...ok, context: `x ${MARKER}:end base` }] }, { profiles: [{ ...ok, rules: [] }] }, { profiles: [{ ...ok, rules: { "../x": ["a"] } }] }, { profiles: [{ ...ok, rules: { proposal: [""] } }] }, { profiles: [{ ...ok, rules: { proposal: ["two\nlines"] } }] }]) {
    expect(() => validateSharedConfig(bad)).toThrow(SharedConfigValidationError);
  }
});

test("storage: nothing saved reads as undefined, save round-trips in the dashboard home", async () => {
  expect(await loadSharedConfig()).toBeUndefined();
  expect(await saveSharedConfig(SHARED)).toEqual(SHARED);
  expect(await loadSharedConfig()).toEqual(SHARED);
  await expect(saveSharedConfig({ profiles: [{ ...BASE, id: "Not A Slug" }] })).rejects.toThrow();
  expect(await loadSharedConfig()).toEqual(SHARED);
});

test("apply keeps every other key and every comment", () => {
  for (const [name, original] of Object.entries(FIXTURES)) {
    const applied = applyShared(original, [BASE, SECURITY]);
    for (const line of original.split("\n").filter((l) => l.trim() !== "" && !/^context:/.test(l))) expect([name, applied.split("\n").includes(line), line]).toEqual([name, true, line]);
  }
  const applied = applyShared(UNKNOWN_KEYS, [BASE]);
  for (const kept of ["# top comment", "profile: strict # trailing", "    - run the linter"]) expect(applied).toContain(kept);
});

test("apply is idempotent and removing everything restores the original bytes", () => {
  for (const [name, original] of Object.entries(FIXTURES)) {
    const once = applyShared(original, [BASE, SECURITY, RULES_ONLY]);
    expect([name, once === original]).toEqual([name, false]);
    expect([name, applyShared(once, [BASE, SECURITY, RULES_ONLY]) === once]).toEqual([name, true]);
    const removed = applyShared(once, []);
    // a quoted one-line context comes back as a literal block: same value, different spelling — the one documented exception
    if (name === "QUOTED") expect(readBack(removed).context?.trim()).toBe("One line of local context.");
    else expect([name, removed]).toEqual([name, original]);
  }
});

// Sections written before the rename carry the former prefix in every marker; the pre-rename notice text named it too.
const toFormer = (text: string) => text.replaceAll(MARKER, FORMER_MARKER).replaceAll("managed by spec-control", "managed by openspec-dashboard");

test("markers are written with the spec-control prefix", () => {
  const applied = applyShared(WITH_LOCAL, [BASE]);
  expect(MARKER).toBe("spec-control:shared");
  expect(applied).toContain("<!-- spec-control:shared:begin base — managed by spec-control, edits here are overwritten -->");
  expect(applied).toContain("<!-- spec-control:shared:end base -->");
  expect(applied).toContain("# spec-control:shared:base");
  expect(applied).not.toContain("openspec-dashboard");
});

test("former markers are still recognised: in sync, outdated and orphaned as before", () => {
  const former = toFormer(applyShared(WITH_LOCAL, [BASE, SECURITY]));
  expect(former).toContain(`${FORMER_MARKER}:begin base`);
  expect(former).not.toContain(MARKER);
  expect(states(former)).toEqual({ unreadable: false, applied: [{ id: "base", state: "in-sync" }, { id: "security", state: "in-sync" }] });
  expect(states(former, { profiles: [{ ...BASE, context: "changed" }] })).toEqual({ unreadable: false, applied: [{ id: "base", state: "outdated" }, { id: "security", state: "orphaned" }] });
});

test("applying again moves every kept section to the new prefix and changes nothing else", () => {
  const current = applyShared(WITH_LOCAL, [BASE, SECURITY]);
  const former = toFormer(current);
  // In sync, but not `unchanged`: the marker lines are the difference the preview shows.
  expect(applyShared(former, [BASE, SECURITY])).toBe(current);
  expect(applyShared(applyShared(former, [BASE, SECURITY]), [BASE, SECURITY])).toBe(current);
  // Detaching from a former-prefix file removes its sections just the same.
  expect(applyShared(former, [])).toBe(WITH_LOCAL);
});

test("a block opened with one prefix and closed with the other is malformed", () => {
  const current = applyShared(WITH_LOCAL, [BASE]);
  const mixed = current.replace(`${MARKER}:end base`, `${FORMER_MARKER}:end base`);
  expect(states(mixed).unreadable).toBe(true);
  expect(() => applyShared(mixed, [BASE])).toThrow();
  // A rule marked with the former prefix next to a current block is fine: each marker is whole on its own.
  const rulesFormer = current.replace(`# ${MARKER}:base`, `# ${FORMER_MARKER}:base`);
  expect(states(rulesFormer)).toEqual({ unreadable: false, applied: [{ id: "base", state: "in-sync" }] });
});

test("a profile context may contain neither marker", () => {
  const ok = { id: "base", name: "Base", context: "", rules: {} };
  for (const marker of [MARKER, FORMER_MARKER]) expect(() => validateSharedConfig({ profiles: [{ ...ok, context: `see ${marker}` }] })).toThrow(SharedConfigValidationError);
});

test("stacked profiles: one block each in dashboard order, then the project's own content with its comments", () => {
  const applied = applyShared(WITH_LOCAL, [BASE, SECURITY, RULES_ONLY]);
  const parsed = readBack(applied);
  expect(parsed.context).toBe(
    `${contextBegin("base")}\nWe use conventional commits.\nSpecs use SHALL.\n${contextEnd("base")}\n\n${contextBegin("security")}\nThreat-model every new endpoint.\n${contextEnd("security")}\n\nTech stack: Go.\nDomain: alert triage.\n`,
  );
  expect(parsed.rules).toEqual({
    proposal: ["Always include Non-goals", "State the data classification", "Mention the on-call impact"],
    design: ["List trust boundaries", "Include a rollback section"],
    tasks: ["Max 2h per task"],
    specs: ["One scenario per behaviour"],
  });
  expect(applied).toContain("- Mention the on-call impact # keep this");
  expect(applied).toContain(`- Always include Non-goals # ${ruleComment("base")}`);
  expect(applied).toContain(`- State the data classification # ${ruleComment("security")}`);
  expect(applied).toContain("# our own notes");
  expect(applied).toMatch(/^context: \|/m);
  expect(states(applied).applied).toEqual([{ id: "base", state: "in-sync" }, { id: "security", state: "in-sync" }, { id: "style", state: "in-sync" }]);
});

test("detaching one profile removes only its sections; different repositories can carry different sets", () => {
  const both = applyShared(WITH_LOCAL, [BASE, SECURITY]);
  const onlySecurity = applyShared(both, [SECURITY]);
  expect(onlySecurity).toBe(applyShared(WITH_LOCAL, [SECURITY]));
  expect(onlySecurity).not.toContain("conventional commits");
  expect(readBack(onlySecurity).rules).toEqual({ proposal: ["State the data classification", "Mention the on-call impact"], design: ["List trust boundaries", "Include a rollback section"] });
  expect(states(onlySecurity).applied).toEqual([{ id: "security", state: "in-sync" }]);
  expect(states(applyShared(SCAFFOLD, [BASE])).applied).toEqual([{ id: "base", state: "in-sync" }]);
});

test("updating one profile changes only that profile's lines", () => {
  const v1 = applyShared(WITH_LOCAL, [BASE, SECURITY]);
  const base2 = { ...BASE, context: "We use conventional commits.\nSpecs use MUST.", rules: { proposal: ["Always include Non-goals", "Name the owner"] } };
  const v2 = applyShared(v1, [base2, SECURITY]);
  const [a, b] = [v1.split("\n"), v2.split("\n")];
  const changed = [...a.filter((l) => !b.includes(l)), ...b.filter((l) => !a.includes(l))];
  expect(changed.sort()).toEqual(["  Specs use MUST.", "  Specs use SHALL.", `    - Max 2h per task # ${ruleComment("base")}`, `    - Name the owner # ${ruleComment("base")}`, "  tasks:"].sort());
});

test("state per applied profile", () => {
  expect(states(SCAFFOLD)).toEqual({ unreadable: false, applied: [] });
  const applied = applyShared(WITH_LOCAL, [BASE, SECURITY]);
  const edited: SharedConfig = { profiles: [{ ...BASE, context: "changed" }, SECURITY] };
  expect(states(applied, edited).applied).toEqual([{ id: "base", state: "outdated" }, { id: "security", state: "in-sync" }]);
  expect(states(applied, { profiles: [{ ...BASE, rules: { proposal: ["Always include Non-goals"] } }, SECURITY] }).applied[0]).toEqual({ id: "base", state: "outdated" });
  // hand edit inside a managed block
  expect(states(applied.replace("Specs use SHALL.", "Specs use SHALL, mostly.")).applied[0]).toEqual({ id: "base", state: "outdated" });
  // the project's own content does not count
  const localEdits = applied.replace("Tech stack: Go.", "Tech stack: Rust.").replace("    - Include a rollback section", "    - Include a rollback section\n    - And a diagram");
  expect(states(localEdits).applied.every((p) => p.state === "in-sync")).toBe(true);
  // a profile deleted in the dashboard is reported, last, and can be cleaned up by applying without it
  expect(states(applied, { profiles: [SECURITY] }).applied).toEqual([{ id: "security", state: "in-sync" }, { id: "base", state: "orphaned" }]);
  expect(states(applyShared(applied, [SECURITY]), { profiles: [SECURITY] }).applied).toEqual([{ id: "security", state: "in-sync" }]);
  // file order does not matter for reporting, but apply normalises it to dashboard order
  const reversed = applyShared(WITH_LOCAL, [SECURITY, BASE]);
  expect(states(reversed).applied.map((p) => p.id)).toEqual(["base", "security"]);
  expect(applyShared(reversed, [BASE, SECURITY])).toBe(applied);
});

test("unreadable: missing file, broken YAML, wrong types, malformed markers — and apply refuses them", () => {
  const applied = applyShared(WITH_LOCAL, [BASE, SECURITY]);
  const unreadable = { unreadable: true, applied: [] };
  expect(states(undefined)).toEqual(unreadable);
  for (const text of ["schema: [unclosed", "schema: spec-driven\ncontext:\n  - not a string\n", "schema: spec-driven\nrules:\n  proposal: not a list\n", "- just\n- a list\n"]) {
    expect(states(text)).toEqual(unreadable);
    expect(() => applyShared(text, [BASE])).toThrow();
  }
  const malformed = [
    applied.replace(`  ${contextEnd("base")}\n`, ""), // begin without end
    applied.replace(`  ${contextBegin("base")}\n`, ""), // end without begin
    applied.replace(contextEnd("base"), contextEnd("security")), // mismatched pair
    applied.replace("  Tech stack: Go.", `  ${contextBegin("base")}\n  x\n  ${contextEnd("base")}`), // same profile twice
    applied.replace("  Tech stack: Go.", `  <!-- ${MARKER}:begin -->`), // marker without a profile id
  ];
  for (const text of malformed) {
    expect(states(text)).toEqual(unreadable);
    expect(() => applyShared(text, [BASE])).toThrow("malformed");
  }
});

test("the 50KB guard counts UTF-8 bytes of the combined context", () => {
  const overhead = Buffer.byteLength(`${contextBegin("base")}\n\n${contextEnd("base")}\n`, "utf8");
  const budget = MAX_CONTEXT_BYTES - overhead;
  const exactly = "é".repeat(Math.floor(budget / 2)) + "a".repeat(budget % 2); // é is 2 bytes; pad an odd budget
  expect(Buffer.byteLength(exactly, "utf8")).toBe(budget);
  expect(() => applyShared(SCAFFOLD, [{ ...BASE, context: exactly, rules: {} }])).not.toThrow();
  expect(() => applyShared(SCAFFOLD, [{ ...BASE, context: `${exactly}x`, rules: {} }])).toThrow("OpenSpec ignores context above 50.0KB");
  const big = `schema: spec-driven\ncontext: |\n  ${"a".repeat(48 * 1024)}\n`;
  expect(() => applyShared(big, [{ ...BASE, context: "b".repeat(4 * 1024), rules: {} }])).toThrow(/shared 4\.\dKB \+ the project's own 48\.0KB/);
});

async function repoWith(config: string | undefined): Promise<{ root: string; file: string }> {
  const root = await tempDir("osd-shared-");
  await mkdir(join(root, "openspec", "changes"), { recursive: true });
  const file = join(root, "openspec", "config.yaml");
  if (config !== undefined) await writeFile(file, config);
  return { root, file };
}

/** Apply as the UI does: with the digest of a preview taken just before. */
async function previewThenApply(repo: RepoConfig, profileIds: string[], shared: SharedConfig = SHARED) {
  return applyTo(repo, shared, profileIds, (await previewFor(repo, shared, profileIds)).digest);
}

test("applyTo: writes once, then reports unchanged without touching the file; keeps the mode; leaves no temp file", async () => {
  const { root, file } = await repoWith(WITH_LOCAL);
  await chmod(file, 0o640);
  const repo = newRepoConfig(root, true);
  expect(await previewThenApply(repo, ["security", "base"])).toEqual({ repoId: repo.id, result: "written" });
  expect((await stat(file)).mode & 0o777).toBe(0o640);
  expect((await readdir(join(root, "openspec"))).sort()).toEqual(["changes", "config.yaml"]); // readdir order is platform-dependent

  const past = new Date("2026-01-01T00:00:00Z");
  await utimes(file, past, past);
  expect(await previewThenApply(repo, ["base", "security"])).toEqual({ repoId: repo.id, result: "unchanged" });
  expect((await stat(file)).mtimeMs).toBe(past.getTime());

  // OpenSpec's own reader accepts the result and sees shared + local
  const seen = readProjectConfig(root);
  expect(seen?.context).toContain("We use conventional commits.");
  expect(seen?.context).toContain("Threat-model every new endpoint.");
  expect(seen?.context).toContain("Tech stack: Go.");
  expect(seen?.rules?.proposal).toEqual(["Always include Non-goals", "State the data classification", "Mention the on-call impact"]);
  await rm(root, { recursive: true, force: true });
});

test("previewFor and applyTo refuse what must not be touched, and never write then", async () => {
  const missing = await repoWith(undefined);
  const broken = await repoWith("schema: [unclosed");
  for (const { root, file } of [missing, broken]) {
    const repo = newRepoConfig(root, true);
    const preview = await previewFor(repo, SHARED, ["base"]);
    expect(preview.current.unreadable).toBe(true);
    expect(preview.refusal).toBeDefined();
    const result = await previewThenApply(repo, ["base"]);
    expect([result.result, result.reason !== undefined]).toEqual(["refused", true]);
    expect(await readFile(file, "utf8").catch(() => undefined)).toBe(root === missing.root ? undefined : "schema: [unclosed");
    await rm(root, { recursive: true, force: true });
  }
  const healthy = await repoWith(SCAFFOLD);
  const repo = newRepoConfig(healthy.root, true);
  const preview = await previewFor(repo, SHARED, ["base"]);
  expect([preview.current, preview.refusal, preview.before]).toEqual([{ unreadable: false, applied: [] }, undefined, SCAFFOLD]);
  expect(preview.after).toContain(contextBegin("base"));
  expect((await previewFor(repo, SHARED, ["base", "nope"])).refusal).toBe("unknown profile: nope");
  expect((await previewThenApply(repo, ["nope"])).result).toBe("refused");
  expect(await readFile(healthy.file, "utf8")).toBe(SCAFFOLD); // previewing and refused applies wrote nothing
  await rm(healthy.root, { recursive: true, force: true });
});

test("previewFor: the digest covers the file and the result", async () => {
  const { root, file } = await repoWith(SCAFFOLD);
  const repo = newRepoConfig(root, true);
  const first = await previewFor(repo, SHARED, ["base"]);
  expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
  expect((await previewFor(repo, SHARED, ["base"])).digest).toBe(first.digest);
  expect((await previewFor(repo, SHARED, ["base", "security"])).digest).not.toBe(first.digest);
  expect((await previewFor(repo, { profiles: [{ ...BASE, context: "Changed." }, SECURITY] }, ["base"])).digest).not.toBe(first.digest);
  await writeFile(file, `${SCAFFOLD}# edited\n`);
  expect((await previewFor(repo, SHARED, ["base"])).digest).not.toBe(first.digest);
  await rm(root, { recursive: true, force: true });
});

test("applyTo: refuses a missing digest, a file changed after the preview and profiles saved after it, and writes nothing", async () => {
  const { root, file } = await repoWith(SCAFFOLD);
  const repo = newRepoConfig(root, true);
  expect(await applyTo(repo, SHARED, ["base"], undefined)).toEqual({ repoId: repo.id, result: "refused", reason: CHANGED_SINCE_PREVIEW });
  expect(await readFile(file, "utf8")).toBe(SCAFFOLD);

  const preview = await previewFor(repo, SHARED, ["base"]);
  const edited = `${SCAFFOLD}profile: strict # edited after the preview\n`;
  await writeFile(file, edited);
  expect(await applyTo(repo, SHARED, ["base"], preview.digest)).toEqual({ repoId: repo.id, result: "refused", reason: CHANGED_SINCE_PREVIEW });
  expect(await readFile(file, "utf8")).toBe(edited);

  const again = await previewFor(repo, SHARED, ["base"]);
  const resaved = { profiles: [{ ...BASE, context: "Saved in another tab." }, SECURITY] };
  expect(await applyTo(repo, resaved, ["base"], again.digest)).toEqual({ repoId: repo.id, result: "refused", reason: CHANGED_SINCE_PREVIEW });
  expect(await readFile(file, "utf8")).toBe(edited);

  expect(await applyTo(repo, SHARED, ["base"], again.digest)).toEqual({ repoId: repo.id, result: "written" });
  expect(await readFile(file, "utf8")).toBe(again.after);
  await rm(root, { recursive: true, force: true });
});

// ---- Apply writes only a real config file and leaves no temporary file (contain-repository-reads design D7) ----

test("applyTo refuses a linked config.yaml or openspec/, and the link and its target stay as they were", async () => {
  const elsewhere = await tempDir("osd-shared-common-");
  await writeFile(join(elsewhere, "config.yaml"), SCAFFOLD);

  const linkedFile = await repoWith(undefined);
  await symlink(join(elsewhere, "config.yaml"), linkedFile.file);
  const repo = newRepoConfig(linkedFile.root, true);
  expect((await previewFor(repo, SHARED, ["base"])).refusal).toContain("openspec/config.yaml is a symbolic link");
  const result = await previewThenApply(repo, ["base"]);
  expect(result.result).toBe("refused");
  expect(result.reason).toContain("symbolic link");
  expect((await lstat(linkedFile.file)).isSymbolicLink()).toBe(true);
  expect(await readFile(join(elsewhere, "config.yaml"), "utf8")).toBe(SCAFFOLD);

  const linkedDir = await tempDir("osd-shared-linkeddir-");
  await mkdir(join(elsewhere, "openspec"), { recursive: true });
  await writeFile(join(elsewhere, "openspec", "config.yaml"), SCAFFOLD);
  await symlink(join(elsewhere, "openspec"), join(linkedDir, "openspec"));
  const dirResult = await previewThenApply(newRepoConfig(linkedDir, true), ["base"]);
  expect([dirResult.result, dirResult.reason?.startsWith("openspec is a symbolic link")]).toEqual(["refused", true]);
  expect(await readFile(join(elsewhere, "openspec", "config.yaml"), "utf8")).toBe(SCAFFOLD);
  expect((await readdir(join(elsewhere, "openspec"))).sort()).toEqual(["config.yaml"]);

  for (const root of [linkedFile.root, linkedDir, elsewhere]) await rm(root, { recursive: true, force: true });
});

test("applyTo still writes in place when only openspec/changes is a link", async () => {
  const { root, file } = await repoWith(SCAFFOLD);
  const elsewhere = await tempDir("osd-shared-changes-");
  await rm(join(root, "openspec", "changes"), { recursive: true });
  await symlink(elsewhere, join(root, "openspec", "changes"));
  expect((await previewThenApply(newRepoConfig(root, true), ["base"])).result).toBe("written");
  expect(await readFile(file, "utf8")).toContain(contextBegin("base"));
  expect(await readdir(elsewhere)).toEqual([]);
  for (const dir of [root, elsewhere]) await rm(dir, { recursive: true, force: true });
});

test("a failing rename refuses the apply, leaves config.yaml unchanged and no temporary file", async () => {
  const { root, file } = await repoWith(SCAFFOLD);
  const failing = { rename: async () => Promise.reject(new Error("disk full")) };
  const repo = newRepoConfig(root, true);
  const result = await applyTo(repo, SHARED, ["base"], (await previewFor(repo, SHARED, ["base"])).digest, failing);
  expect(result).toMatchObject({ result: "refused", reason: "could not write: disk full" });
  expect(await readFile(file, "utf8")).toBe(SCAFFOLD);
  expect((await readdir(join(root, "openspec"))).sort()).toEqual(["changes", "config.yaml"]);
  await rm(root, { recursive: true, force: true });
});

test("two applies at once leave one complete config and no temporary file", async () => {
  const { root, file } = await repoWith(SCAFFOLD);
  const repo = newRepoConfig(root, true);
  const [base, security] = await Promise.all([previewFor(repo, SHARED, ["base"]), previewFor(repo, SHARED, ["security"])]);
  const results = await Promise.all([applyTo(repo, SHARED, ["base"], base.digest), applyTo(repo, SHARED, ["security"], security.digest)]);
  expect(results.map((r) => r.result)).toEqual(["written", "written"]);
  const text = await readFile(file, "utf8");
  expect([applyShared(SCAFFOLD, resolveProfiles(SHARED, ["base"])), applyShared(SCAFFOLD, resolveProfiles(SHARED, ["security"]))]).toContain(text);
  expect((await readdir(join(root, "openspec"))).sort()).toEqual(["changes", "config.yaml"]);
  await rm(root, { recursive: true, force: true });
});
