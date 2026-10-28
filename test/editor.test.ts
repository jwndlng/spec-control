import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { editorArgv, editorCommand, editorFound, openEditor } from "../src/server/sessions/editor.ts";
import { installFakeEditor, type EditorHarness } from "./editorHelpers.ts";
import { tempDir, treeFingerprint } from "./helpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let editor: EditorHarness | undefined;
afterEach(() => {
  editor?.restore();
  editor = undefined;
});

test("the argument list: code by default, {path} replaced where it stands, else the folder appended as one argument", () => {
  const folder = "/home/u/.spec-control/worktrees/demo-ops/audit-trail";
  expect(editorCommand({})).toEqual(["code"]);
  expect(editorArgv({}, folder)).toEqual(["code", folder]);
  expect(editorArgv({ editor: ["zed"] }, folder)).toEqual(["zed", folder]);
  expect(editorArgv({ editor: ["open", "-a", "Visual Studio Code", "{path}"] }, folder)).toEqual(["open", "-a", "Visual Studio Code", folder]);
  expect(editorArgv({ editor: ["idea", "{path}", "--wait"] }, folder)).toEqual(["idea", folder, "--wait"]);
  const spaced = "/w/acme/My Projects/alpha infra";
  expect(editorArgv({ editor: ["code", "--new-window"] }, spaced)).toEqual(["code", "--new-window", spaced]); // never split
});

test("a missing executable or a missing folder is refused and nothing starts", async () => {
  editor = await installFakeEditor();
  const folder = await tempDir("osd-editor-folder-");
  await expect(openEditor(["no-such-editor-osd", folder], folder)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("no-such-editor-osd") });
  expect(editorFound(["no-such-editor-osd"])).toBe(false);
  const gone = join(folder, "gone");
  await expect(openEditor(["fake-editor", gone], gone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("no longer exists") });
  await new Promise((r) => setTimeout(r, 300));
  expect(await editor.starts()).toEqual([]);
});

test("the stand-in editor starts once in the folder with the expected arguments, and the repository stays untouched", async () => {
  editor = await installFakeEditor();
  expect(editorFound(["fake-editor"])).toBe(true);
  const repo = await tempGitRepo();
  const worktree = join(await realpath(await tempDir("osd-editor-wt-")), "audit trail");
  git(repo, "worktree", "add", "-q", "-b", "feat/audit-trail", worktree);
  const before = [await treeFingerprint(repo), await treeFingerprint(worktree)];

  const argv = editorArgv({ editor: ["fake-editor", "--reuse-window", "{path}"] }, worktree);
  await openEditor(argv, worktree);
  const starts = await editor.waitForStarts(1);
  expect(starts).toEqual([{ argv: ["--reuse-window", worktree], cwd: worktree }]);
  await new Promise((r) => setTimeout(r, 300));
  expect(await editor.starts()).toHaveLength(1);
  expect([await treeFingerprint(repo), await treeFingerprint(worktree)]).toEqual(before);
});
