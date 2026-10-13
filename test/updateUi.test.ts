import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "../src/shared/types.ts";
import { createDemoApi, DEMO_UPDATE_STATUS } from "../src/ui/demo/demoApi.ts";
import { lastCheckText, updateCheckBlocked, UpdatesPanel } from "../src/ui/settings.tsx";
import { parseSection, SECTION_IDS } from "../src/ui/settingsSections.ts";
import { bannerVersion, headerVersion, HOW_TO_UPDATE_URL, loadDismissed, saveDismissed, UPDATE_DISMISSED_KEY, UpdateBanner, VersionLabel } from "../src/ui/updateBanner.tsx";
import { byTag, textOf } from "./vnode.ts";

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true,
  current: "v0.11.2",
  latest: "v0.12.0",
  checkedAt: "2026-10-09T08:01:00.000Z",
  outcome: "ok",
  available: true,
  ...patch,
});

/** A Storage stand-in; `broken` throws like a blocked one. */
function memoryStorage(broken = false): Storage {
  const map = new Map<string, string>();
  const guard = () => {
    if (broken) throw new Error("blocked");
  };
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (guard(), map.get(k) ?? null),
    setItem: (k, v) => (guard(), void map.set(k, v)),
    removeItem: (k) => void map.delete(k),
  };
}

// ---- 4.2 the banner ----

test("the banner announces a newer version with both links and a dismiss button", () => {
  expect(bannerVersion(status(), undefined)).toBe("v0.12.0");
  const banner = UpdateBanner({ status: status(), dismissed: undefined, onDismiss: () => {} });
  expect(textOf(banner)).toContain("Spec Control v0.12.0 is available — you have v0.11.2.");
  const links = byTag(banner, "a");
  expect(links.map((a) => a.props.href)).toEqual(["https://github.com/jwndlng/spec-control/releases/tag/v0.12.0", HOW_TO_UPDATE_URL]);
  expect(links.map((a) => textOf(a))).toEqual(["Release notes", "How to update"]);
  for (const a of links) expect(a.props.target).toBe("_blank");
  const [dismiss] = byTag(banner, "button");
  expect(dismiss.props["aria-label"]).toContain("v0.12.0");
});

test("dismissing hides that version only; a newer one shows again", () => {
  let dismissed: string | undefined;
  const banner = UpdateBanner({ status: status(), dismissed: undefined, onDismiss: (v) => (dismissed = v) });
  (byTag(banner, "button")[0].props.onClick as () => void)();
  expect(dismissed).toBe("v0.12.0");
  expect(bannerVersion(status(), "v0.12.0")).toBeUndefined();
  expect(bannerVersion(status({ latest: "v0.13.0" }), "v0.12.0")).toBe("v0.13.0");
});

test("no banner when nothing is available, checks are off, or nothing is known yet", () => {
  expect(bannerVersion(undefined, undefined)).toBeUndefined();
  expect(bannerVersion(status({ available: false, latest: "v0.11.2" }), undefined)).toBeUndefined();
  expect(bannerVersion(status({ enabled: false, available: false }), undefined)).toBeUndefined();
  expect(bannerVersion(status({ enabled: false }), undefined)).toBeUndefined();
  expect(bannerVersion(status({ outcome: "never", latest: undefined, checkedAt: undefined, available: false }), undefined)).toBeUndefined();
  const empty = UpdateBanner({ status: status({ available: false }), dismissed: undefined, onDismiss: () => {} });
  expect(textOf(empty)).toBe("");
  // The live region stays, so the banner's arrival is announced.
  expect(empty.props.role).toBe("status");
});

test("the dismissed version is kept per browser, and blocked storage only means the banner comes back", () => {
  const storage = memoryStorage();
  expect(loadDismissed(storage)).toBeUndefined();
  saveDismissed("v0.12.0", storage);
  expect(storage.getItem(UPDATE_DISMISSED_KEY)).toBe("v0.12.0");
  expect(UPDATE_DISMISSED_KEY).toBe("spec-control.updateDismissed");
  expect(loadDismissed(storage)).toBe("v0.12.0");
  const blocked = memoryStorage(true);
  expect(() => saveDismissed("v0.12.0", blocked)).not.toThrow();
  expect(loadDismissed(blocked)).toBeUndefined();
});

test("the page asks only its own server: the banner module requests nothing", () => {
  const source = readFileSync(join(import.meta.dir, "../src/ui/updateBanner.tsx"), "utf8");
  expect(source).not.toContain("fetch(");
});

// ---- the version in the header ----

test("a release build shows its version in the header, linked to its release page", () => {
  expect(headerVersion(status({ current: "v0.12.0" }))).toBe("v0.12.0");
  const label = VersionLabel({ status: status({ current: "v0.12.0" }) });
  const [link] = byTag(label, "a");
  expect(textOf(link)).toBe("v0.12.0");
  expect(link.props.href).toBe("https://github.com/jwndlng/spec-control/releases/tag/v0.12.0");
  expect(link.props.target).toBe("_blank");
  expect(link.props.rel).toBe("noopener noreferrer");
  expect(link.props["aria-label"]).toContain("v0.12.0");
});

test("the header version does not depend on checks being on or an update being available", () => {
  expect(headerVersion(status({ enabled: false, available: false, outcome: "never", latest: undefined }))).toBe("v0.11.2");
  expect(headerVersion(status({ available: false }))).toBe("v0.11.2");
});

test("dev, the demo, other versions and an unknown status show no version in the header", () => {
  for (const current of ["dev", "demo", "v0.12", "0.12.0", "v0.12.0-rc.1", "nightly"]) {
    expect(headerVersion(status({ current }))).toBeUndefined();
    expect(VersionLabel({ status: status({ current }) })).toBeNull();
  }
  expect(headerVersion(undefined)).toBeUndefined();
  expect(VersionLabel({ status: undefined })).toBeNull();
  expect(headerVersion(DEMO_UPDATE_STATUS)).toBeUndefined();
});

// ---- 4.4 the Updates section ----

test("Updates sits before Environment and can be linked to", () => {
  expect(SECTION_IDS.slice(-2)).toEqual(["updates", "environment"]);
  expect(parseSection("?section=updates", SECTION_IDS)).toBe("updates");
});

const panel = (s: UpdateStatus | undefined, on = true, extra: { checking?: boolean; error?: string } = {}) =>
  UpdatesPanel({ status: s, on, onToggle: () => {}, checking: extra.checking ?? false, error: extra.error, onCheck: () => {} });
const checkNow = (node: ReturnType<typeof panel>) => byTag(node, "button").find((b) => textOf(b).includes("Check"));

test("the section shows the running version, the last check and an enabled Check now", () => {
  const node = panel(status());
  const text = textOf(node);
  expect(text).toContain("Check for new versions");
  expect(text).toContain("Running v0.11.2");
  expect(text).toContain("v0.12.0 is available");
  expect(checkNow(node)?.props.disabled).toBe(false);
  expect(byTag(node, "input")[0].props.checked).toBe(true);
});

test("the switch is part of the draft: toggling reports the new value", () => {
  const seen: boolean[] = [];
  const node = UpdatesPanel({ status: status(), on: true, onToggle: (on) => seen.push(on), checking: false, error: undefined, onCheck: () => {} });
  (byTag(node, "input")[0].props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
  expect(seen).toEqual([false]);
});

test("Check now is disabled while off, while the draft turns it off or on unsaved, and for dev with the reason", () => {
  // Off in the draft (saved or not).
  expect(checkNow(panel(status(), false))?.props.disabled).toBe(true);
  expect(updateCheckBlocked(status(), false)).toContain("Turned off");
  // Saved off, drafted on: not until saved.
  expect(updateCheckBlocked(status({ enabled: false, available: false }), true)).toBe("Save to turn checking on.");
  // A development build says why, whatever the switch says.
  const dev = panel({ enabled: false, current: "dev", outcome: "never", available: false });
  expect(checkNow(dev)?.props.disabled).toBe(true);
  expect(textOf(dev)).toContain("Running dev");
  expect(textOf(dev)).toContain("Development builds do not check for new versions.");
  // Not loaded yet, or a check under way.
  expect(checkNow(panel(undefined))?.props.disabled).toBe(true);
  expect(checkNow(panel(status(), true, { checking: true }))?.props.disabled).toBe(true);
});

test("the last check is described in words", () => {
  expect(lastCheckText(status({ outcome: "never", checkedAt: undefined, latest: undefined, available: false }))).toBe("Not checked yet.");
  expect(lastCheckText(status({ latest: "v0.11.2", available: false }))).toContain("up to date");
  expect(lastCheckText(status({ outcome: "failed" }))).toContain("failed — the latest release known is v0.12.0");
  expect(lastCheckText(status({ outcome: "failed", latest: undefined, available: false }))).toMatch(/failed\.$/);
  expect(textOf(panel(status(), true, { error: "turned off" }))).toContain("The check could not run: turned off");
});

// ---- 4.1 the demo ----

test("the demo shows the section, never a banner, refuses Check now and requests nothing", async () => {
  const api = createDemoApi({ now: () => Date.parse("2026-06-01T12:00:00.000Z"), latencyMs: 0 });
  const original = globalThis.fetch;
  let requested = 0;
  globalThis.fetch = (() => {
    requested++;
    return Promise.reject(new Error("no network in the demo"));
  }) as unknown as typeof fetch;
  try {
    const shown = await api.updateStatus();
    expect(shown).toEqual(DEMO_UPDATE_STATUS);
    expect(bannerVersion(shown, undefined)).toBeUndefined();
    await expect(api.checkForUpdate()).rejects.toMatchObject({ status: 409 });
    const node = panel(shown);
    expect(textOf(node)).toContain("The demo does not check for new versions.");
    expect(checkNow(node)?.props.disabled).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
  expect(requested).toBe(0);
});
