import type { AgentPermissionProfileId } from "./types.ts";

/** Project command prefixes are deliberately a small literal language, never shell or vendor rule syntax. */
export const MAX_CUSTOM_COMMANDS = 50;
export const MAX_CUSTOM_COMMAND_LENGTH = 256;
export const MAX_CUSTOM_COMMAND_INPUT_LENGTH = 50 * 1024;

/** Shared capability source for the adapter preview/launch and project settings explanation. */
export function customCommandCapability(agentId: string | undefined, profile: AgentPermissionProfileId): "inactive" | "supported" | "unsupported" {
  if (profile === "minimum") return "inactive";
  return agentId === "claude" ? "supported" : "unsupported";
}

const TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const bypassFlags = new Set([
  "--dangerously-skip-permissions", "--no-sandbox", "--yolo", "--allow-all", "--ignore-safety",
  "--skip-permissions", "--disable-sandbox", "--full-auto",
]);
const wrappers = new Set(["sh", "bash", "zsh", "dash", "fish", "eval", "exec", "env", "command", "xargs", "sudo", "su", "npx", "bunx", "uvx", "pipx"]);
const dangerousExecutables = new Set(["rm", "rmdir", "chmod", "chown", "brew", "apt", "apt-get"]);
const interpreters = new Set(["python", "python2", "python3", "node", "ruby", "perl", "php", "lua", "deno", "bun"]);
const protectedOps = new Set([
  "git reset", "git clean", "git merge", "git rebase", "git cherry-pick", "git revert", "git worktree remove",
  "git worktree prune", "git branch -D", "git branch --delete", "git push", "gh pr merge", "gh pr close",
  "gh pr review", "rm -r", "rm -f", "rmdir", "chmod", "chown", "brew", "apt", "apt-get",
]);

function basename(token: string): string {
  return token.split("/").at(-1)!.toLowerCase();
}

function validatePrefix(prefix: string): string | undefined {
  const tokens = prefix.split(" ");
  if (!tokens.length || tokens.some((token) => !TOKEN.test(token))) return "use literal command tokens separated by spaces";
  const executable = basename(tokens[0]!);
  const command = [executable, ...tokens.slice(1)];
  if (wrappers.has(executable)) return "shells, command wrappers and privilege escalation cannot be allowed";
  if (dangerousExecutables.has(executable)) return "filesystem deletion, privilege and package-management commands cannot be allowed";
  if ((executable === "npm" && ["exec", "x"].includes(tokens[1] ?? "")) || (executable === "pnpm" && ["exec", "dlx"].includes(tokens[1] ?? "")) || (executable === "yarn" && tokens[1] === "dlx") || executable === "corepack") return "package-manager dispatch wrappers cannot be allowed";
  if (interpreters.has(executable) && tokens.some((token, index) => index > 0 && ["-c", "--eval", "-e", "-p", "--print", "-r", "-m"].includes(token))) {
    return "interpreter inline-code modes cannot be allowed";
  }
  if (tokens.some((token) => bypassFlags.has(token.toLowerCase()) || /bypass|dangerously|skip.?permissions|--no.?sandbox|--full.?auto/i.test(token))) return "permission bypass flags cannot be allowed";
  if (executable === "git" || executable === "gh") {
    if (command.length === 1) return "bare git and gh prefixes are too broad";
    const operation = command.slice(0, 3).join(" ");
    if (protectedOps.has(command.slice(0, 2).join(" ")) || protectedOps.has(operation)) return "prefix overlaps a protected or gated operation";
    if (executable === "git" && command[1] === "branch") return "git branch prefixes overlap branch-cleanup operations";
    if (executable === "git" && command[1] === "push" && command.length <= 3) return "git push prefixes are too broad";
    if (executable === "gh" && command[1] === "pr") return "gh pr prefixes overlap protected and gated operations";
    if (executable === "git" && command[1] === "worktree" && command.length <= 3) return "git worktree prefixes are too broad";
  }
  return undefined;
}

/** Normalize, deduplicate and validate an entire list atomically. */
export function normalizeCustomCommands(input: unknown): { commands?: string[]; error?: string } {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== "string")) return { error: "commands must be a list of strings" };
  const raw = input as string[];
  if (raw.length > MAX_CUSTOM_COMMANDS) return { error: `at most ${MAX_CUSTOM_COMMANDS} commands are allowed` };
  if (raw.some((entry) => entry.length > MAX_CUSTOM_COMMAND_INPUT_LENGTH)) return { error: "command input is too large" };
  if (raw.some((entry) => [...entry].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  }))) return { error: "control characters are not allowed" };
  const commands: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = entry.trim().replace(/ +/gu, " ");
    if (!normalized) return { error: "commands cannot be empty" };
    if (normalized.length > MAX_CUSTOM_COMMAND_LENGTH) return { error: `commands must be at most ${MAX_CUSTOM_COMMAND_LENGTH} characters` };
    const error = validatePrefix(normalized);
    if (error) return { error: `invalid command prefix: ${error}` };
    if (!seen.has(normalized)) { seen.add(normalized); commands.push(normalized); }
  }
  return { commands };
}

