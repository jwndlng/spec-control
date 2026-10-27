import { expect, test } from "bun:test";
import type { ArtifactStatus } from "../src/shared/types.ts";
import { cardProgress, Meter, meterText } from "../src/ui/kanban.tsx";
import { byTag, textOf } from "./vnode.ts";

const A = (...done: boolean[]): ArtifactStatus[] => ["proposal", "specs", "design", "tasks"].map((id, i) => ({ id, status: done[i] ? "done" : "ready" }));

test("a Drafts card counts written artifacts, whatever the tasks say", () => {
  expect(cardProgress({ stage: "drafts", artifacts: A(true, false, true, false), tasks: { done: 0, total: 12 } })).toEqual({ done: 2, total: 4, unit: "artifacts" });
  expect(meterText(2, 4, "artifacts")).toBe("2 of 4 artifacts written");
  const brief: ArtifactStatus[] = [{ id: "brief", status: "done" }, { id: "plan", status: "ready" }, { id: "checklist", status: "blocked" }];
  expect(cardProgress({ stage: "drafts", artifacts: brief, tasks: null })).toEqual({ done: 1, total: 3, unit: "artifacts" });
});

test("other cards count tasks when there are any; Backlog shows no bar", () => {
  expect(cardProgress({ stage: "ready", artifacts: A(true, true, true, true), tasks: { done: 0, total: 12 } })).toEqual({ done: 0, total: 12, unit: "tasks" });
  expect(meterText(0, 12, "tasks")).toBe("0 of 12 tasks complete");
  expect(cardProgress({ stage: "implementing", artifacts: A(true, true, true, true), tasks: { done: 3, total: 12 } })?.unit).toBe("tasks");
  expect(cardProgress({ stage: "ready", artifacts: A(true, true, true, true), tasks: { done: 0, total: 0 } })).toBeUndefined();
  expect(cardProgress({ stage: "backlog", artifacts: A(false, false, false, false), tasks: { done: 0, total: 0 } })).toBeUndefined();
  expect(cardProgress({ stage: "backlog", artifacts: A(false, false, false, false), tasks: null })).toBeUndefined();
});

test("a task that needs the user is its own segment, named in the label, tooltip and accessible name", () => {
  const card = { stage: "done" as const, artifacts: A(true, true, true, true), tasks: { done: 13, awaiting: 2, total: 15 } };
  expect(cardProgress(card)).toEqual({ done: 13, awaiting: 2, total: 15, unit: "tasks" });
  expect(meterText(13, 2 + 13, "tasks", 2)).toBe("13 of 15 tasks complete, 2 need the user, 0 open");
  expect(meterText(4, 12, "tasks", 3)).toBe("4 of 12 tasks complete, 3 need the user, 5 open");

  const meter = Meter({ done: 13, total: 15, awaiting: 2, showUnit: true });
  const text = "13 of 15 tasks complete, 2 need the user, 0 open";
  expect(meter.props).toMatchObject({ title: text, "aria-label": text, role: "progressbar", "aria-valuenow": 13, "aria-valuemax": 15 });
  expect(String(meter.props.class)).toContain("has-awaiting");
  expect(textOf(meter)).toBe("13 + 2 need you / 15 Tasks");
  // Three parts: the done tasks filled, the awaiting ones between them and the remainder.
  const segments = byTag(meter, "div").filter((d) => d.props.class === "fill" || d.props.class === "awaiting");
  expect(segments.map((d) => [d.props.class, (d.props.style as { width: string }).width])).toEqual([["fill", "87%"], ["awaiting", "13%"]]);
});

test("without an awaiting count the bar is exactly what it was", () => {
  const before = { title: "4 of 12 tasks complete", "aria-label": "4 of 12 tasks complete" };
  for (const awaiting of [undefined, 0]) {
    const meter = Meter({ done: 4, total: 12, awaiting, showUnit: true });
    expect(meter.props).toMatchObject(before);
    expect(String(meter.props.class)).not.toContain("has-awaiting");
    expect(textOf(meter)).toBe("4/12 Tasks");
    expect(byTag(meter, "div").filter((d) => d.props.class === "awaiting")).toEqual([]);
  }
  expect(meterText(4, 12, "tasks", 0)).toBe(meterText(4, 12, "tasks"));
  // Artifacts never have an awaiting state, whatever is passed.
  expect(meterText(2, 4, "artifacts", 1)).toBe("2 of 4 artifacts written");
});
