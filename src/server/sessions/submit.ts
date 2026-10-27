// Submitting text to an agent's terminal on the user's behalf (design: submit-agent-input D1/D2).
//
// Type the text, wait until the terminal shows it back, then press Enter as a separate write. A text prompt shows
// typed characters; a selection menu does not — there Enter would confirm whatever is highlighted, so it is never
// pressed blind. A separate Enter is also what makes long text submit: written in one burst with the text, the
// carriage return is taken as part of a paste.
//
// The text itself is typed in small pieces (archive-button-wrong-text D1). A pseudo-terminal's input queue holds about
// 1 KB (1024 bytes on macOS); a longer write reaches the agent in reads split wherever the queue filled, and an agent
// that takes a large read for a paste then shows a placeholder followed by a fragment. Pieces well below that bound,
// with a pause after each, reach the agent whole and in order.
//
// This is the only place where the dashboard looks at an agent's output, and only to answer one question: did the
// text we just typed appear? Nothing observed here is stored, logged or forwarded.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// OSC … (BEL | ESC \), CSI … final byte, and two-character escapes. Built from strings: no control characters in source.
const ANSI = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[@-Z\\\\-_]`, "g");

export const PROBE_LENGTH = 48;
/** Share of the probe that must be found, in order, inside one window. */
const REQUIRED_SHARE = 0.85;
/** A window may be this much longer than the probe (room for a few foreign characters). */
const WINDOW_SLACK = 1.25;
/** Only the most recent output is searched; an echo is recent by definition. */
const SEARCH_LIMIT = 4096;

export function stripAnsi(output: string): string {
  return output.replace(ANSI, "");
}

/** Terminal UIs wrap, pad and position text freely, so whitespace carries no information about what was typed. */
export function normalise(text: string): string {
  return stripAnsi(text).replace(/\s+/g, "");
}

/** What has to show up: the whole text when short, otherwise its beginning (long input may be truncated or scrolled). */
export function echoProbe(text: string): string {
  return normalise(text).slice(0, PROBE_LENGTH);
}

function lcsLength(a: string, b: string): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Whether `output` (raw terminal output since the text was written) shows `text`. Tolerant on purpose: terminal UIs
 * redraw only the cells that changed, so with text already in the input box an echo arrives with holes. The match
 * must still sit inside one narrow window, which keeps it far from "these letters occur somewhere".
 */
export function containsEcho(output: string, text: string): boolean {
  const probe = echoProbe(text);
  if (probe.length === 0) return false;
  const haystack = normalise(output).slice(-SEARCH_LIMIT);
  if (haystack.includes(probe)) return true;
  const required = Math.ceil(probe.length * REQUIRED_SHARE);
  if (haystack.length < required) return false;
  const windowLength = Math.ceil(probe.length * WINDOW_SLACK);
  const first = probe[0];
  const second = probe[1];
  for (let start = 0; start + required <= haystack.length; start++) {
    // A window worth checking starts at (or right after a dropped) first character of the probe.
    if (haystack[start] !== first && haystack[start] !== second) continue;
    if (lcsLength(probe, haystack.slice(start, start + windowLength)) >= required) return true;
  }
  return false;
}

/** The little a submission needs from a terminal. `onOutput` returns its unsubscribe function. */
export interface SubmitTerminal {
  write(data: string): void;
  onOutput(listener: (chunk: Uint8Array) => void): () => void;
}

export interface SubmitOptions {
  /** How long to wait, after the last piece, for the text to show up before giving up. */
  echoTimeoutMs?: number;
  /** Pause between the echo and Enter, so the agent has finished taking in the text. */
  settleMs?: number;
  /** Largest piece written at once, in UTF-8 bytes. */
  pieceBytes?: number;
  /** Pause after each piece but the last, so the agent reads it before the next arrives. */
  piecePauseMs?: number;
}

export const ECHO_TIMEOUT_MS = 2000;
export const SETTLE_MS = 400;
/** A quarter of the smallest pseudo-terminal input queue known (1024 bytes on macOS). */
export const PIECE_BYTES = 256;
export const PIECE_PAUSE_MS = 25;

/** `text` cut into pieces of at most `maxBytes` UTF-8 bytes, only between characters; joined, they are `text` again. */
export function submissionPieces(text: string, maxBytes: number = PIECE_BYTES): string[] {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let piece = "";
  let bytes = 0;
  // Iterating a string yields code points, so a surrogate pair is never cut in two.
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes && piece) {
      pieces.push(piece);
      piece = "";
      bytes = 0;
    }
    piece += char;
    bytes += size;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Types `text`, in pieces; presses Enter only once the terminal has shown it. Resolves `submitted: false` when it never showed
 * up — nothing further is written then, the text is simply left as typed.
 */
export async function submitText(terminal: SubmitTerminal, text: string, options: SubmitOptions = {}): Promise<{ submitted: boolean }> {
  const decoder = new TextDecoder();
  let seen = "";
  let matched: (() => void) | undefined;
  const unsubscribe = terminal.onOutput((chunk) => {
    if (chunk.length === 0) return;
    seen = (seen + decoder.decode(chunk, { stream: true })).slice(-4 * SEARCH_LIMIT);
    if (matched && containsEcho(seen, text)) matched();
  });
  try {
    let echo = false;
    matched = () => {
      echo = true;
    };
    const pieces = submissionPieces(text, options.pieceBytes ?? PIECE_BYTES);
    for (const [i, piece] of pieces.entries()) {
      terminal.write(piece);
      if (i < pieces.length - 1) await sleep(options.piecePauseMs ?? PIECE_PAUSE_MS);
    }
    // The wait starts once the whole text is typed (D2); an echo that already arrived counts.
    const echoed = echo
      ? Promise.resolve(true)
      : new Promise<boolean>((resolve) => {
          matched = () => resolve(true);
          setTimeout(() => resolve(false), options.echoTimeoutMs ?? ECHO_TIMEOUT_MS);
        });
    if (!(await echoed)) return { submitted: false };
    await sleep(options.settleMs ?? SETTLE_MS);
    terminal.write("\r");
    return { submitted: true };
  } finally {
    matched = undefined;
    unsubscribe();
  }
}

/** Text the dashboard is willing to submit: sentences, not key sequences. */
export function validSubmission(text: unknown): text is string {
  if (typeof text !== "string" || text.length === 0 || text.length > 4096) return false;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return normalise(text).length > 0;
}
