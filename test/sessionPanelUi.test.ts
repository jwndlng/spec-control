// The session panel's header actions run one at a time (fix-form-and-dialog-interactions 3.1): the pure guard, and the
// panel's source, which uses hooks and so is read rather than rendered.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { oneAtATime } from "../src/ui/sessionState.ts";

const panel = readFileSync(join(import.meta.dir, "..", "src", "ui", "sessionPanel.tsx"), "utf8");

/** A request that stays in flight until the test lets it finish. */
function pending() {
  let finish: (ok: boolean) => void = () => {};
  const done = new Promise<void>((resolve, reject) => (finish = (ok) => (ok ? resolve() : reject(new Error("refused")))));
  return { done, finish };
}

test("a second activation while one is in flight sends no request, and the actions read busy until it finishes", async () => {
  const running = { current: false };
  const busy: boolean[] = [];
  const act = oneAtATime(running, (b) => busy.push(b));
  let requests = 0;
  const request = pending();
  const ship = async () => {
    requests++;
    await request.done;
  };
  // A double-click on Ship: both clicks arrive before the re-render that disables the button.
  const first = act(ship);
  const second = act(ship);
  await second;
  expect(requests).toBe(1);
  expect(busy).toEqual([true]);
  request.finish(true);
  await first;
  expect(busy).toEqual([true, false]);
  // Enabled again: the next activation sends.
  await act(async () => {
    requests++;
  });
  expect(requests).toBe(2);
});

test("a failed request enables the actions again", async () => {
  const running = { current: false };
  const busy: boolean[] = [];
  const act = oneAtATime(running, (b) => busy.push(b));
  await expect(act(() => Promise.reject(new Error("resume refused")))).rejects.toThrow("resume refused");
  expect(running.current).toBe(false);
  expect(busy).toEqual([true, false]);
});

test("the panel's header actions go through the guard and are disabled while one runs", () => {
  expect(panel).toContain("oneAtATime(inFlight, setActing)");
  const header = panel.slice(panel.indexOf('<header class="session-head">'), panel.indexOf("</header>"));
  // Ship, Resolve conflicts, Resume and Delete record; Merge also keeps its own readiness.
  expect(header.match(/disabled=\{acting\}/g)).toHaveLength(4);
  expect(header).toContain("disabled={!merge.enabled || acting}");
  // The same steps offered through the split button in the console.
  expect(header).toContain("disabled: !merge.enabled || acting,");
  expect(header).toContain("disabled: acting,");
  for (const call of ["api.shipSession(session.id)", "api.resolveConflicts(session.id)", "api.mergeSession(session.id)", "api.resumeSession(session.id)", "api.deleteSession(session.id)"]) {
    const at = header.indexOf(call);
    expect(at).toBeGreaterThan(0);
    expect(header.slice(Math.max(0, at - 120), at)).toContain("act(");
  }
});
