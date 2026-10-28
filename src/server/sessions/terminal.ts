// A child process attached to a pseudo-terminal, which is what an interactive agent CLI expects.
export interface TerminalOptions {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (chunk: Uint8Array) => void;
}

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Hang-up first, as closing a terminal window would; a hard kill follows if the process ignores it. */
  kill(): void;
  /** `SIGKILL` now, for a process that outlived the hang-up's grace period when nothing may wait for the timer. */
  forceKill(): void;
  pid: number;
  exited: Promise<number | null>;
}

interface BunTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export const KILL_GRACE_MS = 2000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n) || lo));

export function spawnTerminal(options: TerminalOptions): TerminalProcess {
  const proc = Bun.spawn(options.argv, {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: clamp(options.cols ?? 120, 20, 500),
      rows: clamp(options.rows ?? 32, 5, 200),
      data: (_terminal: unknown, chunk: Uint8Array) => options.onData(chunk),
    },
    // `terminal` is newer than the bundled type declarations.
  } as unknown as Parameters<typeof Bun.spawn>[1]);
  const terminal = (proc as unknown as { terminal: BunTerminal }).terminal;

  const exited = proc.exited.then((code) => {
    try {
      terminal.close();
    } catch {
      // already closed
    }
    return code;
  });

  return {
    write: (data) => {
      try {
        terminal.write(data);
      } catch {
        // the process is gone; `exited` reports it
      }
    },
    resize: (cols, rows) => {
      try {
        terminal.resize(clamp(cols, 20, 500), clamp(rows, 5, 200));
      } catch {
        // gone
      }
    },
    kill: () => {
      proc.kill("SIGHUP");
      const timer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
      (timer as { unref?: () => void }).unref?.();
      void proc.exited.then(() => clearTimeout(timer));
    },
    forceKill: () => proc.kill("SIGKILL"),
    pid: proc.pid,
    exited,
  };
}
