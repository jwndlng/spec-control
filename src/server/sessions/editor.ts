// Open in editor (openspec/specs/editor-launch): the user's editor on a change session's folder. The folder always
// comes from the server's own session records or session worktree list; nothing the browser sent reaches the command.
// The editor is the user's program, like the agent: started without a shell, detached, and then left alone — no
// terminal, no record, no waiting for it to exit.
import { stat } from "node:fs/promises";
import { DEFAULT_EDITOR, editorCommandLine, type AgentSessionsConfig } from "../../shared/types.ts";
import { whichOnPath } from "../paths.ts";

export class EditorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The editor command in effect: the configured one, else `code`. */
export function editorCommand(config: Pick<AgentSessionsConfig, "editor">): string[] {
  return [...(config.editor?.length ? config.editor : DEFAULT_EDITOR)];
}

/** Whether the editor's executable is found on this machine. */
export function editorFound(command: readonly string[]): boolean {
  return whichOnPath(command[0]) !== undefined;
}

/** The argument list that opens `folder`: `{path}` replaced where it stands, else the folder as one last argument. */
export function editorArgv(config: Pick<AgentSessionsConfig, "editor">, folder: string): string[] {
  return editorCommandLine(editorCommand(config), folder);
}

/**
 * Starts the editor once on `folder` and returns without waiting for it. `code` and `open` hand off and exit at once,
 * other editors stay in the foreground while open, so an exit code would mean nothing either way. Detached, so the
 * editor outlives the dashboard.
 */
export async function openEditor(argv: string[], folder: string): Promise<void> {
  const isFolder = await stat(folder).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!isFolder) throw new EditorError(409, `the folder ${folder} no longer exists`);
  const executable = whichOnPath(argv[0]);
  if (!executable) throw new EditorError(503, `the editor ${argv[0]} was not found; install it or change the editor command in Settings`);
  try {
    // The server's own environment as it is now: Bun.spawn would otherwise pass the one captured at start.
    Bun.spawn([executable, ...argv.slice(1)], { cwd: folder, env: { ...process.env }, stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true }).unref();
  } catch (err) {
    throw new EditorError(500, `the editor could not be started: ${err instanceof Error ? err.message : String(err)}`);
  }
}
