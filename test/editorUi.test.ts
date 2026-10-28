// Open in editor in the UI (editor-launch 4.2): the pure control, the control as rendered, and the hosts' sources, which
// use hooks and so are read rather than rendered.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editorControl } from "../src/ui/sessionState.ts";
import { OpenInEditorView } from "../src/ui/sessions.tsx";
import { byTag, textOf } from "./vnode.ts";

const source = (name: string) => readFileSync(join(import.meta.dir, "..", "src", "ui", name), "utf8");
const FOLDER = "/home/u/.spec-control/worktrees/demo-ops/audit-trail";

test("the control names the command that will run, with the folder", () => {
  expect(editorControl({ command: ["code"], found: true }, FOLDER)).toEqual({ enabled: true, title: `Opens this folder in your editor: code ${FOLDER}` });
  expect(editorControl({ command: ["open", "-a", "Visual Studio Code", "{path}"], found: true }, FOLDER).title).toBe(`Opens this folder in your editor: open -a "Visual Studio Code" ${FOLDER}`);
  // Before the list was read the default is assumed; the server still refuses when it is not there.
  expect(editorControl(undefined, FOLDER)).toMatchObject({ enabled: true, title: expect.stringContaining(`code ${FOLDER}`) });
});

test("when the editor is not found the control is disabled, says so and links to the Agent sessions settings", () => {
  const control = editorControl({ command: ["code"], found: false }, FOLDER);
  expect(control).toEqual({ enabled: false, title: "code was not found — change the editor in Settings", notFound: "code" });
  const view = OpenInEditorView({ control, onActivate: () => {} });
  const [button] = byTag(view, "button");
  expect(button.props.disabled).toBe(true);
  expect(button.props.title).toContain("code was not found");
  const [link] = byTag(view, "a");
  expect(String(link.props.href)).toContain("/settings?section=agents");
  expect(textOf(link)).toContain("code not found");
});

test("an enabled control activates once and has no settings link", () => {
  let activated = 0;
  const view = OpenInEditorView({ control: editorControl({ command: ["zed"], found: true }, FOLDER), onActivate: () => activated++ });
  const [button] = byTag(view, "button");
  expect(textOf(button)).toBe("Open in editor");
  expect(button.props.disabled).toBe(false);
  (button.props.onClick as () => void)();
  expect(activated).toBe(1);
  expect(byTag(view, "a")).toEqual([]);
  expect(byTag(OpenInEditorView({ control: editorControl({ command: ["zed"], found: true }, FOLDER), busy: true, onActivate: () => {} }), "button")[0].props.disabled).toBe(true);
});

test("the Console tab and Open work offer it beside Copy cd, by session or by worktree name, never by path", () => {
  const panel = source("sessionPanel.tsx");
  expect(panel).toContain("api.openEditor(session.id)");
  expect(panel).toContain("api.openWorktreeEditor(tree.repoId, tree.name)");
  expect(panel).toContain("<OpenInEditor folder={path} open={openInEditor} run={act} />");
  const sessions = source("sessions.tsx");
  const orphan = sessions.slice(sessions.indexOf("function OrphanActions"), sessions.indexOf("export function OpenInEditor("));
  expect(orphan).toContain("Copy cd");
  expect(orphan).toContain("api.openWorktreeEditor(worktree.repoId, worktree.name)");
});

test("consoles and integration sessions get no control", () => {
  for (const name of ["console.tsx", "projectConsole.tsx", "integrate.tsx"]) {
    const text = source(name);
    expect(text).not.toContain("OpenInEditor");
    expect(text).not.toContain("openEditor");
  }
});
