import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetchHandler } from "../src/server/api.ts";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { LifecycleDeliveryMonitor, writeLifecycleDelivery } from "../src/server/lifecycleDelivery.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { Config, LifecycleDeliveryRecord, Snapshot } from "../src/shared/types.ts";

test("lifecycle delivery API is same-origin, exposes no local paths, and serializes duplicate retries", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-api-"));
  try {
    const repo = newRepoConfig(join(home, "repo"), true);
    const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } } satisfies Config;
    const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [] };
    const path = join(home, "lifecycle.json");
    const row: LifecycleDeliveryRecord = {
      version: 1, id: "a".repeat(64), projectId: repo.id, projectPath: repo.path, projectIncarnation: "project",
      change: "sample", changeIncarnation: "change", phase: "proposal", revision: 1, actionId: "action-identity", completionRevision: 1,
      sessionId: "session", worktreePath: join(home, "private-worktree"), branch: "docs/sample", contentHash: "content",
      snapshotHash: "snapshot", state: "blocked", blocker: "temporary failure", recovery: ["retry"],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attempts: 1,
    };
    let calls = 0;
    const monitor = new LifecycleDeliveryMonitor({
      getConfig: () => config, getSnapshot: () => snapshot, listSessions: () => [], completion: () => undefined,
      readReports: async () => undefined,
      deliver: async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return { pullRequestUrl: "https://github.com/acme/sample/pull/12", pullRequestNumber: 12 }; },
    }, path);
    await writeLifecycleDelivery([row], path);
    await monitor.init();
    const handler = createFetchHandler({ state: { config, scanner: new Scanner(() => config, { persist: false }, snapshot), lifecycleDelivery: monitor }, indexHtml: "" });
    const get = await handler(new Request(`http://127.0.0.1/api/repos/${repo.id}/changes/sample/delivery`));
    expect(get.status).toBe(200);
    const listed = await get.json() as { deliveries: Record<string, unknown>[] };
    expect(listed.deliveries[0]).toMatchObject({ id: row.id, phase: "proposal", state: "blocked" });
    expect(JSON.stringify(listed)).not.toContain("private-worktree");

    const url = `http://127.0.0.1/api/repos/${repo.id}/changes/sample/delivery`;
    const crossSite = await handler(new Request(url, { method: "POST", headers: { origin: "https://outside.invalid", "content-type": "application/json" }, body: JSON.stringify({ checkpointId: row.id }) }));
    expect(crossSite.status).toBe(403);
    const retry = () => handler(new Request(url, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ checkpointId: row.id }) }));
    const [first, second] = await Promise.all([retry(), retry()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
    const state = await first.json() as { delivery: { state: string; pullRequestNumber: number } };
    expect(state.delivery).toMatchObject({ state: "waiting-to-merge", pullRequestNumber: 12 });

    const obsolete = await handler(new Request(url, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ checkpointId: "b".repeat(64) }) }));
    expect(obsolete.status).toBe(409);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
