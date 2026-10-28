import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useGitLookup } from "../src/server/paths.ts";

export const FIXTURES = join(import.meta.dir, "fixtures");

/** Points SPEC_CONTROL_HOME at a fresh temp dir for the duration of a test file. */
export async function useTempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "osd-home-"));
  const previous = process.env.SPEC_CONTROL_HOME;
  process.env.SPEC_CONTROL_HOME = home;
  return {
    home,
    cleanup: async () => {
      if (previous === undefined) delete process.env.SPEC_CONTROL_HOME;
      else process.env.SPEC_CONTROL_HOME = previous;
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** Canonical, because repository paths are: on macOS the temp dir is reached through the /var → /private/var symlink. */
export async function tempDir(prefix = "osd-"): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** True for strings that contain something shaped like a real user's home directory (the demo's /home/demo is allowed). */
export function looksLikeRealHome(text: string): boolean {
  return /\/Users\/[^/\s"']+/.test(text) || /\/home\/(?!demo(?:\/|\b))[^/\s"']+/.test(text) || /[A-Za-z]:\\+Users\\+[^\\\s"']+/.test(text);
}

/** Runs git for test setup with a fixed identity and date; throws with git's message on failure. */
export async function gitIn(cwd: string, ...args: string[]): Promise<void> {
  const date = "2026-03-01T10:00:00+01:00";
  const proc = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
}

/** Every file and directory under `root` with size, mtime and content hash — equal before and after means nothing was created, modified or deleted. */
export async function treeFingerprint(root: string): Promise<string> {
  const lines: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name);
      const info = await lstat(p);
      if (entry.isDirectory()) {
        lines.push(`d ${p} ${info.mtimeMs}`);
        await visit(p);
      } else {
        lines.push(`f ${p} ${info.size} ${info.mtimeMs} ${entry.isFile() ? Bun.hash(await readFile(p)) : "link"}`);
      }
    }
  };
  await visit(root);
  return lines.join("\n");
}

export interface FakeMac {
  /** The folder holding the placeholder, `<root>/usr/bin`: put it on the PATH where macOS has `/usr/bin`. */
  usrBin: string;
  /** Every time the placeholder was run, one line of its arguments. */
  placeholderRuns: () => Promise<string[]>;
  /** The link `xcode-select --switch` would maintain; absent until a test makes it. */
  selectLink: string;
  /** Installs the command line developer tools in a folder of its own, for `DEVELOPER_DIR` or the link to name. */
  installDeveloperTools: () => Promise<string>;
  /** Sets `DEVELOPER_DIR` for the lookup, as a user's shell would. */
  setDeveloperDirVariable: (dir: string) => void;
  /** Back to this machine's own git lookup. */
  restore: () => void;
}

/**
 * A Mac without the command line developer tools, on any machine: a stand-in for `/usr/bin/git` that only records being
 * run (the real one would offer to install the tools), and no developer directory at all — until a test adds one.
 */
export async function fakeMac(): Promise<FakeMac> {
  const root = await tempDir("osd-mac-");
  const usrBin = join(root, "usr", "bin");
  const runs = join(root, "placeholder.log");
  await mkdir(usrBin, { recursive: true });
  await writeFile(join(usrBin, "git"), `#!/bin/sh\necho "$@" >> "${runs}"\nexit 1\n`);
  await chmod(join(usrBin, "git"), 0o755);
  const selectLink = join(root, "xcode_select_link");
  const lookup = { platform: "darwin", placeholder: join(usrBin, "git"), selectLink, developerDirs: [join(root, "Xcode.app", "Contents", "Developer"), join(root, "CommandLineTools")] };
  useGitLookup({ ...lookup, env: {} });
  return {
    usrBin,
    selectLink,
    placeholderRuns: async () => (await readFile(runs, "utf8").catch(() => "")).split("\n").filter(Boolean),
    installDeveloperTools: async () => {
      const dir = join(root, "tools");
      await mkdir(join(dir, "usr", "bin"), { recursive: true });
      await writeFile(join(dir, "usr", "bin", "git"), "#!/bin/sh\nexit 0\n");
      await chmod(join(dir, "usr", "bin", "git"), 0o755);
      return dir;
    },
    setDeveloperDirVariable: (dir) => useGitLookup({ ...lookup, env: { DEVELOPER_DIR: dir } }),
    restore: () => useGitLookup(undefined),
  };
}
