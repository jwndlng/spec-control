import { expect, test } from "bun:test";
import { containsEcho, echoProbe, normalise, PIECE_BYTES, stripAnsi, submissionPieces, submitText, validSubmission, type SubmitTerminal } from "../src/server/sessions/submit.ts";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const csi = (body: string) => `${ESC}[${body}`;
const SHIP = "Ship the work in this worktree: commit everything that belongs to it with a Conventional Commit message, push the branch, and open a pull request.";

test("stripAnsi removes CSI, OSC and two-character escapes and nothing else", () => {
  const raw = `${csi("2K")}${csi("1;32m")}Yes${csi("0m")}, ${ESC}]0;window title${BEL}go ${ESC}]8;;https://example.invalid${ESC}\\ahead${ESC}M`;
  expect(stripAnsi(raw)).toBe("Yes, go ahead");
  expect(normalise(raw)).toBe("Yes,goahead");
});

test("the probe is the whole short text, or the first 48 normalised characters of a long one", () => {
  expect(echoProbe("Yes, go ahead")).toBe("Yes,goahead");
  expect(echoProbe(SHIP)).toBe(normalise(SHIP).slice(0, 48));
  expect(echoProbe(SHIP).length).toBe(48);
});

const shown: [string, string, string][] = [
  ["plain echo", "Yes, go ahead", "> Yes, go ahead"],
  ["interleaved with colour and cursor movement", "Yes, go ahead", `${csi("2K")}${csi("1G")}❯${csi("3G")}Yes,${csi("8G")}go${csi("11G")}${csi("1m")}ahead${csi("0m")}`],
  ["long text wrapped over lines with padding", SHIP, `❯ Ship the work in this worktree: commit everything   \r\n  that belongs to it with a Conventional Commit message,   \r\n  push the branch`],
  ["long text of which only the beginning is shown", SHIP, `❯ ${SHIP.slice(0, 70)}…`],
  ["partial redraw: unchanged cells are not re-sent (seen with the real agent)", "Compute 19 times 3 and reply with the digits only, nothing else.", "Cmpute 19 times 3 and reply with thedigits only, nothing else. Thissetenc"],
  ["echo after other output", "No, stop here", `${"working… ".repeat(40)}\r\n❯ No, stop here`],
];
for (const [name, text, output] of shown) {
  test(`shown: ${name}`, () => expect(containsEcho(output, text)).toBe(true));
}

const notShown: [string, string, string][] = [
  ["no output at all", "Yes, go ahead", ""],
  ["a menu redraw that ignores typed text", "Yes, go ahead", `${csi("H")} Quick safety check: Is this a project you trust?\r\n ❯ No, exit\r\n   Yes, I trust this folder\r\n Enter to confirm · Esc to cancel`],
  ["the same letters scattered through unrelated output", "Yes, go ahead", "Yesterday, a gopher added heavy loads: ahead of schedule, yes; go? a head start."],
  ["only the first word", "Yes, create a PR", "❯ Yes"],
  ["a different long prompt", SHIP, "❯ Summarise the work in this worktree and tell me what is left to do before it can be merged."],
];
for (const [name, text, output] of notShown) {
  test(`not shown: ${name}`, () => expect(containsEcho(output, text)).toBe(false));
}

test("text without visible characters is never considered shown", () => {
  expect(containsEcho("anything", "   ")).toBe(false);
});

/** A terminal whose behaviour is scripted per test; records every write. */
function fakeTerminal(onWrite: (data: string, emit: (output: string) => void) => void) {
  const writes: string[] = [];
  const listeners = new Set<(chunk: Uint8Array) => void>();
  const emit = (output: string) => {
    for (const listener of [...listeners]) listener(new TextEncoder().encode(output));
  };
  const terminal: SubmitTerminal = {
    write: (data) => {
      writes.push(data);
      onWrite(data, emit);
    },
    onOutput: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { terminal, writes, listeners, emit };
}

const FAST = { echoTimeoutMs: 120, settleMs: 10 };

test("an echoing terminal gets the text, then Enter as a separate write", async () => {
  const t = fakeTerminal((data, emit) => data !== "\r" && setTimeout(() => emit(`❯ ${data}`), 5));
  expect(await submitText(t.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: true });
  expect(t.writes).toEqual(["Yes, go ahead", "\r"]);
  expect(t.listeners.size).toBe(0);
});

test("a terminal that does not show the text gets the text and never an Enter", async () => {
  const t = fakeTerminal((_data, emit) => setTimeout(() => emit(" ❯ No, exit\r\n   Yes, I trust this folder"), 5));
  expect(await submitText(t.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: false });
  expect(t.writes).toEqual(["Yes, go ahead"]);
  expect(t.listeners.size).toBe(0);
});

test("a silent terminal times out without Enter", async () => {
  const t = fakeTerminal(() => {});
  expect(await submitText(t.terminal, "No, stop here", FAST)).toEqual({ submitted: false });
  expect(t.writes).toEqual(["No, stop here"]);
});

test("an echo arriving in several chunks, split inside an escape sequence, is recognised", async () => {
  const t = fakeTerminal((data, emit) => {
    if (data === "\r") return;
    setTimeout(() => emit(`${ESC}[1`), 5);
    setTimeout(() => emit(`mYes, go`), 10);
    setTimeout(() => emit(` ah`), 15);
    setTimeout(() => emit(`ead${ESC}[0m`), 20);
  });
  expect(await submitText(t.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: true });
  expect(t.writes).toEqual(["Yes, go ahead", "\r"]);
});

test("output from before the write does not count", async () => {
  const t = fakeTerminal(() => {});
  t.emit("❯ Yes, go ahead"); // nobody is listening yet
  expect(await submitText(t.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: false });
});

test("an echo just before the timeout still submits; one after it does not", async () => {
  const early = fakeTerminal((data, emit) => data !== "\r" && setTimeout(() => emit(data), 80));
  expect(await submitText(early.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: true });
  const late = fakeTerminal((data, emit) => data !== "\r" && setTimeout(() => emit(data), 200));
  expect(await submitText(late.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: false });
  await new Promise((r) => setTimeout(r, 120));
  expect(late.writes).toEqual(["Yes, go ahead"]);
});

test("an exit marker (empty chunk) during the wait is ignored and nothing more is written", async () => {
  const t = fakeTerminal((_data, emit) => setTimeout(() => emit(""), 5));
  expect(await submitText(t.terminal, "Yes, go ahead", FAST)).toEqual({ submitted: false });
  expect(t.writes).toEqual(["Yes, go ahead"]);
});

const bytes = (text: string) => new TextEncoder().encode(text).length;

const piecesCases: [string, string, number][] = [
  ["short text is one piece", "Yes, go ahead", 256],
  ["exactly the bound is one piece", "x".repeat(256), 256],
  ["one byte over is two pieces", "x".repeat(257), 256],
  ["a dash on the boundary is not cut", `${"x".repeat(255)}—${"y".repeat(10)}`, 256],
  ["an emoji (surrogate pair) on the boundary is not cut", `${"x".repeat(254)}🚀${"y".repeat(10)}`, 256],
  ["the longest valid submission", "Archive — sync, then archive. ".repeat(136).slice(0, 4096), 256],
];
for (const [name, text, max] of piecesCases) {
  test(`pieces: ${name}`, () => {
    const pieces = submissionPieces(text, max);
    expect(pieces.join("")).toBe(text);
    for (const piece of pieces) {
      expect(bytes(piece)).toBeLessThanOrEqual(max);
      expect(piece.length).toBeGreaterThan(0);
    }
  });
}

test("pieces: the default bound is a quarter of a 1024-byte input queue", () => {
  expect(PIECE_BYTES).toBe(256);
  expect(submissionPieces("x".repeat(1200)).map(bytes)).toEqual([256, 256, 256, 256, 176]);
});

test("a long text is written in pieces of at most the bound, in order, then Enter once", async () => {
  const text = "Ship — commit, push and open a pull request. ".repeat(27);
  expect(bytes(text)).toBeGreaterThan(1024);
  let typed = "";
  const t = fakeTerminal((data, emit) => {
    if (data === "\r") return;
    typed += data;
    emit(data);
  });
  expect(await submitText(t.terminal, text, { ...FAST, piecePauseMs: 1 })).toEqual({ submitted: true });
  expect(t.writes.at(-1)).toBe("\r");
  expect(t.writes.filter((w) => w === "\r").length).toBe(1);
  expect(t.writes.slice(0, -1).join("")).toBe(text);
  for (const piece of t.writes.slice(0, -1)) expect(bytes(piece)).toBeLessThanOrEqual(256);
  expect(typed).toBe(text);
});

test("the echo wait starts after the last piece: an echo that only follows it still submits", async () => {
  const text = "x".repeat(1000);
  let pieces = 0;
  const t = fakeTerminal((data, emit) => {
    if (data === "\r") return;
    // Echoed only once everything is typed, as an agent that redraws after a burst would.
    if (++pieces === 4) setTimeout(() => emit(text), 80);
  });
  expect(await submitText(t.terminal, text, { ...FAST, piecePauseMs: 40 })).toEqual({ submitted: true });
  expect(t.writes.length).toBe(5);
});

test("only sentences are valid submissions", () => {
  expect(validSubmission("Yes, go ahead")).toBe(true);
  expect(validSubmission(SHIP)).toBe(true);
  for (const bad of ["", "   ", `up${ESC}[A`, "line\rbreak", "tab\there", "x".repeat(4097), 42, null, undefined, { text: "x" }]) expect(validSubmission(bad)).toBe(false);
});
