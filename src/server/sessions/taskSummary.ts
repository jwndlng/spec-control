import { createHash } from "node:crypto";
import { relative, dirname } from "node:path";
import type { FrameworkId, ShipTaskSummary } from "../../shared/types.ts";
import { frameworkById } from "../frameworks/registry.ts";
import { linkedSegment, LocalRepoSource, readBounded } from "../source.ts";

export const SHIP_TASK_BYTES = 64 * 1024;

/** Read only the session checkout, using its framework's paths and the bounded repository reader. */
export async function readShipTasks(checkout: string, change: string, frameworkId?: FrameworkId): Promise<{ summary: ShipTaskSummary; fingerprint: string }> {
  let summary: ShipTaskSummary = { verified: false, reason: "Task state could not be read.", total: 0, done: 0, open: [], awaiting: [], truncated: false };
  let content = "";
  try {
    const framework = frameworkById(frameworkId);
    if (!framework) throw new Error("The spec framework is unavailable.");
    const activeProblem = await linkedSegment(checkout, `${framework.layout.changesDir}/${change}`);
    if (activeProblem && activeProblem.reason !== "missing") throw new Error("The change directory contains a symbolic link or is not a directory.");
    const source = new LocalRepoSource(checkout);
    const listing = await framework.listChanges(source);
    const entry = listing.active.find((c) => c.name === change) ?? listing.archived.find((c) => c.name === change);
    if (!entry) throw new Error("The change directory is missing or contains a symbolic link.");
    const directory = relative(checkout, entry.dir);
    if (await linkedSegment(checkout, directory)) throw new Error("The change directory is missing or contains a symbolic link.");
    const project = await framework.readProject(source);
    const result = await framework.readChange(source, project, entry);
    if (!result.tasksPath) throw new Error("No tasks file is available in this checkout.");
    const rel = relative(checkout, result.tasksPath);
    if (rel.startsWith("..") || (await linkedSegment(checkout, relative(checkout, dirname(result.tasksPath)))))
      throw new Error("The tasks path is outside the checkout or contains a symbolic link.");
    const read = await readBounded(result.tasksPath, { within: dirname(result.tasksPath), inPlace: true, maxBytes: SHIP_TASK_BYTES, truncate: true });
    if (!read.ok) throw new Error(`Tasks could not be read (${read.reason}).`);
    content = read.text;
    summary = framework.shipTaskSummary(read.text);
    if (read.truncated)
      summary = { ...summary, verified: false, truncated: true, reason: "The tasks file exceeds the reading limit; completion is unverified." };
  } catch (err) {
    summary.reason = err instanceof Error ? err.message : "Task state could not be read.";
  }
  return { summary, fingerprint: createHash("sha256").update(JSON.stringify(summary)).update(content).digest("hex") };
}

export const tasksSettled = (summary: ShipTaskSummary): boolean =>
  summary.verified && !summary.truncated && summary.total > 0 && summary.done === summary.total;
