// The end-session dialog while a confirmation runs (fix-form-and-dialog-interactions 2.1, 2.2): Escape and Cancel do
// not close it, Escape stops at it, and a confirmation reports only into its own session's dialog. The dialog itself
// uses hooks, so its Escape listener is read from the source; the rest is the pure decisions and the hook-free footer.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EndDialogFooter } from "../src/ui/endSessionDialog.tsx";
import { endDialogEscape, ownReports } from "../src/ui/sessionState.ts";
import { byTag, textOf } from "./vnode.ts";

const source = readFileSync(join(import.meta.dir, "..", "src", "ui", "endSessionDialog.tsx"), "utf8");

function footer(busy: boolean) {
  const calls: string[] = [];
  const tree = EndDialogFooter({
    busy,
    onCancel: () => calls.push("cancel"),
    ship: { title: "ship", onClick: () => calls.push("ship") },
    confirm: { class: "btn sm danger", disabled: busy, label: busy ? "Pulling…" : "End anyway", onClick: () => calls.push("confirm") },
  });
  const button = (label: string) => byTag(tree, "button").find((b) => textOf(b).includes(label));
  return { button, calls };
}

test("Escape closes the dialog only while no confirmation runs", () => {
  expect(endDialogEscape(false)).toBe(true);
  expect(endDialogEscape(true)).toBe(false);
});

test("while busy, Cancel, Ship instead and the confirmation are disabled", () => {
  const busy = footer(true);
  expect(busy.button("Cancel")?.props.disabled).toBe(true);
  expect(busy.button("Ship instead")?.props.disabled).toBe(true);
  expect(busy.button("Pulling…")?.props.disabled).toBe(true);

  const idle = footer(false);
  const cancel = idle.button("Cancel");
  expect(cancel?.props.disabled).toBe(false);
  (cancel?.props.onClick as (() => void) | undefined)?.();
  expect(idle.calls).toEqual(["cancel"]);
});

test("Escape is caught on the document in the capture phase and stops there, busy or not", () => {
  const listener = source.slice(source.indexOf("const onKey = (e: KeyboardEvent)"), source.indexOf("if (!id || !session) return null;"));
  expect(listener).toContain('document.addEventListener("keydown", onKey, true)');
  expect(listener).not.toContain("window.addEventListener");
  // Propagation stops before the busy check, so a busy Escape does not reach the change detail view either.
  expect(listener.indexOf("e.stopPropagation()")).toBeLessThan(listener.indexOf("endDialogEscape(busy)"));
  expect(listener).toContain("}, [id, busy, ui.requestEnd]);");
});

test("a confirmation started for one session does not report into a dialog opened for another", () => {
  let open: string | undefined = "rotate-keys-1";
  const seen: string[] = [];
  const dialog = ownReports("rotate-keys-1", () => open, {
    setReport: (r: string) => seen.push(`report ${r}`),
    setBusy: (b: boolean) => seen.push(`busy ${b}`),
    close: () => seen.push("close"),
  });
  dialog.setBusy(true);
  // The add-login session's dialog is opened while the rotate-keys confirmation is still running.
  open = "add-login-2";
  dialog.setReport("blocked pull");
  dialog.setBusy(false);
  dialog.close();
  expect(seen).toEqual(["busy true"]);
  // Nor into a closed dialog.
  open = undefined;
  dialog.close();
  expect(seen).toEqual(["busy true"]);
});

test("every report, error and close after an await goes through the guard", () => {
  for (const name of ["confirm", "run"]) {
    const body = source.slice(source.indexOf(`const ${name} = async`), source.indexOf("};\n", source.indexOf(`const ${name} = async`)));
    expect(body).toContain("const dialog = own();");
    const afterFirstAwait = body.slice(body.indexOf("await "));
    expect(afterFirstAwait).not.toMatch(/(?<![\w.])(setReport|setBusy|setError|setPulling|close)\(/);
  }
});
