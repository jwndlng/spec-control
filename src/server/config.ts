import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { AGENT_PRESETS, defaultAgentSessions } from "../shared/agentDefaults.ts";
import { MAX_LABEL_COLORS, MAX_LABEL_LENGTH, MAX_LABELS } from "../shared/labels.ts";
import type { Config, PromptKey, RepoConfig } from "../shared/types.ts";
import { canonicalPath, configPath, dashboardHome, expandPath } from "./paths.ts";

export const DEFAULT_PORT = 4711;
export const DEFAULT_POLL_SECONDS = 60;
export const MIN_POLL_SECONDS = 10;

const absolutePath = z
  .string()
  .min(1)
  .transform(canonicalPath)
  .refine(isAbsolute, { message: "must be an absolute path" });

const scanRootsSchema = z.array(absolutePath);
const ignorePathsSchema = z.array(absolutePath);

// A profile is the user's own command line, but the dashboard never helps switching off an agent's permission checks.
const BYPASS = /bypassPermissions|dangerously|skip-permissions|--yolo/i;
const noBypass = (value: string) => !BYPASS.test(value);
const BYPASS_MESSAGE = "must not contain a permission-bypass mode or flag";

const placeholdersOnly = (allowed: string[]) => (v: string) => (v.match(/\{[^}]*\}/g) ?? []).every((ph) => allowed.includes(ph));

const commandSchema = z
  .array(z.string().min(1).refine(noBypass, { message: BYPASS_MESSAGE }).refine(placeholdersOnly(["{prompt}"]), { message: "unknown placeholder; only {prompt} is supported" }))
  .min(1, { message: "command must name an executable" })
  .refine((args) => args.length === 0 || !args[0].includes("{"), { message: "the executable cannot be a placeholder" });

const promptSchema = z
  .string()
  .trim()
  .min(1)
  .refine(placeholdersOnly(["{change}"]), { message: "unknown placeholder; only {change} is supported" })
  .refine((v) => v.includes("{change}"), { message: "must contain {change}" })
  .refine(noBypass, { message: BYPASS_MESSAGE });

// Ship is plain language about the worktree the agent already sits in, so it does not have to name the change.
const shipPromptSchema = z
  .string()
  .trim()
  .min(1)
  .refine(placeholdersOnly(["{change}"]), { message: "unknown placeholder; only {change} is supported" })
  .refine(noBypass, { message: BYPASS_MESSAGE });

// Integrate belongs to no change: the repository folder is the agent's working directory, so nothing from the browser
// is substituted into it at all. Rejecting every placeholder is what makes that guarantee checkable.
const integratePromptSchema = z
  .string()
  .trim()
  .min(1)
  .refine(placeholdersOnly([]), { message: "no placeholder is supported in an Integrate prompt" })
  .refine(noBypass, { message: BYPASS_MESSAGE });

/**
 * Additional instructions appended to a prompt. Same rules as the prompt they extend, minus the requirement to name the
 * change: a suffix may mention `{change}` but does not have to, and an Integrate suffix carries no placeholder at all —
 * that is what keeps the Integrate guarantee ("nothing from the browser is substituted into it") checkable per key.
 */
const suffixSchema = z
  .string()
  .trim()
  .min(1)
  .refine(placeholdersOnly(["{change}"]), { message: "unknown placeholder; only {change} is supported" })
  .refine(noBypass, { message: BYPASS_MESSAGE });

const integrateSuffixSchema = z
  .string()
  .trim()
  .min(1)
  .refine(placeholdersOnly([]), { message: "no placeholder is supported in additional Integrate instructions" })
  .refine(noBypass, { message: BYPASS_MESSAGE });

const agentProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, { message: "lower-case letters, digits and dashes" }),
  name: z.string().trim().min(1),
  command: commandSchema,
  prompts: z
    .object({
      draft: promptSchema.optional(),
      implement: promptSchema.optional(),
      validate: promptSchema.optional(),
      archive: promptSchema.optional(),
      ship: shipPromptSchema.optional(),
      resolveConflicts: shipPromptSchema.optional(),
      merge: shipPromptSchema.optional(),
      integrate: integratePromptSchema.optional(),
    })
    .default({}),
  promptSuffixes: z
    .object({
      draft: suffixSchema.optional(),
      implement: suffixSchema.optional(),
      validate: suffixSchema.optional(),
      archive: suffixSchema.optional(),
      ship: suffixSchema.optional(),
      resolveConflicts: suffixSchema.optional(),
      merge: suffixSchema.optional(),
      integrate: integrateSuffixSchema.optional(),
    })
    .optional(),
  resumeCommand: z.array(z.string().min(1).refine(noBypass, { message: BYPASS_MESSAGE })).min(1).optional(),
  unsetEnv: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).optional(),
});

// A shortcut's prompt is typed into a running agent's terminal, so it has to be one line: a newline would submit the
// text past the echo check that decides about Enter (server/sessions/submit.ts). The title only ever reaches a control.
const isSingleLine = (value: string) =>
  ![...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });

const shortcutSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, { message: "lower-case letters, digits and dashes" }),
  title: z.string().trim().min(1).max(40, { message: "a title has to fit on a control: at most 40 characters" }),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(isSingleLine, { message: "must be a single line without control characters" })
    .refine(noBypass, { message: BYPASS_MESSAGE }),
});

// Older configs carried Claude-specific keys here (claudePath, commands, allowedTools, …); unknown keys are dropped.
export { defaultAgentSessions };

const agentSessionsSchema = z
  .object({
    enabled: z.boolean().default(false),
    agents: z.array(agentProfileSchema).min(1).default(() => defaultAgentSessions().agents),
    defaultAgent: z.string().default(() => defaultAgentSessions().defaultAgent),
    // Shape only: a config whose console folder was deleted since must still load. Saving checks the folder itself.
    consoleDir: absolutePath.optional(),
    // Absent means the default agent; Settings stores "default agent" that way so the console follows the default.
    consoleAgent: z.string().optional(),
    // Absent means a config saved before shortcuts were configurable: it carries the shipped ones. An empty list is the
    // user's own decision and is kept — the dashboard never adds a shortcut back.
    shortcuts: z.array(shortcutSchema).default(() => defaultAgentSessions().shortcuts),
    // Absent means Fast-forward asks first; only the user's "don't show this warning again" or Settings makes it false.
    confirmFastForward: z.boolean().optional(),
  })
  .default({})
  .superRefine((cfg, ctx) => {
    const ids = cfg.agents.map((a) => a.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["agents"], message: "agent ids must be unique" });
    if (!ids.includes(cfg.defaultAgent)) ctx.addIssue({ code: "custom", path: ["defaultAgent"], message: "must be the id of a configured agent" });
    if (cfg.consoleAgent !== undefined && !ids.includes(cfg.consoleAgent)) ctx.addIssue({ code: "custom", path: ["consoleAgent"], message: "unknown agent" });
    const shortcutIds = cfg.shortcuts.map((s) => s.id);
    if (new Set(shortcutIds).size !== shortcutIds.length) ctx.addIssue({ code: "custom", path: ["shortcuts"], message: "shortcut ids must be unique" });
  });

const labelSchema = z
  .string()
  .trim()
  .min(1, { message: "a label cannot be empty" })
  .max(MAX_LABEL_LENGTH, { message: `a label has at most ${MAX_LABEL_LENGTH} characters` })
  .refine(isSingleLine, { message: "a label cannot contain control characters" })
  .refine((v) => !v.includes(","), { message: "a label cannot contain a comma" });

// Optional with no default: a config saved before labels existed loads, and saves, without the key.
const labelsSchema = z.array(labelSchema).max(MAX_LABELS, { message: `at most ${MAX_LABELS} labels per repository` }).optional();

// A chosen label colour: any whole degree, so retuning the palette never makes a saved config unreadable — the UI snaps
// it to the nearest assignable hue. Optional with no default, like the label lists.
const labelColorsSchema = z
  .record(z.string(), z.number().int({ message: "a label colour is a whole number of degrees" }).min(0, { message: "a label colour is a hue from 0 to 359" }).max(359, { message: "a label colour is a hue from 0 to 359" }))
  .optional();

/** Why `key` cannot name a label colour: the label rules, stored in lower case. Undefined when it can. */
function labelColorKeyProblem(key: string): string | undefined {
  const parsed = labelSchema.safeParse(key);
  if (!parsed.success) return parsed.error.issues[0]?.message;
  if (parsed.data !== key) return "a label cannot start or end with spaces";
  if (key !== key.toLowerCase()) return "a label colour is stored under the label in lower case";
  return undefined;
}

const repoSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{12}$/),
  path: absolutePath,
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  agent: z.object({ enabled: z.boolean(), agentId: z.string().optional(), autoMergeDocs: z.boolean().optional() }).optional(),
  labels: labelsSchema,
  hiddenLabels: labelsSchema,
  prTitleConvention: z.literal("conventional-commits").optional(),
  // AUTO_FETCH_SECONDS and 0 (Off), spelled out for zod's tuple; a test keeps the two equal.
  autoFetchSeconds: z
    .union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(300), z.literal(600), z.literal(900), z.literal(1800), z.literal(3600)])
    .optional(),
});

/** The first label that repeats another one of the list, ignoring case. */
function duplicateLabel(labels: string[] | undefined): string | undefined {
  const seen = new Set<string>();
  for (const label of labels ?? []) {
    const key = label.toLowerCase();
    if (seen.has(key)) return label;
    seen.add(key);
  }
  return undefined;
}

export const configSchema = z
  .object({
    version: z.literal(1),
    scanRoots: scanRootsSchema,
    ignorePaths: ignorePathsSchema.default([]),
    repos: z.array(repoSchema),
    pollIntervalSeconds: z.number().int().min(MIN_POLL_SECONDS),
    port: z.number().int().min(1024).max(65535),
    agentSessions: agentSessionsSchema,
    labelColors: labelColorsSchema,
    // Only `false` is stored: on is the default and is written as no key at all.
    updateCheck: z
      .boolean()
      .optional()
      .transform((on) => (on === false ? (false as const) : undefined)),
    // Likewise: Keep awake while agents work is on unless it is stored as `false` (openspec/specs/keep-awake).
    keepAwake: z
      .boolean()
      .optional()
      .transform((on) => (on === false ? (false as const) : undefined)),
    // Only `"pending"` is stored, and only by `freshConfig`; anything else reads as "set up".
    setup: z
      .unknown()
      .optional()
      .transform((value) => (value === "pending" ? ("pending" as const) : undefined)),
  })
  .superRefine((cfg, ctx) => {
    const colored = Object.keys(cfg.labelColors ?? {});
    if (colored.length > MAX_LABEL_COLORS) ctx.addIssue({ code: "custom", path: ["labelColors"], message: `at most ${MAX_LABEL_COLORS} label colours` });
    for (const key of colored) {
      const problem = labelColorKeyProblem(key);
      if (problem) ctx.addIssue({ code: "custom", path: ["labelColors", key], message: `label "${key}": ${problem}` });
    }
    const ids = new Set<string>();
    for (const [i, repo] of cfg.repos.entries()) {
      if (ids.has(repo.id)) {
        ctx.addIssue({ code: "custom", path: ["repos", i, "id"], message: `duplicate repo id ${repo.id}` });
      }
      ids.add(repo.id);
      if (repo.agent?.agentId && !cfg.agentSessions.agents.some((a) => a.id === repo.agent?.agentId)) {
        ctx.addIssue({ code: "custom", path: ["repos", i, "agent", "agentId"], message: "unknown agent" });
      }
      for (const key of ["labels", "hiddenLabels"] as const) {
        const dup = duplicateLabel(repo[key]);
        if (dup !== undefined) ctx.addIssue({ code: "custom", path: ["repos", i, key], message: `${repo.name}: label "${dup}" is listed twice` });
      }
      if (repo.id !== repoId(repo.path)) {
        ctx.addIssue({ code: "custom", path: ["repos", i, "id"], message: "id does not match path" });
      }
    }
  });

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid config: ${issues.join("; ")}`);
  }
}

export function defaultConfig(): Config {
  return { version: 1, scanRoots: [], ignorePaths: [], repos: [], pollIntervalSeconds: DEFAULT_POLL_SECONDS, port: DEFAULT_PORT, agentSessions: defaultAgentSessions() };
}

/** A configuration made because none could be loaded: the defaults, with the setup wizard still to come. */
export function freshConfig(): Config {
  return { ...defaultConfig(), setup: "pending" };
}

/** Stable identity for a repository: 12 hex chars of the sha1 of its canonical path, so one directory has one id. */
export function repoId(path: string): string {
  return createHash("sha1").update(canonicalPath(path)).digest("hex").slice(0, 12);
}

export function repoNameFromPath(path: string): string {
  return basename(expandPath(path));
}

export function newRepoConfig(path: string, enabled = false): RepoConfig {
  const abs = canonicalPath(path);
  return { id: repoId(abs), path: abs, name: repoNameFromPath(abs), enabled };
}

export function validateConfig(input: unknown): Config {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`));
  }
  return upgradeFormerDefaults(result.data);
}

/**
 * Profiles are persisted from the first run on, so a reworded preset prompt would never reach an existing installation.
 * Only a verbatim former prompt or command of the preset with the profile's id is replaced: an edited prompt or command,
 * a removed prompt, another preset's former ones and profiles of no preset are the user's. Nothing is written here; the
 * value reaches the file with the next save.
 */
function upgradeFormerDefaults(config: Config): Config {
  const agents = config.agentSessions.agents.map((agent) => {
    const preset = AGENT_PRESETS.find((p) => p.profile.id === agent.id);
    if (!preset) return agent;
    const prompts = { ...agent.prompts };
    let upgraded = false;
    for (const [key, former] of Object.entries(preset.formerPrompts) as [PromptKey, readonly string[]][]) {
      const saved = prompts[key];
      if (saved === undefined || !former.includes(saved)) continue; // removed or edited: the user's
      prompts[key] = preset.profile.prompts[key];
      upgraded = true;
    }
    const { command } = agent;
    const formerCommand = preset.formerCommands?.some((former) => former.length === command.length && former.every((arg, i) => arg === command[i]));
    if (formerCommand) return { ...agent, prompts, command: [...preset.profile.command] };
    return upgraded ? { ...agent, prompts } : agent;
  });
  return { ...config, agentSessions: { ...config.agentSessions, agents } };
}

/** Same rule as `Config.scanRoots`: absolute after `~` expansion. Used for ad-hoc discovery roots. */
export function validateScanRoots(input: unknown): string[] {
  const result = scanRootsSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map((i) => `scanRoots${i.path.length ? `.${i.path.join(".")}` : ""}: ${i.message}`));
  }
  return result.data;
}

/** Same rule as `Config.ignorePaths`. Used for ad-hoc discovery ignore paths. */
export function validateIgnorePaths(input: unknown): string[] {
  const result = ignorePathsSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map((i) => `ignorePaths${i.path.length ? `.${i.path.join(".")}` : ""}: ${i.message}`));
  }
  return result.data;
}

function canonicalList(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return [...new Set(input.map((p) => (typeof p === "string" && p ? canonicalPath(p) : p)))];
}

/**
 * Brings a config written by an earlier version up to date before it is validated: `ignorePaths` defaults to empty,
 * stored paths become canonical, ids are recomputed, and repositories that turn out to be one directory are merged
 * (the enabled entry wins, else the first, together with its name). Anything it does not understand is left for
 * validation to report.
 */
export function migrateConfig(raw: unknown): { config: unknown; changed: boolean; warning?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { config: raw, changed: false };
  const input = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...input, scanRoots: canonicalList(input.scanRoots), ignorePaths: canonicalList(input.ignorePaths ?? []) };
  const merged: string[] = [];
  if (Array.isArray(input.repos)) {
    const byId = new Map<string, Record<string, unknown>>();
    const repos: unknown[] = [];
    for (const entry of input.repos) {
      if (!entry || typeof entry !== "object" || typeof (entry as { path?: unknown }).path !== "string" || !(entry as { path: string }).path) {
        repos.push(entry);
        continue;
      }
      const path = canonicalPath((entry as { path: string }).path);
      const repo: Record<string, unknown> = migrateAutoFetch({ ...(entry as Record<string, unknown>), id: repoId(path), path });
      const kept = byId.get(repo.id as string);
      if (!kept) {
        byId.set(repo.id as string, repo);
        repos.push(repo);
        continue;
      }
      const winner = kept.enabled !== true && repo.enabled === true ? repo : kept;
      const loser = winner === kept ? repo : kept;
      merged.push(`"${String(loser.name)}" into "${String(winner.name)}" (${path})`);
      if (winner !== kept) {
        byId.set(repo.id as string, repo);
        repos[repos.indexOf(kept)] = repo;
      }
    }
    next.repos = repos;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(input);
  const warning = merged.length ? `config.json listed the same directory more than once; merged ${merged.join(", ")}` : undefined;
  return { config: next, changed, warning };
}

/**
 * `autoFetchMinutes` (5, 15, 30 or 60, absent = off) became `autoFetchSeconds` (absent = every minute, 0 = off). A
 * saved interval is kept as the same number of seconds (none of the old ones is the new default). An entry that has both
 * keeps `autoFetchSeconds`, and a value that is not one of the old intervals is left for validation to report.
 */
function migrateAutoFetch(repo: Record<string, unknown>): Record<string, unknown> {
  if (!("autoFetchMinutes" in repo)) return repo;
  const { autoFetchMinutes: minutes, ...rest } = repo;
  if ("autoFetchSeconds" in rest) return rest;
  if (minutes !== 5 && minutes !== 15 && minutes !== 30 && minutes !== 60) return repo;
  return { ...rest, autoFetchSeconds: minutes * 60 };
}

/** Writes via a temp file + rename so a crash never leaves a half-written config. */
async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function saveConfig(config: Config): Promise<Config> {
  const valid = validateConfig(config);
  await writeAtomic(configPath(), `${JSON.stringify(valid, null, 2)}\n`);
  return valid;
}

/** The tail of the queue of config writes; a failed write must not stop the ones after it. */
let pendingWrite: Promise<unknown> = Promise.resolve();

/**
 * The one way to change the saved config while the server runs. Writes are applied one at a time, each to the config
 * as the previous write left it, so two requests arriving together cannot undo each other. `change` returns the next
 * config, or `undefined` when there is nothing to write; whatever it throws reaches the caller and nothing is saved.
 */
export function updateConfig(state: { config: Config }, change: (current: Config) => Config | undefined | Promise<Config | undefined>): Promise<{ previous: Config; saved: Config }> {
  const run = pendingWrite.then(async () => {
    const previous = state.config;
    const next = await change(previous);
    if (next === undefined) return { previous, saved: previous };
    state.config = await saveConfig(next);
    return { previous, saved: state.config };
  });
  pendingWrite = run.catch(() => undefined);
  return run;
}

/**
 * The port in `<home>/config.json`, read without writing or validating anything else, so the server can bind before
 * the home migration runs (the port is what keeps a second instance from moving a home in use). Anything unreadable
 * means the default, which is also what `loadConfig` falls back to.
 */
export async function configuredPort(home: string): Promise<number> {
  try {
    const port = (JSON.parse(await readFile(join(home, "config.json"), "utf8")) as { port?: unknown }).port;
    return typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Loads the config, creating defaults on first run. A corrupt file is moved
 * aside (`config.json.bak-<ts>`) and replaced by defaults so the dashboard
 * still starts; the returned `warning` says so.
 */
export async function loadConfig(): Promise<{ config: Config; warning?: string }> {
  await mkdir(dashboardHome(), { recursive: true });
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const config = await saveConfig(freshConfig());
    return { config };
  }
  try {
    const migrated = migrateConfig(JSON.parse(raw));
    const config = validateConfig(migrated.config);
    if (migrated.changed) await saveConfig(config);
    return { config, warning: migrated.warning };
  } catch (err) {
    const backup = `${path}.bak-${Date.now()}`;
    await rename(path, backup);
    const config = await saveConfig(freshConfig());
    const reason = err instanceof Error ? err.message : String(err);
    return { config, warning: `config.json was invalid (${reason}); moved to ${backup} and reset to defaults` };
  }
}
