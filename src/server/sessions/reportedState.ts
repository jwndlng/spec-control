// What an agent may report about itself (improve-input-detection D2–D5): one word in a file the dashboard names in the
// agent's environment. The agent's own hooks write it; the dashboard only reads it, and never reads the agent's output.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { ManagedActionPhase, ManagedCompletionReport } from "../../shared/types.ts";

/** The environment variable that names the file. The whole contract with an agent is this name and the two words. */
export const STATE_FILE_ENV = "SPEC_CONTROL_STATE_FILE";

export type ReportedState = "waiting" | "working";

/** At most this much of the file is read: the two words fit many times over. */
export const REPORT_MAX_BYTES = 64;
export const COMPLETION_REPORT_MAX_BYTES = 1024;

export interface Report {
  state: ReportedState;
  /** The file's modification time: when the agent reported. */
  mtimeMs: number;
}

/**
 * Replies a browser terminal sends by itself — focus in/out, cursor position, device attributes and status, mode and
 * colour reports. Input made only of these is not the user's: it must not make an agent's report stale.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are exactly what is being recognised
const TERMINAL_REPLY = /\x1b\[[IO]|\x1b\[\d+;\d+R|\x1b\[[?>]?[\d;]*c|\x1b\[\d*n|\x1b\[\?[\d;]*\$y|\x1b\]\d+;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** True when every byte of `data` belongs to a terminal reply; empty input counts as one, since nobody typed it. */
export function terminalRepliesOnly(data: string): boolean {
  return data.replace(TERMINAL_REPLY, "") === "";
}

/** The word a file holds, or undefined for anything that is not exactly one of the two. */
export function parseReport(text: string): ReportedState | undefined {
  const word = text.trim().toLowerCase();
  return word === "waiting" || word === "working" ? word : undefined;
}

/** A completion report carries no authority beyond matching the server-issued action id and phase. */
export function parseCompletionReport(text: string): ManagedCompletionReport | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return undefined;
    const report = value as Partial<ManagedCompletionReport>;
    if (report.kind !== "phase-complete" || typeof report.actionId !== "string" || report.actionId.length < 16 || report.actionId.length > 128) return undefined;
    if (!(typeof report.phase === "string" && ["draft", "implement", "fastForward", "archive"].includes(report.phase))) return undefined;
    if (!Number.isSafeInteger(report.revision) || (report.revision as number) < 1) return undefined;
    return { kind: "phase-complete", actionId: report.actionId, phase: report.phase as ManagedActionPhase, revision: report.revision as number };
  } catch {
    return undefined;
  }
}

/**
 * The report at `path`, or undefined when there is none: missing, unreadable, not a regular file (a symbolic link is
 * not followed), larger than `REPORT_MAX_BYTES`, or holding anything but one of the two words. `known` is the report
 * read last time: when the file's modification time and size are unchanged it is returned without reading again.
 */
export async function readReport(path: string, known?: Report & { size: number }): Promise<(Report & { size: number }) | undefined> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.size > REPORT_MAX_BYTES) return undefined;
  if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); // a link swapped in after `lstat` is refused too
    const buffer = new Uint8Array(REPORT_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > REPORT_MAX_BYTES) return undefined;
    const state = parseReport(new TextDecoder().decode(buffer.subarray(0, bytesRead)));
    return state ? { state, mtimeMs: info.mtimeMs, size: info.size } : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Reads only a bounded, ordinary completion-report file; symlinks and malformed records are refused. */
export async function readCompletionReport(path: string): Promise<ManagedCompletionReport | undefined> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.size > COMPLETION_REPORT_MAX_BYTES) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const buffer = new Uint8Array(COMPLETION_REPORT_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > COMPLETION_REPORT_MAX_BYTES) return undefined;
    return parseCompletionReport(new TextDecoder().decode(buffer.subarray(0, bytesRead)));
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
