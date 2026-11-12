import { afterAll, beforeAll, expect, test } from "bun:test";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { defaultConfig, saveConfig } from "../src/server/config.ts";
import { type Config, type RepoSnapshot } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
let home: string;
let state: AppState;
let handler: (request: Request) => Promise<Response>;
const repoId = "123456789abc";

beforeAll(async () => {
  ({ home, cleanup } = await useTempHome());
  await tempDir();
  const config: Config = await saveConfig({ ...defaultConfig(), agentSessions: { ...defaultConfig().agentSessions, enabled: true }, repos: [{ id: repoId, path: `${home}/repo`, name: "repo", enabled: true }] });
  const scanned = { id: repoId, changes: [{ name: "change-one", archived: false }] } as unknown as RepoSnapshot;
  state = { config, scanner: { snapshot: { repos: [scanned] } } as AppState["scanner"] };
  handler = createFetchHandler({ state, indexHtml: "" });
});
afterAll(async () => cleanup());

const call = (path: string, method = "GET", body?: unknown) => handler(new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));

test("permission preview returns effective profile, adapters, matrix, protected commands and notice", async () => {
  const response = await call(`/api/repos/${repoId}/agent-permissions?change=change-one`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.effectiveProfile).toBe("minimum");
  expect(body.agentPreview.claude.args).toContain("plan");
  expect(body.capabilityMatrix.some((item: { agentId: string }) => item.agentId === "codex")).toBe(true);
  expect(body.protectedCommands).toContain("rm -rf*");
  expect(body.securityNotice).toContain("executes repository code");
});

test("project custom commands validate, normalize, preview and clear through the project-agent route", async () => {
  const path = `/api/repos/${repoId}/agent`;
  const set = await call(path, "POST", { allowedCommands: [" bun   run lint ", "bun run lint"], permissionProfile: "less-friction" });
  expect(set.status).toBe(200);
  expect(state.config.repos[0]?.agent?.allowedCommands).toEqual(["bun run lint"]);
  const preview = await call(`/api/repos/${repoId}/agent-permissions?agent=claude`);
  const body = await preview.json();
  expect(body.effectivePolicy.allowedCommands).toEqual(["bun run lint"]);
  expect(body.agentPreview.claude.args).toContain("Bash(bun run lint)");
  const invalid = await call(path, "POST", { allowedCommands: ["bun run lint; echo unsafe"] });
  expect(invalid.status).toBe(400);
  expect(state.config.repos[0]?.agent?.allowedCommands).toEqual(["bun run lint"]);
  expect((await call("/api/repos/unknown/agent", "POST", { allowedCommands: ["bun run test"] })).status).toBe(404);
  const crossOrigin = await handler(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://outside.example" }, body: JSON.stringify({ allowedCommands: ["bun run test"] }) }));
  expect(crossOrigin.status).toBe(403);
  expect(state.config.repos[0]?.agent?.allowedCommands).toEqual(["bun run lint"]);
  const clear = await call(path, "POST", { allowedCommands: [], permissionProfile: null });
  expect(clear.status).toBe(200);
  expect(state.config.repos[0]?.agent?.allowedCommands).toBeUndefined();
  await call(path, "POST", { allowedCommands: ["bun run test"] });
  const minimum = await call(`/api/repos/${repoId}/agent-permissions?agent=claude`);
  const minimumBody = await minimum.json();
  expect(minimumBody.agentPreview.claude.args).not.toContain("Bash(bun run test)");
  expect(minimumBody.limitations.join(" ")).toContain("inactive under the minimum");
  await call(path, "POST", { allowedCommands: [] });
  const malformed = await call(path, "POST", { allowedCommands: ["bun run lint", 42] });
  expect(malformed.status).toBe(400);
  const concurrent = await Promise.all([
    call(path, "POST", { allowedCommands: ["bun run check"] }),
    call(`/api/repos/${repoId}/name`, "POST", { name: "renamed" }),
  ]);
  expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
  expect(state.config.repos[0]?.agent?.allowedCommands).toEqual(["bun run check"]);
  expect(state.config.repos[0]?.name).toBe("renamed");
});

test("change profile override saves and clearing it restores inheritance", async () => {
  const setResponse = await call(`/api/repos/${repoId}/changes/change-one/permission-profile`, "POST", { permissionProfile: "less-friction" });
  expect(setResponse.status).toBe(200);
  expect(state.config.repos[0].agentOverrides?.["change-one"]?.permissionProfile).toBe("less-friction");
  const clearResponse = await call(`/api/repos/${repoId}/changes/change-one/permission-profile`, "POST", { permissionProfile: null });
  expect(clearResponse.status).toBe(200);
  expect(state.config.repos[0].agentOverrides).toBeUndefined();
});

test("permission API reports an override and rejects malformed or disabled requests", async () => {
  await call(`/api/repos/${repoId}/changes/change-one/permission-profile`, "POST", { permissionProfile: "full-automation" });
  const preview = await call(`/api/repos/${repoId}/agent-permissions?change=change-one`);
  expect((await preview.json()).effectiveProfile).toBe("full-automation");
  const malformed = await handler(new Request(`http://localhost/api/repos/${repoId}/changes/change-one/permission-profile`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
  expect(malformed.status).toBe(400);
  state.config.agentSessions.enabled = false;
  expect((await call(`/api/repos/${repoId}/agent-permissions`)).status).toBe(403);
  state.config.agentSessions.enabled = true;
});

test("invalid override and missing repository are refused", async () => {
  expect((await call(`/api/repos/${repoId}/changes/change-one/permission-profile`, "POST", { permissionProfile: "bypass" })).status).toBe(400);
  expect((await call("/api/repos/unknown/agent-permissions")).status).toBe(404);
});
