// Whether a change's delta specs are already reflected in the main specs. Nothing on disk records a sync, so it is
// derived by checking each delta against `openspec/specs/<capability>/spec.md`. Read-only.
import { join } from "node:path";
import { boundedReadWarning, CHANGE_NAME, MAX_REPO_FILE_BYTES, type RepoSource } from "../../source.ts";
import type { SpecSyncResult } from "../framework.ts";
import { extractRequirementsSection, normalizeRequirementName, parseDeltaSpec } from "./adapter.ts";

/** Trim, strip trailing spaces, collapse blank-line runs: differences a sync or an editor may introduce. */
function normalizeBlock(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * True when every operation in the delta already holds in the main spec. ADDED is matched by name only: once synced,
 * a later change may legitimately modify that requirement, which must not flip this change back.
 */
export function isDeltaSynced(deltaText: string, mainText: string | undefined): boolean {
  const plan = parseDeltaSpec(deltaText);
  // The parser is lenient: a malformed delta would otherwise look like "nothing to do" and pass as synced.
  if (plan.orphanedRequirements.length > 0 || plan.unpairedRenames.length > 0) {
    throw new Error("delta spec has requirements outside a delta section or an incomplete rename");
  }
  const main = new Map<string, string>();
  if (mainText !== undefined) {
    for (const block of extractRequirementsSection(mainText).bodyBlocks) main.set(normalizeRequirementName(block.name), block.raw);
  }
  const has = (name: string) => main.has(normalizeRequirementName(name));

  if (!plan.added.every((b) => has(b.name))) return false;
  if (!plan.modified.every((b) => has(b.name) && normalizeBlock(main.get(normalizeRequirementName(b.name)) ?? "") === normalizeBlock(b.raw))) return false;
  if (plan.removed.some((name) => has(name))) return false;
  if (!plan.renamed.every((r) => has(r.to) && !has(r.from))) return false;
  return true;
}

/** A change with no delta spec files has nothing to sync. Any read or parse problem counts as not synced. */
export async function changeSpecsSynced(source: RepoSource, changeDir: string): Promise<SpecSyncResult> {
  const warnings: string[] = [];
  let synced = true;
  for (const capability of await source.listDirs(join(changeDir, "specs"))) {
    if (!CHANGE_NAME.test(capability)) continue;
    const limit = MAX_REPO_FILE_BYTES;
    const delta = await source.readBounded(join(changeDir, "specs", capability, "spec.md"), { within: changeDir, maxBytes: limit });
    const deltaWarning = boundedReadWarning(`specs/${capability}/spec.md`, delta, limit);
    if (deltaWarning) {
      synced = false;
      warnings.push(deltaWarning);
    }
    if (!delta.ok) continue;
    const main = await source.readBounded(join(source.path, "openspec", "specs", capability, "spec.md"), { within: source.path, maxBytes: limit });
    const mainWarning = boundedReadWarning(`openspec/specs/${capability}/spec.md`, main, limit);
    if (mainWarning) {
      synced = false;
      warnings.push(mainWarning);
      continue;
    }
    try {
      if (!isDeltaSynced(delta.text, main.ok ? main.text : undefined)) synced = false;
    } catch (err) {
      synced = false;
      warnings.push(`could not check spec sync for ${capability}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { synced, warnings };
}
