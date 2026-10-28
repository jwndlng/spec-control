// Puts a fake editor first on PATH under a chosen name, so the editor tests exercise the real spawning code without a
// real editor. The fake records each start; nothing here starts a process itself.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES, tempDir } from "./helpers.ts";
import { waitFor } from "./sessionHelpers.ts";

export const FAKE_EDITOR = join(FIXTURES, "fake-editor.ts");

export interface EditorStart {
  argv: string[];
  cwd: string;
}

export interface EditorHarness {
  /** Every start so far, in order. */
  starts(): Promise<EditorStart[]>;
  /** Waits until `count` starts were recorded; the editor is detached, so its record lands after the request returned. */
  waitForStarts(count: number): Promise<EditorStart[]>;
  /** Restores PATH and the log variable. */
  restore(): void;
}

/** Writes an executable `name` (default `fake-editor`) that runs the fake, first on PATH, logging outside any repository. */
export async function installFakeEditor(name = "fake-editor"): Promise<EditorHarness> {
  const base = await tempDir("osd-editor-");
  const bin = join(base, "bin");
  await mkdir(bin, { recursive: true });
  const shim = join(bin, name);
  await writeFile(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_EDITOR)} "$@"\n`);
  await chmod(shim, 0o755);
  const logPath = join(base, "starts.jsonl");
  await writeFile(logPath, "");
  const before = { PATH: process.env.PATH, FAKE_EDITOR_LOG: process.env.FAKE_EDITOR_LOG };
  process.env.FAKE_EDITOR_LOG = logPath;
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  const starts = async () =>
    (await readFile(logPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EditorStart);
  return {
    starts,
    waitForStarts: async (count) => {
      await waitFor(async () => (await starts()).length >= count, `${count} editor start(s)`);
      return starts();
    },
    restore: () => {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
