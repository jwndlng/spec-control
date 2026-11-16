import { afterAll, beforeAll, expect, test } from "bun:test";
import { currentIdentity, dismissIdentity, isDismissed, listDismissals, restoreIdentity } from "../src/server/dismissalStore.ts";
import { useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
beforeAll(async () => { ({ cleanup } = await useTempHome()); });
afterAll(async () => { await cleanup(); });

test("fallback identity is stable across checkout changes and reads, but scoped to repository", async () => {
  const first = await currentIdentity("repo-a", "same-name");
  expect(await currentIdentity("repo-a", "same-name")).toBe(first);
  expect(await currentIdentity("repo-b", "same-name")).not.toBe(first);
  const record = await dismissIdentity("repo-a", "same-name", undefined, first);
  expect(await isDismissed("repo-a", "same-name")).toBe(true);
  expect((await listDismissals("repo-a")).map((r) => r.identity)).toEqual([record.identity]);
  // A new server read uses only the durable home record and deterministic fallback.
  expect(await currentIdentity("repo-a", "same-name")).toBe(first);
  expect(await isDismissed("repo-b", "same-name")).toBe(false);
});

test("verified creation metadata scopes a dismissal and later name reuse is visible", async () => {
  const oldIdentity = await currentIdentity("repo-created", "reused", "2026-01-02");
  await dismissIdentity("repo-created", "reused", "2026-01-02", oldIdentity);
  expect(await isDismissed("repo-created", "reused", "2026-01-02")).toBe(true);
  expect(await isDismissed("repo-created", "reused", "2099-02-03")).toBe(false);
  expect(await currentIdentity("repo-created", "reused", "2099-02-03")).toBe("created:2099-02-03");
});

test("unknown creation date keeps the fallback dismissal instead of guessing from edits", async () => {
  const id = await currentIdentity("repo-unknown", "change");
  await dismissIdentity("repo-unknown", "change", undefined, id);
  expect(await isDismissed("repo-unknown", "change", "2000-01-01")).toBe(true);
  expect(await currentIdentity("repo-unknown", "change", "2000-01-01")).toBe(id);
});

test("restore removes only the matching project and incarnation and is idempotent", async () => {
  const id = await currentIdentity("repo-restore", "change");
  await dismissIdentity("repo-restore", "change", undefined, id);
  await restoreIdentity("repo-restore", "change", "other-id");
  expect(await isDismissed("repo-restore", "change")).toBe(true);
  await restoreIdentity("repo-restore", "change", id);
  await restoreIdentity("repo-restore", "change", id);
  expect(await isDismissed("repo-restore", "change")).toBe(false);
});
