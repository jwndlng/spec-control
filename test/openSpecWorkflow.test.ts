import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { resolveOpenSpecWorkflow, WorkflowUnavailableError, type WorkflowCommand } from "../src/server/frameworks/openspec/workflow.ts";

const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), "spec-control-workflow-"));
  roots.push(path);
  return path;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const CHANGE = "cache-api-calls";
const status = {
  changeName: CHANGE,
  schemaName: "spec-driven",
  artifacts: [{ id: "proposal" }, { id: "specs" }, { id: "design" }, { id: "tasks" }],
  artifactPaths: { tasks: { outputPath: "openspec/changes/cache-api-calls/tasks.md" } },
};
const apply = (state = "ready") => ({
  changeName: CHANGE,
  schemaName: "spec-driven",
  state,
  contextFiles: { proposal: ["openspec/changes/cache-api-calls/proposal.md"], tasks: ["openspec/changes/cache-api-calls/tasks.md"] },
});
async function fixture(dir: string) {
  await mkdir(join(dir, "openspec/changes", CHANGE), { recursive: true });
  await writeFile(join(dir, "openspec/changes", CHANGE, "proposal.md"), "proposal");
  await writeFile(join(dir, "openspec/changes", CHANGE, "tasks.md"), "- [ ] task");
}
const command = (state = "ready", calls: string[][] = []): WorkflowCommand => async (_cwd, argv) => {
  calls.push(argv);
  if (argv[0] === "openspec" && argv[1] === "--version") return { code: 0, stdout: "openspec 1.15.0\n", stderr: "" };
  if (argv[1] === "status") return { code: 0, stdout: JSON.stringify({ ...status, planningHome: { kind: "repo", root: _cwd } }), stderr: "" };
  if (argv[1] === "instructions" && argv[2] === "apply") return { code: 0, stdout: JSON.stringify(apply(state)), stderr: "" };
  if (argv[1] === "instructions") return { code: 0, stdout: JSON.stringify({ instruction: "Follow schema", outputPath: `${argv[2]}.md` }), stderr: "" };
  if (argv[1] === "archive" && argv[2] === "--help") return { code: 0, stdout: "Usage: openspec archive [change] --skip-specs", stderr: "" };
  return { code: 1, stdout: "", stderr: "unsupported" };
};

test("a tracked Claude skill is resolved from the actual checkout with an explicit relative path", async () => {
  const checkout = await root();
  await mkdir(join(checkout, ".claude/skills/openspec-apply-change"), { recursive: true });
  await writeFile(join(checkout, ".claude/skills/openspec-apply-change/SKILL.md"), "Implement tasks from an OpenSpec change");
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: async () => { throw new Error("CLI should not be needed"); } });
  expect(result.mode).toBe("skill");
  expect(result.instruction).toContain(".claude/skills/openspec-apply-change/SKILL.md");
});

test("a main-only .agents skill is not copied into the fresh session checkout", async () => {
  const main = await root();
  const checkout = await root();
  await fixture(checkout);
  await mkdir(join(main, ".agents/skills/openspec-apply-change"), { recursive: true });
  await writeFile(join(main, ".agents/skills/openspec-apply-change/SKILL.md"), "main-only skill");
  const calls: string[][] = [];
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: command("ready", calls) });
  expect(result.mode).toBe("cli");
  expect(result.instruction).toContain("openspec instructions apply");
  expect(await Bun.file(join(checkout, ".agents/skills/openspec-apply-change/SKILL.md")).exists()).toBe(false);
  expect(calls.some((args) => args.includes("init") || args.includes("update"))).toBe(false);
  expect(calls.every((args) => args[0] === "openspec")).toBe(true);
});

test("a missing native skill uses checked CLI apply context and task tracking", async () => {
  const checkout = await root();
  await fixture(checkout);
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: command() });
  expect(result.mode).toBe("cli");
  expect(result.instruction).toContain("Schema: spec-driven");
  expect(result.instruction).toContain("do not invoke it or search global skill locations");
  expect(result.instruction).toContain("tasks.md");
  expect(result.instruction).toContain("track tasks");
  expect(result.diagnostic).toContain("1.15.0");
});

test("Draft verifies every schema artifact instruction and limits its packet", async () => {
  const checkout = await root();
  await fixture(checkout);
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "draft", command: command() });
  expect(result.mode).toBe("cli");
  expect(result.instruction).toContain("openspec instructions proposal");
  expect(result.instruction).toContain("create only the missing");
  expect(Buffer.byteLength(result.instruction)).toBeLessThan(3500);
});

test("unsupported and missing CLI versions produce a project setup blocker", async () => {
  const checkout = await root();
  await fixture(checkout);
  const unsupported: WorkflowCommand = async (_cwd, argv) => argv[1] === "--version" ? { code: 0, stdout: "1.12.0", stderr: "" } : { code: 1, stdout: "", stderr: "" };
  await expect(resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: unsupported })).rejects.toThrow("older than 1.13.0");
  const unsupportedCapability: WorkflowCommand = async (_cwd, argv) => {
    if (argv[1] === "--version") return { code: 0, stdout: "openspec 1.15.0", stderr: "" };
    if (argv[1] === "status") return { code: 0, stdout: JSON.stringify({ ...status, planningHome: { kind: "repo", root: checkout } }), stderr: "" };
    return { code: 1, stdout: "unknown command", stderr: "" };
  };
  await expect(resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: unsupportedCapability })).rejects.toThrow("instructions apply is not supported");
  await expect(resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: async () => { throw new Error("missing"); } })).rejects.toBeInstanceOf(WorkflowUnavailableError);
});

test("blocked apply instructions stop fallback before the agent starts", async () => {
  const checkout = await root();
  await fixture(checkout);
  await expect(resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: command("blocked") })).rejects.toThrow("blocked by missing artifacts");
});

test("Archive checks the CLI capability and its prompt preserves spec sync", async () => {
  const checkout = await root();
  await fixture(checkout);
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "archive", command: command("all_done") });
  expect(result.instruction).toContain("delta-spec sync");
  expect(result.instruction).toContain("do not pass --skip-specs");
});

test("Validate keeps user confirmation and leaves unconfirmed tasks open", async () => {
  const checkout = await root();
  await fixture(checkout);
  const result = await resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "validate", command: command() });
  expect(result.instruction).toContain("one at a time");
  expect(result.instruction).toContain("only tasks the user confirms");
  expect(result.instruction).toContain("exact user action on that task's line");
});

test("a planning home outside the session checkout is refused", async () => {
  const checkout = await root();
  const external = await root();
  await fixture(checkout);
  const externalRootCommand: WorkflowCommand = async (_cwd, argv) => {
    if (argv[1] === "--version") return { code: 0, stdout: "1.15.0", stderr: "" };
    if (argv[1] === "status") return { code: 0, stdout: JSON.stringify({ ...status, planningHome: { kind: "store", root: external } }), stderr: "" };
    return command()(checkout, argv);
  };
  await expect(resolveOpenSpecWorkflow({ root: checkout, change: CHANGE, action: "implement", command: externalRootCommand })).rejects.toThrow("outside this session checkout");
});
