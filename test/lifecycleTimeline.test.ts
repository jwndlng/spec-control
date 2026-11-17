import { describe, expect, test } from "bun:test";
import type { ChangeArtifactEntry, ChangeSnapshot } from "../src/shared/types.ts";
import type { LifecycleDeliveryView } from "../src/ui/api.ts";
import { lifecycleTimelineModel } from "../src/ui/lifecycleTimeline.tsx";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";

const change = (overrides: Partial<ChangeSnapshot> = {}) => ({
  stage: "drafts", artifacts: [], tasks: null, ...overrides,
}) as ChangeSnapshot;
const artifact = (id: string, status: ChangeArtifactEntry["status"]): ChangeArtifactEntry => ({ id, status, files: [] });
const delivery = (overrides: Partial<LifecycleDeliveryView> = {}): LifecycleDeliveryView => ({
  id: "delivery-1", phase: "implementation", revision: 1, state: "pending", recovery: [], attempts: 1, updatedAt: "2026-11-16T12:00:00Z", ...overrides,
});

describe("lifecycleTimelineModel", () => {
  test("uses schema artifact names and does not fabricate missing evidence", () => {
    const model = lifecycleTimelineModel(change(), [artifact("overview", "done"), artifact("quality-gate", "blocked")], []);
    expect(model.current).toBe("Drafts");
    expect(model.artifacts).toEqual([
      { id: "overview", label: "Overview", status: "done" },
      { id: "quality-gate", label: "Quality gate", status: "blocked" },
    ]);
    expect(model.validation).toBeUndefined();
    expect(model.persistence).toEqual([]);
  });

  test("shows validation and local progress only when snapshot evidence exists", () => {
    const model = lifecycleTimelineModel(change({ stage: "done", subState: "validate", tasks: { done: 2, awaiting: 1, total: 4 } }), [], []);
    expect(model.current).toBe("Done");
    expect(model.validation).toBe("Validation awaiting confirmation");
    expect(model.localProgress).toBe("2/4 tasks complete · 1 awaiting confirmation");
  });

  test("labels pending pull-request delivery and archived local state separately", () => {
    const model = lifecycleTimelineModel(change({ stage: "archived", archived: "2026-11-16" }), [], [delivery({ phase: "archive", pullRequestNumber: 42 })]);
    expect(model.current).toBe("Archived");
    expect(model.phases.at(-1)?.state).toBe("current");
    expect(model.persistence).toEqual([{ id: "delivery-1", label: "Archive delivery: Pending", pullRequestNumber: 42, pullRequestUrl: undefined }]);
  });

  test("demo includes fictional pending, blocked and archive delivery examples", async () => {
    const api = createDemoApi({ now: () => Date.parse("2026-11-16T12:00:00Z"), latencyMs: 0 });
    expect((await api.lifecycleDeliveries("demo", "idempotency-keys"))[0]?.state).toBe("pending");
    expect((await api.lifecycleDeliveries("demo", "deprecate-v1-auth"))[0]?.state).toBe("blocked");
    expect((await api.lifecycleDeliveries("demo", "add-health-endpoint"))[0]?.phase).toBe("archive");
  });
});
