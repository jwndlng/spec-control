import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type OpenSpecAction = "draft" | "implement" | "validate" | "archive";
export type WorkflowMode = "skill" | "cli";

export interface WorkflowResolution {
  mode: WorkflowMode;
  /** Checkout-relative path, when a project workflow file was found. */
  workflowPath?: string;
  /** A short action packet appended to the existing starter prompt. */
  instruction: string;
  diagnostic: string;
}

export class WorkflowUnavailableError extends Error {}

interface CommandResult { code: number; stdout: string; stderr: string }
export type WorkflowCommand = (cwd: string, argv: string[]) => Promise<CommandResult>;

const SKILL = {
  draft: "openspec-ff-change",
  implement: "openspec-apply-change",
  validate: "openspec-apply-change",
  archive: "openspec-archive-change",
} satisfies Record<OpenSpecAction, string>;
const WORKFLOW = {
  draft: "opsx-ff.md",
  implement: "opsx-apply.md",
  validate: "opsx-apply.md",
  archive: "opsx-archive.md",
} satisfies Record<OpenSpecAction, string>;
const MAX_SKILL_BYTES = 128 * 1024;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_PACKET_BYTES = 3500;
const MAX_FILE_BYTES = 64 * 1024;
const CLI_MINIMUM = [1, 13, 0];

const defaultCommand: WorkflowCommand = async (cwd, argv) => {
  const executable = Bun.which(argv[0]);
  if (!executable) throw new Error("OpenSpec CLI was not found on PATH");
  const proc = Bun.spawn([executable, ...argv.slice(1)], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env } });
  const timer = setTimeout(() => proc.kill(), 8000);
  try {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_COMMAND_BYTES) throw new Error("OpenSpec CLI output exceeded the workflow limit");
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

function within(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function readableProjectFile(root: string, relativePath: string): Promise<boolean> {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part === ".." || part === "")) return false;
  const rootReal = await realpath(root).catch(() => undefined);
  if (!rootReal) return false;
  const absolutePath = resolve(rootReal, relativePath);
  if (!within(rootReal, absolutePath)) return false;
  const parts = relative(rootReal, absolutePath).split(sep);
  let current = rootReal;
  try {
    for (const part of parts) {
      current = resolve(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) return false;
    }
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.size > MAX_SKILL_BYTES) return false;
    const text = await readFile(absolutePath, "utf8");
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

function skillCandidates(action: OpenSpecAction): string[] {
  const skill = SKILL[action];
  const workflow = WORKFLOW[action];
  // Probe documented project locations. The chosen file is always named explicitly in the prompt,
  // including when it is outside the selected runtime's native discovery directory.
  return [
    `.agents/skills/${skill}/SKILL.md`,
    `.claude/skills/${skill}/SKILL.md`,
    `.agents/workflows/${workflow}`,
  ];
}

function parseJson<T>(text: string, label: string): T {
  try { return JSON.parse(text) as T; } catch { throw new Error(`${label} did not return valid JSON`); }
}

function supportedVersion(output: string): string | undefined {
  const match = /(?:openspec\s+)?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?/i.exec(output);
  if (!match) return undefined;
  const version = match.slice(1, 4).map(Number);
  const below = version.some((part, i) => part < CLI_MINIMUM[i] && version.slice(0, i).every((n, j) => n === CLI_MINIMUM[j]));
  return below ? undefined : `${version[0]}.${version[1]}.${version[2]}`;
}

async function runJson<T>(run: WorkflowCommand, cwd: string, args: string[], label: string): Promise<T> {
  const result = await run(cwd, args);
  if (result.code !== 0) throw new Error(`${label} is not supported by the installed OpenSpec CLI`);
  return parseJson<T>(result.stdout, label);
}

interface StatusResult {
  changeName?: string;
  schemaName?: string;
  artifacts?: { id: string }[];
  artifactPaths?: Record<string, { outputPath?: string; existingOutputPaths?: string[] }>;
  planningHome?: { root?: string; kind?: string };
}
interface ApplyResult {
  changeName?: string;
  schemaName?: string;
  state?: string;
  contextFiles?: Record<string, string[]>;
}

async function contextPaths(root: string, files: Record<string, string[]> | undefined): Promise<string[]> {
  const paths = Object.values(files ?? {}).flat();
  if (!paths.length) throw new Error("OpenSpec apply instructions returned no context files");
  const rootReal = await realpath(root);
  const result: string[] = [];
  let totalBytes = 0;
  for (const path of paths) {
    const absolutePath = resolve(rootReal, path);
    if (!within(rootReal, absolutePath)) throw new Error("OpenSpec returned a context file outside this checkout");
    let current = rootReal;
    for (const part of relative(rootReal, absolutePath).split(sep)) {
      current = resolve(current, part);
      const segment = await lstat(current).catch(() => undefined);
      if (!segment || segment.isSymbolicLink()) throw new Error(`OpenSpec context file is missing or linked: ${relative(rootReal, absolutePath)}`);
    }
    const info = await lstat(absolutePath).catch(() => undefined);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`OpenSpec context file is missing or too large: ${relative(rootReal, absolutePath)}`);
    // The bytes are not copied into the prompt; reading them here proves each returned path is readable now.
    await readFile(absolutePath);
    totalBytes += info.size;
    if (totalBytes > MAX_COMMAND_BYTES) throw new Error("OpenSpec context exceeds the workflow limit");
    result.push(relative(rootReal, absolutePath));
  }
  return result;
}

function actionRules(action: OpenSpecAction, change: string, schema: string, files: string[]): string {
  const context = `The named project workflow was not found in this checkout; do not invoke it or search global skill locations. Follow this verified CLI fallback. Selected change: ${change}. Schema: ${schema}. Context files: ${files.join(", ")}.`;
  switch (action) {
    case "draft":
      return `Use the CLI-provided instructions for each schema artifact to create only the missing OpenSpec planning artifacts, in schema order. Do not implement application behavior. ${context}`;
    case "implement":
      return `Read the complete context and honor the apply state. If blocked, stop and explain the missing artifact; if all done, do not invent work. Implement only the selected change, track tasks at the location returned by OpenSpec, and verify before ticking them. ${context}`;
    case "validate":
      return `Use the OpenSpec task state and context. Check each - [~] task one at a time with the user; do the parts you can, and tick only tasks the user confirms. Leave unconfirmed tasks as - [~], with the exact user action on that task's line. Do not edit unrelated files. ${context}`;
    case "archive":
      return `Check the OpenSpec state and delta-spec sync before archiving. Sync required specs; never use --skip-specs. Do not archive blocked work or unconfirmed - [~] tasks. Use the CLI archive command only after the checks allow it. ${context}`;
  }
}

/** Resolve a checked-in workflow or a capability-checked CLI workflow in the actual session checkout. */
export async function resolveOpenSpecWorkflow(input: {
  root: string;
  change: string;
  action: OpenSpecAction;
  command?: WorkflowCommand;
}): Promise<WorkflowResolution> {
  const { root, change, action } = input;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(change)) throw new WorkflowUnavailableError("The change name is not safe for OpenSpec commands.");
  for (const candidate of skillCandidates(action)) {
    if (await readableProjectFile(root, candidate)) {
      return {
        mode: "skill",
        workflowPath: candidate,
        instruction: `Read and follow the project workflow at ${candidate} in this session checkout.`,
        diagnostic: `OpenSpec workflow loaded from ${candidate}`,
      };
    }
  }

  const setup = "Open Project settings → Update OpenSpec setup to add supported project workflows. No global settings or project files were changed by this check.";
  const run = input.command ?? defaultCommand;
  try {
    const versionResult = await run(root, ["openspec", "--version"]);
    const version = versionResult.code === 0 ? supportedVersion(versionResult.stdout) : undefined;
    if (!version) throw new Error("OpenSpec CLI is missing or older than 1.13.0");

    const status = await runJson<StatusResult>(run, root, ["openspec", "status", "--change", change, "--json"], "openspec status");
    if (status.changeName !== change || !status.schemaName) throw new Error("OpenSpec status did not resolve the selected change and schema");
    const checkoutRoot = await realpath(root);
    const planningRoot = status.planningHome?.root ? await realpath(status.planningHome.root).catch(() => undefined) : undefined;
    if (!planningRoot) throw new Error("OpenSpec status did not resolve a readable planning home");
    if (planningRoot !== checkoutRoot) throw new Error("the OpenSpec planning home is outside this session checkout; the session will not write to another checkout");
    const schemaArg = ["--schema", status.schemaName];
    let apply: ApplyResult;
    let pathList: string[];
    if (action === "draft") {
      const artifactIds = (status.artifacts ?? []).map((artifact) => artifact.id);
      if (!artifactIds.length) throw new Error("OpenSpec status returned no schema artifacts");
      const artifactPaths: string[] = [];
      for (const artifact of artifactIds) {
        const result = await runJson<Record<string, unknown>>(run, root, ["openspec", "instructions", artifact, "--change", change, ...schemaArg, "--json"], `instructions ${artifact}`);
        if (typeof result.instruction !== "string" || typeof result.outputPath !== "string") throw new Error(`instructions ${artifact} returned no workflow guidance or output path`);
        const output = status.artifactPaths?.[artifact]?.outputPath ?? result.outputPath;
        artifactPaths.push(`${artifact} → ${output}`);
      }
      apply = { changeName: change, schemaName: status.schemaName, state: "ready" };
      pathList = [];
      const commands = artifactIds.map((artifact) => `openspec instructions ${artifact} --change ${change} --schema ${status.schemaName} --json`).join("; ");
      const packet = `${actionRules(action, change, status.schemaName, pathList)} Planning home: this session checkout. Schema outputs: ${artifactPaths.join(", ")}. The installed CLI supports these artifact instruction commands: ${commands}. Run each and follow its returned instruction and template.`;
      if (Buffer.byteLength(packet) > MAX_PACKET_BYTES) throw new Error("OpenSpec artifact instructions exceed the prompt limit");
      return { mode: "cli", instruction: packet, diagnostic: `OpenSpec CLI ${version} verified; Draft uses the ${status.schemaName} artifact instructions.` };
    }

    apply = await runJson<ApplyResult>(run, root, ["openspec", "instructions", "apply", "--change", change, ...schemaArg, "--json"], "openspec instructions apply");
    if (apply.changeName !== change || apply.schemaName !== status.schemaName || !apply.state) throw new Error("OpenSpec apply instructions did not resolve the selected change state");
    if (apply.state === "blocked") throw new Error("OpenSpec apply is blocked by missing artifacts");
    if (action === "implement" && apply.state === "all_done") throw new Error("OpenSpec reports that implementation tasks are already complete");
    pathList = await contextPaths(planningRoot, apply.contextFiles);
    let archiveHelp = "";
    if (action === "archive") {
      const help = await run(root, ["openspec", "archive", "--help"]);
      if (help.code !== 0 || !/--skip-specs/.test(help.stdout + help.stderr)) throw new Error("the installed OpenSpec CLI does not expose a verifiable archive command");
      archiveHelp = "The CLI archive command syncs delta specs by default; do not pass --skip-specs or --no-validate.";
    }
    const stateLine = `Planning home: this session checkout. Apply state: ${apply.state}. CLI ${version}. Run openspec status --change ${change} --json and openspec instructions apply --change ${change} --json to refresh state.`;
    const packet = `${actionRules(action, change, status.schemaName, pathList)} ${stateLine} ${archiveHelp}`;
    if (Buffer.byteLength(packet) > MAX_PACKET_BYTES) throw new Error("OpenSpec workflow instructions exceed the prompt limit");
    return { mode: "cli", instruction: packet, diagnostic: `OpenSpec CLI ${version} verified; ${action} state is ${apply.state}.` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkflowUnavailableError(`OpenSpec ${action} workflow is unavailable: ${reason}. ${setup}`);
  }
}
