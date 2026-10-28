// Terminal recordings for the demo's simulated agent sessions, and the player that feeds them to the terminal view.
//
// EVERY LINE HERE IS WRITTEN BY HAND. Never paste output captured from a real session, machine or repository: the
// demo is public. Names come only from the placeholders {change}, {branch} and {path}, which the player fills from
// the sample data, so a transcript cannot mention anything the sample does not contain. test/demoTranscripts.test.ts
// fails the build on home directories, e-mail addresses, URLs and host names.
import type { WorkStatus } from "../../shared/types.ts";
import type { TerminalConnection, TerminalHandlers, TerminalMessage } from "../api.ts";

export type Step =
  /** Text to print after `after` ms (default 0). `work`: the worktree's status from this point on. */
  | { out: string; after?: number; work?: WorkStatus }
  /** Print the question and stop until the visitor sends a line of input. */
  | { ask: string; after?: number }
  /** The agent's process ends. */
  | { exit: number; after?: number };

export type TranscriptName = "draft" | "implement" | "implementAsking" | "validate" | "archive" | "resume" | "ship" | "resolveConflicts" | "console" | "integrate";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const OFF = "\x1b[0m";
const line = (text = "") => `${text}\r\n`;
const tool = (what: string) => line(`${CYAN}●${OFF} ${what}`);
const note = (text: string) => line(`  ${DIM}${text}${OFF}`);
const say = (text: string) => line(`${text}`);

export const RECORDING_NOTICE = line(`${DIM}— demo recording: nothing runs on this page —${OFF}`);

const header = (prompt: string): Step[] => [
  { out: line(`${BOLD}demo-agent${OFF} ${DIM}· {path}${OFF}`) },
  { out: line(`${DIM}branch {branch}${OFF}`) },
  { out: line() },
  { out: line(`${GREEN}>${OFF} ${prompt}`), after: 400 },
  { out: line(), after: 300 },
];

/** One task of the long Implement recording: read, think, edit, test, tick. Paced so a round takes about a minute. */
interface Round {
  task: string;
  plan: string;
  read: string;
  edits: [file: string, note: string][];
  tests: string;
  done: number;
}
const IMPLEMENT_ROUNDS: Round[] = [
  { task: "3.2", plan: "count requests per client key in a sliding window", read: "src/limits.ts", edits: [["src/limits.ts", "+ sliding window counter per client key"], ["test/limits.test.ts", "+ 4 cases: burst, refill, two keys, clock skew"]], tests: "41 pass, 0 fail", done: 10 },
  { task: "3.3", plan: "return the retry hint with the refusal", read: "src/responses.ts", edits: [["src/responses.ts", "+ retry-after on refusals, in whole seconds"], ["test/responses.test.ts", "+ 2 cases"]], tests: "43 pass, 0 fail", done: 11 },
  { task: "4.1", plan: "make the limits configurable per route", read: "src/config.ts", edits: [["src/config.ts", "+ limits section with defaults"], ["src/routes.ts", "+ per-route override"], ["test/config.test.ts", "+ 3 cases"]], tests: "46 pass, 0 fail", done: 12 },
  { task: "4.2", plan: "expose the counters for the metrics endpoint", read: "src/metrics.ts", edits: [["src/metrics.ts", "+ allowed and refused counters per route"], ["test/metrics.test.ts", "+ 2 cases"]], tests: "48 pass, 0 fail", done: 13 },
  { task: "4.3", plan: "document the limits and the refusal format", read: "docs/limits.md", edits: [["docs/limits.md", "+ defaults, overrides, refusal format"]], tests: "48 pass, 0 fail", done: 14 },
];
let edited = 0;
function round(r: Round): Step[] {
  return [
    { out: line(), after: 1500 },
    { out: say(`Task ${r.task}: ${r.plan}.`), after: 2500 },
    { out: tool(`Read ${r.read}`), after: 4000 },
    { out: note("thinking about where this fits…"), after: 7000 },
    ...r.edits.flatMap(([file, what]): Step[] => [
      { out: tool(`Edit ${file}`), after: 9000, work: { state: "uncommitted", count: ++edited } },
      { out: note(what), after: 600 },
    ]),
    { out: tool("Run the test suite"), after: 5000 },
    { out: note(r.tests), after: 8000 },
    { out: tool("Edit openspec/changes/{change}/tasks.md"), after: 3000 },
    { out: note(`${r.task} ticked — ${r.done} of 14`), after: 600 },
  ];
}

export const TRANSCRIPTS: Record<TranscriptName, Step[]> = {
  draft: [
    ...header("/opsx:ff {change}"),
    { out: tool("Read openspec/changes/{change}/proposal.md"), after: 900 },
    { out: tool("Read openspec/specs"), after: 700 },
    { out: say("The proposal is there. Writing the design, the delta specs and the tasks."), after: 1600 },
    { out: tool("Write openspec/changes/{change}/design.md"), after: 2600, work: { state: "uncommitted", count: 1 } },
    { out: note("4 decisions, 3 risks"), after: 300 },
    { out: tool("Write openspec/changes/{change}/specs/api/spec.md"), after: 2400, work: { state: "uncommitted", count: 2 } },
    { out: note("2 requirements added, 1 modified"), after: 300 },
    { out: tool("Write openspec/changes/{change}/tasks.md"), after: 2100, work: { state: "uncommitted", count: 3 } },
    { out: note("14 tasks in 4 groups"), after: 300 },
    { out: tool("Run openspec validate {change} --strict"), after: 1500 },
    { out: note("Change '{change}' is valid"), after: 900 },
    { out: line(), after: 200 },
    { out: say("All artifacts are written. {change} is ready to implement."), after: 600 },
    { exit: 0, after: 1500 },
  ],
  implement: [
    ...header("/opsx:apply {change}"),
    { out: tool("Read openspec/changes/{change}/tasks.md"), after: 900 },
    { out: say("14 tasks, 9 done. Five to go, starting with 3.2."), after: 1200 },
    ...IMPLEMENT_ROUNDS.flatMap(round),
    { out: say("All 14 tasks are ticked. Stopping here so you can look at the behaviour before shipping."), after: 2500 },
    { exit: 0, after: 1500 },
  ],
  implementAsking: [
    ...header("/opsx:apply {change}"),
    { out: tool("Read openspec/changes/{change}/tasks.md"), after: 900 },
    { out: say("6 tasks, none done. Starting with 1.1."), after: 1200 },
    { out: tool("Read src/settings/layout.ts"), after: 1600 },
    { out: say("1.1 replaces the layout module. It is imported in 12 places."), after: 1800 },
    { ask: `${YELLOW}?${OFF} Allow editing src/settings/layout.ts? ${DIM}(Enter = yes)${OFF} `, after: 900 },
    { out: tool("Edit src/settings/layout.ts"), after: 1200, work: { state: "uncommitted", count: 1 } },
    { out: tool("Run the type checker"), after: 1500 },
    { out: note("no errors"), after: 1900 },
    { out: tool("Edit openspec/changes/{change}/tasks.md"), after: 900, work: { state: "uncommitted", count: 2 } },
    { out: note("1.1 ticked — 1 of 6"), after: 300 },
    { out: say("Done with 1.1. Tell me when to go on."), after: 1200 },
    { ask: `${GREEN}>${OFF} `, after: 600 },
    { out: say("Continuing is not part of this recording — in the dashboard the agent would carry on from here."), after: 700 },
    { exit: 0, after: 1500 },
  ],
  validate: [
    ...header("/opsx:apply {change} — walk me through the tasks left to validate"),
    { out: tool("Read openspec/changes/{change}/tasks.md"), after: 900 },
    { out: say("Two tasks need you. Taking them one at a time: what to check or do, and what I can help with."), after: 1400 },
    { out: line(), after: 400 },
    { out: say("2.4: the refusal carries a retry hint. Send two bursts to the demo endpoint and check the second one names the wait in whole seconds."), after: 2200 },
    { ask: `${YELLOW}?${OFF} Did that check pass? ${DIM}(yes / no)${OFF} `, after: 900 },
    { out: tool("Edit openspec/changes/{change}/tasks.md"), after: 1200, work: { state: "uncommitted", count: 1 } },
    { out: note("2.4 ticked — 1 of 2 left to validate"), after: 400 },
    { out: line(), after: 400 },
    { out: say("2.5: the per-route override. Set a lower limit for one route in the config and confirm the other routes keep theirs."), after: 2200 },
    { ask: `${YELLOW}?${OFF} Did that check pass? ${DIM}(yes / no)${OFF} `, after: 900 },
    { out: say("Leaving 2.5 as it is, then — it stays marked for you and the change stays in Done."), after: 1400 },
    { exit: 0, after: 1500 },
  ],
  archive: [
    ...header("/opsx:archive {change}"),
    { out: tool("Run openspec status --change {change}"), after: 1000 },
    { out: note("4 of 4 artifacts, 18 of 18 tasks"), after: 900 },
    { out: say("Two delta specs to sync: one requirement added, one modified."), after: 1500 },
    { out: tool("Run openspec archive {change} -y"), after: 1700, work: { state: "uncommitted", count: 9 } },
    { out: note("Specs updated. Archived as today's date plus {change}."), after: 1400 },
    { out: tool("Run openspec validate --specs --strict"), after: 1200 },
    { out: note("all specs pass"), after: 1500 },
    { out: say("Archived. The change is ready to ship."), after: 700 },
    { exit: 0, after: 1500 },
  ],
  resume: [
    { out: line(`${BOLD}demo-agent${OFF} ${DIM}· resumed · {path}${OFF}`) },
    { out: line(), after: 300 },
    { out: say("Picking up {change} where we left off."), after: 900 },
    { out: tool("Run git status"), after: 1100 },
    { out: note("on {branch}, working tree as you left it"), after: 800 },
    { ask: `${GREEN}>${OFF} `, after: 500 },
    { out: say("This recording ends here — in the dashboard you would be talking to your own agent."), after: 700 },
    { exit: 0, after: 1500 },
  ],
  // The main console: no change, no branch, no prompt — the agent waits for the visitor to say something.
  console: [
    { out: line(`${BOLD}demo-agent${OFF} ${DIM}· {path}${OFF}`) },
    { out: line(), after: 300 },
    { out: say("Hi. This console belongs to no change — ask for anything, or spin off a new one."), after: 700 },
    { ask: `${GREEN}>${OFF} `, after: 400 },
    { out: tool("Read the tracked repositories"), after: 900 },
    { out: note("five repositories, 14 changes in flight"), after: 1200 },
    { out: say("In the dashboard you would be talking to your own agent here, in your console folder."), after: 800 },
    { ask: `${GREEN}>${OFF} `, after: 400 },
    { out: say("This recording ends here."), after: 600 },
    { exit: 0, after: 1500 },
  ],
  integrate: [
    { out: line(`${BOLD}demo-agent${OFF} ${DIM}· {path}${OFF}`) },
    { out: line(), after: 300 },
    { out: say("Setting this project up for OpenSpec. I will run `openspec init` here."), after: 700 },
    { ask: `${GREEN}>${OFF} Install the tool files for which assistants? `, after: 500 },
    { out: tool("Run openspec init"), after: 1100 },
    { out: note("created openspec/config.yaml"), after: 900 },
    { out: note("created openspec/specs/ and openspec/changes/"), after: 700 },
    { out: say("Done. The dashboard will pick this project up now that the config file is there."), after: 900 },
    { exit: 0, after: 1400 },
  ],
  // The dashboard hands over the prompt; everything after it is the agent's own doing, as in the real thing.
  resolveConflicts: [
    { out: line(), after: 200 },
    { out: line(`${GREEN}>${OFF} The branch for {change} no longer merges into the default branch. Bring it up to date and resolve the conflicts.`), after: 500 },
    { out: line(), after: 300 },
    { out: tool("Run git fetch and git rebase onto the default branch"), after: 1400 },
    { out: note("2 conflicts: src/router/table.ts, src/router/table.test.ts"), after: 1800 },
    { out: tool("Read src/router/table.ts"), after: 1200 },
    { out: say("Both sides added a route to the same table. Keeping both, in the order the default branch has."), after: 2200 },
    { out: tool("Edit src/router/table.ts"), after: 1300 },
    { out: tool("Edit src/router/table.test.ts"), after: 1100 },
    { out: tool("Run the checks"), after: 1500 },
    { out: note("lint, types and tests pass"), after: 2200 },
    { out: tool("Run git rebase --continue"), after: 1200 },
    { out: tool("Run git push --force-with-lease"), after: 1600, work: { state: "pushed", base: "origin/main" } },
    { out: note("{branch} merges cleanly again"), after: 1200 },
    { out: say("Conflicts resolved. The pull request is mergeable — I have not merged it."), after: 800 },
    { exit: 0, after: 1500 },
  ],
  ship: [
    { out: line(), after: 200 },
    { out: line(`${GREEN}>${OFF} Commit the work for {change}, push the branch and open a pull request.`), after: 500 },
    { out: line(), after: 300 },
    { out: tool("Run the checks"), after: 1200 },
    { out: note("lint, types and tests pass"), after: 2400 },
    { out: tool("Run git add and git commit"), after: 1300, work: { state: "unpushed", count: 1 } },
    { out: note("feat: {change}"), after: 500 },
    { out: tool("Run git push"), after: 1500, work: { state: "pushed" } },
    { out: note("{branch} is on the remote"), after: 1300 },
    { out: tool("Open a pull request"), after: 1600 },
    { out: note("opened against the default branch — waiting for review"), after: 1200 },
    { out: say("Shipped. Nothing is left in the worktree."), after: 700 },
    { exit: 0, after: 1500 },
  ],
};

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const REAL_CLOCK: Clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Where playback stands: the next step to happen, or — when `waiting` — the question that was asked and not answered. */
export interface Position {
  index: number;
  waiting: boolean;
}

/**
 * How far a transcript has got after `elapsedMs`. Playback never gets past a question on its own, however long ago the
 * session started.
 */
export function positionAfter(steps: Step[], elapsedMs: number): Position {
  let at = 0;
  for (const [i, step] of steps.entries()) {
    at += step.after ?? 0;
    if (at > elapsedMs) return { index: i, waiting: false };
    if ("ask" in step) return { index: i, waiting: true };
  }
  return { index: steps.length, waiting: false };
}

/** The work status the worktree has once the first `count` steps have happened. */
export function workAfter(steps: Step[], count: number, initial?: WorkStatus): WorkStatus | undefined {
  let work = initial;
  for (const step of steps.slice(0, count)) if ("work" in step && step.work) work = step.work;
  return work;
}

export interface PlayOptions {
  /** Steps before `from.index` have already happened: they are written at once, as scrollback. */
  from: Position;
  values: { change: string; branch: string; path: string };
  handlers: TerminalHandlers;
  /** Continue on a view that is already open: no `onOpen`, no recording notice, no scrollback. */
  continuing?: boolean;
  /** Called whenever playback moves on, with the new position and the worktree's status so far. */
  onProgress?(position: Position, work: WorkStatus | undefined): void;
  clock?: Clock;
}

export interface Playback extends TerminalConnection {
  /** Prints text as if it had been typed into the terminal (the demo's version of a starter prompt). */
  type(text: string): void;
}

/** Plays a transcript into a terminal view through the same handlers the real WebSocket stream uses. */
export function playTranscript(steps: Step[], { from, values, handlers, onProgress, continuing = false, clock = REAL_CLOCK }: PlayOptions): Playback {
  const encoder = new TextEncoder();
  const fill = (text: string) => text.replaceAll("{change}", values.change).replaceAll("{branch}", values.branch).replaceAll("{path}", values.path);
  const write = (text: string) => handlers.onData(encoder.encode(fill(text)));
  let index = Math.min(from.index, steps.length);
  let timer: unknown;
  let waiting = false;
  let closed = false;
  const progress = () => onProgress?.({ index, waiting }, workAfter(steps, index));

  const finish = (step: Step) => {
    if ("out" in step) write(step.out);
    else if ("ask" in step) write(step.ask);
  };

  const schedule = () => {
    if (closed || index >= steps.length) return;
    const step = steps[index];
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (closed) return;
      if ("exit" in step) {
        index = steps.length;
        progress();
        handlers.onExit();
        handlers.onClose();
        closed = true;
        return;
      }
      finish(step);
      if ("ask" in step) {
        waiting = true; // `index` stays on the question until it is answered
        progress();
        return;
      }
      index++;
      progress();
      schedule();
    }, step.after ?? 0);
  };

  timer = clock.setTimeout(() => {
    timer = undefined;
    if (closed) return;
    if (!continuing) {
      handlers.onOpen();
      write(RECORDING_NOTICE);
      for (const step of steps.slice(0, index)) finish(step);
    }
    // Opened while it sits at a question: the question is part of what already happened; keep waiting for the answer.
    if (from.waiting && index < steps.length && "ask" in steps[index]) {
      finish(steps[index]);
      waiting = true;
      return;
    }
    schedule();
  }, 0);

  return {
    send(message: TerminalMessage) {
      if (closed || message.type === "resize") return;
      // The recorded agent always shows a text prompt, so a submitted response is typed and sent.
      const data = message.type === "submit" ? `${message.data}\r` : message.data;
      const answered = /[\r\n]/.test(data);
      // echo what was typed, like a terminal in cooked mode would
      write(data.replace(/\r\n?|\n/g, "\r\n").replace(/\x7f/g, "\b \b"));
      if (waiting && answered) {
        waiting = false;
        index++;
        progress();
        schedule();
      }
      if (message.type === "submit") handlers.onSubmitted(true);
    },
    type(text: string) {
      if (!closed) write(text);
    },
    close() {
      closed = true;
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
    },
  };
}
