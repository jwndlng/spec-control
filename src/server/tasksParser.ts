import type { ShipTaskSummary, TaskProgress } from "../shared/types.ts";

// A task line is exactly what the `openspec` CLI counts (`TASK_LINE_PATTERN`, `dist/utils/task-progress.js`): a list
// item (`-`, `*`, `+`, or one to nine digits and `.` or `)`), no whitespace required before the bracket, then a box
// holding at most one character whose `]` is not followed by `(` or `[` — so `- [x](notes.md)` is a link bullet, not a
// task — or a whitespace-only box, followed by anything. `test/parsers.test.ts` compares the counts with the CLI's.
const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])/;

/** How many `[~]` tasks' text a scan carries, and how long each may be: the snapshot stays small, `awaiting` stays exact. */
export const AWAITING_TASKS_LIMIT = 10;
export const AWAITING_TASK_LENGTH = 200;

/** A task's text after the checkbox, trimmed and at most `AWAITING_TASK_LENGTH` characters, an ellipsis ending a shortened one. */
function awaitingText(rest: string): string {
  const text = rest.trim();
  const chars = Array.from(text);
  return chars.length > AWAITING_TASK_LENGTH ? `${chars.slice(0, AWAITING_TASK_LENGTH - 1).join("").trimEnd()}…` : text;
}

/**
 * Counts the three checkbox states: done (`[x]`), awaiting a person's confirmation (`[~]`) and open (everything else).
 * A marker this does not recognise counts as open — never as done, the rule OpenSpec's archive workflow follows too.
 * The `[~]` tasks' text is kept too (`awaitingTasks`), bounded, and only when there is any.
 */
export function parseTaskProgress(markdown: string): TaskProgress {
  let done = 0;
  let awaiting = 0;
  let total = 0;
  const awaitingTasks: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    total += 1;
    const state = match[1];
    if (state === "x" || state === "X") done += 1;
    else if (state === "~") {
      awaiting += 1;
      if (awaitingTasks.length < AWAITING_TASKS_LIMIT) awaitingTasks.push(awaitingText(line.slice(match[0].length)));
    }
  }
  return awaitingTasks.length > 0 ? { done, awaiting, awaitingTasks, total } : { done, awaiting, total };
}

/** Bounded task explanations for Ship; an empty or malformed task document never proves completion. */
export function parseShipTaskSummary(markdown: string): ShipTaskSummary {
  const progress = parseTaskProgress(markdown);
  const open: string[] = [];
  const awaiting: string[] = [];
  let truncated = false;
  let malformed = false;
  for (const line of markdown.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line);
    if (!match) {
      if (/^\s*(?:[-*+]|\d{1,9}[.)])\s*\[/.test(line) && !/\]\(/.test(line)) malformed = true;
      continue;
    }
    if (/^[xX]$/.test(match[1] ?? "")) continue;
    const list = match[1] === "~" ? awaiting : open;
    const text = line.slice(match[0].length).trim();
    if (list.length >= AWAITING_TASKS_LIMIT) { truncated = true; continue; }
    if (Array.from(text).length > AWAITING_TASK_LENGTH) truncated = true;
    list.push(awaitingText(text) || "Task without a description");
  }
  return { verified: progress.total > 0 && !malformed, ...(malformed ? { reason: "The tasks file contains malformed checkboxes." } : progress.total === 0 ? { reason: "The tasks file has no recognizable task checkboxes." } : {}), total: progress.total, done: progress.done, open, awaiting, truncated };
}
